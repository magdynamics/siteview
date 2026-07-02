const express = require('express');
const router = express.Router();
const multer = require('multer');
const { db, storage } = require('../services/firebase');
const { authenticate } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Upload scanned document (receipt, vendor invoice, etc.)
router.post('/', authenticate, upload.single('document'), async (req, res) => {
  try {
    const { documentType, description, siteId, vendorName, amount } = req.body;
    // documentType: 'receipt', 'vendor_invoice', 'delivery_note', 'other'

    const docId = uuidv4();
    const ext = req.file.mimetype.includes('pdf') ? 'pdf' : 'jpg';
    const fileName = `documents/${siteId}/${req.user.uid}/${docId}.${ext}`;
    const bucket = storage.bucket();
    const file = bucket.file(fileName);

    await file.save(req.file.buffer, {
      metadata: { contentType: req.file.mimetype },
    });

    await file.makePublic();
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;

    const documentRecord = {
      id: docId,
      uploadedBy: req.user.uid,
      siteId,
      documentType,
      description: description || '',
      vendorName: vendorName || '',
      amount: amount ? parseFloat(amount) : null,
      url: publicUrl,
      fileName: req.file.originalname,
      timestamp: new Date().toISOString(),
    };

    await db.collection('documents').doc(docId).set(documentRecord);
    res.status(201).json({ message: 'Document uploaded', document: documentRecord });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get documents with filters
router.get('/', authenticate, async (req, res) => {
  try {
    const { siteId, documentType, startDate, endDate } = req.query;
    let query = db.collection('documents');

    if (siteId) query = query.where('siteId', '==', siteId);
    if (documentType) query = query.where('documentType', '==', documentType);
    if (startDate) query = query.where('timestamp', '>=', `${startDate}T00:00:00.000Z`);
    if (endDate) query = query.where('timestamp', '<=', `${endDate}T23:59:59.999Z`);

    const snapshot = await query.orderBy('timestamp', 'desc').get();
    const documents = snapshot.docs.map(doc => doc.data());
    res.json(documents);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
