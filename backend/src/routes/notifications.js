const express = require('express');
const router = express.Router();
const { db, messaging } = require('../services/firebase');
const { authenticate, authorize } = require('../middleware/auth');
const { isEnabled: smsEnabled, sendBulkSMS } = require('../services/sms');

// ─── SMS TEXT DISPATCH ────────────────────────────────────────────────────────
// Text an assignment (or any message) to one employee, a list of employees,
// or every active employee at a site — mirrors "text the assignment, or text
// anyone or even groups" from the field. Falls back to a no-op with
// skipped:true per recipient when Twilio isn't configured (see services/sms.js).
router.post('/sms', authenticate, authorize('supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const { message, employeeIds, siteId } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'message is required' });
    if (!employeeIds?.length && !siteId) return res.status(400).json({ error: 'employeeIds or siteId is required' });

    let recipients = [];
    if (employeeIds?.length) {
      const docs = await Promise.all(employeeIds.map(id => db.collection('users').doc(id).get()));
      recipients = docs.filter(d => d.exists).map(d => ({ id: d.id, name: d.data().name, phone: d.data().phone }));
    } else {
      const snap = await db.collection('users')
        .where('assignedSiteId', '==', siteId)
        .where('isActive', '==', true)
        .get();
      recipients = snap.docs.map(d => ({ id: d.id, name: d.data().name, phone: d.data().phone }));
    }

    const results = await sendBulkSMS(recipients, message.trim());
    const sentCount = results.filter(r => r.sent).length;
    const skippedNoPhone = results.filter(r => r.skipped && r.error === 'No phone number on file');

    res.json({
      message: smsEnabled()
        ? `Texted ${sentCount} of ${recipients.length} recipients`
        : 'Twilio is not configured — no messages were actually sent (see results for what would have gone out)',
      smsEnabled: smsEnabled(),
      results,
      missingPhoneCount: skippedNoPhone.length,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Send notification to a site (broadcast)
router.post('/broadcast', authenticate, authorize('supervisor', 'admin', 'manager'), async (req, res) => {
  try {
    const { siteId, title, body } = req.body;

    const snapshot = await db.collection('users')
      .where('assignedSiteId', '==', siteId)
      .where('isActive', '==', true)
      .get();

    const tokens = snapshot.docs
      .map(doc => doc.data().fcmToken)
      .filter(Boolean);

    if (tokens.length === 0) {
      return res.json({ message: 'No devices to notify' });
    }

    await messaging.sendEachForMulticast({ tokens, notification: { title, body } });
    res.json({ message: `Notification sent to ${tokens.length} devices` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Alert: employee punched outside geofence
router.post('/geofence-alert', authenticate, async (req, res) => {
  try {
    const { employeeId, siteId, latitude, longitude } = req.body;

    const siteDoc = await db.collection('sites').doc(siteId).get();
    const site = siteDoc.data();

    const supervisorDoc = await db.collection('users').doc(site.supervisorId).get();
    const supervisor = supervisorDoc.data();

    if (supervisor?.fcmToken) {
      await messaging.send({
        token: supervisor.fcmToken,
        notification: {
          title: 'Geofence Alert',
          body: `An employee attempted to punch in from outside the site boundary.`,
        },
      });
    }

    res.json({ message: 'Alert sent to supervisor' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
