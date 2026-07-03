const express = require('express');
const router = express.Router();
const cron = require('node-cron');
const { db, messaging } = require('../services/firebase');
const { createMaintenanceRecord } = require('../services/maintenanceRecords');
const { authenticate, authorize } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// ─── CREATE MAINTENANCE SCHEDULE ──────────────────────────────────────────────
router.post('/', authenticate, authorize('supervisor', 'admin'), async (req, res) => {
  try {
    const {
      equipmentId,
      equipmentName,
      siteId,
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

    if (!equipmentId) return res.status(400).json({ error: 'equipmentId is required' });
    if (!maintenanceType) return res.status(400).json({ error: 'maintenanceType is required' });

    const parsedIntervalHours = intervalHours ? parseFloat(intervalHours) : null;
    const parsedIntervalDays = intervalDays ? parseInt(intervalDays) : null;
    let parsedNextDueDate = nextDueDate || null;
    let parsedNextDueHours = nextDueHours ? parseFloat(nextDueHours) : null;

    const hasDateTrigger = !!(parsedIntervalDays || parsedNextDueDate);
    const hasHoursTrigger = !!(parsedIntervalHours || parsedNextDueHours);
    if (!hasDateTrigger && !hasHoursTrigger) {
      return res.status(400).json({ error: 'Schedule needs an interval or a next due date/hours' });
    }

    const equipDoc = await db.collection('equipment').doc(equipmentId).get();
    if (!equipDoc.exists) return res.status(404).json({ error: 'Equipment not found' });
    const equip = equipDoc.data();

    // When only an interval was given, derive the first due point
    if (!parsedNextDueDate && parsedIntervalDays) {
      const next = new Date();
      next.setDate(next.getDate() + parsedIntervalDays);
      parsedNextDueDate = next.toISOString().split('T')[0];
    }
    if (!parsedNextDueHours && parsedIntervalHours) {
      parsedNextDueHours = (equip.currentHours || 0) + parsedIntervalHours;
    }

    const id = uuidv4();
    const schedule = {
      id,
      equipmentId,
      equipmentName: equipmentName || equip.name || '',
      siteId: siteId || equip.siteId || null,
      scheduleType: hasDateTrigger && hasHoursTrigger ? 'both' : hasHoursTrigger ? 'hours' : 'date',
      maintenanceType,
      customDescription: customDescription || '',
      intervalHours: parsedIntervalHours,
      intervalDays: parsedIntervalDays,
      nextDueDate: parsedNextDueDate,
      nextDueHours: parsedNextDueHours,
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
router.get('/', authenticate, authorize('supervisor', 'manager', 'admin'), async (req, res) => {
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
      isOverdue: s.status === 'overdue' ||
        (s.status === 'active' && !!s.nextDueDate && s.nextDueDate < today),
      daysUntilDue: s.nextDueDate
        ? Math.ceil((new Date(s.nextDueDate) - new Date()) / 86400000)
        : null,
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── MARK SCHEDULE AS COMPLETED (auto-reschedule + log maintenance record) ───
router.post('/:id/complete', authenticate, authorize('supervisor', 'admin'), async (req, res) => {
  try {
    const { completedDate, completedAtHours, performedBy, notes } = req.body;
    const doc = await db.collection('maintenance_schedules').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Schedule not found' });
    const schedule = doc.data();
    const now = completedDate || new Date().toISOString().split('T')[0];

    // Hour-based recurring schedules can't compute the next due point without a reading
    if (schedule.isRecurring && schedule.intervalHours && !completedAtHours) {
      return res.status(400).json({ error: 'completedAtHours is required for hour-based schedules' });
    }

    let updates = {
      lastCompletedDate: now,
      lastCompletedHours: completedAtHours ? parseFloat(completedAtHours) : null,
    };

    // A recurring schedule with no interval has nothing to reschedule — close it out
    if (schedule.isRecurring && (schedule.intervalDays || schedule.intervalHours)) {
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

    // Log the completed work in maintenance history
    const record = await createMaintenanceRecord({
      equipmentId: schedule.equipmentId,
      equipmentName: schedule.equipmentName,
      siteId: schedule.siteId,
      performedBy: performedBy || req.user.name || req.user.uid,
      authorizedBy: req.user.name || req.user.uid,
      maintenanceDate: now,
      maintenanceType: 'routine',
      description: schedule.maintenanceType === 'custom'
        ? (schedule.customDescription || 'Scheduled maintenance')
        : `Scheduled ${(schedule.maintenanceType || '').replace(/_/g, ' ')}`,
      hoursAtService: completedAtHours,
      nextServiceDate: updates.nextDueDate || null,
      nextServiceHours: updates.nextDueHours || null,
      notes,
      scheduleId: schedule.id,
      status: 'completed',
    }, req.user.uid);
    updates.lastMaintenanceRecordId = record.id;

    await db.collection('maintenance_schedules').doc(req.params.id).update(updates);
    res.json({ message: schedule.isRecurring ? 'Schedule updated and rescheduled' : 'Schedule completed', updates, record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── UPDATE SCHEDULE ──────────────────────────────────────────────────────────
// Only these fields are editable; id/equipmentId/status/audit fields are not
const UPDATABLE_FIELDS = {
  equipmentName: v => v,
  maintenanceType: v => v,
  customDescription: v => v,
  intervalHours: v => (v ? parseFloat(v) : null),
  intervalDays: v => (v ? parseInt(v) : null),
  nextDueDate: v => v || null,
  nextDueHours: v => (v ? parseFloat(v) : null),
  reminderDaysBefore: v => (v ? parseInt(v) : 3),
  notifyRoles: v => v,
  isRecurring: v => v !== false,
};

router.put('/:id', authenticate, authorize('supervisor', 'admin'), async (req, res) => {
  try {
    const updates = {};
    for (const [field, parse] of Object.entries(UPDATABLE_FIELDS)) {
      if (field in req.body) updates[field] = parse(req.body[field]);
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No updatable fields provided' });
    }

    const doc = await db.collection('maintenance_schedules').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Schedule not found' });

    await db.collection('maintenance_schedules').doc(req.params.id).update(updates);
    res.json({ message: 'Schedule updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── REQUIRED PARTS FOR A SCHEDULE ───────────────────────────────────────────
// Attach the parts a service consumes so stock can be checked before due day
router.put('/:id/parts', authenticate, authorize('supervisor', 'admin'), async (req, res) => {
  try {
    const { parts } = req.body; // [{ inventoryItemId, quantity }]
    if (!Array.isArray(parts)) return res.status(400).json({ error: 'parts must be an array' });

    const doc = await db.collection('maintenance_schedules').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Schedule not found' });

    const requiredParts = [];
    for (const p of parts) {
      const qty = parseFloat(p.quantity);
      if (!p.inventoryItemId || isNaN(qty) || qty <= 0) {
        return res.status(400).json({ error: 'each part needs inventoryItemId and a positive quantity' });
      }
      const itemDoc = await db.collection('inventory').doc(p.inventoryItemId).get();
      if (!itemDoc.exists) return res.status(400).json({ error: `inventory item ${p.inventoryItemId} not found` });
      const item = itemDoc.data();
      requiredParts.push({
        inventoryItemId: p.inventoryItemId,
        itemName: item.name,
        partNumber: item.partNumber || '',
        unit: item.unit,
        quantity: qty,
      });
    }

    await db.collection('maintenance_schedules').doc(req.params.id).update({ requiredParts });
    res.json({ message: 'Required parts saved', requiredParts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stock check: is everything this service needs on the shelf?
router.get('/:id/parts-check', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('maintenance_schedules').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Schedule not found' });
    const parts = doc.data().requiredParts || [];

    const results = [];
    for (const p of parts) {
      const itemDoc = await db.collection('inventory').doc(p.inventoryItemId).get();
      const inStock = itemDoc.exists ? (itemDoc.data().currentQty || 0) : 0;
      results.push({ ...p, inStock, ok: inStock >= p.quantity, shortBy: Math.max(0, p.quantity - inStock) });
    }
    res.json({ ready: results.every(r => r.ok), parts: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PAUSE / RESUME SCHEDULE ──────────────────────────────────────────────────
router.post('/:id/pause', authenticate, authorize('supervisor', 'admin'), async (req, res) => {
  try {
    const doc = await db.collection('maintenance_schedules').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Schedule not found' });
    await db.collection('maintenance_schedules').doc(req.params.id).update({ status: 'paused' });
    res.json({ message: 'Schedule paused' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/resume', authenticate, authorize('supervisor', 'admin'), async (req, res) => {
  try {
    const doc = await db.collection('maintenance_schedules').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Schedule not found' });
    await db.collection('maintenance_schedules').doc(req.params.id).update({ status: 'active' });
    res.json({ message: 'Schedule resumed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DAILY REMINDER JOB (runs at 7:00 AM every day) ──────────────────────────
cron.schedule('0 7 * * *', async () => {
  try {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Firestore marker so only one server instance runs the job per day
    const markerRef = db.collection('system').doc('maintenanceReminderJob');
    const shouldRun = await db.runTransaction(async t => {
      const marker = await t.get(markerRef);
      if (marker.exists && marker.data().lastRunDate === todayStr) return false;
      t.set(markerRef, { lastRunDate: todayStr, lastRunAt: new Date().toISOString() });
      return true;
    });
    if (!shouldRun) return;

    console.log('[Maintenance Reminders] Running daily check...');

    const snapshot = await db.collection('maintenance_schedules')
      .where('status', 'in', ['active', 'overdue'])
      .get();

    for (const doc of snapshot.docs) {
      const schedule = doc.data();

      if (!schedule.nextDueDate) {
        // Hour-based schedule already flagged overdue by machine-hours logging:
        // keep reminding daily until it's completed
        if (schedule.status === 'overdue') {
          await sendMaintenanceReminder(schedule, null, true);
        }
        continue;
      }

      const dueDate = new Date(schedule.nextDueDate);
      const daysUntil = Math.ceil((dueDate - today) / 86400000);

      // Send reminder if within X days before due
      if (daysUntil <= schedule.reminderDaysBefore && daysUntil >= 0 && schedule.status === 'active') {
        await sendMaintenanceReminder(schedule, daysUntil, false);
      }

      // Mark overdue (once) and keep reminding daily while overdue
      if (daysUntil < 0) {
        if (schedule.status === 'active') {
          await db.collection('maintenance_schedules').doc(doc.id).update({ status: 'overdue' });
        }
        await sendMaintenanceReminder(schedule, Math.abs(daysUntil), true);
      }
    }

    console.log('[Maintenance Reminders] Check complete');

    await sendDailySiteDigests();
  } catch (err) {
    console.error('[Maintenance Reminders] Error:', err.message);
  }
});

// ─── DAILY SITE DIGEST ────────────────────────────────────────────────────────
// One morning push per site: critical tickets, machines down, overdue
// maintenance, and in-use equipment with stale inspections
async function sendDailySiteDigests() {
  const sitesSnap = await db.collection('sites').where('isActive', '==', true).get();
  const staleCutoff = new Date(Date.now() - 24 * 3600000).toISOString();

  for (const siteDoc of sitesSnap.docs) {
    const site = siteDoc.data();
    try {
      const [equipSnap, ticketSnap, schedSnap] = await Promise.all([
        db.collection('equipment').where('siteId', '==', site.id).where('isActive', '==', true).get(),
        db.collection('repair_tickets').where('siteId', '==', site.id).get(),
        db.collection('maintenance_schedules').where('siteId', '==', site.id).where('status', '==', 'overdue').get(),
      ]);

      const equipment = equipSnap.docs.map(d => d.data());
      const down = equipment.filter(e => e.status === 'out_of_service');
      const critical = ticketSnap.docs.map(d => d.data())
        .filter(t => t.priority === 'critical' && ['pending', 'approved', 'in_progress'].includes(t.status));
      const overdueCount = schedSnap.size;

      const inUse = equipment.filter(e => e.status === 'in_use');
      let staleInspections = 0;
      for (const e of inUse) {
        const insp = await db.collection('inspections')
          .where('equipmentId', '==', e.id)
          .orderBy('timestamp', 'desc').limit(1).get();
        const last = insp.docs[0] ? insp.docs[0].data().timestamp : null;
        if (!last || last < staleCutoff) staleInspections++;
      }

      if (!down.length && !critical.length && !overdueCount && !staleInspections) continue;

      const lines = [];
      if (critical.length) lines.push(`${critical.length} critical ticket(s)`);
      if (down.length) lines.push(`${down.length} machine(s) out of service`);
      if (overdueCount) lines.push(`${overdueCount} overdue maintenance`);
      if (staleInspections) lines.push(`${staleInspections} in-use machine(s) missing daily inspection`);

      const usersSnap = await db.collection('users')
        .where('assignedSiteId', '==', site.id)
        .where('isActive', '==', true)
        .get();
      const tokens = usersSnap.docs
        .filter(d => ['supervisor', 'manager', 'admin'].includes(d.data().role))
        .map(d => d.data().fcmToken)
        .filter(Boolean);
      if (!tokens.length) continue;

      await messaging.sendEachForMulticast({
        tokens,
        notification: {
          title: `📋 ${site.name} — morning fleet digest`,
          body: lines.join(' · '),
        },
      });
    } catch (err) {
      console.error(`[Daily Digest] ${site.name}:`, err.message);
    }
  }
}

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

    let body = isOverdue
      ? (days === null
          ? `${schedule.maintenanceType} is overdue on ${schedule.equipmentName}`
          : `${schedule.maintenanceType} is ${days} day(s) overdue on ${schedule.equipmentName}`)
      : days === 0
        ? `${schedule.maintenanceType} is due TODAY on ${schedule.equipmentName}`
        : `${schedule.maintenanceType} is due in ${days} day(s) on ${schedule.equipmentName}`;

    // Warn if the service's parts aren't on the shelf
    if (Array.isArray(schedule.requiredParts) && schedule.requiredParts.length) {
      const short = [];
      for (const p of schedule.requiredParts) {
        const itemDoc = await db.collection('inventory').doc(p.inventoryItemId).get();
        const inStock = itemDoc.exists ? (itemDoc.data().currentQty || 0) : 0;
        if (inStock < p.quantity) short.push(p.itemName);
      }
      if (short.length) body += ` ⚠️ parts short: ${short.join(', ')}`;
    }

    await messaging.sendEachForMulticast({ tokens, notification: { title, body } });
  } catch (err) {
    console.error('Error sending maintenance reminder:', err.message);
  }
}

module.exports = router;
