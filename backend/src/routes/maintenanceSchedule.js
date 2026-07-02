const express = require('express');
const router = express.Router();
const cron = require('node-cron');
const { db, messaging } = require('../services/firebase');
const { authenticate, authorize } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// ─── CREATE MAINTENANCE SCHEDULE ──────────────────────────────────────────────
router.post('/', authenticate, authorize('supervisor', 'admin'), async (req, res) => {
  try {
    const {
      equipmentId,
      equipmentName,
      siteId,
      scheduleType,         // 'hours' | 'date' | 'both'
      maintenanceType,      // 'oil_change' | 'filter' | 'inspection' | 'tires' | 'custom'
      customDescription,    // if maintenanceType is 'custom'
      intervalHours,        // e.g. every 250 hours
      intervalDays,         // e.g. every 30 days
      nextDueDate,          // next due date
      nextDueHours,         // next due at X machine hours
      reminderDaysBefore,   // send reminder X days before due date
      notifyRoles,          // ['supervisor', 'manager'] who to notify
      isRecurring,          // auto-reschedule after completion
    } = req.body;

    const id = uuidv4();
    const schedule = {
      id,
      equipmentId,
      equipmentName,
      siteId,
      scheduleType,
      maintenanceType,
      customDescription: customDescription || '',
      intervalHours: intervalHours ? parseFloat(intervalHours) : null,
      intervalDays: intervalDays ? parseInt(intervalDays) : null,
      nextDueDate: nextDueDate || null,
      nextDueHours: nextDueHours ? parseFloat(nextDueHours) : null,
      reminderDaysBefore: reminderDaysBefore ? parseInt(reminderDaysBefore) : 3,
      notifyRoles: notifyRoles || ['supervisor'],
      isRecurring: isRecurring !== false,
      status: 'active',       // 'active' | 'overdue' | 'completed' | 'paused'
      createdBy: req.user.uid,
      createdAt: new Date().toISOString(),
      lastCompletedDate: null,
      lastCompletedHours: null,
    };

    await db.collection('maintenance_schedules').doc(id).set(schedule);
    res.status(201).json({ message: 'Schedule created', schedule });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET SCHEDULES ────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { equipmentId, siteId, status } = req.query;
    let query = db.collection('maintenance_schedules');

    if (equipmentId) query = query.where('equipmentId', '==', equipmentId);
    if (siteId) query = query.where('siteId', '==', siteId);
    if (status) query = query.where('status', '==', status);

    const snapshot = await query.get();
    const schedules = snapshot.docs.map(doc => doc.data());

    // Flag overdue
    const today = new Date().toISOString().split('T')[0];
    const enriched = schedules.map(s => ({
      ...s,
      isOverdue: s.nextDueDate && s.nextDueDate < today && s.status === 'active',
      daysUntilDue: s.nextDueDate
        ? Math.ceil((new Date(s.nextDueDate) - new Date()) / 86400000)
        : null,
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── MARK SCHEDULE AS COMPLETED (auto-reschedule) ────────────────────────────
router.post('/:id/complete', authenticate, authorize('supervisor', 'admin'), async (req, res) => {
  try {
    const { completedDate, completedAtHours } = req.body;
    const doc = await db.collection('maintenance_schedules').doc(req.params.id).get();
    const schedule = doc.data();
    const now = completedDate || new Date().toISOString().split('T')[0];

    let updates = {
      lastCompletedDate: now,
      lastCompletedHours: completedAtHours ? parseFloat(completedAtHours) : null,
    };

    if (schedule.isRecurring) {
      // Calculate next due
      let nextDueDate = null;
      let nextDueHours = null;

      if (schedule.intervalDays) {
        const next = new Date(now);
        next.setDate(next.getDate() + schedule.intervalDays);
        nextDueDate = next.toISOString().split('T')[0];
      }
      if (schedule.intervalHours && completedAtHours) {
        nextDueHours = parseFloat(completedAtHours) + schedule.intervalHours;
      }

      updates = { ...updates, nextDueDate, nextDueHours, status: 'active' };
    } else {
      updates.status = 'completed';
    }

    await db.collection('maintenance_schedules').doc(req.params.id).update(updates);
    res.json({ message: schedule.isRecurring ? 'Schedule updated and rescheduled' : 'Schedule completed', updates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── UPDATE SCHEDULE ──────────────────────────────────────────────────────────
router.put('/:id', authenticate, authorize('supervisor', 'admin'), async (req, res) => {
  try {
    await db.collection('maintenance_schedules').doc(req.params.id).update(req.body);
    res.json({ message: 'Schedule updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PAUSE / RESUME SCHEDULE ──────────────────────────────────────────────────
router.post('/:id/pause', authenticate, authorize('supervisor', 'admin'), async (req, res) => {
  try {
    await db.collection('maintenance_schedules').doc(req.params.id).update({ status: 'paused' });
    res.json({ message: 'Schedule paused' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/resume', authenticate, authorize('supervisor', 'admin'), async (req, res) => {
  try {
    await db.collection('maintenance_schedules').doc(req.params.id).update({ status: 'active' });
    res.json({ message: 'Schedule resumed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DAILY REMINDER JOB (runs at 7:00 AM every day) ──────────────────────────
cron.schedule('0 7 * * *', async () => {
  console.log('[Maintenance Reminders] Running daily check...');
  try {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const snapshot = await db.collection('maintenance_schedules')
      .where('status', '==', 'active')
      .get();

    for (const doc of snapshot.docs) {
      const schedule = doc.data();
      if (!schedule.nextDueDate) continue;

      const dueDate = new Date(schedule.nextDueDate);
      const daysUntil = Math.ceil((dueDate - today) / 86400000);

      // Send reminder if within X days before due
      if (daysUntil <= schedule.reminderDaysBefore && daysUntil >= 0) {
        await sendMaintenanceReminder(schedule, daysUntil, false);
      }

      // Mark overdue
      if (daysUntil < 0) {
        await db.collection('maintenance_schedules').doc(doc.id).update({ status: 'overdue' });
        await sendMaintenanceReminder(schedule, Math.abs(daysUntil), true);
      }
    }

    console.log('[Maintenance Reminders] Check complete');
  } catch (err) {
    console.error('[Maintenance Reminders] Error:', err.message);
  }
});

async function sendMaintenanceReminder(schedule, days, isOverdue) {
  try {
    // Notify all supervisors on the site
    const snapshot = await db.collection('users')
      .where('assignedSiteId', '==', schedule.siteId)
      .where('isActive', '==', true)
      .get();

    const tokens = [];
    snapshot.docs.forEach(doc => {
      const user = doc.data();
      if (schedule.notifyRoles.includes(user.role) && user.fcmToken) {
        tokens.push(user.fcmToken);
      }
    });

    if (tokens.length === 0) return;

    const title = isOverdue
      ? `⚠️ Overdue Maintenance: ${schedule.equipmentName}`
      : `🔧 Maintenance Due: ${schedule.equipmentName}`;

    const body = isOverdue
      ? `${schedule.maintenanceType} is ${days} day(s) overdue on ${schedule.equipmentName}`
      : days === 0
        ? `${schedule.maintenanceType} is due TODAY on ${schedule.equipmentName}`
        : `${schedule.maintenanceType} is due in ${days} day(s) on ${schedule.equipmentName}`;

    await messaging.sendEachForMulticast({ tokens, notification: { title, body } });
  } catch (err) {
    console.error('Error sending maintenance reminder:', err.message);
  }
}

module.exports = router;
