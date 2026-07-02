const express = require('express');
const router = express.Router();
const { db } = require('../services/firebase');
const { authenticate, authorize } = require('../middleware/auth');

// Weekly summary report (all sites)
router.get('/weekly', authenticate, authorize('manager', 'admin'), async (req, res) => {
  try {
    const { weekStart } = req.query;
    const start = weekStart || getMonday(new Date()).toISOString().split('T')[0];
    const end = new Date(new Date(start).getTime() + 6 * 86400000).toISOString().split('T')[0];

    // Get all sites
    const sitesSnapshot = await db.collection('sites').where('isActive', '==', true).get();
    const sites = sitesSnapshot.docs.map(doc => doc.data());

    const report = [];
    for (const site of sites) {
      const punchSnapshot = await db.collection('punches')
        .where('siteId', '==', site.id)
        .where('timestamp', '>=', `${start}T00:00:00.000Z`)
        .where('timestamp', '<=', `${end}T23:59:59.999Z`)
        .get();

      const punches = punchSnapshot.docs.map(doc => doc.data());
      const employeeIds = [...new Set(punches.map(p => p.employeeId))];

      report.push({
        siteId: site.id,
        siteName: site.name,
        period: { start, end },
        totalEmployeesWorked: employeeIds.length,
        totalPunches: punches.length,
        manualEntries: punches.filter(p => p.isManual).length,
      });
    }

    res.json({ period: { start, end }, sites: report });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Audit log
router.get('/audit', authenticate, authorize('supervisor', 'accountant', 'manager', 'admin'), async (req, res) => {
  try {
    const { startDate, endDate, employeeId, siteId } = req.query;
    let query = db.collection('audit_logs');

    if (startDate) query = query.where('timestamp', '>=', `${startDate}T00:00:00.000Z`);
    if (endDate) query = query.where('timestamp', '<=', `${endDate}T23:59:59.999Z`);
    if (employeeId) query = query.where('employeeId', '==', employeeId);
    if (siteId) query = query.where('siteId', '==', siteId);

    const snapshot = await query.orderBy('timestamp', 'desc').limit(500).get();
    const logs = snapshot.docs.map(doc => doc.data());
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

module.exports = router;
