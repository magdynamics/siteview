const express = require('express');
const router = express.Router();
const { db } = require('../services/firebase');
const { authenticate, authorize } = require('../middleware/auth');

// Weekly budget engine (technical guideline §4.7). Actuals are computed
// live from captured events — never hand-entered:
//   labor     = out-punches (durationHours × rate snapshot)
//   equipment = maintenance record costs + fuel costs in the week
//   materials = BOM consume tickets × unit cost + shop-stock takes

const budgetRoles = authorize('supervisor', 'accountant', 'manager', 'admin');

function weekBounds(weekStartDate) {
  // weeks run Monday..Sunday; default = current week
  let start;
  if (weekStartDate) {
    start = new Date(`${weekStartDate}T00:00:00.000Z`);
  } else {
    const now = new Date();
    const day = now.getUTCDay() || 7;
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day + 1));
  }
  const end = new Date(start.getTime() + 6 * 86400000);
  return {
    weekStartDate: start.toISOString().split('T')[0],
    weekEndDate: end.toISOString().split('T')[0],
  };
}

async function computeActuals(siteId, weekStartDate, weekEndDate) {
  const startIso = `${weekStartDate}T00:00:00.000Z`;
  const endIso = `${weekEndDate}T23:59:59.999Z`;

  const [punchSnap, maintSnap, hoursSnap, matTicketSnap, invTxSnap] = await Promise.all([
    db.collection('punches').where('timestamp', '>=', startIso).where('timestamp', '<=', endIso).get(),
    db.collection('maintenance_records').where('maintenanceDate', '>=', weekStartDate).where('maintenanceDate', '<=', weekEndDate).get(),
    db.collection('machine_hours_log').where('date', '>=', weekStartDate).where('date', '<=', weekEndDate).get(),
    db.collection('material_tickets').where('loggedAt', '>=', startIso).where('loggedAt', '<=', endIso).get(),
    db.collection('inventory_transactions').where('timestamp', '>=', startIso).where('timestamp', '<=', endIso).get(),
  ]);

  let labor = 0, laborHours = 0;
  punchSnap.docs.forEach(d => {
    const p = d.data();
    if (p.siteId !== siteId || p.type !== 'out' || !p.durationHours) return;
    laborHours += p.durationHours;
    if (p.paymentTypeSnapshot === 'hourly') labor += p.durationHours * (p.rateSnapshot || 0);
    else if (p.paymentTypeSnapshot === 'daily') labor += (p.durationHours / 8) * (p.rateSnapshot || 0);
  });

  let equipment = 0;
  maintSnap.docs.forEach(d => {
    const r = d.data();
    if (r.siteId === siteId) equipment += r.totalCost || 0;
  });
  hoursSnap.docs.forEach(d => {
    const log = d.data();
    if (log.siteId === siteId) equipment += log.fuelCost || 0;
  });

  let materials = 0;
  const matCostCache = {};
  for (const doc of matTicketSnap.docs) {
    const t = doc.data();
    if (t.siteId !== siteId || t.ticketType !== 'consume') continue;
    if (!(t.materialId in matCostCache)) {
      const m = await db.collection('material_items').doc(t.materialId).get();
      matCostCache[t.materialId] = m.exists ? (m.data().unitCost || 0) : 0;
    }
    materials += (t.qty || 0) * matCostCache[t.materialId];
  }
  invTxSnap.docs.forEach(d => {
    const tx = d.data();
    if (tx.siteId === siteId && tx.transactionType === 'take') materials += tx.totalCost || 0;
  });

  return {
    actualLaborCost: +labor.toFixed(2),
    actualLaborHours: +laborHours.toFixed(2),
    actualEquipmentCost: +equipment.toFixed(2),
    actualMaterialCost: +materials.toFixed(2),
    actualTotal: +(labor + equipment + materials).toFixed(2),
    computedAt: new Date().toISOString(),
  };
}

async function getWeeklyBudget(siteId, weekStartDate) {
  const bounds = weekBounds(weekStartDate);
  const docId = `${siteId}_${bounds.weekStartDate}`;
  const doc = await db.collection('weekly_budgets').doc(docId).get();
  const planned = doc.exists ? doc.data() : {
    plannedLaborCost: 0, plannedEquipmentCost: 0, plannedMaterialCost: 0, plannedTotal: 0,
  };
  const actuals = await computeActuals(siteId, bounds.weekStartDate, bounds.weekEndDate);
  const budget = {
    id: docId,
    siteId,
    ...bounds,
    plannedLaborCost: planned.plannedLaborCost || 0,
    plannedEquipmentCost: planned.plannedEquipmentCost || 0,
    plannedMaterialCost: planned.plannedMaterialCost || 0,
    plannedTotal: planned.plannedTotal || 0,
    ...actuals,
    variance: +((actuals.actualTotal) - (planned.plannedTotal || 0)).toFixed(2),
    hasPlan: doc.exists,
  };
  // persist the latest computation so history reads are cheap
  await db.collection('weekly_budgets').doc(docId).set(budget, { merge: true });
  return budget;
}

// ─── SET / UPDATE THE WEEK'S PLAN ─────────────────────────────────────────────
router.put('/weekly/plan', authenticate, authorize('accountant', 'manager', 'admin'), async (req, res) => {
  try {
    const { siteId, weekStartDate, plannedLaborCost, plannedEquipmentCost, plannedMaterialCost } = req.body;
    if (!siteId) return res.status(400).json({ error: 'siteId is required' });
    const siteDoc = await db.collection('sites').doc(siteId).get();
    if (!siteDoc.exists) return res.status(400).json({ error: 'siteId does not match an existing site' });

    const bounds = weekBounds(weekStartDate);
    const labor = parseFloat(plannedLaborCost) || 0;
    const equip = parseFloat(plannedEquipmentCost) || 0;
    const mat = parseFloat(plannedMaterialCost) || 0;

    const docId = `${siteId}_${bounds.weekStartDate}`;
    await db.collection('weekly_budgets').doc(docId).set({
      id: docId,
      siteId,
      ...bounds,
      plannedLaborCost: labor,
      plannedEquipmentCost: equip,
      plannedMaterialCost: mat,
      plannedTotal: +(labor + equip + mat).toFixed(2),
      plannedBy: req.user.uid,
      plannedAt: new Date().toISOString(),
    }, { merge: true });

    const budget = await getWeeklyBudget(siteId, bounds.weekStartDate);
    res.json({ message: 'Weekly plan saved', budget });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── WEEKLY BUDGET (live actuals) ─────────────────────────────────────────────
router.get('/weekly', authenticate, budgetRoles, async (req, res) => {
  try {
    const { siteId, week } = req.query;
    if (!siteId) return res.status(400).json({ error: 'siteId is required' });
    res.json(await getWeeklyBudget(siteId, week));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── VARIANCE ─────────────────────────────────────────────────────────────────
router.get('/variance', authenticate, budgetRoles, async (req, res) => {
  try {
    const { siteId, week } = req.query;
    if (!siteId) return res.status(400).json({ error: 'siteId is required' });
    const b = await getWeeklyBudget(siteId, week);
    res.json({
      siteId,
      weekStartDate: b.weekStartDate,
      labor: { planned: b.plannedLaborCost, actual: b.actualLaborCost, variance: +(b.actualLaborCost - b.plannedLaborCost).toFixed(2) },
      equipment: { planned: b.plannedEquipmentCost, actual: b.actualEquipmentCost, variance: +(b.actualEquipmentCost - b.plannedEquipmentCost).toFixed(2) },
      materials: { planned: b.plannedMaterialCost, actual: b.actualMaterialCost, variance: +(b.actualMaterialCost - b.plannedMaterialCost).toFixed(2) },
      total: { planned: b.plannedTotal, actual: b.actualTotal, variance: b.variance },
      overBudget: b.plannedTotal > 0 && b.actualTotal > b.plannedTotal,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── HISTORY (trend over prior weeks) ─────────────────────────────────────────
router.get('/weekly/history', authenticate, budgetRoles, async (req, res) => {
  try {
    const { siteId } = req.query;
    const weeks = Math.min(parseInt(req.query.weeks) || 4, 12);
    if (!siteId) return res.status(400).json({ error: 'siteId is required' });

    const current = weekBounds().weekStartDate;
    const results = [];
    for (let i = 0; i < weeks; i++) {
      const start = new Date(new Date(`${current}T00:00:00.000Z`).getTime() - i * 7 * 86400000)
        .toISOString().split('T')[0];
      results.push(await getWeeklyBudget(siteId, start));
    }
    res.json(results.reverse());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = { router, getWeeklyBudget, computeActuals, weekBounds };
