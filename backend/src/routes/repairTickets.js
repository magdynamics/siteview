const express = require('express');
const router = express.Router();
const multer = require('multer');
const { db, storage, messaging } = require('../services/firebase');
const { authenticate, authorize } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ─── CREATE REPAIR TICKET ─────────────────────────────────────────────────────
// Any employee or supervisor can open a ticket
router.post('/', authenticate, async (req, res) => {
  try {
    const {
      equipmentId,
      equipmentName,
      siteId,
      priority,           // 'low' | 'medium' | 'high' | 'critical'
      issueType,          // 'mechanical' | 'electrical' | 'hydraulic' | 'body' | 'tires' | 'other'
      description,        // what is wrong
      hoursAtReport,      // machine hours when reported
      odometerAtReport,   // odometer reading
      isSafeToOperate,    // boolean — safety flag
    } = req.body;

    const id = uuidv4();
    const now = new Date().toISOString();

    const ticket = {
      id,
      equipmentId,
      equipmentName,
      siteId,
      priority: priority || 'medium',
      issueType,
      description,
      hoursAtReport: hoursAtReport ? parseFloat(hoursAtReport) : null,
      odometerAtReport: odometerAtReport ? parseFloat(odometerAtReport) : null,
      isSafeToOperate: isSafeToOperate !== false,
      reportedBy: req.user.uid,
      reportedByName: req.user.name || '',
      reportedAt: now,
      status: 'pending',         // pending | approved | in_progress | completed | rejected
      approvedBy: null,
      approvedAt: null,
      rejectedBy: null,
      rejectedReason: null,
      assignedTo: null,
      estimatedCost: null,
      actualCost: null,
      completedAt: null,
      photos: [],
      comments: [],
      maintenanceRecordId: null, // linked once repair is done
    };

    await db.collection('repair_tickets').doc(id).set(ticket);

    // If critical or unsafe — flag equipment immediately and notify supervisor
    if (priority === 'critical' || !isSafeToOperate) {
      await db.collection('equipment').doc(equipmentId).update({ status: 'out_of_service' });

      const siteDoc = await db.collection('sites').doc(siteId).get();
      if (siteDoc.exists) {
        const supervisorDoc = await db.collection('users').doc(siteDoc.data().supervisorId).get();
        if (supervisorDoc.exists?.fcmToken) {
          await messaging.send({
            token: supervisorDoc.data().fcmToken,
            notification: {
              title: `🚨 CRITICAL Repair Ticket`,
              body: `${equipmentName} reported unsafe to operate. Immediate attention required.`,
            },
          });
        }
      }
    }

    await db.collection('audit_logs').doc(uuidv4()).set({
      action: 'REPAIR_TICKET_CREATED',
      ticketId: id,
      equipmentId,
      priority,
      performedBy: req.user.uid,
      timestamp: now,
    });

    res.status(201).json({ message: 'Repair ticket created', ticket });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET TICKETS ──────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { siteId, equipmentId, status, priority } = req.query;
    let query = db.collection('repair_tickets');

    if (siteId) query = query.where('siteId', '==', siteId);
    if (equipmentId) query = query.where('equipmentId', '==', equipmentId);
    if (status) query = query.where('status', '==', status);
    if (priority) query = query.where('priority', '==', priority);

    const snapshot = await query.orderBy('reportedAt', 'desc').get();
    const tickets = snapshot.docs.map(doc => doc.data());
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('repair_tickets').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Ticket not found' });
    res.json(doc.data());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── SUPERVISOR/ADMIN APPROVES TICKET ─────────────────────────────────────────
router.post('/:id/approve', authenticate, authorize('supervisor', 'admin'), async (req, res) => {
  try {
    const { assignedTo, estimatedCost, notes } = req.body;
    const now = new Date().toISOString();

    await db.collection('repair_tickets').doc(req.params.id).update({
      status: 'approved',
      approvedBy: req.user.uid,
      approvedByName: req.user.name || '',
      approvedAt: now,
      assignedTo: assignedTo || null,
      estimatedCost: estimatedCost ? parseFloat(estimatedCost) : null,
      approvalNotes: notes || '',
    });

    // Update equipment to maintenance status
    const ticket = (await db.collection('repair_tickets').doc(req.params.id).get()).data();
    await db.collection('equipment').doc(ticket.equipmentId).update({ status: 'maintenance' });

    // Notify reporter
    const reporterDoc = await db.collection('users').doc(ticket.reportedBy).get();
    if (reporterDoc.exists && reporterDoc.data().fcmToken) {
      await messaging.send({
        token: reporterDoc.data().fcmToken,
        notification: {
          title: 'Repair Ticket Approved',
          body: `Your ticket for ${ticket.equipmentName} has been approved`,
        },
      });
    }

    await db.collection('audit_logs').doc(uuidv4()).set({
      action: 'REPAIR_TICKET_APPROVED',
      ticketId: req.params.id,
      performedBy: req.user.uid,
      timestamp: now,
    });

    res.json({ message: 'Ticket approved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── REJECT TICKET ────────────────────────────────────────────────────────────
router.post('/:id/reject', authenticate, authorize('supervisor', 'admin'), async (req, res) => {
  try {
    const { reason } = req.body;
    const now = new Date().toISOString();

    await db.collection('repair_tickets').doc(req.params.id).update({
      status: 'rejected',
      rejectedBy: req.user.uid,
      rejectedAt: now,
      rejectedReason: reason || '',
    });

    // Restore equipment to available if rejected
    const ticket = (await db.collection('repair_tickets').doc(req.params.id).get()).data();
    await db.collection('equipment').doc(ticket.equipmentId).update({ status: 'available' });

    res.json({ message: 'Ticket rejected' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── MARK IN PROGRESS ────────────────────────────────────────────────────────
router.post('/:id/start', authenticate, authorize('supervisor', 'admin'), async (req, res) => {
  try {
    await db.collection('repair_tickets').doc(req.params.id).update({
      status: 'in_progress',
      startedAt: new Date().toISOString(),
    });
    res.json({ message: 'Repair started' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── COMPLETE TICKET (link to maintenance record) ─────────────────────────────
router.post('/:id/complete', authenticate, authorize('supervisor', 'admin'), async (req, res) => {
  try {
    const { maintenanceRecordId, actualCost, finalNotes } = req.body;
    const now = new Date().toISOString();

    await db.collection('repair_tickets').doc(req.params.id).update({
      status: 'completed',
      completedAt: now,
      completedBy: req.user.uid,
      maintenanceRecordId: maintenanceRecordId || null,
      actualCost: actualCost ? parseFloat(actualCost) : null,
      finalNotes: finalNotes || '',
    });

    res.json({ message: 'Ticket completed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ADD COMMENT TO TICKET ────────────────────────────────────────────────────
router.post('/:id/comments', authenticate, async (req, res) => {
  try {
    const { text } = req.body;
    const comment = {
      id: uuidv4(),
      text,
      authorId: req.user.uid,
      authorName: req.user.name || '',
      timestamp: new Date().toISOString(),
    };

    const doc = await db.collection('repair_tickets').doc(req.params.id).get();
    const existing = doc.data().comments || [];
    await db.collection('repair_tickets').doc(req.params.id).update({
      comments: [...existing, comment],
    });

    res.status(201).json({ message: 'Comment added', comment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── UPLOAD PHOTO TO TICKET ───────────────────────────────────────────────────
router.post('/:id/photos', authenticate, upload.single('photo'), async (req, res) => {
  try {
    const { photoType } = req.body; // 'issue' | 'after_repair'
    const photoId = uuidv4();
    const fileName = `repair_tickets/${req.params.id}/${photoType}_${photoId}.jpg`;

    const bucket = storage.bucket();
    const file = bucket.file(fileName);
    await file.save(req.file.buffer, { metadata: { contentType: req.file.mimetype } });
    await file.makePublic();
    const url = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

    const photo = { id: photoId, photoType, url, uploadedBy: req.user.uid, uploadedAt: new Date().toISOString() };
    const doc = await db.collection('repair_tickets').doc(req.params.id).get();
    await db.collection('repair_tickets').doc(req.params.id).update({
      photos: [...(doc.data().photos || []), photo],
    });

    res.status(201).json({ message: 'Photo uploaded', photo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
