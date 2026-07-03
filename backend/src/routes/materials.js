const express = require('express');
const router = express.Router();
const { db, messaging } = require('../services/firebase');
const { authenticate, authorize } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// Materials / Bill-of-Materials with location tracking (technical guideline §4.4).
// material_items is the BOM master; material_tickets is the single event log
// that drives quantities, location lookup, and BOM variance.
// (Separate from the shop-stock `inventory` module, which tracks consumables.)

const TICKET_TYPES = ['receive', 'consume', 'dispose', 'relocate'];

function materialShape(body, user) {
  return {
    id: uuidv4(),
    siteId: body.siteId,
    description: body.description,
    unitOfMeasure: body.unitOfMeasure || 'each',
    specReference: body.specReference || '',   // plan/BOM line reference
    qtyPlanned: parseFloat(body.qtyPlanned),
    qtyReceived: 0,
    qtyConsumed: 0,
    qtyDisposed: 0,
    qtyOnHand: 0,
    unitCost: body.unitCost ? parseFloat(body.unitCost) : 0,
    currentLocation: null,   // { zone: {area, aisle, row}, loggedBy, loggedByName, loggedAt, ticketId }
    createdBy: user.uid,
    createdAt: new Date().toISOString(),
    isActive: true,
  };
}

function validateMaterial(body) {
  if (!body.siteId) return 'siteId is required';
  if (!body.description) return 'description is required';
  const qty = parseFloat(body.qtyPlanned);
  if (isNaN(qty) || qty <= 0) return 'qtyPlanned must be a positive number';
  return null;
}

function stripCostFor(user, item) {
  if (user.role !== 'employee') return item;
  const { unitCost, ...rest } = item;
  return rest;
}

// ─── CREATE BOM LINE(S) ───────────────────────────────────────────────────────
router.post('/', authenticate, authorize('supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const err = validateMaterial(req.body);
    if (err) return res.status(400).json({ error: err });
    const item = materialShape(req.body, req.user);
    await db.collection('material_items').doc(item.id).set(item);
    res.status(201).json({ message: 'Material added', item });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Bulk BOM import: { siteId, items: [{description, unitOfMeasure, specReference, qtyPlanned, unitCost}] }
router.post('/bulk', authenticate, authorize('supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const { siteId, items } = req.body;
    if (!siteId || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'siteId and a non-empty items array are required' });
    }
    const created = [];
    const errors = [];
    for (const [i, raw] of items.entries()) {
      const body = { ...raw, siteId };
      const err = validateMaterial(body);
      if (err) { errors.push({ row: i + 1, error: err }); continue; }
      created.push(materialShape(body, req.user));
    }
    if (errors.length) return res.status(400).json({ error: 'Some rows are invalid', rows: errors });

    const batch = db.batch();
    created.forEach(item => batch.set(db.collection('material_items').doc(item.id), item));
    await batch.commit();
    res.status(201).json({ message: `${created.length} materials imported`, items: created });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── LIST / SEARCH ────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    let query = db.collection('material_items').where('isActive', '==', true);
    if (req.query.siteId) query = query.where('siteId', '==', req.query.siteId);
    const snap = await query.get();
    const items = snap.docs.map(d => stripCostFor(req.user, d.data()));
    res.json(items);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// "Find material" — substring match on description/specReference
router.get('/search', authenticate, async (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase().trim();
    if (!q) return res.status(400).json({ error: 'q is required' });
    let query = db.collection('material_items').where('isActive', '==', true);
    if (req.query.siteId) query = query.where('siteId', '==', req.query.siteId);
    const snap = await query.get();
    const matches = snap.docs.map(d => d.data())
      .filter(m => m.description.toLowerCase().includes(q) || (m.specReference || '').toLowerCase().includes(q))
      .map(m => stripCostFor(req.user, m));
    res.json(matches);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('material_items').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Material not found' });
    res.json(stripCostFor(req.user, doc.data()));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── LOCATION LOOKUP ("where is beam 5012?") ─────────────────────────────────
router.get('/:id/location', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('material_items').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Material not found' });
    const m = doc.data();
    if (!m.currentLocation) return res.json({ materialId: m.id, description: m.description, location: null, message: 'No location logged yet' });
    const ageHours = +((Date.now() - new Date(m.currentLocation.loggedAt)) / 3600000).toFixed(1);
    res.json({
      materialId: m.id,
      description: m.description,
      qtyOnHand: m.qtyOnHand,
      unit: m.unitOfMeasure,
      location: m.currentLocation.zone,
      loggedBy: m.currentLocation.loggedByName || m.currentLocation.loggedBy,
      loggedAt: m.currentLocation.loggedAt,
      ageHours,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── BALANCE / VARIANCE ───────────────────────────────────────────────────────
router.get('/:id/balance', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('material_items').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Material not found' });
    const m = doc.data();
    res.json({
      materialId: m.id,
      description: m.description,
      unit: m.unitOfMeasure,
      qtyPlanned: m.qtyPlanned,
      qtyReceived: m.qtyReceived,
      qtyConsumed: m.qtyConsumed,
      qtyDisposed: m.qtyDisposed,
      qtyOnHand: m.qtyOnHand,
      receivedPctOfPlanned: +((m.qtyReceived / m.qtyPlanned) * 100).toFixed(1),
      consumedPctOfPlanned: +((m.qtyConsumed / m.qtyPlanned) * 100).toFixed(1),
      overrun: m.qtyConsumed > m.qtyPlanned,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── TICKET HISTORY ───────────────────────────────────────────────────────────
router.get('/:id/tickets', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('material_tickets')
      .where('materialId', '==', req.params.id)
      .orderBy('loggedAt', 'desc')
      .limit(100)
      .get();
    res.json(snap.docs.map(d => d.data()));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── LOG A TICKET (receive / consume / dispose / relocate) ───────────────────
// Any authenticated user — field crews log receiving and consumption
router.post('/:id/tickets', authenticate, async (req, res) => {
  try {
    const { ticketType, qty, locationZone, linkedTaskId, poReference, supplier, notes } = req.body;
    if (!TICKET_TYPES.includes(ticketType)) {
      return res.status(400).json({ error: `ticketType must be one of: ${TICKET_TYPES.join(', ')}` });
    }
    const needsQty = ticketType !== 'relocate';
    const parsedQty = parseFloat(qty);
    if (needsQty && (isNaN(parsedQty) || parsedQty <= 0)) {
      return res.status(400).json({ error: 'qty must be a positive number' });
    }
    const needsZone = ['receive', 'relocate'].includes(ticketType);
    if (needsZone && (!locationZone || !locationZone.area)) {
      return res.status(400).json({ error: 'locationZone with at least an area is required for receive/relocate' });
    }

    const materialRef = db.collection('material_items').doc(req.params.id);
    const ticketId = uuidv4();
    const now = new Date().toISOString();

    const result = await db.runTransaction(async (t) => {
      const doc = await t.get(materialRef);
      if (!doc.exists) return { error: { status: 404, message: 'Material not found' } };
      const m = doc.data();

      const updates = {};
      if (ticketType === 'receive') {
        updates.qtyReceived = +(m.qtyReceived + parsedQty).toFixed(3);
        updates.qtyOnHand = +(m.qtyOnHand + parsedQty).toFixed(3);
      } else if (ticketType === 'consume') {
        if (m.qtyOnHand < parsedQty) return { error: { status: 400, message: `Insufficient on hand. Available: ${m.qtyOnHand} ${m.unitOfMeasure}` } };
        updates.qtyConsumed = +(m.qtyConsumed + parsedQty).toFixed(3);
        updates.qtyOnHand = +(m.qtyOnHand - parsedQty).toFixed(3);
      } else if (ticketType === 'dispose') {
        if (m.qtyOnHand < parsedQty) return { error: { status: 400, message: `Insufficient on hand. Available: ${m.qtyOnHand} ${m.unitOfMeasure}` } };
        updates.qtyDisposed = +(m.qtyDisposed + parsedQty).toFixed(3);
        updates.qtyOnHand = +(m.qtyOnHand - parsedQty).toFixed(3);
      }
      if (needsZone) {
        updates.currentLocation = {
          zone: { area: locationZone.area, aisle: locationZone.aisle || '', row: locationZone.row || '' },
          loggedBy: req.user.uid,
          loggedByName: req.user.name || '',
          loggedAt: now,
          ticketId,
        };
      }

      const ticket = {
        id: ticketId,
        materialId: m.id,
        materialDescription: m.description,
        siteId: m.siteId,
        ticketType,
        qty: needsQty ? parsedQty : null,
        unit: m.unitOfMeasure,
        locationZone: needsZone
          ? { area: locationZone.area, aisle: locationZone.aisle || '', row: locationZone.row || '' }
          : null,
        linkedTaskId: linkedTaskId || null,   // wired to tasks in Phase 3
        photoUrls: [],                        // filled once Storage is provisioned
        poReference: poReference || null,
        supplier: supplier || null,
        notes: notes || '',
        loggedBy: req.user.uid,
        loggedByName: req.user.name || '',
        loggedAt: now,
      };

      t.set(db.collection('material_tickets').doc(ticketId), ticket);
      t.update(materialRef, updates);
      return { ticket, material: { ...m, ...updates } };
    });

    if (result.error) return res.status(result.error.status).json({ error: result.error.message });

    // BOM overrun early warning (guideline recommendation #9)
    if (ticketType === 'consume') {
      await checkBomOverrun(result.material);
    }

    res.status(201).json({ message: 'Ticket logged', ticket: result.ticket, quantities: {
      qtyReceived: result.material.qtyReceived,
      qtyConsumed: result.material.qtyConsumed,
      qtyDisposed: result.material.qtyDisposed,
      qtyOnHand: result.material.qtyOnHand,
    }});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── BOM OVERRUN ALERTS ───────────────────────────────────────────────────────
async function checkBomOverrun(material) {
  try {
    const pct = material.qtyConsumed / material.qtyPlanned;
    let type = null;
    if (pct > 1) type = 'bom_overrun';
    else if (pct >= 0.9) type = 'bom_overrun_warning';
    if (!type) return;

    // one alert per material per type
    const alertId = `${material.id}_${type}`;
    const existing = await db.collection('material_alerts').doc(alertId).get();
    if (existing.exists) return;

    await db.collection('material_alerts').doc(alertId).set({
      id: alertId,
      materialId: material.id,
      siteId: material.siteId,
      type,
      message: type === 'bom_overrun'
        ? `${material.description}: consumed ${material.qtyConsumed} of ${material.qtyPlanned} planned ${material.unitOfMeasure} — OVER budgeted quantity`
        : `${material.description}: consumption at ${(pct * 100).toFixed(0)}% of planned quantity — heading for overrun`,
      createdAt: new Date().toISOString(),
      acknowledged: false,
    });

    const usersSnap = await db.collection('users')
      .where('assignedSiteId', '==', material.siteId)
      .where('role', 'in', ['supervisor', 'admin'])
      .get();
    const tokens = usersSnap.docs.map(d => d.data().fcmToken).filter(Boolean);
    if (tokens.length) {
      await messaging.sendEachForMulticast({
        tokens,
        notification: {
          title: type === 'bom_overrun' ? '🔴 BOM Overrun' : '🟡 BOM Overrun Warning',
          body: `${material.description}: ${material.qtyConsumed}/${material.qtyPlanned} ${material.unitOfMeasure} consumed`,
        },
      });
    }
  } catch (err) { console.error('BOM overrun check failed:', err.message); }
}

// List open material alerts
router.get('/alerts/open', authenticate, authorize('supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    let query = db.collection('material_alerts').where('acknowledged', '==', false);
    if (req.query.siteId) query = query.where('siteId', '==', req.query.siteId);
    const snap = await query.get();
    res.json(snap.docs.map(d => d.data()));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
