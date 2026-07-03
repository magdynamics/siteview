const express = require('express');
const router = express.Router();
const { db } = require('../services/firebase');
const { authenticate, authorize } = require('../middleware/auth');

// Fleet utilization / downtime / compliance reports for managers.
// Queries filter by date range only (single-field indexes) and apply
// site filters in memory — the fleet is small (~4 sites).

const readRoles = authorize('supervisor', 'manager', 'admin');

function parsePeriod(req, defaultDays = 30) {
  const end = req.query.endDate || new Date().toISOString().split('T')[0];
  const start = req.query.startDate
    || new Date(Date.now() - defaultDays * 86400000).toISOString().split('T')[0];
  const days = Math.max(1, Math.round((new Date(end) - new Date(start)) / 86400000) + 1);
  return { start, end, days };
}

async function getEquipment(siteId) {
  let q = db.collection('equipment').where('isActive', '==', true);
  if (siteId) q = q.where('siteId', '==', siteId);
  return (await q.get()).docs.map(d => d.data());
}

// ─── UTILIZATION ──────────────────────────────────────────────────────────────
// hours run ÷ hours available per machine over the period
router.get('/utilization', authenticate, readRoles, async (req, res) => {
  try {
    const { siteId } = req.query;
    const hoursPerDay = parseFloat(req.query.hoursPerDay) || 8;
    const period = parsePeriod(req);

    const [equipment, logsSnap] = await Promise.all([
      getEquipment(siteId),
      db.collection('machine_hours_log')
        .where('date', '>=', period.start)
        .where('date', '<=', period.end)
        .get(),
    ]);

    const hoursByEquip = {};
    logsSnap.docs.forEach(d => {
      const log = d.data();
      hoursByEquip[log.equipmentId] = (hoursByEquip[log.equipmentId] || 0) + (log.hoursAdded || 0);
    });

    const availableHours = period.days * hoursPerDay;
    const rows = equipment.map(e => {
      const hoursRun = +(hoursByEquip[e.id] || 0).toFixed(1);
      return {
        equipmentId: e.id,
        equipmentName: e.name,
        typeName: e.typeName,
        siteId: e.siteId,
        status: e.status,
        currentHours: e.currentHours || 0,
        lastHoursLogDate: e.lastHoursLogDate || null,
        hoursRun,
        availableHours,
        utilizationPct: +Math.min(100, (hoursRun / availableHours) * 100).toFixed(1),
      };
    }).sort((a, b) => b.utilizationPct - a.utilizationPct);

    const avg = rows.length ? +(rows.reduce((s, r) => s + r.utilizationPct, 0) / rows.length).toFixed(1) : 0;
    res.json({ period, hoursPerDay, averageUtilizationPct: avg, equipment: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── DOWNTIME / MTTR ──────────────────────────────────────────────────────────
// repair-ticket turnaround: reported -> completed, plus open ticket age
router.get('/downtime', authenticate, readRoles, async (req, res) => {
  try {
    const { siteId } = req.query;
    const period = parsePeriod(req, 90);

    const snap = await db.collection('repair_tickets')
      .where('reportedAt', '>=', `${period.start}T00:00:00.000Z`)
      .where('reportedAt', '<=', `${period.end}T23:59:59.999Z`)
      .get();

    let tickets = snap.docs.map(d => d.data());
    if (siteId) tickets = tickets.filter(t => t.siteId === siteId);

    const now = Date.now();
    const rows = tickets.map(t => {
      const start = new Date(t.reportedAt).getTime();
      const end = t.completedAt ? new Date(t.completedAt).getTime() : now;
      return {
        ticketId: t.id,
        equipmentId: t.equipmentId,
        equipmentName: t.equipmentName,
        siteId: t.siteId,
        priority: t.priority,
        issueType: t.issueType,
        status: t.status,
        reportedAt: t.reportedAt,
        completedAt: t.completedAt || null,
        hours: +((end - start) / 3600000).toFixed(1),
        isOpen: !['completed', 'rejected'].includes(t.status),
      };
    });

    const completed = rows.filter(r => r.status === 'completed');
    const open = rows.filter(r => r.isOpen);
    const mttrHours = completed.length
      ? +(completed.reduce((s, r) => s + r.hours, 0) / completed.length).toFixed(1)
      : null;

    const byCause = {};
    rows.forEach(r => {
      const k = r.issueType || 'other';
      if (!byCause[k]) byCause[k] = { count: 0, hours: 0 };
      byCause[k].count++;
      byCause[k].hours = +(byCause[k].hours + r.hours).toFixed(1);
    });

    res.json({
      period,
      totalTickets: rows.length,
      openTickets: open.length,
      completedTickets: completed.length,
      mttrHours,
      openDowntimeHours: +open.reduce((s, r) => s + r.hours, 0).toFixed(1),
      byCause,
      tickets: rows.sort((a, b) => b.hours - a.hours),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── MAINTENANCE COMPLIANCE ───────────────────────────────────────────────────
router.get('/maintenance-compliance', authenticate, readRoles, async (req, res) => {
  try {
    const { siteId } = req.query;
    const [schedSnap, recSnap] = await Promise.all([
      db.collection('maintenance_schedules').get(),
      db.collection('maintenance_records').get(),
    ]);

    let schedules = schedSnap.docs.map(d => d.data());
    if (siteId) schedules = schedules.filter(s => s.siteId === siteId);
    let records = recSnap.docs.map(d => d.data());
    if (siteId) records = records.filter(r => r.siteId === siteId);

    const today = new Date();
    const overdue = schedules.filter(s => s.status === 'overdue');
    const avgDaysOverdue = overdue.length
      ? +(overdue.reduce((s, o) => s + (o.nextDueDate ? Math.max(0, (today - new Date(o.nextDueDate)) / 86400000) : 0), 0) / overdue.length).toFixed(1)
      : 0;

    const tracked = schedules.filter(s => ['active', 'overdue'].includes(s.status));
    res.json({
      totalSchedules: schedules.length,
      active: schedules.filter(s => s.status === 'active').length,
      overdue: overdue.length,
      paused: schedules.filter(s => s.status === 'paused').length,
      completed: schedules.filter(s => s.status === 'completed').length,
      compliancePct: tracked.length ? +(((tracked.length - overdue.length) / tracked.length) * 100).toFixed(1) : 100,
      avgDaysOverdue,
      completionsLogged: records.filter(r => r.scheduleId).length,
      overdueList: overdue.map(o => ({
        scheduleId: o.id, equipmentName: o.equipmentName, siteId: o.siteId,
        maintenanceType: o.maintenanceType, nextDueDate: o.nextDueDate, nextDueHours: o.nextDueHours,
      })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── IDLE ASSETS ──────────────────────────────────────────────────────────────
// available equipment with no hours logged for N+ days — candidates to transfer
router.get('/idle-assets', authenticate, readRoles, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const equipment = await getEquipment(req.query.siteId);
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

    const idle = equipment
      .filter(e => e.status === 'available' && (!e.lastHoursLogDate || e.lastHoursLogDate < cutoff))
      .map(e => ({
        equipmentId: e.id,
        equipmentName: e.name,
        typeName: e.typeName,
        siteId: e.siteId,
        lastHoursLogDate: e.lastHoursLogDate || null,
        daysIdle: e.lastHoursLogDate
          ? Math.floor((Date.now() - new Date(e.lastHoursLogDate)) / 86400000)
          : null,
      }))
      .sort((a, b) => (b.daysIdle || 9999) - (a.daysIdle || 9999));

    res.json({ thresholdDays: days, count: idle.length, idle });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── COST PER OPERATING HOUR (fleet ranking) ─────────────────────────────────
router.get('/cost-per-hour', authenticate, readRoles, async (req, res) => {
  try {
    const [equipment, recSnap] = await Promise.all([
      getEquipment(req.query.siteId),
      db.collection('maintenance_records').get(),
    ]);
    const costByEquip = {};
    recSnap.docs.forEach(d => {
      const r = d.data();
      costByEquip[r.equipmentId] = (costByEquip[r.equipmentId] || 0) + (r.totalCost || 0);
    });
    const rows = equipment.map(e => {
      const totalCost = +(costByEquip[e.id] || 0).toFixed(2);
      return {
        equipmentId: e.id,
        equipmentName: e.name,
        siteId: e.siteId,
        currentHours: e.currentHours || 0,
        totalMaintenanceCost: totalCost,
        costPerHour: e.currentHours > 0 ? +(totalCost / e.currentHours).toFixed(2) : null,
      };
    }).sort((a, b) => (b.costPerHour || 0) - (a.costPerHour || 0));
    res.json({ equipment: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── MAINTENANCE WINDOW SUGGESTION ───────────────────────────────────────────
// Weekday usage profile from hours logs; the lowest-usage day is the best
// time to schedule a service without stealing productive hours
router.get('/maintenance-windows/:equipmentId', authenticate, readRoles, async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 60;
    const start = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

    const snap = await db.collection('machine_hours_log')
      .where('equipmentId', '==', req.params.equipmentId)
      .where('date', '>=', start)
      .orderBy('date', 'desc')   // matches the deployed (equipmentId, date desc) index
      .get();

    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const byWeekday = Array(7).fill(0);
    const samples = Array(7).fill(0);
    snap.docs.forEach(d => {
      const log = d.data();
      const wd = new Date(log.date).getUTCDay();
      byWeekday[wd] += log.hoursAdded || 0;
      samples[wd]++;
    });

    const profile = names.map((name, i) => ({
      day: name,
      totalHours: +byWeekday[i].toFixed(1),
      logCount: samples[i],
    }));

    const totalLogs = samples.reduce((a, b) => a + b, 0);
    let suggestion = null;
    if (totalLogs >= 5) {
      const min = [...profile].sort((a, b) => a.totalHours - b.totalHours)[0];
      suggestion = { day: min.day, reason: `lowest recorded usage (${min.totalHours} hrs over the period)` };
    }

    res.json({ periodDays: days, sampleCount: totalLogs, profile, suggestion,
      note: totalLogs < 5 ? 'Not enough hours history yet for a reliable suggestion' : undefined });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── LABOR DOWNTIME EXPOSURE ──────────────────────────────────────────────────
// For each period where a machine was down (unsafe/critical tickets), estimate
// how much punched labor at that site overlapped the outage
router.get('/labor-impact', authenticate, readRoles, async (req, res) => {
  try {
    const period = parsePeriod(req, 30);
    const snap = await db.collection('repair_tickets')
      .where('reportedAt', '>=', `${period.start}T00:00:00.000Z`)
      .get();

    let tickets = snap.docs.map(d => d.data())
      .filter(t => (t.priority === 'critical' || t.isSafeToOperate === false) && t.status !== 'rejected');
    if (req.query.siteId) tickets = tickets.filter(t => t.siteId === req.query.siteId);

    const results = [];
    for (const t of tickets) {
      const windowStart = t.reportedAt;
      const windowEnd = t.completedAt || new Date().toISOString();
      const downtimeHours = +((new Date(windowEnd) - new Date(windowStart)) / 3600000).toFixed(1);

      const punchSnap = await db.collection('punches')
        .where('timestamp', '>=', windowStart)
        .where('timestamp', '<=', windowEnd)
        .get();
      const crew = new Set(
        punchSnap.docs.map(d => d.data()).filter(p => p.siteId === t.siteId).map(p => p.employeeId)
      );

      results.push({
        ticketId: t.id,
        equipmentName: t.equipmentName,
        siteId: t.siteId,
        status: t.status,
        downtimeHours,
        crewPresent: crew.size,
        // estimate: crew on site during the outage × outage duration
        estimatedLaborHoursExposed: +(crew.size * downtimeHours).toFixed(1),
      });
    }

    res.json({
      period,
      note: 'Exposure = crew punched at the site during the outage × outage hours (upper-bound estimate)',
      totalEstimatedLaborHoursExposed: +results.reduce((s, r) => s + r.estimatedLaborHoursExposed, 0).toFixed(1),
      outages: results.sort((a, b) => b.estimatedLaborHoursExposed - a.estimatedLaborHoursExposed),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
