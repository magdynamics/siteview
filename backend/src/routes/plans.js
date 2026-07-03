const express = require('express');
const router = express.Router();
const multer = require('multer');
const { db } = require('../services/firebase');
const { saveFile } = require('../services/fileStorage');
const { authenticate, authorize } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// Plan / BIM document management (technical guideline §4.6).
// New versions of the same title+discipline automatically supersede the old.

const DISCIPLINES = [
  'architectural', 'structural', 'mechanical', 'electrical', 'plumbing',
  'hvac', 'fire_protection', 'civil', 'lighting',
];

// ─── UPLOAD PLAN ──────────────────────────────────────────────────────────────
router.post('/', authenticate, authorize('supervisor', 'manager', 'admin'), upload.single('file'), async (req, res) => {
  try {
    const { siteId, discipline, title, versionNumber, zoneTags } = req.body;
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    if (!siteId) return res.status(400).json({ error: 'siteId is required' });
    if (!title) return res.status(400).json({ error: 'title is required' });
    if (!DISCIPLINES.includes(discipline)) {
      return res.status(400).json({ error: `discipline must be one of: ${DISCIPLINES.join(', ')}` });
    }

    const id = uuidv4();
    const ext = req.file.mimetype.includes('pdf') ? 'pdf'
      : req.file.mimetype.includes('png') ? 'png' : 'jpg';
    const fileUrl = await saveFile(`plans/${siteId}/${discipline}/${id}.${ext}`, req.file.buffer, req.file.mimetype);

    // parse zoneTags: accepts JSON array or comma-separated string
    let tags = [];
    if (Array.isArray(zoneTags)) tags = zoneTags;
    else if (typeof zoneTags === 'string' && zoneTags.trim()) {
      try { tags = JSON.parse(zoneTags); } catch { tags = zoneTags.split(',').map(s => s.trim()).filter(Boolean); }
    }

    const doc = {
      id,
      siteId,
      discipline,
      title,
      versionNumber: versionNumber ? parseInt(versionNumber) : 1,
      fileUrl,
      fileName: req.file.originalname,
      zoneTags: tags,
      uploadedBy: req.user.uid,
      uploadedByName: req.user.name || '',
      uploadedAt: new Date().toISOString(),
      supersededBy: null,
    };

    // supersede the previous current version of the same title+discipline
    const priorSnap = await db.collection('plan_documents')
      .where('siteId', '==', siteId)
      .where('discipline', '==', discipline)
      .get();
    const prior = priorSnap.docs.map(d => d.data())
      .filter(p => p.title === title && !p.supersededBy);

    const batch = db.batch();
    batch.set(db.collection('plan_documents').doc(id), doc);
    prior.forEach(p => batch.update(db.collection('plan_documents').doc(p.id), { supersededBy: id }));
    await batch.commit();

    res.status(201).json({ message: 'Plan uploaded', plan: doc, superseded: prior.map(p => p.id) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── LIST PLANS ───────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { siteId, discipline, includeSuperseded } = req.query;
    let query = db.collection('plan_documents');
    if (siteId) query = query.where('siteId', '==', siteId);
    if (discipline) query = query.where('discipline', '==', discipline);
    const snap = await query.get();
    let plans = snap.docs.map(d => d.data());
    if (includeSuperseded !== 'true') plans = plans.filter(p => !p.supersededBy);
    plans.sort((a, b) => a.discipline.localeCompare(b.discipline) || a.title.localeCompare(b.title));
    res.json(plans);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Version history for a title (current + superseded chain)
router.get('/:id/history', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('plan_documents').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Plan not found' });
    const plan = doc.data();
    const snap = await db.collection('plan_documents')
      .where('siteId', '==', plan.siteId)
      .where('discipline', '==', plan.discipline)
      .get();
    const versions = snap.docs.map(d => d.data())
      .filter(p => p.title === plan.title)
      .sort((a, b) => b.versionNumber - a.versionNumber || b.uploadedAt.localeCompare(a.uploadedAt));
    res.json(versions);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
