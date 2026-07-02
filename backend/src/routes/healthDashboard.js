const express = require('express');
const router = express.Router();
const { db } = require('../services/firebase');
const { authenticate } = require('../middleware/auth');

// ─── EQUIPMENT HEALTH SCORE ENGINE ───────────────────────────────────────────
// Returns health score (0-100) and color for each piece of equipment

function computeHealthScore(equip, openTickets, overdueSchedules, lastInspection) {
  let score = 100;
  const issues = [];

  // Status penalties
  if (equip.status === 'out_of_service') { score -= 60; issues.push('Out of service'); }
  else if (equip.status === 'maintenance') { score -= 30; issues.push('Under maintenance'); }

  // Open critical tickets
  const criticalTickets = openTickets.filter(t => t.priority === 'critical').length;
  const highTickets = openTickets.filter(t => t.priority === 'high').length;
  score -= criticalTickets * 25;
  score -= highTickets * 10;
  if (criticalTickets) issues.push(`${criticalTickets} critical ticket(s)`);
  if (highTickets) issues.push(`${highTickets} high priority ticket(s)`);

  // Overdue maintenance
  score -= overdueSchedules.length * 15;
  if (overdueSchedules.length) issues.push(`${overdueSchedules.length} overdue maintenance`);

  // Last inspection
  if (!lastInspection) { score -= 10; issues.push('No recent inspection'); }
  else {
    const daysSince = Math.floor((new Date() - new Date(lastInspection.timestamp)) / 86400000);
    if (daysSince > 7) { score -= 10; issues.push(`Last inspection ${daysSince} days ago`); }
    if (lastInspection.overallCondition === 'major_issues') { score -= 20; issues.push('Major issues in last inspection'); }
    if (lastInspection.overallCondition === 'unsafe') { score -= 40; issues.push('Unsafe in last inspection'); }
  }

  score = Math.max(0, Math.min(100, score));
  const color = score >= 80 ? 'green' : score >= 50 ? 'yellow' : score >= 25 ? 'orange' : 'red';
  const label = score >= 80 ? 'Good' : score >= 50 ? 'Fair' : score >= 25 ? 'Poor' : 'Critical';

  return { score, color, label, issues };
}

// ─── GET HEALTH DASHBOARD FOR A SITE ─────────────────────────────────────────
router.get('/:siteId', authenticate, async (req, res) => {
  try {
    const { siteId } = req.params;

    // Get all equipment for site
    const equipSnap = await db.collection('equipment')
      .where('siteId', '==', siteId)
      .where('isActive', '==', true)
      .get();

    const equipmentList = equipSnap.docs.map(d => d.data());

    // For each equipment, compute health
    const healthData = [];
    for (const equip of equipmentList) {
      // Open repair tickets
      const ticketSnap = await db.collection('repair_tickets')
        .where('equipmentId', '==', equip.id)
        .where('status', 'in', ['pending', 'approved', 'in_progress'])
        .get();
      const openTickets = ticketSnap.docs.map(d => d.data());

      // Overdue maintenance schedules
      const scheduleSnap = await db.collection('maintenance_schedules')
        .where('equipmentId', '==', equip.id)
        .where('status', '==', 'overdue')
        .get();
      const overdueSchedules = scheduleSnap.docs.map(d => d.data());

      // Last inspection
      const inspSnap = await db.collection('inspections')
        .where('equipmentId', '==', equip.id)
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();
      const lastInspection = inspSnap.docs.length > 0 ? inspSnap.docs[0].data() : null;

      // Maintenance cost total
      const maintSnap = await db.collection('maintenance_records')
        .where('equipmentId', '==', equip.id)
        .get();
      const totalMaintenanceCost = maintSnap.docs.reduce((sum, d) => sum + (d.data().totalCost || 0), 0);

      // Compute score
      const health = computeHealthScore(equip, openTickets, overdueSchedules, lastInspection);

      healthData.push({
        equipment: equip,
        health,
        openTickets: openTickets.length,
        overdueSchedules: overdueSchedules.length,
        lastInspection: lastInspection ? {
          date: lastInspection.timestamp?.split('T')[0],
          type: lastInspection.inspectionType,
          condition: lastInspection.overallCondition,
        } : null,
        currentHours: equip.currentHours || 0,
        totalMaintenanceCost: +totalMaintenanceCost.toFixed(2),
      });
    }

    // Sort: critical first
    healthData.sort((a, b) => a.health.score - b.health.score);

    // Site summary
    const summary = {
      total: healthData.length,
      green: healthData.filter(h => h.health.color === 'green').length,
      yellow: healthData.filter(h => h.health.color === 'yellow').length,
      orange: healthData.filter(h => h.health.color === 'orange').length,
      red: healthData.filter(h => h.health.color === 'red').length,
      totalMaintenanceCost: +healthData.reduce((s, h) => s + h.totalMaintenanceCost, 0).toFixed(2),
    };

    res.json({ siteId, summary, equipment: healthData });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── COST ANALYSIS PER EQUIPMENT ─────────────────────────────────────────────
router.get('/costs/:equipmentId', authenticate, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let query = db.collection('maintenance_records').where('equipmentId', '==', req.params.equipmentId);
    const snapshot = await query.get();

    const records = snapshot.docs.map(d => d.data());
    const monthlyCosts = {};

    records.forEach(r => {
      const month = r.maintenanceDate?.substring(0, 7) || 'unknown';
      if (!monthlyCosts[month]) monthlyCosts[month] = { labor: 0, parts: 0, total: 0, count: 0 };
      monthlyCosts[month].labor += r.laborCost || 0;
      monthlyCosts[month].parts += r.partsCost || 0;
      monthlyCosts[month].total += r.totalCost || 0;
      monthlyCosts[month].count++;
    });

    const totalCost = records.reduce((s, r) => s + (r.totalCost || 0), 0);
    const equipDoc = await db.collection('equipment').doc(req.params.equipmentId).get();
    const equip = equipDoc.data();

    res.json({
      equipmentId: req.params.equipmentId,
      equipmentName: equip?.name,
      totalCost: +totalCost.toFixed(2),
      maintenanceCount: records.length,
      currentHours: equip?.currentHours || 0,
      costPerHour: equip?.currentHours > 0 ? +(totalCost / equip.currentHours).toFixed(2) : 0,
      monthlyCosts,
      records,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
