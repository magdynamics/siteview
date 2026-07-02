const express = require('express');
const router = express.Router();
const multer = require('multer');
const { db, storage } = require('../services/firebase');
const { authenticate } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Upload before/after task photo
router.post('/task', authenticate, upload.single('photo'), async (req, res) => {
  try {
    const { taskDescription, photoType, siteId, latitude, longitude } = req.body;
    // photoType: 'before' or 'after'

    const photoId = uuidv4();
    const fileName = `photos/${siteId}/${req.user.uid}/${photoId}.jpg`;
    const bucket = storage.bucket();
    const file = bucket.file(fileName);

    await file.save(req.file.buffer, {
      metadata: {
        contentType: req.file.mimetype,
        metadata: {
          uploadedBy: req.user.uid,
          photoType,
          siteId,
          latitude: latitude || '',
          longitude: longitude || '',
        },
      },
    });

    await file.makePublic();
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

    const photoRecord = {
      id: photoId,
      employeeId: req.user.uid,
      siteId,
      taskDescription,
      photoType,
      url: publicUrl,
      latitude: latitude || null,
      longitude: longitude || null,
      timestamp: new Date().toISOString(),
    };

    await db.collection('task_photos').doc(photoId).set(photoRecord);
    res.status(201).json({ message: 'Photo uploaded', photo: photoRecord });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get before/after photos for a task or date
router.get('/', authenticate, async (req, res) => {
  try {
    const { siteId, employeeId, date } = req.query;
    let query = db.collection('task_photos');

    if (siteId) query = query.where('siteId', '==', siteId);
    if (employeeId) query = query.where('employeeId', '==', employeeId);
    if (date) {
      query = query
        .where('timestamp', '>=', `${date}T00:00:00.000Z`)
        .where('timestamp', '<=', `${date}T23:59:59.999Z`);
    }

    const snapshot = await query.orderBy('timestamp', 'desc').get();
    const photos = snapshot.docs.map(doc => doc.data());
    res.json(photos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
