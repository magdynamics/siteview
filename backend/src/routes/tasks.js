const express = require('express');
const router = express.Router();
const multer = require('multer');
const { db, messaging } = require('../services/firebase');
const { saveFile } = require('../services/fileStorage');
const { authenticate, authorize } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// 60MB ceiling: task evidence can be a short video clip, not just a photo
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });

// Task dispatch & acknowledgment (technical guideline §4.5).
// Photo enforcement on completion is gated by REQUIRE_TASK_PHOTOS until
// Firebase Storage is provisioned.

const STATUSES = ['assigned', 'acknowledged', 'in_progress', 'blocked', 'complete'];
const TRANSITIONS = {
  assigned: ['acknowledged', 'blocked'],
  acknowledged: ['in_progress', 'blocked'],
  in_progress: ['blocked', 'complete'],
  blocked: ['in_progress', 'acknowledged'],
  complete: [],
};

async function computeEstimatedCost({ assignedTo, estimatedHours, requiredEquipmentIds, requiredMaterials }) {
  let labor = 0, equipment = 0, materials = 0;
  const hours = parseFloat(estimatedHours) || 0;

  if (assignedTo && hours) {
    const empDoc = await db.collection('users').doc(assignedTo).get();
    if (empDoc.exists) {
      const emp = empDoc.data();
      const rate = emp.paymentType === 'hourly' ? (emp.hourlyRate || 0)
        : emp.paymentType === 'daily' ? (emp.dailyRate || 0) / 8
        : 0;
      labor = rate * hours;
    }
  }

  for (const equipId of requiredEquipmentIds || []) {
    const eqDoc = await db.collection('equipment').doc(equipId).get();
    if (!eqDoc.exists) continue;
    const typeDoc = await db.collection('equipment_types').doc(eqDoc.data().typeId).get();
    const rate = typeDoc.exists ? (typeDoc.data().defaultHourlyRate || 0) : 0;
    equipment += rate * hours;
  }

  for (const rm of requiredMaterials || []) {
    const matDoc = await db.collection('material_items').doc(rm.materialId).get();
    if (matDoc.exists) materials += (matDoc.data().unitCost || 0) * (parseFloat(rm.qty) || 0);
  }

  return {
    labor: +labor.toFixed(2),
    equipment: +equipment.toFixed(2),
    materials: +materials.toFixed(2),
    total: +(labor + equipment + materials).toFixed(2),
  };
}

async function notifyUser(uid, title, body) {
  try {
    const doc = await db.collection('users').doc(uid).get();
    const token = doc.exists ? doc.data().fcmToken : null;
    if (token) await messaging.send({ token, notification: { title, body } });
  } catch {}
}

// ─── CREATE TASK ──────────────────────────────────────────────────────────────
// Any authenticated user can create (foremen assign sub-tasks to their crew)
router.post('/', authenticate, async (req, res) => {
  try {
    const {
      siteId, title, description, assignedTo, planReference,
      scheduledDate, requiredEquipmentIds, requiredMaterials, estimatedHours,
      requiredCrewSize,
    } = req.body;

    if (!siteId) return res.status(400).json({ error: 'siteId is required' });
    if (!title) return res.status(400).json({ error: 'title is required' });
    if (!assignedTo) return res.status(400).json({ error: 'assignedTo is required' });

    const assigneeDoc = await db.collection('users').doc(assignedTo).get();
    if (!assigneeDoc.exists) return res.status(400).json({ error: 'assignedTo does not match an existing user' });

    const estimatedCost = await computeEstimatedCost({ assignedTo, estimatedHours, requiredEquipmentIds, requiredMaterials });

    const id = uuidv4();
    const now = new Date().toISOString();
    const task = {
      id,
      siteId,
      title,
      description: description || '',
      assignedTo,
      assignedToName: assigneeDoc.data().name || '',
      assignedBy: req.user.uid,
      assignedByName: req.user.name || '',
      planReference: planReference || '',   // linked to PlanDocument in Phase 4
      changeOrderId: null,
      scheduledDate: scheduledDate || now.split('T')[0],
      status: 'assigned',
      acknowledgedAt: null,
      startedAt: null,
      completedAt: null,
      blockedReason: null,
      requiredEquipmentIds: requiredEquipmentIds || [],
      requiredMaterials: requiredMaterials || [],   // [{materialId, qty}]
      estimatedHours: estimatedHours ? parseFloat(estimatedHours) : null,
      requiredCrewSize: requiredCrewSize ? Math.max(1, parseInt(requiredCrewSize)) : 1,
      estimatedCost,
      reworkFlag: false,
      createdAt: now,
    };

    await db.collection('tasks').doc(id).set(task);
    await notifyUser(assignedTo, '📋 New Task Assigned', `${title}${planReference ? ` — ${planReference}` : ''}`);

    res.status(201).json({ message: 'Task created', task });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── LIST TASKS ───────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const { siteId, assignedTo, date, status } = req.query;
    let query = db.collection('tasks');
    // one equality filter server-side, rest in memory (task volume is small)
    if (assignedTo) query = query.where('assignedTo', '==', assignedTo === 'me' ? req.user.uid : assignedTo);
    else if (siteId) query = query.where('siteId', '==', siteId);

    const snap = await query.get();
    let tasks = snap.docs.map(d => d.data());
    if (assignedTo && siteId) tasks = tasks.filter(t => t.siteId === siteId);
    if (date) tasks = tasks.filter(t => t.scheduledDate === date);
    if (status) tasks = tasks.filter(t => t.status === status);
    tasks.sort((a, b) => (a.scheduledDate || '').localeCompare(b.scheduledDate || '') || a.createdAt.localeCompare(b.createdAt));
    res.json(tasks);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── CALENDAR VIEW ────────────────────────────────────────────────────────────
// Must be registered before /:id — otherwise Express matches "calendar" as an id.
// Tasks in a date range, shaped for the scheduling calendar (day/week/month).
router.get('/calendar', authenticate, authorize('supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const { siteId, startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });

    let query = db.collection('tasks');
    if (siteId) query = query.where('siteId', '==', siteId);
    const snap = await query.get();

    const tasks = snap.docs
      .map(d => d.data())
      .filter(t => t.scheduledDate >= startDate && t.scheduledDate <= endDate);

    res.json(tasks);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('tasks').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Task not found' });
    res.json(doc.data());
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ACKNOWLEDGE ──────────────────────────────────────────────────────────────
router.post('/:id/acknowledge', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('tasks').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Task not found' });
    const task = doc.data();
    if (task.assignedTo !== req.user.uid) return res.status(403).json({ error: 'Only the assignee can acknowledge' });
    if (task.status !== 'assigned') return res.status(400).json({ error: `Task is ${task.status}, not awaiting acknowledgment` });

    await db.collection('tasks').doc(req.params.id).update({
      status: 'acknowledged',
      acknowledgedAt: new Date().toISOString(),
    });
    await notifyUser(task.assignedBy, '✅ Task Acknowledged', `${task.assignedToName} acknowledged: ${task.title}`);
    res.json({ message: 'Task acknowledged' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── STATUS TRANSITIONS ───────────────────────────────────────────────────────
router.patch('/:id/status', authenticate, async (req, res) => {
  try {
    const { status, blockedReason } = req.body;
    if (!STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of: ${STATUSES.join(', ')}` });

    const doc = await db.collection('tasks').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Task not found' });
    const task = doc.data();

    const isAssignee = task.assignedTo === req.user.uid;
    const isManager = ['supervisor', 'manager', 'admin'].includes(req.user.role);
    if (!isAssignee && !isManager) return res.status(403).json({ error: 'Not your task' });

    if (!TRANSITIONS[task.status].includes(status)) {
      return res.status(400).json({ error: `Cannot move from ${task.status} to ${status}` });
    }
    if (status === 'blocked' && !blockedReason) {
      return res.status(400).json({ error: 'blockedReason is required when blocking a task' });
    }

    const updates = { status, blockedReason: status === 'blocked' ? blockedReason : null };
    const now = new Date().toISOString();
    if (status === 'in_progress' && !task.startedAt) updates.startedAt = now;

    if (status === 'complete') {
      // photo evidence gate — enforced once Storage is provisioned
      const mediaSnap = await db.collection('task_media').where('taskId', '==', task.id).get();
      const phases = mediaSnap.docs.map(d => d.data().phase);
      const hasBefore = phases.includes('before');
      const hasAfter = phases.includes('after');
      if (process.env.REQUIRE_TASK_PHOTOS === 'true' && (!hasBefore || !hasAfter)) {
        return res.status(400).json({ error: 'A before and an after photo are required to complete this task' });
      }
      updates.completedAt = now;
      updates.completedWithPhotos = hasBefore && hasAfter;
    }

    await db.collection('tasks').doc(req.params.id).update(updates);

    if (status === 'blocked') {
      const supsSnap = await db.collection('users')
        .where('assignedSiteId', '==', task.siteId)
        .where('role', 'in', ['supervisor', 'admin'])
        .get();
      const tokens = supsSnap.docs.map(d => d.data().fcmToken).filter(Boolean);
      if (tokens.length) {
        await messaging.sendEachForMulticast({
          tokens,
          notification: { title: '🚧 Task Blocked', body: `${task.title}: ${blockedReason}` },
        });
      }
    }

    res.json({ message: `Task ${status}`, updates });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── TASK MEDIA (before / during / after) ─────────────────────────────────────
router.post('/:id/media', authenticate, upload.single('photo'), async (req, res) => {
  try {
    const { phase, caption, latitude, longitude } = req.body;
    if (!req.file) return res.status(400).json({ error: 'photo file is required' });
    if (!['before', 'during', 'after'].includes(phase)) {
      return res.status(400).json({ error: "phase must be 'before', 'during', or 'after'" });
    }
    const taskDoc = await db.collection('tasks').doc(req.params.id).get();
    if (!taskDoc.exists) return res.status(404).json({ error: 'Task not found' });
    const task = taskDoc.data();

    const mediaId = uuidv4();
    const isVideo = (req.file.mimetype || '').startsWith('video/');
    const ext = isVideo ? 'mp4' : 'jpg';
    const fileName = `task-media/${task.siteId}/${task.id}/${phase}_${mediaId}.${ext}`;
    const url = await saveFile(fileName, req.file.buffer, req.file.mimetype);

    const media = {
      id: mediaId,
      taskId: task.id,
      siteId: task.siteId,
      mediaType: isVideo ? 'video' : 'photo',
      phase,
      caption: caption || '',
      latitude: latitude || null,
      longitude: longitude || null,
      uploadedBy: req.user.uid,
      uploadedByName: req.user.name || '',
      uploadedAt: new Date().toISOString(),
      url,
    };
    await db.collection('task_media').doc(mediaId).set(media);
    res.status(201).json({ message: 'Media uploaded', media });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/media', authenticate, async (req, res) => {
  try {
    const snap = await db.collection('task_media').where('taskId', '==', req.params.id).get();
    res.json(snap.docs.map(d => d.data()).sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── COST (estimated vs actual, computed on demand) ─────────────────────────
router.get('/:id/cost', authenticate, authorize('supervisor', 'accountant', 'manager', 'admin'), async (req, res) => {
  try {
    const doc = await db.collection('tasks').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Task not found' });
    const task = doc.data();

    // labor: out-punches carry taskId + rateSnapshot copied from the matched in-punch
    const punchSnap = await db.collection('punches').where('taskId', '==', task.id).get();
    let laborHours = 0, laborCost = 0;
    punchSnap.docs.forEach(d => {
      const p = d.data();
      if (p.type === 'out' && p.durationHours) {
        laborHours += p.durationHours;
        if (p.paymentTypeSnapshot === 'hourly') laborCost += p.durationHours * (p.rateSnapshot || 0);
        else if (p.paymentTypeSnapshot === 'daily') laborCost += (p.durationHours / 8) * (p.rateSnapshot || 0);
      }
    });

    // materials: consume tickets linked to this task, costed from the material master
    const matTickets = await db.collection('material_tickets').where('linkedTaskId', '==', task.id).get();
    let materialsCost = 0;
    for (const t of matTickets.docs) {
      const tk = t.data();
      if (tk.ticketType !== 'consume') continue;
      const matDoc = await db.collection('material_items').doc(tk.materialId).get();
      if (matDoc.exists) materialsCost += (matDoc.data().unitCost || 0) * (tk.qty || 0);
    }

    const actual = {
      labor: +laborCost.toFixed(2),
      laborHours: +laborHours.toFixed(2),
      materials: +materialsCost.toFixed(2),
      total: +(laborCost + materialsCost).toFixed(2),
    };
    res.json({
      taskId: task.id,
      title: task.title,
      estimated: task.estimatedCost,
      actual,
      variance: task.estimatedCost ? +(actual.total - task.estimatedCost.total).toFixed(2) : null,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── RESCHEDULE (drag-and-drop) ───────────────────────────────────────────────
// Moves a task to a new date and/or reassigns it. Conflicts (the employee or
// any required equipment already booked at a different site that day) are
// soft — the move still applies, and the response flags what to double-check.
router.patch('/:id/reschedule', authenticate, authorize('supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const { scheduledDate, assignedTo } = req.body;
    if (!scheduledDate) return res.status(400).json({ error: 'scheduledDate is required' });

    const doc = await db.collection('tasks').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Task not found' });
    const task = doc.data();

    const newAssignee = assignedTo || task.assignedTo;
    let assigneeName = task.assignedToName;
    if (assignedTo && assignedTo !== task.assignedTo) {
      const assigneeDoc = await db.collection('users').doc(assignedTo).get();
      if (!assigneeDoc.exists) return res.status(400).json({ error: 'assignedTo does not match an existing user' });
      assigneeName = assigneeDoc.data().name || '';
    }

    // Soft conflict check: same employee or same equipment already booked
    // at a DIFFERENT site on the target date. Multiple tasks for the same
    // resource at the SAME site on the same day is normal and not flagged.
    const conflicts = [];
    const daySnap = await db.collection('tasks')
      .where('scheduledDate', '==', scheduledDate)
      .get();
    const equipmentIds = task.requiredEquipmentIds || [];
    daySnap.docs.forEach(d => {
      const other = d.data();
      if (other.id === task.id || other.status === 'complete') return;
      if (other.siteId === task.siteId) return;
      if (other.assignedTo === newAssignee) {
        conflicts.push({ type: 'employee', name: assigneeName, conflictingTask: other.title, conflictingSite: other.siteId });
      }
      const overlap = (other.requiredEquipmentIds || []).filter(id => equipmentIds.includes(id));
      overlap.forEach(equipId => {
        conflicts.push({ type: 'equipment', equipmentId: equipId, conflictingTask: other.title, conflictingSite: other.siteId });
      });
    });

    await db.collection('tasks').doc(req.params.id).update({
      scheduledDate,
      assignedTo: newAssignee,
      assignedToName: assigneeName,
    });

    if (assignedTo && assignedTo !== task.assignedTo) {
      await notifyUser(newAssignee, '📋 Task Rescheduled to You', `${task.title} — ${scheduledDate}`);
    }

    res.json({ message: 'Task rescheduled', conflicts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
