const express = require('express');
const router = express.Router();
const multer = require('multer');
const { db } = require('../services/firebase');
const { saveFile } = require('../services/fileStorage');
const { authenticate, authorize } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Payment ledger: every payment made — to whom, why, how (method + reference),
// with proof scans (check image, wire confirmation, signed receipt) attached.
// This is a record-keeping ledger, not a payment processor: money moves through
// the bank; SiteView documents it. Linking a subcontractor invoice marks that
// invoice paid automatically.

const manageRoles = authorize('accountant', 'manager', 'admin');

const PAYEE_TYPES = ['vendor', 'subcontractor', 'employee', 'other'];
const METHODS = ['check', 'ach', 'wire', 'cash', 'card', 'other'];

router.post('/', authenticate, manageRoles, async (req, res) => {
  try {
    const {
      payeeType, payeeId, payeeName, siteId,
      amount, method, reference, reason,
      relatedInvoiceId, paidDate,
    } = req.body;

    if (!PAYEE_TYPES.includes(payeeType)) return res.status(400).json({ error: `payeeType must be one of: ${PAYEE_TYPES.join(', ')}` });
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'amount must be a positive number' });
    if (!METHODS.includes(method)) return res.status(400).json({ error: `method must be one of: ${METHODS.join(', ')}` });
    if (!reason) return res.status(400).json({ error: 'reason is required — what is this payment for?' });

    // resolve the payee name from the registry when an id is given
    let resolvedName = payeeName || '';
    if (payeeId && payeeType === 'vendor') {
      const v = await db.collection('vendors').doc(payeeId).get();
      if (v.exists) resolvedName = v.data().name;
    } else if (payeeId && payeeType === 'subcontractor') {
      const s = await db.collection('subcontractors').doc(payeeId).get();
      if (s.exists) resolvedName = s.data().name;
    } else if (payeeId && payeeType === 'employee') {
      const e = await db.collection('users').doc(payeeId).get();
      if (e.exists) resolvedName = e.data().name;
    }
    if (!resolvedName) return res.status(400).json({ error: 'payeeName is required when payeeId is not provided' });

    // optional invoice link — validates and auto-marks paid
    let invoice = null;
    if (relatedInvoiceId) {
      const invDoc = await db.collection('subcontractor_invoices').doc(relatedInvoiceId).get();
      if (!invDoc.exists) return res.status(400).json({ error: 'relatedInvoiceId does not match an invoice' });
      invoice = invDoc.data();
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const payment = {
      id,
      payeeType, payeeId: payeeId || null, payeeName: resolvedName,
      siteId: siteId || null,
      amount: amt,
      method,
      reference: reference || '',       // check #, ACH/wire confirmation, last-4
      reason,                            // why: invoice #, PO, payroll period, rental…
      relatedInvoiceId: relatedInvoiceId || null,
      proofUrls: [],
      paidDate: paidDate || now.split('T')[0],
      recordedBy: req.user.uid,
      recordedByName: req.user.name || '',
      recordedAt: now,
    };
    await db.collection('payments').doc(id).set(payment);

    if (invoice && invoice.status !== 'paid') {
      await db.collection('subcontractor_invoices').doc(relatedInvoiceId).update({
        status: 'paid', paidAt: now, paymentId: id,
      });
    }

    await db.collection('audit_logs').doc(uuidv4()).set({
      action: 'PAYMENT_RECORDED', paymentId: id, payeeName: resolvedName,
      amount: amt, method, siteId: siteId || null,
      performedBy: req.user.uid, timestamp: now,
    });

    res.status(201).json({ message: 'Payment recorded', payment });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/', authenticate, manageRoles, async (req, res) => {
  try {
    const { siteId, payeeType, payeeId, startDate, endDate } = req.query;
    let query = db.collection('payments');
    if (siteId) query = query.where('siteId', '==', siteId);
    if (payeeId) query = query.where('payeeId', '==', payeeId);
    const snap = await query.get();
    let payments = snap.docs.map(d => d.data());
    if (payeeType) payments = payments.filter(p => p.payeeType === payeeType);
    if (startDate) payments = payments.filter(p => p.paidDate >= startDate);
    if (endDate) payments = payments.filter(p => p.paidDate <= endDate);
    payments.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
    res.json(payments);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Attach proof: check image, wire confirmation PDF, signed receipt photo
router.post('/:id/proof', authenticate, manageRoles, upload.single('proof'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'proof file is required' });
    const doc = await db.collection('payments').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Payment not found' });

    const ext = req.file.mimetype.includes('pdf') ? 'pdf' : 'jpg';
    const url = await saveFile(`payments/${req.params.id}/${uuidv4()}.${ext}`, req.file.buffer, req.file.mimetype);
    await db.collection('payments').doc(req.params.id).update({
      proofUrls: [...(doc.data().proofUrls || []), url],
    });

    // also register it in the documents library, linked to this payment
    const docId = uuidv4();
    await db.collection('documents').doc(docId).set({
      id: docId,
      uploadedBy: req.user.uid,
      siteId: doc.data().siteId || '',
      documentType: 'payment_proof',
      description: `Proof for payment to ${doc.data().payeeName} — ${doc.data().reason}`,
      vendorName: doc.data().payeeName,
      amount: doc.data().amount,
      relatedType: 'payment',
      relatedId: req.params.id,
      url,
      fileName: req.file.originalname,
      timestamp: new Date().toISOString(),
    });

    res.status(201).json({ message: 'Proof attached', url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
