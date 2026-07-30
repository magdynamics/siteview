const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { db, auth } = require('../services/firebase');
const { authenticate, authorize } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// Create employee
router.post('/', authenticate, authorize('admin'), async (req, res) => {
  try {
    const {
      name, email, phone, role, assignedSiteId,
      paymentType, hourlyRate, dailyRate, contractAmount, language, password
    } = req.body;

    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!email) return res.status(400).json({ error: 'email is required' });

    // Accounts need a password to sign in; generate a temporary one if not provided
    const initialPassword = password || crypto.randomBytes(9).toString('base64url');

    let userRecord;
    try {
      userRecord = await auth.createUser({ email, displayName: name, password: initialPassword });
    } catch (e) {
      if (e.code === 'auth/email-already-exists') return res.status(409).json({ error: 'An account with this email already exists' });
      if (e.code === 'auth/invalid-email') return res.status(400).json({ error: 'Invalid email address' });
      if (e.code === 'auth/invalid-password') return res.status(400).json({ error: 'Password must be at least 6 characters' });
      throw e;
    }

    const employee = {
      uid: userRecord.uid,
      name,
      email,
      phone,
      role: role || 'employee',
      assignedSiteId,
      paymentType,
      hourlyRate: hourlyRate || 0,
      dailyRate: dailyRate || 0,
      contractAmount: contractAmount || 0,
      language: language || 'en',
      createdAt: new Date().toISOString(),
      isActive: true,
    };

    await db.collection('users').doc(userRecord.uid).set(employee);
    res.status(201).json({
      message: 'Employee created',
      employee,
      // Only returned when the password was generated server-side
      temporaryPassword: password ? undefined : initialPassword,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all employees (with optional site filter)
router.get('/', authenticate, authorize('supervisor', 'accountant', 'manager', 'admin'), async (req, res) => {
  try {
    let query = db.collection('users').where('role', '==', 'employee');
    if (req.query.siteId) query = query.where('assignedSiteId', '==', req.query.siteId);

    const snapshot = await query.get();
    const employees = snapshot.docs.map(doc => doc.data());
    res.json(employees);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Availability for the scheduling calendar's resource pool — must be
// registered before /:id, otherwise Express matches "availability" as an id.
router.get('/availability', authenticate, authorize('supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const { date, siteId } = req.query;
    if (!date) return res.status(400).json({ error: 'date is required' });

    let query = db.collection('users').where('role', '==', 'employee');
    if (siteId) query = query.where('assignedSiteId', '==', siteId);
    const empSnap = await query.get();
    const employees = empSnap.docs.map(d => d.data()).filter(e => e.isActive !== false);

    const taskSnap = await db.collection('tasks').where('scheduledDate', '==', date).get();
    const bookedByEmployee = {};
    taskSnap.docs.forEach(d => {
      const t = d.data();
      if (t.status === 'complete' || !t.assignedTo) return;
      bookedByEmployee[t.assignedTo] = bookedByEmployee[t.assignedTo] || [];
      bookedByEmployee[t.assignedTo].push({ taskId: t.id, title: t.title, siteId: t.siteId });
    });

    res.json(employees.map(e => ({
      uid: e.uid,
      name: e.name,
      assignedSiteId: e.assignedSiteId,
      bookings: bookedByEmployee[e.uid] || [],
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get single employee
router.get('/:id', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('users').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Employee not found' });
    res.json(doc.data());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update employee
router.put('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    await db.collection('users').doc(req.params.id).update(req.body);

    await db.collection('audit_logs').doc(uuidv4()).set({
      action: 'EMPLOYEE_UPDATED',
      employeeId: req.params.id,
      performedBy: req.user.uid,
      changes: req.body,
      timestamp: new Date().toISOString(),
    });

    res.json({ message: 'Employee updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deactivate employee
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    await db.collection('users').doc(req.params.id).update({ isActive: false });
    res.json({ message: 'Employee deactivated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
