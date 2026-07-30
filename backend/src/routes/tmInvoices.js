const express = require('express');
const router = express.Router();
const { db } = require('../services/firebase');
const { authenticate, authorize } = require('../middleware/auth');
const { generateTMInvoicePDF } = require('../services/pdf');
const { v4: uuidv4 } = require('uuid');

// Time & Materials → Invoice automation: pulls actual labor (punches),
// equipment hours (machine_hours_log), and consumed materials
// (material_tickets) for a site + date range and rolls them into a single
// billable draft invoice — no manual re-entry from three separate modules.

const acctRoles = authorize('accountant', 'manager', 'admin');

function laborRate(p) {
  if (p.paymentTypeSnapshot === 'hourly') return p.rateSnapshot || 0;
  if (p.paymentTypeSnapshot === 'daily') return (p.rateSnapshot || 0) / 8;
  return 0;
}

async function aggregateLabor(siteId, startDate, endDate) {
  const snap = await db.collection('punches')
    .where('siteId', '==', siteId)
    .where('type', '==', 'out')
    .get();
  const inRange = snap.docs.map(d => d.data())
    .filter(p => !p.supersededBy && p.timestamp >= `${startDate}T00:00:00.000Z` && p.timestamp <= `${endDate}T23:59:59.999Z`);

  const byEmployee = {};
  for (const p of inRange) {
    if (!p.durationHours) continue;
    const rate = laborRate(p);
    if (!byEmployee[p.employeeId]) byEmployee[p.employeeId] = { employeeId: p.employeeId, hours: 0, rate, cost: 0 };
    byEmployee[p.employeeId].hours = +(byEmployee[p.employeeId].hours + p.durationHours).toFixed(2);
    byEmployee[p.employeeId].cost = +(byEmployee[p.employeeId].cost + p.durationHours * rate).toFixed(2);
  }
  const lines = Object.values(byEmployee);
  for (const line of lines) {
    const empDoc = await db.collection('users').doc(line.employeeId).get();
    line.employeeName = empDoc.exists ? empDoc.data().name : 'Unknown';
  }
  return lines;
}

async function aggregateEquipment(siteId, startDate, endDate) {
  const snap = await db.collection('machine_hours_log')
    .where('siteId', '==', siteId)
    .get();
  const inRange = snap.docs.map(d => d.data())
    .filter(l => l.date >= startDate && l.date <= endDate && l.hoursAdded > 0);

  const byEquipment = {};
  for (const l of inRange) {
    if (!byEquipment[l.equipmentId]) byEquipment[l.equipmentId] = { equipmentId: l.equipmentId, equipmentName: l.equipmentName, hours: 0 };
    byEquipment[l.equipmentId].hours = +(byEquipment[l.equipmentId].hours + l.hoursAdded).toFixed(2);
  }
  const lines = Object.values(byEquipment);
  for (const line of lines) {
    const eqDoc = await db.collection('equipment').doc(line.equipmentId).get();
    let rate = 0;
    if (eqDoc.exists) {
      const typeDoc = await db.collection('equipment_types').doc(eqDoc.data().typeId).get();
      rate = typeDoc.exists ? (typeDoc.data().defaultHourlyRate || 0) : 0;
    }
    line.rate = rate;
    line.cost = +(line.hours * rate).toFixed(2);
  }
  return lines;
}

async function aggregateMaterials(siteId, startDate, endDate) {
  const snap = await db.collection('material_tickets')
    .where('siteId', '==', siteId)
    .where('ticketType', '==', 'consume')
    .get();
  const inRange = snap.docs.map(d => d.data())
    .filter(t => t.loggedAt >= `${startDate}T00:00:00.000Z` && t.loggedAt <= `${endDate}T23:59:59.999Z`);

  const byMaterial = {};
  for (const t of inRange) {
    if (!byMaterial[t.materialId]) byMaterial[t.materialId] = { materialId: t.materialId, description: t.materialDescription, unit: t.unit, qty: 0 };
    byMaterial[t.materialId].qty = +(byMaterial[t.materialId].qty + (t.qty || 0)).toFixed(3);
  }
  const lines = Object.values(byMaterial);
  for (const line of lines) {
    const matDoc = await db.collection('material_items').doc(line.materialId).get();
    const unitCost = matDoc.exists ? (matDoc.data().unitCost || 0) : 0;
    line.unitCost = unitCost;
    line.cost = +(line.qty * unitCost).toFixed(2);
  }
  return lines;
}

// ─── GENERATE DRAFT INVOICE ───────────────────────────────────────────────────
router.post('/generate', authenticate, acctRoles, async (req, res) => {
  try {
    const { siteId, title, periodStart, periodEnd, markupPercent } = req.body;
    if (!siteId) return res.status(400).json({ error: 'siteId is required' });
    if (!periodStart || !periodEnd) return res.status(400).json({ error: 'periodStart and periodEnd are required' });

    const siteDoc = await db.collection('sites').doc(siteId).get();
    if (!siteDoc.exists) return res.status(400).json({ error: 'siteId does not match an existing site' });

    const [labor, equipment, materials] = await Promise.all([
      aggregateLabor(siteId, periodStart, periodEnd),
      aggregateEquipment(siteId, periodStart, periodEnd),
      aggregateMaterials(siteId, periodStart, periodEnd),
    ]);

    const laborTotal = +labor.reduce((s, l) => s + l.cost, 0).toFixed(2);
    const equipmentTotal = +equipment.reduce((s, l) => s + l.cost, 0).toFixed(2);
    const materialsTotal = +materials.reduce((s, l) => s + l.cost, 0).toFixed(2);
    const subtotal = +(laborTotal + equipmentTotal + materialsTotal).toFixed(2);
    const markup = markupPercent ? Math.max(0, parseFloat(markupPercent)) : 0;
    const markupAmount = +(subtotal * (markup / 100)).toFixed(2);
    const total = +(subtotal + markupAmount).toFixed(2);

    const id = uuidv4();
    const invoice = {
      id,
      siteId,
      siteName: siteDoc.data().name,
      title: title || `T&M Invoice — ${periodStart} to ${periodEnd}`,
      periodStart,
      periodEnd,
      lineItems: { labor, equipment, materials },
      subtotals: { labor: laborTotal, equipment: equipmentTotal, materials: materialsTotal },
      subtotal,
      markupPercent: markup,
      markupAmount,
      total,
      status: 'draft', // draft | sent | paid
      createdBy: req.user.uid,
      createdByName: req.user.name || '',
      createdAt: new Date().toISOString(),
      sentAt: null,
      paidAt: null,
    };

    await db.collection('tm_invoices').doc(id).set(invoice);
    res.status(201).json({ message: 'Draft invoice generated', invoice });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── LIST / GET ────────────────────────────────────────────────────────────────
router.get('/', authenticate, acctRoles, async (req, res) => {
  try {
    const { siteId, status } = req.query;
    let query = db.collection('tm_invoices');
    if (siteId) query = query.where('siteId', '==', siteId);
    const snap = await query.get();
    let invoices = snap.docs.map(d => d.data());
    if (status) invoices = invoices.filter(i => i.status === status);
    invoices.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json(invoices);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', authenticate, acctRoles, async (req, res) => {
  try {
    const doc = await db.collection('tm_invoices').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Invoice not found' });
    res.json(doc.data());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── STATUS ────────────────────────────────────────────────────────────────────
router.patch('/:id/status', authenticate, acctRoles, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['sent', 'paid'].includes(status)) return res.status(400).json({ error: "status must be 'sent' or 'paid'" });
    const doc = await db.collection('tm_invoices').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Invoice not found' });

    const updates = { status };
    const now = new Date().toISOString();
    if (status === 'sent') updates.sentAt = now;
    if (status === 'paid') updates.paidAt = now;
    await db.collection('tm_invoices').doc(req.params.id).update(updates);
    res.json({ message: `Invoice marked ${status}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PDF ───────────────────────────────────────────────────────────────────────
router.get('/:id/pdf', authenticate, acctRoles, async (req, res) => {
  try {
    const doc = await db.collection('tm_invoices').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Invoice not found' });
    const invoice = doc.data();

    const pdfBuffer = await generateTMInvoicePDF(invoice);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=tm-invoice-${invoice.id}.pdf`);
    res.send(pdfBuffer);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
