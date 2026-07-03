const express = require('express');
const router = express.Router();
const { db, messaging } = require('../services/firebase');
const { authenticate, authorize } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// Change orders with threshold-gated dual approval (technical guideline §9/§15).
// Below the site's changeOrderThreshold: one approval from any eligible role
// is final. At/above: needs a manager (GC/PM) approval AND an admin
// (Owner/Investor) approval.

const ELIGIBLE_ROLES = ['supervisor', 'employee', 'accountant', 'manager', 'admin'];

// ─── CREATE ───────────────────────────────────────────────────────────────────
router.post('/', authenticate, authorize('supervisor', 'accountant', 'manager', 'admin'), async (req, res) => {
  try {
    const {
      siteId, coNumber, issuedBy, issuedDate, affectedPlanDocIds,
      affectedZone, description, costImpact, scheduleImpactDays,
    } = req.body;
    if (!siteId) return res.status(400).json({ error: 'siteId is required' });
    if (!coNumber) return res.status(400).json({ error: 'coNumber is required' });
    if (!description) return res.status(400).json({ error: 'description is required' });
    const cost = parseFloat(costImpact);
    if (isNaN(cost)) return res.status(400).json({ error: 'costImpact must be a number' });

    const siteDoc = await db.collection('sites').doc(siteId).get();
    if (!siteDoc.exists) return res.status(400).json({ error: 'siteId does not match an existing site' });
    const threshold = siteDoc.data().changeOrderThreshold ?? 5000;

    const id = uuidv4();
    const co = {
      id,
      siteId,
      coNumber,
      issuedBy: issuedBy || req.user.name || '',
      issuedDate: issuedDate || new Date().toISOString().split('T')[0],
      affectedPlanDocIds: affectedPlanDocIds || [],
      affectedZone: affectedZone || '',
      description,
      costImpact: cost,
      scheduleImpactDays: scheduleImpactDays ? parseInt(scheduleImpactDays) : 0,
      status: 'pending',                                  // pending | partially_approved | approved | rejected
      linkedTaskIds: [],
      approvalThresholdSnapshot: threshold,
      requiresDualApproval: cost >= threshold,
      approvals: [],                                      // {approvedBy, approvedByName, roleAtTime, approvedAt}
      rejectedBy: null,
      rejectedReason: null,
      createdBy: req.user.uid,
      createdAt: new Date().toISOString(),
    };
    await db.collection('change_orders').doc(id).set(co);
    res.status(201).json({ message: 'Change order created', changeOrder: co });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── LIST ─────────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { siteId, status } = req.query;
    let query = db.collection('change_orders');
    if (siteId) query = query.where('siteId', '==', siteId);
    const snap = await query.get();
    let cos = snap.docs.map(d => d.data());
    if (status) cos = cos.filter(c => c.status === status);
    cos.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json(cos);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── APPROVE (threshold-gated) ────────────────────────────────────────────────
router.post('/:id/approve', authenticate, async (req, res) => {
  try {
    if (!ELIGIBLE_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: 'Your role cannot approve change orders' });
    }
    const ref = db.collection('change_orders').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Change order not found' });
    const co = doc.data();

    if (['approved', 'rejected'].includes(co.status)) {
      return res.status(400).json({ error: `Change order is already ${co.status}` });
    }
    if (co.approvals.some(a => a.approvedBy === req.user.uid)) {
      return res.status(400).json({ error: 'You have already approved this change order' });
    }

    const approvals = [...co.approvals, {
      approvedBy: req.user.uid,
      approvedByName: req.user.name || '',
      roleAtTime: req.user.role,
      approvedAt: new Date().toISOString(),
    }];

    let status;
    if (!co.requiresDualApproval) {
      status = 'approved';   // any single eligible approval is final
    } else {
      const hasManager = approvals.some(a => a.roleAtTime === 'manager');
      const hasAdmin = approvals.some(a => a.roleAtTime === 'admin');
      status = hasManager && hasAdmin ? 'approved' : 'partially_approved';
    }

    await ref.update({ approvals, status });

    if (status === 'approved') {
      await flagReworkTasks(co);
    }

    res.json({
      message: status === 'approved' ? 'Change order approved' : 'Approval recorded — awaiting second approval',
      status,
      awaiting: status === 'partially_approved'
        ? ['manager', 'admin'].filter(r => !approvals.some(a => a.roleAtTime === r))
        : [],
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── REJECT ───────────────────────────────────────────────────────────────────
router.patch('/:id/reject', authenticate, authorize('manager', 'admin'), async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'reason is required' });
    const ref = db.collection('change_orders').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Change order not found' });
    if (doc.data().status === 'approved') return res.status(400).json({ error: 'Cannot reject an approved change order' });

    await ref.update({
      status: 'rejected',
      rejectedBy: req.user.uid,
      rejectedReason: reason,
    });
    res.json({ message: 'Change order rejected' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── REWORK FLAGGING ──────────────────────────────────────────────────────────
// "Wall already built, then the change order hit it": completed tasks whose
// plan reference matches the affected zone, finished before the CO was issued
async function flagReworkTasks(co) {
  try {
    if (!co.affectedZone) return;
    const zone = co.affectedZone.toLowerCase();
    const snap = await db.collection('tasks').where('siteId', '==', co.siteId).get();
    const affected = snap.docs.map(d => d.data()).filter(t =>
      t.status === 'complete' &&
      t.completedAt && t.completedAt.split('T')[0] <= co.issuedDate &&
      (t.planReference || '').toLowerCase().includes(zone)
    );
    if (!affected.length) return;

    const batch = db.batch();
    affected.forEach(t => {
      batch.update(db.collection('tasks').doc(t.id), { reworkFlag: true, reworkChangeOrderId: co.id });
    });
    batch.update(db.collection('change_orders').doc(co.id), {
      linkedTaskIds: affected.map(t => t.id),
    });
    await batch.commit();

    const supsSnap = await db.collection('users')
      .where('assignedSiteId', '==', co.siteId)
      .where('role', 'in', ['supervisor', 'admin'])
      .get();
    const tokens = supsSnap.docs.map(d => d.data().fcmToken).filter(Boolean);
    if (tokens.length) {
      await messaging.sendEachForMulticast({
        tokens,
        notification: {
          title: '⚠️ Rework Flagged',
          body: `CO ${co.coNumber} affects ${affected.length} completed task(s) in ${co.affectedZone}`,
        },
      });
    }
  } catch (err) { console.error('Rework flagging failed:', err.message); }
}

module.exports = router;
