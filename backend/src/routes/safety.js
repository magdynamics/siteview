const express = require('express');
const router = express.Router();
const multer = require('multer');
const { db, messaging } = require('../services/firebase');
const { saveFile } = require('../services/fileStorage');
const { authenticate, authorize } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Safety incident reporting (technical guideline §10.5) — OSHA/liability
// documentation: who, what, when, photos, corrective action. Immutable
// except for corrective action + closure.

const INCIDENT_TYPES = ['injury', 'near_miss', 'property_damage', 'environmental', 'other'];
const SEVERITIES = ['minor', 'moderate', 'serious', 'critical'];

// Any authenticated user can report — field workers see incidents first
router.post('/', authenticate, async (req, res) => {
  try {
    const {
      siteId, incidentType, severity, description,
      occurredAt, location, involvedEmployeeIds, witnesses, immediateActionTaken,
    } = req.body;
    if (!siteId) return res.status(400).json({ error: 'siteId is required' });
    if (!INCIDENT_TYPES.includes(incidentType)) return res.status(400).json({ error: `incidentType must be one of: ${INCIDENT_TYPES.join(', ')}` });
    if (!SEVERITIES.includes(severity)) return res.status(400).json({ error: `severity must be one of: ${SEVERITIES.join(', ')}` });
    if (!description) return res.status(400).json({ error: 'description is required' });

    const id = uuidv4();
    const now = new Date().toISOString();
    const incident = {
      id,
      siteId,
      incidentType,
      severity,
      description,
      occurredAt: occurredAt || now,
      location: location || '',
      involvedEmployeeIds: involvedEmployeeIds || [],
      witnesses: witnesses || '',
      immediateActionTaken: immediateActionTaken || '',
      photoUrls: [],
      correctiveAction: null,
      status: 'open',              // open | closed
      reportedBy: req.user.uid,
      reportedByName: req.user.name || '',
      reportedAt: now,
      closedBy: null,
      closedAt: null,
    };
    await db.collection('safety_incidents').doc(id).set(incident);

    await db.collection('audit_logs').doc(uuidv4()).set({
      action: 'SAFETY_INCIDENT_REPORTED', incidentId: id, siteId, severity,
      performedBy: req.user.uid, timestamp: now,
    });

    // serious/critical incidents page supervisors + managers immediately
    if (['serious', 'critical'].includes(severity)) {
      const usersSnap = await db.collection('users').where('isActive', '==', true).get();
      const tokens = usersSnap.docs
        .filter(d => ['supervisor', 'manager', 'admin'].includes(d.data().role))
        .map(d => d.data().fcmToken).filter(Boolean);
      if (tokens.length) {
        await messaging.sendEachForMulticast({
          tokens,
          notification: { title: `🚨 ${severity.toUpperCase()} Safety Incident`, body: description.slice(0, 100) },
        });
      }
    }

    res.status(201).json({ message: 'Incident reported', incident });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/', authenticate, authorize('supervisor', 'accountant', 'manager', 'admin', 'viewer'), async (req, res) => {
  try {
    const { siteId, status } = req.query;
    let query = db.collection('safety_incidents');
    if (siteId) query = query.where('siteId', '==', siteId);
    const snap = await query.get();
    let incidents = snap.docs.map(d => d.data());
    if (status) incidents = incidents.filter(i => i.status === status);
    incidents.sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
    res.json(incidents);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/photos', authenticate, upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'photo file is required' });
    const doc = await db.collection('safety_incidents').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Incident not found' });

    const photoId = uuidv4();
    const url = await saveFile(`safety/${doc.data().siteId}/${req.params.id}/${photoId}.jpg`, req.file.buffer, req.file.mimetype);
    await db.collection('safety_incidents').doc(req.params.id).update({
      photoUrls: [...(doc.data().photoUrls || []), url],
    });
    res.status(201).json({ message: 'Photo attached', url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Corrective action + closure (supervisor and up); the report itself is immutable
router.post('/:id/close', authenticate, authorize('supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const { correctiveAction } = req.body;
    if (!correctiveAction) return res.status(400).json({ error: 'correctiveAction is required to close an incident' });
    const doc = await db.collection('safety_incidents').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Incident not found' });
    if (doc.data().status === 'closed') return res.status(400).json({ error: 'Incident is already closed' });

    await db.collection('safety_incidents').doc(req.params.id).update({
      correctiveAction,
      status: 'closed',
      closedBy: req.user.uid,
      closedByName: req.user.name || '',
      closedAt: new Date().toISOString(),
    });
    res.json({ message: 'Incident closed with corrective action' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
