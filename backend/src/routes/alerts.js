const express = require('express');
const router = express.Router();
const cron = require('node-cron');
const { db } = require('../services/firebase');
const { authenticate, authorize } = require('../middleware/auth');
const { getWeeklyBudget } = require('./budget');

// Persisted, acknowledgeable alerts (technical guideline §8/§17).
// System-generated only — evaluators scan the data hourly; one open alert
// per alertType+relatedId; acknowledging closes it (it re-raises on a later
// run only if the condition still holds).

async function raiseAlert({ siteId, alertType, severity, message, relatedId }) {
  const id = `${alertType}_${relatedId}`;
  const existing = await db.collection('alerts').doc(id).get();
  if (existing.exists && !existing.data().acknowledged) return false;  // already open
  await db.collection('alerts').doc(id).set({
    id, siteId, alertType, severity, message, relatedId,
    createdAt: new Date().toISOString(),
    acknowledged: false, acknowledgedBy: null, acknowledgedAt: null,
  });
  return true;
}

async function evaluateSite(site) {
  let raised = 0;
  const todayStr = new Date().toISOString().split('T')[0];

  const [equipSnap, schedSnap, taskSnap, matSnap, fcSnap] = await Promise.all([
    db.collection('equipment').where('siteId', '==', site.id).where('isActive', '==', true).get(),
    db.collection('maintenance_schedules').where('siteId', '==', site.id).where('status', '==', 'overdue').get(),
    db.collection('tasks').where('siteId', '==', site.id).get(),
    db.collection('material_items').where('siteId', '==', site.id).where('isActive', '==', true).get(),
    db.collection('cash_forecast_snapshots').where('siteId', '==', site.id).get(),
  ]);

  // equipment_idle: available, no hours for 7+ days
  const idleCutoff = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];
  for (const d of equipSnap.docs) {
    const e = d.data();
    if (e.status === 'available' && (!e.lastHoursLogDate || e.lastHoursLogDate < idleCutoff)) {
      if (await raiseAlert({ siteId: site.id, alertType: 'equipment_idle', severity: 'info', relatedId: e.id,
        message: `${e.name} idle since ${e.lastHoursLogDate || 'never logged'} — transfer or utilize` })) raised++;
    }
  }

  // maintenance_due: overdue schedules
  for (const d of schedSnap.docs) {
    const s = d.data();
    if (await raiseAlert({ siteId: site.id, alertType: 'maintenance_due', severity: 'warning', relatedId: s.id,
      message: `${s.equipmentName}: ${(s.maintenanceType || '').replace(/_/g, ' ')} overdue` })) raised++;
  }

  const tasks = taskSnap.docs.map(d => d.data());
  // task_overdue
  for (const t of tasks.filter(x => x.status !== 'complete' && x.scheduledDate < todayStr)) {
    if (await raiseAlert({ siteId: site.id, alertType: 'task_overdue', severity: 'warning', relatedId: t.id,
      message: `Task overdue: "${t.title}" (${t.assignedToName}, scheduled ${t.scheduledDate})` })) raised++;
  }
  // task blocked
  for (const t of tasks.filter(x => x.status === 'blocked')) {
    if (await raiseAlert({ siteId: site.id, alertType: 'task_blocked', severity: 'warning', relatedId: t.id,
      message: `Task blocked: "${t.title}" — ${t.blockedReason}` })) raised++;
  }
  // rework_flag
  for (const t of tasks.filter(x => x.reworkFlag)) {
    if (await raiseAlert({ siteId: site.id, alertType: 'rework_flag', severity: 'critical', relatedId: t.id,
      message: `Rework required: completed task "${t.title}" affected by a change order` })) raised++;
  }

  // material_shortage / BOM overrun
  for (const d of matSnap.docs) {
    const m = d.data();
    if (!m.qtyPlanned) continue;
    const pct = m.qtyConsumed / m.qtyPlanned;
    if (pct >= 0.9) {
      if (await raiseAlert({ siteId: site.id, alertType: 'material_shortage', severity: pct > 1 ? 'critical' : 'warning', relatedId: m.id,
        message: `${m.description}: ${(pct * 100).toFixed(0)}% of planned quantity consumed` })) raised++;
    }
  }

  // budget_variance: actual > 110% of plan
  const budget = await getWeeklyBudget(site.id);
  if (budget.plannedTotal > 0 && budget.actualTotal > budget.plannedTotal * 1.1) {
    if (await raiseAlert({ siteId: site.id, alertType: 'budget_variance', severity: 'critical', relatedId: budget.id,
      message: `Week spend $${budget.actualTotal.toLocaleString()} exceeds plan $${budget.plannedTotal.toLocaleString()} by >10%` })) raised++;
  }

  // cash_shortfall: latest forecast flagged
  const forecasts = fcSnap.docs.map(d => d.data()).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  if (forecasts[0]?.flaggedShortfall) {
    if (await raiseAlert({ siteId: site.id, alertType: 'cash_shortfall', severity: 'critical', relatedId: forecasts[0].weekStartDate + '_' + site.id,
      message: forecasts[0].notes || 'Cash forecast shortfall flagged' })) raised++;
  }

  return raised;
}

async function evaluateAll() {
  const sitesSnap = await db.collection('sites').where('isActive', '==', true).get();
  let total = 0;
  for (const doc of sitesSnap.docs) {
    try { total += await evaluateSite(doc.data()); } catch (e) { console.error('[Alerts]', doc.data().name, e.message); }
  }
  return total;
}

// ─── LIST / ACKNOWLEDGE ───────────────────────────────────────────────────────
router.get('/', authenticate, authorize('supervisor', 'accountant', 'manager', 'admin'), async (req, res) => {
  try {
    const { siteId, acknowledged } = req.query;
    let query = db.collection('alerts');
    if (siteId) query = query.where('siteId', '==', siteId);
    const snap = await query.get();
    let alerts = snap.docs.map(d => d.data());
    if (acknowledged !== undefined) alerts = alerts.filter(a => a.acknowledged === (acknowledged === 'true'));
    alerts.sort((a, b) => (a.acknowledged - b.acknowledged) || b.createdAt.localeCompare(a.createdAt));
    res.json(alerts);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/:id/acknowledge', authenticate, authorize('supervisor', 'accountant', 'manager', 'admin'), async (req, res) => {
  try {
    const doc = await db.collection('alerts').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Alert not found' });
    await db.collection('alerts').doc(req.params.id).update({
      acknowledged: true,
      acknowledgedBy: req.user.uid,
      acknowledgedAt: new Date().toISOString(),
    });
    res.json({ message: 'Alert acknowledged' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// On-demand evaluation (also used by tests)
router.post('/evaluate', authenticate, authorize('manager', 'admin'), async (req, res) => {
  try {
    const raised = await evaluateAll();
    res.json({ message: 'Evaluation complete', newAlerts: raised });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── HOURLY EVALUATOR ─────────────────────────────────────────────────────────
cron.schedule('15 * * * *', async () => {
  try {
    const hourKey = new Date().toISOString().slice(0, 13);
    const markerRef = db.collection('system').doc('alertEvaluatorJob');
    const shouldRun = await db.runTransaction(async t => {
      const marker = await t.get(markerRef);
      if (marker.exists && marker.data().lastRunHour === hourKey) return false;
      t.set(markerRef, { lastRunHour: hourKey, lastRunAt: new Date().toISOString() });
      return true;
    });
    if (!shouldRun) return;
    const raised = await evaluateAll();
    if (raised) console.log(`[Alerts] ${raised} new alert(s) raised`);
  } catch (err) {
    console.error('[Alerts] Evaluator error:', err.message);
  }
});

module.exports = router;
