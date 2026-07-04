const express = require('express');
const router = express.Router();
const cron = require('node-cron');
const { db, messaging } = require('../services/firebase');
const { authenticate, authorize } = require('../middleware/auth');
const { getWeeklyBudget, weekBounds } = require('./budget');
const { v4: uuidv4 } = require('uuid');

// Cash forecast snapshots (technical guideline §4.8): generated every
// Thursday for the accountant, and on demand.

const acctRoles = authorize('accountant', 'manager', 'admin');

async function generateSnapshot(siteId) {
  const bounds = weekBounds();
  const budget = await getWeeklyBudget(siteId, bounds.weekStartDate);

  // obligations: recent material receipts with a PO reference — the invoices
  // that will land on the accountant's desk
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const receiveSnap = await db.collection('material_tickets')
    .where('loggedAt', '>=', since)
    .get();
  const obligations = {};
  for (const doc of receiveSnap.docs) {
    const t = doc.data();
    if (t.siteId !== siteId || t.ticketType !== 'receive' || !t.poReference) continue;
    const m = await db.collection('material_items').doc(t.materialId).get();
    const amount = (t.qty || 0) * (m.exists ? (m.data().unitCost || 0) : 0);
    const key = `${t.supplier || 'Unknown supplier'}|${t.poReference}`;
    if (!obligations[key]) obligations[key] = { vendor: t.supplier || 'Unknown supplier', poReference: t.poReference, amount: 0 };
    obligations[key].amount = +(obligations[key].amount + amount).toFixed(2);
  }
  const obligationsDue = Object.values(obligations);

  const payrollDueAmount = budget.actualLaborCost;
  const obligationsTotal = +obligationsDue.reduce((s, o) => s + o.amount, 0).toFixed(2);
  const projectedSpendTotal = +(budget.actualTotal + obligationsTotal).toFixed(2);
  const flaggedShortfall = budget.plannedTotal > 0 && projectedSpendTotal > budget.plannedTotal;

  const snapshot = {
    id: uuidv4(),
    siteId,
    generatedAt: new Date().toISOString(),
    weekStartDate: bounds.weekStartDate,
    projectedSpendTotal,
    weekActualToDate: budget.actualTotal,
    obligationsDue,
    obligationsTotal,
    payrollDueAmount,
    plannedTotal: budget.plannedTotal,
    flaggedShortfall,
    notes: flaggedShortfall
      ? `Projected spend $${projectedSpendTotal.toLocaleString()} exceeds the weekly plan of $${budget.plannedTotal.toLocaleString()}`
      : '',
  };
  await db.collection('cash_forecast_snapshots').doc(snapshot.id).set(snapshot);

  if (flaggedShortfall) {
    const usersSnap = await db.collection('users').where('isActive', '==', true).get();
    const tokens = usersSnap.docs
      .filter(d => ['accountant', 'manager', 'admin'].includes(d.data().role))
      .map(d => d.data().fcmToken)
      .filter(Boolean);
    if (tokens.length) {
      await messaging.sendEachForMulticast({
        tokens,
        notification: { title: '💰 Cash Forecast Shortfall', body: snapshot.notes },
      });
    }
  }
  return snapshot;
}

// ─── LATEST FORECAST ──────────────────────────────────────────────────────────
router.get('/cash-forecast', authenticate, acctRoles, async (req, res) => {
  try {
    const { siteId } = req.query;
    if (!siteId) return res.status(400).json({ error: 'siteId is required' });
    const snap = await db.collection('cash_forecast_snapshots')
      .where('siteId', '==', siteId)
      .get();
    const all = snap.docs.map(d => d.data()).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
    if (!all.length) return res.json({ message: 'No forecast yet — generate one', snapshot: null });
    res.json({ snapshot: all[0], history: all.slice(0, 8) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── GENERATE ON DEMAND ───────────────────────────────────────────────────────
router.post('/cash-forecast/generate', authenticate, acctRoles, async (req, res) => {
  try {
    const { siteId } = req.body;
    if (!siteId) return res.status(400).json({ error: 'siteId is required' });
    const siteDoc = await db.collection('sites').doc(siteId).get();
    if (!siteDoc.exists) return res.status(400).json({ error: 'siteId does not match an existing site' });
    res.status(201).json({ message: 'Forecast generated', snapshot: await generateSnapshot(siteId) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── THURSDAY AUTO-GENERATION ─────────────────────────────────────────────────
cron.schedule('30 7 * * 4', async () => {
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    const markerRef = db.collection('system').doc('cashForecastJob');
    const shouldRun = await db.runTransaction(async t => {
      const marker = await t.get(markerRef);
      if (marker.exists && marker.data().lastRunDate === todayStr) return false;
      t.set(markerRef, { lastRunDate: todayStr, lastRunAt: new Date().toISOString() });
      return true;
    });
    if (!shouldRun) return;

    console.log('[Cash Forecast] Generating Thursday snapshots...');
    const sitesSnap = await db.collection('sites').where('isActive', '==', true).get();
    for (const siteDoc of sitesSnap.docs) {
      try { await generateSnapshot(siteDoc.data().id); } catch (e) { console.error('[Cash Forecast]', siteDoc.data().name, e.message); }
    }
    console.log('[Cash Forecast] Done');
  } catch (err) {
    console.error('[Cash Forecast] Error:', err.message);
  }
});

module.exports = router;
