const express = require('express');
const router = express.Router();
const { db } = require('../services/firebase');
const { takeFromInventory } = require('../services/inventoryStock');
const { authenticate, authorize } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// ─── INVENTORY ITEMS ──────────────────────────────────────────────────────────

// Get all inventory items
router.get('/', authenticate, async (req, res) => {
  try {
    const { siteId, category, lowStock } = req.query;
    let query = db.collection('inventory').where('isActive', '==', true);
    if (siteId) query = query.where('siteId', '==', siteId);
    if (category) query = query.where('category', '==', category);
    const snapshot = await query.get();
    let items = snapshot.docs.map(d => d.data());
    if (lowStock === 'true') items = items.filter(i => i.currentQty <= i.minQty);
    res.json(items);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Add inventory item
router.post('/', authenticate, authorize('admin', 'supervisor'), async (req, res) => {
  try {
    const {
      name, partNumber, category,  // 'oil' | 'filter' | 'hydraulic' | 'tires' | 'belts' | 'tools' | 'other'
      unit,          // 'each' | 'liter' | 'gallon' | 'kg' | 'box'
      currentQty, minQty, maxQty,
      unitCost, supplier,
      siteId, location,  // where on site it's stored
      compatibleEquipment,  // array of equipment IDs or types
      notes,
    } = req.body;

    const id = uuidv4();
    const item = {
      id, name, partNumber: partNumber || '',
      category, unit,
      currentQty: parseFloat(currentQty),
      minQty: parseFloat(minQty),
      maxQty: parseFloat(maxQty || 999),
      unitCost: parseFloat(unitCost || 0),
      supplier: supplier || '',
      siteId, location: location || '',
      compatibleEquipment: compatibleEquipment || [],
      notes: notes || '',
      isActive: true,
      createdBy: req.user.uid,
      createdAt: new Date().toISOString(),
    };

    await db.collection('inventory').doc(id).set(item);
    res.status(201).json({ message: 'Inventory item added', item });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Update inventory item details
router.put('/:id', authenticate, authorize('admin', 'supervisor'), async (req, res) => {
  try {
    await db.collection('inventory').doc(req.params.id).update(req.body);
    res.json({ message: 'Item updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── TAKE FROM INVENTORY ──────────────────────────────────────────────────────
router.post('/:id/take', authenticate, async (req, res) => {
  try {
    const {
      quantity, purpose,
      authorizedBy, authorizedAt,
      equipmentId, equipmentName,
      maintenanceRecordId,
    } = req.body;

    const { transaction, newQty } = await takeFromInventory({
      itemId: req.params.id,
      quantity,
      takenByUid: req.user.uid,
      takenByName: req.user.name || '',
      purpose,
      authorizedBy,
      authorizedAt,
      equipmentId,
      equipmentName,
      maintenanceRecordId,
    });

    res.status(201).json({ message: 'Items taken from inventory', transaction, newQty });
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// ─── RESTOCK INVENTORY ────────────────────────────────────────────────────────
router.post('/:id/restock', authenticate, authorize('admin', 'supervisor'), async (req, res) => {
  try {
    const { quantity, unitCost, supplier, invoiceNumber, notes } = req.body;
    const doc = await db.collection('inventory').doc(req.params.id).get();
    const item = doc.data();
    const qty = parseFloat(quantity);
    const newQty = item.currentQty + qty;

    await db.collection('inventory').doc(req.params.id).update({
      currentQty: newQty,
      unitCost: unitCost ? parseFloat(unitCost) : item.unitCost,
      supplier: supplier || item.supplier,
    });

    const txId = uuidv4();
    await db.collection('inventory_transactions').doc(txId).set({
      id: txId, itemId: req.params.id, itemName: item.name,
      transactionType: 'restock', quantity: qty, unit: item.unit,
      unitCost: unitCost ? parseFloat(unitCost) : item.unitCost,
      totalCost: qty * (unitCost ? parseFloat(unitCost) : item.unitCost),
      previousQty: item.currentQty, newQty,
      supplier: supplier || item.supplier,
      invoiceNumber: invoiceNumber || '',
      notes: notes || '',
      restockedBy: req.user.uid,
      siteId: item.siteId,
      timestamp: new Date().toISOString(),
    });

    res.json({ message: 'Inventory restocked', newQty });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── REORDER REQUEST ──────────────────────────────────────────────────────────
router.post('/:id/reorder', authenticate, async (req, res) => {
  try {
    const { quantityNeeded, urgency, notes } = req.body;
    const doc = await db.collection('inventory').doc(req.params.id).get();
    const item = doc.data();

    const requestId = uuidv4();
    const request = {
      id: requestId, itemId: req.params.id,
      itemName: item.name, partNumber: item.partNumber,
      currentQty: item.currentQty, minQty: item.minQty,
      quantityNeeded: parseFloat(quantityNeeded),
      estimatedCost: parseFloat(quantityNeeded) * item.unitCost,
      supplier: item.supplier,
      urgency: urgency || 'normal', // 'low' | 'normal' | 'urgent'
      notes: notes || '',
      status: 'pending',
      requestedBy: req.user.uid,
      siteId: item.siteId,
      requestedAt: new Date().toISOString(),
    };

    await db.collection('reorder_requests').doc(requestId).set(request);
    res.status(201).json({ message: 'Reorder request submitted', request });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get reorder requests
router.get('/reorder-requests', authenticate, authorize('supervisor', 'accountant', 'admin'), async (req, res) => {
  try {
    const { siteId, status } = req.query;
    let query = db.collection('reorder_requests');
    if (siteId) query = query.where('siteId', '==', siteId);
    if (status) query = query.where('status', '==', status);
    const snapshot = await query.orderBy('requestedAt', 'desc').get();
    res.json(snapshot.docs.map(d => d.data()));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Approve reorder request
router.post('/reorder-requests/:id/approve', authenticate, authorize('supervisor', 'admin'), async (req, res) => {
  try {
    await db.collection('reorder_requests').doc(req.params.id).update({
      status: 'approved', approvedBy: req.user.uid, approvedAt: new Date().toISOString(),
    });
    res.json({ message: 'Reorder approved' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get transaction history
router.get('/transactions', authenticate, async (req, res) => {
  try {
    const { itemId, siteId, startDate, endDate } = req.query;
    let query = db.collection('inventory_transactions');
    if (itemId) query = query.where('itemId', '==', itemId);
    if (siteId) query = query.where('siteId', '==', siteId);
    if (startDate) query = query.where('timestamp', '>=', `${startDate}T00:00:00.000Z`);
    if (endDate) query = query.where('timestamp', '<=', `${endDate}T23:59:59.999Z`);
    const snapshot = await query.orderBy('timestamp', 'desc').limit(500).get();
    res.json(snapshot.docs.map(d => d.data()));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
