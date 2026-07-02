const express = require('express');
const router = express.Router();
const { db } = require('../services/firebase');
const { authenticate, authorize } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// ─── EQUIPMENT TYPES (dynamic list) ──────────────────────────────────────────

// Get all equipment types
router.get('/types', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('equipment_types').orderBy('name').get();
    const types = snapshot.docs.map(doc => doc.data());
    res.json(types);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a new equipment type (e.g. "Bobcat", "Crane", "Lift", "Vehicle")
router.post('/types', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { name, icon } = req.body;
    const id = uuidv4();
    const type = { id, name, icon: icon || '🔧', createdAt: new Date().toISOString() };
    await db.collection('equipment_types').doc(id).set(type);
    res.status(201).json({ message: 'Equipment type created', type });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete equipment type
router.delete('/types/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    await db.collection('equipment_types').doc(req.params.id).delete();
    res.json({ message: 'Equipment type deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── EQUIPMENT (individual units) ────────────────────────────────────────────

// Get all equipment (filterable by type, site, status)
router.get('/', authenticate, async (req, res) => {
  try {
    const { typeId, siteId, status } = req.query;
    let query = db.collection('equipment').where('isActive', '==', true);
    if (typeId) query = query.where('typeId', '==', typeId);
    if (siteId) query = query.where('siteId', '==', siteId);
    if (status) query = query.where('status', '==', status);

    const snapshot = await query.get();
    const equipment = snapshot.docs.map(doc => doc.data());
    res.json(equipment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add new equipment unit
router.post('/', authenticate, authorize('admin', 'supervisor'), async (req, res) => {
  try {
    const {
      name, typeId, typeName, make, model,
      serialNumber, licensePlate, siteId, notes
    } = req.body;

    const id = uuidv4();
    const equipment = {
      id, name, typeId, typeName,
      make: make || '',
      model: model || '',
      serialNumber: serialNumber || '',
      licensePlate: licensePlate || '',
      siteId: siteId || '',
      status: 'available', // available | in_use | maintenance | out_of_service
      assignedTo: null,
      assignedAt: null,
      notes: notes || '',
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    await db.collection('equipment').doc(id).set(equipment);
    res.status(201).json({ message: 'Equipment added', equipment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update equipment details
router.put('/:id', authenticate, authorize('admin', 'supervisor'), async (req, res) => {
  try {
    await db.collection('equipment').doc(req.params.id).update(req.body);
    res.json({ message: 'Equipment updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deactivate equipment
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    await db.collection('equipment').doc(req.params.id).update({ isActive: false });
    res.json({ message: 'Equipment deactivated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CHECK OUT / CHECK IN ─────────────────────────────────────────────────────

// Employee checks out equipment (starts using it)
router.post('/:id/checkout', authenticate, async (req, res) => {
  try {
    const { employeeId, siteId, notes } = req.body;
    const targetEmployee = employeeId || req.user.uid;

    const equipDoc = await db.collection('equipment').doc(req.params.id).get();
    if (!equipDoc.exists) return res.status(404).json({ error: 'Equipment not found' });

    const equip = equipDoc.data();
    if (equip.status === 'in_use') {
      return res.status(400).json({ error: `Already checked out by another employee` });
    }
    if (equip.status === 'maintenance' || equip.status === 'out_of_service') {
      return res.status(400).json({ error: `Equipment is not available (${equip.status})` });
    }

    const logId = uuidv4();
    const now = new Date().toISOString();

    // Update equipment status
    await db.collection('equipment').doc(req.params.id).update({
      status: 'in_use',
      assignedTo: targetEmployee,
      assignedAt: now,
      currentLogId: logId,
    });

    // Create usage log
    const log = {
      id: logId,
      equipmentId: req.params.id,
      equipmentName: equip.name,
      typeName: equip.typeName,
      employeeId: targetEmployee,
      siteId: siteId || equip.siteId,
      checkedOutAt: now,
      checkedInAt: null,
      notes: notes || '',
      conditionOut: 'good',
      conditionIn: null,
      isManual: employeeId && employeeId !== req.user.uid,
      performedBy: req.user.uid,
    };

    await db.collection('equipment_logs').doc(logId).set(log);

    // Audit
    await db.collection('audit_logs').doc(uuidv4()).set({
      action: 'EQUIPMENT_CHECKOUT',
      equipmentId: req.params.id,
      equipmentName: equip.name,
      employeeId: targetEmployee,
      performedBy: req.user.uid,
      siteId,
      timestamp: now,
    });

    res.status(201).json({ message: 'Equipment checked out', log });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Employee checks in equipment (done using it)
router.post('/:id/checkin', authenticate, async (req, res) => {
  try {
    const { condition, notes } = req.body;
    // condition: 'good' | 'damaged' | 'needs_maintenance'

    const equipDoc = await db.collection('equipment').doc(req.params.id).get();
    if (!equipDoc.exists) return res.status(404).json({ error: 'Equipment not found' });

    const equip = equipDoc.data();
    const now = new Date().toISOString();

    // Determine new status based on condition
    let newStatus = 'available';
    if (condition === 'damaged') newStatus = 'out_of_service';
    if (condition === 'needs_maintenance') newStatus = 'maintenance';

    // Update equipment
    await db.collection('equipment').doc(req.params.id).update({
      status: newStatus,
      assignedTo: null,
      assignedAt: null,
      currentLogId: null,
    });

    // Update usage log
    if (equip.currentLogId) {
      await db.collection('equipment_logs').doc(equip.currentLogId).update({
        checkedInAt: now,
        conditionIn: condition || 'good',
        returnNotes: notes || '',
      });
    }

    // Notify supervisor if damaged
    if (condition === 'damaged' || condition === 'needs_maintenance') {
      const siteDoc = await db.collection('sites').doc(equip.siteId).get();
      if (siteDoc.exists) {
        const site = siteDoc.data();
        const supervisorDoc = await db.collection('users').doc(site.supervisorId).get();
        if (supervisorDoc.exists && supervisorDoc.data().fcmToken) {
          const { messaging } = require('../services/firebase');
          await messaging.send({
            token: supervisorDoc.data().fcmToken,
            notification: {
              title: 'Equipment Alert',
              body: `${equip.name} returned with condition: ${condition}`,
            },
          });
        }
      }
    }

    await db.collection('audit_logs').doc(uuidv4()).set({
      action: 'EQUIPMENT_CHECKIN',
      equipmentId: req.params.id,
      equipmentName: equip.name,
      employeeId: req.user.uid,
      condition,
      timestamp: now,
    });

    res.json({ message: 'Equipment checked in', newStatus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── USAGE LOGS & REPORTS ────────────────────────────────────────────────────

// Get equipment usage logs
router.get('/logs', authenticate, authorize('supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const { equipmentId, employeeId, siteId, startDate, endDate } = req.query;
    let query = db.collection('equipment_logs');

    if (equipmentId) query = query.where('equipmentId', '==', equipmentId);
    if (employeeId) query = query.where('employeeId', '==', employeeId);
    if (siteId) query = query.where('siteId', '==', siteId);
    if (startDate) query = query.where('checkedOutAt', '>=', `${startDate}T00:00:00.000Z`);
    if (endDate) query = query.where('checkedOutAt', '<=', `${endDate}T23:59:59.999Z`);

    const snapshot = await query.orderBy('checkedOutAt', 'desc').limit(200).get();
    const logs = snapshot.docs.map(doc => doc.data());
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get currently checked-out equipment by site
router.get('/active/:siteId', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('equipment')
      .where('siteId', '==', req.params.siteId)
      .where('status', '==', 'in_use')
      .get();

    const active = snapshot.docs.map(doc => doc.data());
    res.json(active);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get equipment currently held by an employee
router.get('/employee/:employeeId/active', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('equipment')
      .where('assignedTo', '==', req.params.employeeId)
      .where('status', '==', 'in_use')
      .get();

    const items = snapshot.docs.map(doc => doc.data());
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
