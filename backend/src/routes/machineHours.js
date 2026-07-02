const express = require('express');
const router = express.Router();
const { db, messaging } = require('../services/firebase');
const { authenticate } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// ─── LOG MACHINE HOURS ────────────────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  try {
    const { equipmentId, equipmentName, siteId, hours, odometerReading, fuelAdded, notes } = req.body;

    const today = new Date().toISOString().split('T')[0];
    const logId = uuidv4();

    // Get current equipment data
    const equipDoc = await db.collection('equipment').doc(equipmentId).get();
    if (!equipDoc.exists) return res.status(404).json({ error: 'Equipment not found' });
    const equip = equipDoc.data();
    const previousHours = equip.currentHours || 0;
    const parsedHours = parseFloat(hours);

    if (parsedHours < previousHours) {
      return res.status(400).json({ error: `Hours cannot be less than previous reading (${previousHours})` });
    }

    const hoursAdded = parsedHours - previousHours;

    const log = {
      id: logId, equipmentId, equipmentName, siteId,
      hours: parsedHours,
      previousHours,
      hoursAdded: +hoursAdded.toFixed(1),
      odometerReading: odometerReading ? parseFloat(odometerReading) : null,
      fuelAdded: fuelAdded ? parseFloat(fuelAdded) : null,
      notes: notes || '',
      loggedBy: req.user.uid,
      loggedByName: req.user.name || '',
      date: today,
      timestamp: new Date().toISOString(),
      source: 'manual',
    };

    await db.collection('machine_hours_log').doc(logId).set(log);

    // Update equipment current hours
    await db.collection('equipment').doc(equipmentId).update({
      currentHours: parsedHours,
      lastHoursLogDate: today,
    });

    // Check maintenance schedules — alert if approaching due hours
    const schedulesSnap = await db.collection('maintenance_schedules')
      .where('equipmentId', '==', equipmentId)
      .where('status', '==', 'active')
      .get();

    const alerts = [];
    for (const sDoc of schedulesSnap.docs) {
      const schedule = sDoc.data();
      if (!schedule.nextDueHours) continue;

      const hoursUntilDue = schedule.nextDueHours - parsedHours;

      if (hoursUntilDue <= 0) {
        // Overdue
        await db.collection('maintenance_schedules').doc(sDoc.id).update({ status: 'overdue' });
        alerts.push({ type: 'overdue', schedule, hoursOverdue: Math.abs(hoursUntilDue) });
        await sendHoursAlert(siteId, equipmentName, schedule.maintenanceType, hoursUntilDue, true);
      } else if (hoursUntilDue <= 50) {
        // Due soon (within 50 hours)
        alerts.push({ type: 'due_soon', schedule, hoursUntilDue });
        await sendHoursAlert(siteId, equipmentName, schedule.maintenanceType, hoursUntilDue, false);
      }
    }

    await db.collection('audit_logs').doc(uuidv4()).set({
      action: 'HOURS_LOGGED', equipmentId, hours: parsedHours,
      performedBy: req.user.uid, timestamp: new Date().toISOString(),
    });

    res.status(201).json({ message: 'Hours logged', log, alerts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET HOURS HISTORY ────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { equipmentId, siteId, startDate, endDate } = req.query;
    let query = db.collection('machine_hours_log');
    if (equipmentId) query = query.where('equipmentId', '==', equipmentId);
    if (siteId) query = query.where('siteId', '==', siteId);
    if (startDate) query = query.where('date', '>=', startDate);
    if (endDate) query = query.where('date', '<=', endDate);
    const snapshot = await query.orderBy('date', 'desc').limit(200).get();
    res.json(snapshot.docs.map(d => d.data()));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GET EQUIPMENT HOURS SUMMARY ─────────────────────────────────────────────
router.get('/summary/:equipmentId', authenticate, async (req, res) => {
  try {
    const equipDoc = await db.collection('equipment').doc(req.params.equipmentId).get();
    if (!equipDoc.exists) return res.status(404).json({ error: 'Not found' });
    const equip = equipDoc.data();

    // Get all maintenance schedules for this equipment
    const schedulesSnap = await db.collection('maintenance_schedules')
      .where('equipmentId', '==', req.params.equipmentId)
      .get();

    const schedules = schedulesSnap.docs.map(d => {
      const s = d.data();
      return {
        ...s,
        hoursUntilDue: s.nextDueHours ? s.nextDueHours - (equip.currentHours || 0) : null,
      };
    });

    // Get maintenance cost total
    const maintenanceSnap = await db.collection('maintenance_records')
      .where('equipmentId', '==', req.params.equipmentId)
      .get();
    const totalMaintenanceCost = maintenanceSnap.docs.reduce((sum, d) => sum + (d.data().totalCost || 0), 0);
    const maintenanceCount = maintenanceSnap.docs.length;

    res.json({
      equipment: equip,
      currentHours: equip.currentHours || 0,
      totalMaintenanceCost: +totalMaintenanceCost.toFixed(2),
      maintenanceCount,
      costPerHour: equip.currentHours > 0 ? +(totalMaintenanceCost / equip.currentHours).toFixed(2) : 0,
      schedules,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function sendHoursAlert(siteId, equipmentName, maintenanceType, hoursUntilDue, isOverdue) {
  try {
    const snapshot = await db.collection('users')
      .where('assignedSiteId', '==', siteId)
      .where('role', 'in', ['supervisor', 'admin'])
      .get();
    const tokens = snapshot.docs.map(d => d.data().fcmToken).filter(Boolean);
    if (tokens.length === 0) return;
    const title = isOverdue ? `🔴 Maintenance Overdue: ${equipmentName}` : `🟡 Maintenance Due Soon: ${equipmentName}`;
    const body = isOverdue
      ? `${maintenanceType} overdue by ${Math.abs(hoursUntilDue).toFixed(0)} hours`
      : `${maintenanceType} due in ${hoursUntilDue.toFixed(0)} hours`;
    await messaging.sendEachForMulticast({ tokens, notification: { title, body } });
  } catch {}
}

module.exports = router;
