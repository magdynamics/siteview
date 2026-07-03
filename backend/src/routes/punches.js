const express = require('express');
const router = express.Router();
const { db } = require('../services/firebase');
const { authenticate, authorize } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// Employee punches in
router.post('/in', authenticate, async (req, res) => {
  try {
    const { siteId, latitude, longitude, isManual, employeeId, note } = req.body;
    const targetEmployeeId = isManual ? employeeId : req.user.uid;
    const performedBy = isManual ? req.user.uid : null;

    // Verify employee is assigned to this site
    const employeeDoc = await db.collection('users').doc(targetEmployeeId).get();
    const employee = employeeDoc.data();

    if (employee.assignedSiteId !== siteId) {
      return res.status(400).json({ error: 'Employee not assigned to this site' });
    }

    // Check geofence if not manual
    if (!isManual) {
      const siteDoc = await db.collection('sites').doc(siteId).get();
      const site = siteDoc.data();
      const distance = getDistance(latitude, longitude, site.latitude, site.longitude);
      if (distance > site.geofenceRadius) {
        return res.status(400).json({ error: 'You are not within the site boundary' });
      }
    }

    const punchId = uuidv4();
    const punch = {
      id: punchId,
      employeeId: targetEmployeeId,
      siteId,
      type: 'in',
      timestamp: new Date().toISOString(),
      latitude: latitude || null,
      longitude: longitude || null,
      isManual: isManual || false,
      performedBy: performedBy,
      note: note || null,
      status: 'active',
    };

    await db.collection('punches').doc(punchId).set(punch);

    // Audit log
    await logAudit({
      action: 'PUNCH_IN',
      employeeId: targetEmployeeId,
      performedBy: req.user.uid,
      isManual: isManual || false,
      siteId,
      note,
      timestamp: punch.timestamp,
    });

    res.status(201).json({ message: 'Punched in successfully', punch });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Employee punches out (end of day or break)
router.post('/out', authenticate, async (req, res) => {
  try {
    const { siteId, latitude, longitude, isManual, employeeId, note, breakType } = req.body;
    const targetEmployeeId = isManual ? employeeId : req.user.uid;

    const punchType = breakType ? `break_${breakType}` : 'out';

    const punchId = uuidv4();
    const punch = {
      id: punchId,
      employeeId: targetEmployeeId,
      siteId,
      type: punchType,
      timestamp: new Date().toISOString(),
      latitude: latitude || null,
      longitude: longitude || null,
      isManual: isManual || false,
      performedBy: isManual ? req.user.uid : null,
      note: note || null,
    };

    await db.collection('punches').doc(punchId).set(punch);

    await logAudit({
      action: punchType === 'out' ? 'PUNCH_OUT' : `BREAK_${breakType?.toUpperCase()}`,
      employeeId: targetEmployeeId,
      performedBy: req.user.uid,
      isManual: isManual || false,
      siteId,
      note,
      timestamp: punch.timestamp,
    });

    // Nudge: equipment checked out to this employee with no hours logged today
    let hoursLogNeeded = [];
    if (punchType === 'out') {
      const today = new Date().toISOString().split('T')[0];
      const equipSnap = await db.collection('equipment')
        .where('assignedTo', '==', targetEmployeeId)
        .get();
      hoursLogNeeded = equipSnap.docs
        .map(d => d.data())
        .filter(e => e.isActive !== false && e.lastHoursLogDate !== today)
        .map(e => ({ id: e.id, name: e.name }));
    }

    res.status(201).json({ message: 'Punched out successfully', punch, hoursLogNeeded });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get today's punches for an employee
router.get('/today/:employeeId', authenticate, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const snapshot = await db.collection('punches')
      .where('employeeId', '==', req.params.employeeId)
      .where('timestamp', '>=', `${today}T00:00:00.000Z`)
      .where('timestamp', '<=', `${today}T23:59:59.999Z`)
      .orderBy('timestamp', 'asc')
      .get();

    const punches = snapshot.docs.map(doc => doc.data());
    res.json(punches);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Supervisor: get live site attendance
router.get('/site/:siteId/live', authenticate, authorize('supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const snapshot = await db.collection('punches')
      .where('siteId', '==', req.params.siteId)
      .where('timestamp', '>=', `${today}T00:00:00.000Z`)
      .orderBy('timestamp', 'asc')
      .get();

    const punches = snapshot.docs.map(doc => doc.data());

    // Calculate who is currently on site
    const employeeStatus = {};
    punches.forEach(punch => {
      if (!employeeStatus[punch.employeeId]) {
        employeeStatus[punch.employeeId] = { status: 'absent', lastPunch: null };
      }
      employeeStatus[punch.employeeId].lastPunch = punch;
      if (punch.type === 'in') employeeStatus[punch.employeeId].status = 'on_site';
      else if (punch.type === 'out') employeeStatus[punch.employeeId].status = 'left';
      else if (punch.type.startsWith('break')) employeeStatus[punch.employeeId].status = 'on_break';
    });

    res.json(employeeStatus);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Helper: calculate distance between two GPS points (meters)
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Helper: write audit log
async function logAudit(data) {
  const id = uuidv4();
  await db.collection('audit_logs').doc(id).set({ id, ...data });
}

module.exports = router;
