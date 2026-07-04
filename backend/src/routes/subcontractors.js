const express = require('express');
const router = express.Router();
const { db } = require('../services/firebase');
const { authenticate, authorize } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// Subcontractor layer (technical guideline §10.6): not all trades are W-2
// staff. Invoices feed the weekly budget (subcontractor category) and the
// cash forecast (unpaid invoices are obligations).

const manageRoles = authorize('accountant', 'manager', 'admin');

// ─── SUBCONTRACTORS ───────────────────────────────────────────────────────────
router.post('/', authenticate, manageRoles, async (req, res) => {
  try {
    const { name, trade, contactName, phone, email, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const id = uuidv4();
    const sub = {
      id, name, trade: trade || '', contactName: contactName || '',
      phone: phone || '', email: email || '', notes: notes || '',
      isActive: true, createdBy: req.user.uid, createdAt: new Date().toISOString(),
    };
    await db.collection('subcontractors').doc(id).set(sub);
    res.status(201).json({ message: 'Subcontractor added', subcontractor: sub });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/', authenticate, authorize('supervisor', 'accountant', 'manager', 'admin'), async (req, res) => {
  try {
    const snap = await db.collection('subcontractors').where('isActive', '==', true).get();
    res.json(snap.docs.map(d => d.data()).sort((a, b) => a.name.localeCompare(b.name)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── INVOICES ─────────────────────────────────────────────────────────────────
router.post('/invoices', authenticate, manageRoles, async (req, res) => {
  try {
    const { subcontractorId, siteId, invoiceNumber, description, amount, periodStart, periodEnd, poReference } = req.body;
    if (!subcontractorId) return res.status(400).json({ error: 'subcontractorId is required' });
    if (!siteId) return res.status(400).json({ error: 'siteId is required' });
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) return res.status(400).json({ error: 'amount must be a positive number' });

    const subDoc = await db.collection('subcontractors').doc(subcontractorId).get();
    if (!subDoc.exists) return res.status(400).json({ error: 'Subcontractor not found' });

    const id = uuidv4();
    const invoice = {
      id, subcontractorId, subcontractorName: subDoc.data().name,
      siteId,
      invoiceNumber: invoiceNumber || '',
      description: description || '',
      amount: amt,
      periodStart: periodStart || new Date().toISOString().split('T')[0],
      periodEnd: periodEnd || new Date().toISOString().split('T')[0],
      poReference: poReference || null,
      status: 'pending',           // pending | approved | paid | rejected
      createdBy: req.user.uid, createdAt: new Date().toISOString(),
      approvedBy: null, approvedAt: null, paidAt: null,
    };
    await db.collection('subcontractor_invoices').doc(id).set(invoice);
    res.status(201).json({ message: 'Invoice recorded', invoice });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/invoices', authenticate, manageRoles, async (req, res) => {
  try {
    const { siteId, status } = req.query;
    let query = db.collection('subcontractor_invoices');
    if (siteId) query = query.where('siteId', '==', siteId);
    const snap = await query.get();
    let invoices = snap.docs.map(d => d.data());
    if (status) invoices = invoices.filter(i => i.status === status);
    invoices.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json(invoices);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/invoices/:id/status', authenticate, manageRoles, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'paid', 'rejected'].includes(status)) {
      return res.status(400).json({ error: "status must be 'approved', 'paid', or 'rejected'" });
    }
    const doc = await db.collection('subcontractor_invoices').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Invoice not found' });

    const updates = { status };
    const now = new Date().toISOString();
    if (status === 'approved') { updates.approvedBy = req.user.uid; updates.approvedAt = now; }
    if (status === 'paid') updates.paidAt = now;
    await db.collection('subcontractor_invoices').doc(req.params.id).update(updates);
    res.json({ message: `Invoice ${status}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
