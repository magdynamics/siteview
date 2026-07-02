const express = require('express');
const router = express.Router();
const { db, messaging } = require('../services/firebase');
const { authenticate, authorize } = require('../middleware/auth');

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
