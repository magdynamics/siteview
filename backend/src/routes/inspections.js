const express = require('express');
const router = express.Router();
const { db, messaging } = require('../services/firebase');
const { authenticate, authorize } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// ─── INSPECTION TEMPLATES ─────────────────────────────────────────────────────
// Default checklist items per equipment type
const DEFAULT_CHECKLIST = {
  bobcat:   ['Oil level', 'Hydraulic fluid level', 'Coolant level', 'Fuel level', 'Tire condition', 'Seatbelt', 'Warning lights', 'Bucket condition', 'Visible leaks', 'Engine start OK'],
  crane:    ['Oil level', 'Hydraulic fluid', 'Wire rope condition', 'Hook & safety latch', 'Outriggers', 'Load chart present', 'Warning lights', 'Brakes', 'Boom condition', 'Signals working'],
  lift:     ['Oil level', 'Hydraulic fluid', 'Platform condition', 'Safety railings', 'Emergency lowering', 'Horn', 'Tilt sensor', 'Battery/Fuel level', 'Tires', 'Warning lights'],
  vehicle:  ['Oil level', 'Coolant', 'Fuel level', 'Tire pressure', 'Brakes', 'Lights & signals', 'Windshield', 'Seatbelts', 'Horn', 'Registration & insurance present'],
  default:  ['Oil level', 'Fluid levels', 'Tire/track condition', 'Visible leaks', 'Warning lights', 'Safety devices', 'Controls working', 'Cleanliness', 'Damage', 'Start/stop OK'],
};

// Get checklist template for an equipment type
router.get('/template/:equipmentTypeKey', authenticate, async (req, res) => {
  const key = req.params.equipmentTypeKey.toLowerCase();
  const items = DEFAULT_CHECKLIST[key] || DEFAULT_CHECKLIST.default;
  res.json({ items });
});

// Get custom checklist template from DB (if admin created one)
router.get('/templates', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('inspection_templates').get();
    res.json(snapshot.docs.map(d => d.data()));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/templates', authenticate, authorize('admin', 'supervisor'), async (req, res) => {
  try {
    const { equipmentTypeKey, items } = req.body;
    const id = uuidv4();
    const template = { id, equipmentTypeKey, items, createdBy: req.user.uid, createdAt: new Date().toISOString() };
    await db.collection('inspection_templates').doc(id).set(template);
    res.status(201).json({ message: 'Template saved', template });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── SUBMIT INSPECTION ────────────────────────────────────────────────────────
router.post('/', authenticate, async (req, res) => {
  try {
    const {
      equipmentId, equipmentName, siteId,
      inspectionType,   // 'pre_use' | 'post_use'
      items,            // [{ item, passed, note }]
      overallCondition, // 'good' | 'minor_issues' | 'major_issues' | 'unsafe'
      hoursReading,     // machine hours at time of inspection
      odometerReading,
      notes,
    } = req.body;

    const id = uuidv4();
    const now = new Date().toISOString();
    const failedItems = items.filter(i => !i.passed);

    const inspection = {
      id, equipmentId, equipmentName, siteId,
      inspectionType,
      items,
      failedItems,
      overallCondition,
      hoursReading: hoursReading ? parseFloat(hoursReading) : null,
      odometerReading: odometerReading ? parseFloat(odometerReading) : null,
      notes: notes || '',
      inspectedBy: req.user.uid,
      inspectedByName: req.user.name || '',
      timestamp: now,
      autoTicketCreated: false,
    };

    await db.collection('inspections').doc(id).set(inspection);

    // Update machine hours if provided
    if (hoursReading) {
      await db.collection('equipment').doc(equipmentId).update({
        currentHours: parseFloat(hoursReading),
        lastInspectionDate: now,
      });
      // Log hours
      await db.collection('machine_hours_log').doc(uuidv4()).set({
        equipmentId, equipmentName, siteId,
        hours: parseFloat(hoursReading),
        loggedBy: req.user.uid,
        source: 'inspection',
        date: now.split('T')[0],
        timestamp: now,
      });
    }

    // Auto-create repair ticket if unsafe or major issues found
    let autoTicket = null;
    if (overallCondition === 'unsafe' || overallCondition === 'major_issues') {
      const ticketId = uuidv4();
      const failedDesc = failedItems.map(i => `• ${i.item}${i.note ? ': ' + i.note : ''}`).join('\n');
      autoTicket = {
        id: ticketId,
        equipmentId, equipmentName, siteId,
        priority: overallCondition === 'unsafe' ? 'critical' : 'high',
        issueType: 'inspection_failure',
        description: `Auto-generated from ${inspectionType} inspection.\nFailed items:\n${failedDesc}`,
        isSafeToOperate: overallCondition !== 'unsafe',
        reportedBy: req.user.uid,
        reportedByName: req.user.name || '',
        reportedAt: now,
        status: 'pending',
        photos: [], comments: [], sourceInspectionId: id,
        autoTicketCreated: true,
      };
      await db.collection('repair_tickets').doc(ticketId).set(autoTicket);
      await db.collection('inspections').doc(id).update({ autoTicketCreated: true, autoTicketId: ticketId });

      if (overallCondition === 'unsafe') {
        await db.collection('equipment').doc(equipmentId).update({ status: 'out_of_service' });
      }

      // Notify supervisor
      const siteDoc = await db.collection('sites').doc(siteId).get();
      if (siteDoc.exists) {
        const supDoc = await db.collection('users').doc(siteDoc.data().supervisorId).get();
        if (supDoc.exists && supDoc.data().fcmToken) {
          await messaging.send({
            token: supDoc.data().fcmToken,
            notification: {
              title: overallCondition === 'unsafe' ? '🚨 Equipment Unsafe to Operate' : '⚠️ Inspection Issues Found',
              body: `${equipmentName}: ${failedItems.length} item(s) failed inspection`,
            },
          });
        }
      }
    }

    await db.collection('audit_logs').doc(uuidv4()).set({
      action: `INSPECTION_${inspectionType.toUpperCase()}`,
      equipmentId, inspectionId: id,
      overallCondition, failedCount: failedItems.length,
      performedBy: req.user.uid, timestamp: now,
    });

    res.status(201).json({ message: 'Inspection submitted', inspection, autoTicket });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get inspections
router.get('/', authenticate, async (req, res) => {
  try {
    const { equipmentId, siteId, inspectionType, startDate, endDate } = req.query;
    let query = db.collection('inspections');
    if (equipmentId) query = query.where('equipmentId', '==', equipmentId);
    if (siteId) query = query.where('siteId', '==', siteId);
    if (inspectionType) query = query.where('inspectionType', '==', inspectionType);
    if (startDate) query = query.where('timestamp', '>=', `${startDate}T00:00:00.000Z`);
    if (endDate) query = query.where('timestamp', '<=', `${endDate}T23:59:59.999Z`);
    const snapshot = await query.orderBy('timestamp', 'desc').limit(200).get();
    res.json(snapshot.docs.map(d => d.data()));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get today's inspection for an equipment (to check if done)
router.get('/today/:equipmentId', authenticate, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const snapshot = await db.collection('inspections')
      .where('equipmentId', '==', req.params.equipmentId)
      .where('timestamp', '>=', `${today}T00:00:00.000Z`)
      .get();
    res.json(snapshot.docs.map(d => d.data()));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
