const express = require('express');
const router = express.Router();
const { db, messaging } = require('../services/firebase');
const { authenticate, authorize } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// Equipment type keys that require certification
const CERTIFIABLE_TYPES = ['crane', 'lift', 'vehicle', 'bobcat', 'excavator', 'forklift'];

// ─── SKILLS / CERTIFICATIONS ──────────────────────────────────────────────────

// Add or update a skill/certification for an employee
router.post('/skills', authenticate, authorize('admin', 'supervisor'), async (req, res) => {
  try {
    const {
      employeeId,
      skillType,         // 'operate' | 'repair' | 'certified'
      equipmentTypeKey,  // 'crane', 'bobcat', 'vehicle', etc.
      certificationName, // e.g. "OSHA Forklift Certified", "CDL Class A"
      issuedBy,          // issuing authority
      issuedDate,
      expiryDate,
      certificationNumber,
      notes,
    } = req.body;

    const id = uuidv4();
    const skill = {
      id, employeeId, skillType, equipmentTypeKey,
      certificationName: certificationName || '',
      issuedBy: issuedBy || '',
      issuedDate: issuedDate || '',
      expiryDate: expiryDate || null,
      certificationNumber: certificationNumber || '',
      notes: notes || '',
      addedBy: req.user.uid,
      addedAt: new Date().toISOString(),
      isActive: true,
      isExpired: expiryDate ? new Date(expiryDate) < new Date() : false,
    };

    await db.collection('employee_skills').doc(id).set(skill);
    res.status(201).json({ message: 'Skill added', skill });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get skills for an employee
router.get('/skills/:employeeId', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('employee_skills')
      .where('employeeId', '==', req.params.employeeId)
      .where('isActive', '==', true)
      .get();
    const skills = snapshot.docs.map(d => ({
      ...d.data(),
      isExpired: d.data().expiryDate ? new Date(d.data().expiryDate) < new Date() : false,
      daysUntilExpiry: d.data().expiryDate
        ? Math.ceil((new Date(d.data().expiryDate) - new Date()) / 86400000)
        : null,
    }));
    res.json(skills);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get all certified employees for an equipment type
router.get('/certified/:equipmentTypeKey', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('employee_skills')
      .where('equipmentTypeKey', '==', req.params.equipmentTypeKey)
      .where('isActive', '==', true)
      .get();

    const skills = snapshot.docs.map(d => d.data()).filter(s => {
      if (!s.expiryDate) return true;
      return new Date(s.expiryDate) > new Date();
    });

    // Get employee names
    const results = [];
    for (const skill of skills) {
      const empDoc = await db.collection('users').doc(skill.employeeId).get();
      if (empDoc.exists) {
        results.push({ ...skill, employee: empDoc.data() });
      }
    }
    res.json(results);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete a skill/certification
router.delete('/skills/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    await db.collection('employee_skills').doc(req.params.id).update({ isActive: false });
    res.json({ message: 'Skill removed' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── TECHNICIAN ASSIGNMENTS ───────────────────────────────────────────────────

// Assign a technician to an equipment type or specific equipment unit
router.post('/assignments', authenticate, authorize('admin', 'supervisor'), async (req, res) => {
  try {
    const { employeeId, equipmentId, equipmentTypeKey, siteId, isPrimary } = req.body;
    const id = uuidv4();
    const assignment = {
      id, employeeId, equipmentId: equipmentId || null,
      equipmentTypeKey: equipmentTypeKey || null,
      siteId, isPrimary: isPrimary || false,
      assignedBy: req.user.uid,
      assignedAt: new Date().toISOString(),
      isActive: true,
    };
    await db.collection('technician_assignments').doc(id).set(assignment);
    res.status(201).json({ message: 'Technician assigned', assignment });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get assignments for a site
router.get('/assignments', authenticate, async (req, res) => {
  try {
    const { siteId, equipmentId } = req.query;
    let query = db.collection('technician_assignments').where('isActive', '==', true);
    if (siteId) query = query.where('siteId', '==', siteId);
    if (equipmentId) query = query.where('equipmentId', '==', equipmentId);
    const snapshot = await query.get();
    res.json(snapshot.docs.map(d => d.data()));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── CERTIFICATION EXPIRY CHECK (daily cron - called from maintenanceSchedule) ─
router.get('/expiring', authenticate, authorize('admin', 'supervisor', 'manager'), async (req, res) => {
  try {
    const daysAhead = parseInt(req.query.daysAhead || 30);
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    const snapshot = await db.collection('employee_skills').where('isActive', '==', true).get();
    const expiring = snapshot.docs.map(d => d.data()).filter(s => {
      if (!s.expiryDate) return false;
      const exp = new Date(s.expiryDate);
      return exp <= futureDate;
    }).map(s => ({
      ...s,
      isExpired: new Date(s.expiryDate) < new Date(),
      daysLeft: Math.ceil((new Date(s.expiryDate) - new Date()) / 86400000),
    }));

    res.json(expiring);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
