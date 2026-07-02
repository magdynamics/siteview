const express = require('express');
const router = express.Router();
const { db } = require('../services/firebase');
const { authenticate, authorize } = require('../middleware/auth');
const { generatePDF } = require('../services/pdf');
const { generateExcel } = require('../services/excel');
const { v4: uuidv4 } = require('uuid');

// Calculate billable hours from punches
function calculateHours(punches) {
  let totalMs = 0;
  let breakMs = 0;
  let punchInTime = null;
  let breakOutTime = null;

  punches.forEach(punch => {
    if (punch.type === 'in') punchInTime = new Date(punch.timestamp);
    else if (punch.type === 'out' && punchInTime) {
      totalMs += new Date(punch.timestamp) - punchInTime;
      punchInTime = null;
    } else if (punch.type.startsWith('break_out')) {
      breakOutTime = new Date(punch.timestamp);
    } else if (punch.type.startsWith('break_in') && breakOutTime) {
      breakMs += new Date(punch.timestamp) - breakOutTime;
      breakOutTime = null;
    }
  });

  const totalHours = totalMs / 3600000;
  const breakHours = breakMs / 3600000;
  const billableHours = Math.max(0, totalHours - breakHours);

  return {
    totalHours: +totalHours.toFixed(2),
    breakHours: +breakHours.toFixed(2),
    billableHours: +billableHours.toFixed(2),
  };
}

// Generate timesheet for a date range
router.get('/generate', authenticate, authorize('supervisor', 'accountant', 'manager', 'admin'), async (req, res) => {
  try {
    const { startDate, endDate, siteId, employeeId } = req.query;

    let query = db.collection('punches')
      .where('timestamp', '>=', `${startDate}T00:00:00.000Z`)
      .where('timestamp', '<=', `${endDate}T23:59:59.999Z`);

    if (siteId) query = query.where('siteId', '==', siteId);
    if (employeeId) query = query.where('employeeId', '==', employeeId);

    const snapshot = await query.orderBy('timestamp', 'asc').get();
    const punches = snapshot.docs.map(doc => doc.data());

    // Group by employee
    const byEmployee = {};
    punches.forEach(punch => {
      if (!byEmployee[punch.employeeId]) byEmployee[punch.employeeId] = [];
      byEmployee[punch.employeeId].push(punch);
    });

    // Get employee details
    const timesheets = [];
    for (const [empId, empPunches] of Object.entries(byEmployee)) {
      const empDoc = await db.collection('users').doc(empId).get();
      const emp = empDoc.data();
      const hours = calculateHours(empPunches);

      // Group by day
      const byDay = {};
      empPunches.forEach(punch => {
        const day = punch.timestamp.split('T')[0];
        if (!byDay[day]) byDay[day] = [];
        byDay[day].push(punch);
      });

      const dailyBreakdown = Object.entries(byDay).map(([date, dayPunches]) => ({
        date,
        punches: dayPunches,
        ...calculateHours(dayPunches),
      }));

      // Calculate pay
      let payAmount = 0;
      if (emp.paymentType === 'hourly') payAmount = hours.billableHours * (emp.hourlyRate || 0);
      else if (emp.paymentType === 'daily') payAmount = dailyBreakdown.length * (emp.dailyRate || 0);
      else if (emp.paymentType === 'contract') payAmount = emp.contractAmount || 0;

      timesheets.push({
        employeeId: empId,
        employeeName: emp.name,
        paymentType: emp.paymentType,
        siteId: emp.assignedSiteId,
        startDate,
        endDate,
        dailyBreakdown,
        ...hours,
        payAmount: +payAmount.toFixed(2),
        status: 'pending',
      });
    }

    res.json(timesheets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Supervisor approves a timesheet
router.post('/:timesheetId/approve', authenticate, authorize('supervisor', 'admin'), async (req, res) => {
  try {
    const { timesheetId } = req.params;
    const { note } = req.body;

    await db.collection('timesheets').doc(timesheetId).update({
      status: 'approved',
      approvedBy: req.user.uid,
      approvedAt: new Date().toISOString(),
      supervisorNote: note || null,
    });

    await db.collection('audit_logs').doc(uuidv4()).set({
      action: 'TIMESHEET_APPROVED',
      timesheetId,
      performedBy: req.user.uid,
      note,
      timestamp: new Date().toISOString(),
    });

    res.json({ message: 'Timesheet approved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Supervisor rejects a timesheet
router.post('/:timesheetId/reject', authenticate, authorize('supervisor', 'admin'), async (req, res) => {
  try {
    const { timesheetId } = req.params;
    const { reason } = req.body;

    await db.collection('timesheets').doc(timesheetId).update({
      status: 'rejected',
      rejectedBy: req.user.uid,
      rejectedAt: new Date().toISOString(),
      rejectionReason: reason,
    });

    res.json({ message: 'Timesheet rejected', reason });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export timesheet as PDF
router.get('/:timesheetId/export/pdf', authenticate, authorize('accountant', 'supervisor', 'admin'), async (req, res) => {
  try {
    const doc = await db.collection('timesheets').doc(req.params.timesheetId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Timesheet not found' });

    const timesheet = doc.data();
    const pdfBuffer = await generatePDF(timesheet);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=timesheet-${req.params.timesheetId}.pdf`);
    res.send(pdfBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export timesheet as Excel
router.get('/:timesheetId/export/excel', authenticate, authorize('accountant', 'supervisor', 'admin'), async (req, res) => {
  try {
    const doc = await db.collection('timesheets').doc(req.params.timesheetId).get();
    if (!doc.exists) return res.status(404).json({ error: 'Timesheet not found' });

    const timesheet = doc.data();
    const excelBuffer = await generateExcel(timesheet);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=timesheet-${req.params.timesheetId}.xlsx`);
    res.send(excelBuffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
