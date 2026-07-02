const express = require('express');
const router = express.Router();
const { db, auth } = require('../services/firebase');
const { authenticate } = require('../middleware/auth');

// Get current user profile
router.get('/me', authenticate, async (req, res) => {
  res.json(req.user);
});

// Update FCM token for push notifications
router.post('/fcm-token', authenticate, async (req, res) => {
  try {
    const { token } = req.body;
    await db.collection('users').doc(req.user.uid).update({ fcmToken: token });
    res.json({ message: 'FCM token updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update user language preference
router.post('/language', authenticate, async (req, res) => {
  try {
    const { language } = req.body; // 'en' or 'es'
    await db.collection('users').doc(req.user.uid).update({ language });
    res.json({ message: 'Language updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
