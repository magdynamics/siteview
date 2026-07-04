const express = require('express');
const router = express.Router();
const { db } = require('../services/firebase');
const { authenticate, authorize } = require('../middleware/auth');
const { getWeeklyBudget } = require('./budget');

// Role dashboards (technical guideline §7/§17) — pure aggregation over
// existing collections; every figure traces to captured events.

const today = () => new Date().toISOString().split('T')[0];

async function siteOr400(req, res) {
  const { siteId } = req.query;
  if (!siteId) { res.status(400).json({ error: 'siteId is required' }); return null; }
  const doc = await db.collection('sites').doc(siteId).get();
  if (!doc.exists) { res.status(404).json({ error: 'Site not found' }); return null; }
  return doc.data();
}

// ─── EXECUTIVE (owner / investor) ─────────────────────────────────────────────
router.get('/executive', authenticate, authorize('manager', 'admin'), async (req, res) => {
  try {
    const site = await siteOr400(req, res);
    if (!site) return;

    const [budget, taskSnap, coSnap, equipSnap, ticketSnap] = await Promise.all([
      getWeeklyBudget(site.id),
      db.collection('tasks').where('siteId', '==', site.id).get(),
      db.collection('change_orders').where('siteId', '==', site.id).get(),
      db.collection('equipment').where('siteId', '==', site.id).where('isActive', '==', true).get(),
      db.collection('repair_tickets').where('siteId', '==', site.id).get(),
    ]);

    const tasks = taskSnap.docs.map(d => d.data());
    const overdueTasks = tasks.filter(t => t.status !== 'complete' && t.scheduledDate < today());
    const cos = coSnap.docs.map(d => d.data());
    const approvedCoCost = +cos.filter(c => c.status === 'approved').reduce((s, c) => s + (c.costImpact || 0), 0).toFixed(2);
    const scheduleImpactDays = cos.filter(c => c.status === 'approved').reduce((s, c) => s + (c.scheduleImpactDays || 0), 0);
    const criticalTickets = ticketSnap.docs.map(d => d.data())
      .filter(t => t.priority === 'critical' && ['pending', 'approved', 'in_progress'].includes(t.status));

    res.json({
      site: {
        name: site.name, currentPhase: site.currentPhase || null,
        budgetTotal: site.budgetTotal || null,
        startDate: site.startDate || null, targetCompletionDate: site.targetCompletionDate || null,
      },
      budgetWeek: {
        planned: budget.plannedTotal, actual: budget.actualTotal, variance: budget.variance,
      },
      schedule: {
        totalTasks: tasks.length,
        complete: tasks.filter(t => t.status === 'complete').length,
        overdue: overdueTasks.length,
        blocked: tasks.filter(t => t.status === 'blocked').length,
        reworkFlagged: tasks.filter(t => t.reworkFlag).length,
      },
      changeOrders: {
        approvedCostImpact: approvedCoCost,
        approvedScheduleImpactDays: scheduleImpactDays,
        pending: cos.filter(c => ['pending', 'partially_approved'].includes(c.status)).length,
      },
      risk: {
        criticalTickets: criticalTickets.length,
        equipmentDown: equipSnap.docs.map(d => d.data()).filter(e => e.status === 'out_of_service').length,
      },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── OPERATIONS (GC / PM) ─────────────────────────────────────────────────────
router.get('/operations', authenticate, authorize('supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const site = await siteOr400(req, res);
    if (!site) return;
    const t = today();

    const [punchSnap, taskSnap, equipSnap, matTicketSnap, ticketSnap] = await Promise.all([
      db.collection('punches').where('timestamp', '>=', `${t}T00:00:00.000Z`).get(),
      db.collection('tasks').where('siteId', '==', site.id).get(),
      db.collection('equipment').where('siteId', '==', site.id).where('isActive', '==', true).get(),
      db.collection('material_tickets').where('loggedAt', '>=', `${t}T00:00:00.000Z`).get(),
      db.collection('repair_tickets').where('siteId', '==', site.id).get(),
    ]);

    // crew today: last punch per employee at this site
    const byEmp = {};
    punchSnap.docs.map(d => d.data()).filter(p => p.siteId === site.id)
      .forEach(p => { if (!byEmp[p.employeeId] || p.timestamp > byEmp[p.employeeId].timestamp) byEmp[p.employeeId] = p; });
    const crewOnSite = Object.values(byEmp).filter(p => p.type === 'in').length;

    const tasks = taskSnap.docs.map(d => d.data()).filter(x => x.scheduledDate === t);
    const equipment = equipSnap.docs.map(d => d.data());
    const openTickets = ticketSnap.docs.map(d => d.data()).filter(x => ['pending', 'approved', 'in_progress'].includes(x.status));

    const requiredToday = tasks.filter(x => x.status !== 'complete')
      .reduce((s, x) => s + (x.requiredCrewSize || 1), 0);

    res.json({
      crew: { onSiteNow: crewOnSite, punchedToday: Object.keys(byEmp).length, requiredToday },
      tasksToday: {
        total: tasks.length,
        byStatus: ['assigned', 'acknowledged', 'in_progress', 'blocked', 'complete']
          .reduce((acc, s) => ({ ...acc, [s]: tasks.filter(x => x.status === s).length }), {}),
        blockedList: taskSnap.docs.map(d => d.data()).filter(x => x.status === 'blocked')
          .map(x => ({ id: x.id, title: x.title, blockedReason: x.blockedReason, assignedToName: x.assignedToName })),
      },
      equipment: ['available', 'in_use', 'maintenance', 'out_of_service']
        .reduce((acc, s) => ({ ...acc, [s]: equipment.filter(e => e.status === s).length }), {}),
      materialFlowToday: matTicketSnap.docs.map(d => d.data()).filter(x => x.siteId === site.id).length,
      openRepairTickets: {
        total: openTickets.length,
        critical: openTickets.filter(x => x.priority === 'critical').length,
      },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── SITE (site manager, live) ────────────────────────────────────────────────
router.get('/site', authenticate, authorize('supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const site = await siteOr400(req, res);
    if (!site) return;
    const date = req.query.date || today();

    const [taskSnap, punchSnap] = await Promise.all([
      db.collection('tasks').where('siteId', '==', site.id).get(),
      db.collection('punches').where('timestamp', '>=', `${date}T00:00:00.000Z`)
        .where('timestamp', '<=', `${date}T23:59:59.999Z`).get(),
    ]);

    const tasks = taskSnap.docs.map(d => d.data()).filter(x => x.scheduledDate === date);

    // resource conflicts: same equipment required by two tasks on the same day
    const equipUse = {};
    tasks.forEach(x => (x.requiredEquipmentIds || []).forEach(id => {
      equipUse[id] = equipUse[id] || [];
      equipUse[id].push(x.title);
    }));
    const conflicts = Object.entries(equipUse).filter(([, list]) => list.length > 1)
      .map(([equipmentId, taskTitles]) => ({ equipmentId, taskTitles }));

    const byEmp = {};
    punchSnap.docs.map(d => d.data()).filter(p => p.siteId === site.id)
      .forEach(p => { if (!byEmp[p.employeeId] || p.timestamp > byEmp[p.employeeId].timestamp) byEmp[p.employeeId] = p; });

    res.json({
      date,
      clockedIn: Object.values(byEmp).filter(p => p.type === 'in').map(p => p.employeeId),
      tasks: tasks.map(x => ({
        id: x.id, title: x.title, assignedToName: x.assignedToName, status: x.status,
        acknowledgedAt: x.acknowledgedAt, blockedReason: x.blockedReason, planReference: x.planReference,
      })),
      resourceConflicts: conflicts,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── COMPLIANCE (municipality / lender — the viewer role's window) ────────────
router.get('/compliance', authenticate, authorize('viewer', 'accountant', 'manager', 'admin'), async (req, res) => {
  try {
    const site = await siteOr400(req, res);
    if (!site) return;

    const [matSnap, ticketSnap, planSnap, inspSnap, equipSnap] = await Promise.all([
      db.collection('material_items').where('siteId', '==', site.id).where('isActive', '==', true).get(),
      db.collection('material_tickets').where('siteId', '==', site.id).get(),
      db.collection('plan_documents').where('siteId', '==', site.id).get(),
      db.collection('inspections').where('siteId', '==', site.id).get(),
      db.collection('equipment').where('siteId', '==', site.id).where('isActive', '==', true).get(),
    ]);

    const tickets = ticketSnap.docs.map(d => d.data());
    res.json({
      site: { name: site.name, address: site.address, currentPhase: site.currentPhase || null },
      materialStorage: matSnap.docs.map(d => d.data()).filter(m => m.currentLocation).map(m => ({
        description: m.description, qtyOnHand: m.qtyOnHand, unit: m.unitOfMeasure, location: m.currentLocation.zone,
      })),
      disposalLog: tickets.filter(x => x.ticketType === 'dispose').map(x => ({
        material: x.materialDescription, qty: x.qty, unit: x.unit, loggedAt: x.loggedAt, loggedBy: x.loggedByName,
      })),
      planDocuments: planSnap.docs.map(d => d.data()).filter(p => !p.supersededBy).map(p => ({
        title: p.title, discipline: p.discipline, versionNumber: p.versionNumber, uploadedAt: p.uploadedAt,
      })),
      inspections: {
        total: inspSnap.size,
        last30Days: inspSnap.docs.map(d => d.data())
          .filter(i => i.timestamp >= new Date(Date.now() - 30 * 86400000).toISOString()).length,
      },
      equipmentOutOfService: equipSnap.docs.map(d => d.data())
        .filter(e => e.status === 'out_of_service').map(e => e.name),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── FINANCIAL (accountant) ───────────────────────────────────────────────────
router.get('/financial', authenticate, authorize('accountant', 'manager', 'admin'), async (req, res) => {
  try {
    const site = await siteOr400(req, res);
    if (!site) return;
    const budget = await getWeeklyBudget(site.id);
    const fcSnap = await db.collection('cash_forecast_snapshots').where('siteId', '==', site.id).get();
    const forecasts = fcSnap.docs.map(d => d.data()).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
    res.json({ budget, latestForecast: forecasts[0] || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
