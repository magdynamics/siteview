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
  // unpaid subcontractor invoices are obligations too
  const subInvSnap = await db.collection('subcontractor_invoices')
    .where('siteId', '==', siteId).get();
  subInvSnap.docs.map(d => d.data())
    .filter(i => ['pending', 'approved'].includes(i.status))
    .forEach(i => {
      obligations[`sub|${i.id}`] = {
        vendor: i.subcontractorName,
        poReference: i.invoiceNumber || i.poReference || 'invoice',
        amount: i.amount,
      };
    });

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

// ─── EXCEL EXPORT (QuickBooks stopgap) ───────────────────────────────────────
// Until a QuickBooks account exists, the accountant exports weekly costs and
// open obligations as .xlsx and imports/keys them into the books manually.
router.get('/export', authenticate, acctRoles, async (req, res) => {
  try {
    const { siteId } = req.query;
    if (!siteId) return res.status(400).json({ error: 'siteId is required' });

    const bounds = weekBounds();
    const budget = await getWeeklyBudget(siteId, bounds.weekStartDate);

    // reuse the forecast's obligation gathering by generating a fresh snapshot
    const snapshot = await generateSnapshot(siteId);

    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SiteView — Build Chain';
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A237E' } };
    const headerFont = { color: { argb: 'FFFFFFFF' }, bold: true };

    // Sheet 1: weekly cost summary
    const s1 = workbook.addWorksheet('Weekly Costs');
    s1.mergeCells('A1:C1');
    s1.getCell('A1').value = `BUILD CHAIN — WEEKLY COSTS (${bounds.weekStartDate})`;
    s1.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF1A237E' } };
    const rows = [
      ['Category', 'Actual', 'Planned'],
      ['Labor', budget.actualLaborCost, budget.plannedLaborCost || 0],
      ['Equipment', budget.actualEquipmentCost, budget.plannedEquipmentCost || 0],
      ['Materials', budget.actualMaterialCost, budget.plannedMaterialCost || 0],
      ['Subcontractors', budget.actualSubcontractorCost || 0, budget.plannedSubcontractorCost || 0],
      ['TOTAL', budget.actualTotal, budget.plannedTotal],
    ];
    rows.forEach((r, i) => {
      const row = s1.getRow(3 + i);
      r.forEach((v, c) => {
        const cell = row.getCell(c + 1);
        cell.value = v;
        if (i === 0) { cell.fill = headerFill; cell.font = headerFont; }
        else if (c > 0) cell.numFmt = '$#,##0.00';
        if (i === rows.length - 1) cell.font = { bold: true };
      });
    });
    s1.columns = [{ width: 20 }, { width: 16 }, { width: 16 }];

    // Sheet 2: obligations due (vendor bills to enter into the books)
    const s2 = workbook.addWorksheet('Obligations Due');
    ['Vendor', 'Reference', 'Amount'].forEach((h, i) => {
      const cell = s2.getRow(1).getCell(i + 1);
      cell.value = h; cell.fill = headerFill; cell.font = headerFont;
    });
    snapshot.obligationsDue.forEach((o, i) => {
      const row = s2.getRow(2 + i);
      row.getCell(1).value = o.vendor;
      row.getCell(2).value = o.poReference;
      row.getCell(3).value = o.amount;
      row.getCell(3).numFmt = '$#,##0.00';
    });
    const totRow = s2.getRow(2 + snapshot.obligationsDue.length);
    totRow.getCell(1).value = 'TOTAL';
    totRow.getCell(3).value = snapshot.obligationsTotal;
    totRow.getCell(3).numFmt = '$#,##0.00';
    totRow.font = { bold: true };
    s2.columns = [{ width: 28 }, { width: 22 }, { width: 16 }];

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=weekly-costs-${siteId}-${bounds.weekStartDate}.xlsx`);
    res.send(Buffer.from(buffer));
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
