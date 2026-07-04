const express = require('express');
const router = express.Router();
const { db } = require('../services/firebase');
const { authenticate, authorize } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// Vendor registry — material suppliers, equipment rental houses, fuel, etc.
// (Distinct from subcontractors, who perform trade work.) Feeds the payment
// ledger and receipt/document linking.

const manageRoles = authorize('accountant', 'manager', 'admin');

router.post('/', authenticate, manageRoles, async (req, res) => {
  try {
    const { name, category, contactName, phone, email, accountNumber, paymentTerms, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const id = uuidv4();
    const vendor = {
      id, name,
      category: category || '',          // materials | equipment_rental | fuel | services | other
      contactName: contactName || '',
      phone: phone || '',
      email: email || '',
      accountNumber: accountNumber || '',
      paymentTerms: paymentTerms || '',  // e.g. Net 30
      notes: notes || '',
      isActive: true,
      createdBy: req.user.uid,
      createdAt: new Date().toISOString(),
    };
    await db.collection('vendors').doc(id).set(vendor);
    res.status(201).json({ message: 'Vendor added', vendor });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/', authenticate, authorize('supervisor', 'accountant', 'manager', 'admin'), async (req, res) => {
  try {
    const { includeInactive } = req.query;
    let query = db.collection('vendors');
    if (includeInactive !== 'true') query = query.where('isActive', '==', true);
    const snap = await query.get();
    res.json(snap.docs.map(d => d.data()).sort((a, b) => a.name.localeCompare(b.name)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id', authenticate, manageRoles, async (req, res) => {
  try {
    const doc = await db.collection('vendors').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Vendor not found' });
    const allowed = ['name', 'category', 'contactName', 'phone', 'email', 'accountNumber', 'paymentTerms', 'notes', 'isActive'];
    const updates = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No updatable fields provided' });
    updates.updatedBy = req.user.uid;
    updates.updatedAt = new Date().toISOString();
    await db.collection('vendors').doc(req.params.id).update(updates);
    res.json({ message: 'Vendor updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
