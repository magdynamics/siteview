const express = require('express');
const router = express.Router();
const { db } = require('../services/firebase');
const { authenticate, authorize } = require('../middleware/auth');

// Progress tracking (distinct from job costing): rolls up task completion —
// by count and by estimated hours — into a current snapshot and a
// day-by-day cumulative curve, computed on demand from the tasks collection
// (same "no separate snapshot store" approach as tasks/:id/cost).

const viewRoles = authorize('supervisor', 'manager', 'admin', 'accountant');

async function loadTasks(siteId) {
  const snap = await db.collection('tasks').where('siteId', '==', siteId).get();
  return snap.docs.map(d => d.data());
}

// ─── CURRENT SNAPSHOT ──────────────────────────────────────────────────────────
router.get('/summary', authenticate, viewRoles, async (req, res) => {
  try {
    const { siteId } = req.query;
    if (!siteId) return res.status(400).json({ error: 'siteId is required' });

    const tasks = await loadTasks(siteId);
    const byStatus = { assigned: 0, acknowledged: 0, in_progress: 0, blocked: 0, complete: 0 };
    tasks.forEach(t => { if (byStatus[t.status] !== undefined) byStatus[t.status]++; });

    const totalTasks = tasks.length;
    const completedTasks = byStatus.complete;
    const percentByCount = totalTasks ? +((completedTasks / totalTasks) * 100).toFixed(1) : 0;

    const totalHours = tasks.reduce((s, t) => s + (t.estimatedHours || 0), 0);
    const completedHours = tasks.filter(t => t.status === 'complete').reduce((s, t) => s + (t.estimatedHours || 0), 0);
    const percentByHours = totalHours ? +((completedHours / totalHours) * 100).toFixed(1) : 0;

    const blockedTasks = tasks.filter(t => t.status === 'blocked');

    res.json({
      siteId,
      totalTasks,
      completedTasks,
      byStatus,
      percentByCount,
      totalEstimatedHours: +totalHours.toFixed(1),
      completedEstimatedHours: +completedHours.toFixed(1),
      percentByHours,
      blockedTasks: blockedTasks.map(t => ({ id: t.id, title: t.title, blockedReason: t.blockedReason })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── TIMELINE (cumulative completion over time) ───────────────────────────────
router.get('/timeline', authenticate, viewRoles, async (req, res) => {
  try {
    const { siteId, startDate, endDate } = req.query;
    if (!siteId) return res.status(400).json({ error: 'siteId is required' });
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });

    const tasks = await loadTasks(siteId);
    const totalScopeHours = +tasks.reduce((s, t) => s + (t.estimatedHours || 0), 0).toFixed(1);

    const completions = tasks
      .filter(t => t.status === 'complete' && t.completedAt)
      .map(t => ({ date: t.completedAt.split('T')[0], hours: t.estimatedHours || 0 }));

    const series = [];
    let cursor = new Date(startDate);
    const end = new Date(endDate);
    let cumulativeHours = completions
      .filter(c => c.date < startDate)
      .reduce((s, c) => s + c.hours, 0);

    while (cursor <= end) {
      const dateStr = cursor.toISOString().split('T')[0];
      cumulativeHours += completions.filter(c => c.date === dateStr).reduce((s, c) => s + c.hours, 0);
      series.push({
        date: dateStr,
        cumulativeCompletedHours: +cumulativeHours.toFixed(1),
        percentComplete: totalScopeHours ? +((cumulativeHours / totalScopeHours) * 100).toFixed(1) : 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    res.json({ siteId, totalScopeHours, series });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
