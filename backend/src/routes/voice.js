const express = require('express');
const router = express.Router();
const { db, messaging } = require('../services/firebase');
const { authenticate, authorize } = require('../middleware/auth');
const { getWeeklyBudget } = require('./budget');
const { v4: uuidv4 } = require('uuid');

// Voice/text dispatch and query (technical guideline §6.3/§6.4/§18).
// Input arrives as text (typed, or transcribed client-side by the browser's
// Web Speech API). Parsing is rule-based behind parseDispatch()/classifyIntent()
// seams so an LLM can replace them later without touching the endpoints.
// Every input is logged with its parsed result for accuracy review.

async function logVoice(entry) {
  const id = uuidv4();
  await db.collection('voice_logs').doc(id).set({ id, ...entry, timestamp: new Date().toISOString() });
}

// ─── DISPATCH PARSING ─────────────────────────────────────────────────────────
const FILLER = /^(you('ll| will)? (be )?|you('re| are) |please |go |will be |start |begin )+/i;

function parseDispatch(text, employees, zoneTags) {
  const segments = text.split(/[.;\n]+/).map(s => s.trim()).filter(Boolean);
  const drafts = [];
  const unmatched = [];

  for (const seg of segments) {
    const m = seg.match(/^([A-Za-z][\w'-]*(?:\s+[A-Za-z][\w'-]*)?)\s*[,:]\s*(.+)$/);
    if (!m) { unmatched.push({ segment: seg, reason: 'No "Name, action" pattern found' }); continue; }
    const [, nameCandidate, rawAction] = m;

    const nameLc = nameCandidate.toLowerCase();
    const matches = employees.filter(e => {
      const full = (e.name || '').toLowerCase();
      return full === nameLc || full.startsWith(nameLc + ' ') || full.split(' ').includes(nameLc) || full.includes(nameLc);
    });
    if (matches.length === 0) { unmatched.push({ segment: seg, reason: `No employee matches "${nameCandidate}"` }); continue; }
    if (matches.length > 1) { unmatched.push({ segment: seg, reason: `"${nameCandidate}" matches ${matches.length} employees — be more specific` }); continue; }

    const action = rawAction.replace(FILLER, '').trim();
    const actionLc = action.toLowerCase();
    const zone = zoneTags.find(z => actionLc.includes(z.toLowerCase())) || '';

    drafts.push({
      assignedTo: matches[0].uid,
      assignedToName: matches[0].name,
      title: action.charAt(0).toUpperCase() + action.slice(1),
      planReference: zone,
      sourceSegment: seg,
    });
  }
  return { drafts, unmatched };
}

// POST /api/voice/dispatch — parse into DRAFTS; nothing is assigned yet
router.post('/dispatch', authenticate, authorize('supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const { text, siteId, scheduledDate } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });
    if (!siteId) return res.status(400).json({ error: 'siteId is required' });

    const [empSnap, planSnap] = await Promise.all([
      db.collection('users').where('isActive', '==', true).get(),
      db.collection('plan_documents').where('siteId', '==', siteId).get(),
    ]);
    const employees = empSnap.docs.map(d => d.data()).filter(u => ['employee', 'supervisor'].includes(u.role));
    const zoneTags = [...new Set(planSnap.docs.flatMap(d => d.data().zoneTags || []))];

    const { drafts, unmatched } = parseDispatch(text, employees, zoneTags);

    const saved = [];
    for (const d of drafts) {
      const id = uuidv4();
      const draft = {
        id, siteId,
        ...d,
        scheduledDate: scheduledDate || new Date().toISOString().split('T')[0],
        createdBy: req.user.uid,
        createdAt: new Date().toISOString(),
      };
      await db.collection('task_drafts').doc(id).set(draft);
      saved.push(draft);
    }

    await logVoice({ kind: 'dispatch', input: text, siteId, userId: req.user.uid,
      parsed: saved.map(d => ({ assignedToName: d.assignedToName, title: d.title, planReference: d.planReference })),
      unmatchedCount: unmatched.length });

    res.json({
      message: saved.length ? `${saved.length} draft task(s) ready — confirm to dispatch` : 'Nothing could be parsed',
      drafts: saved,
      unmatched,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/voice/dispatch/confirm — only now do tasks go out
router.post('/dispatch/confirm', authenticate, authorize('supervisor', 'manager', 'admin'), async (req, res) => {
  try {
    const { draftIds } = req.body;
    if (!Array.isArray(draftIds) || !draftIds.length) return res.status(400).json({ error: 'draftIds array is required' });

    const created = [];
    for (const draftId of draftIds) {
      const doc = await db.collection('task_drafts').doc(draftId).get();
      if (!doc.exists) continue;
      const d = doc.data();

      const id = uuidv4();
      const now = new Date().toISOString();
      const task = {
        id, siteId: d.siteId, title: d.title, description: `Dispatched via briefing: "${d.sourceSegment}"`,
        assignedTo: d.assignedTo, assignedToName: d.assignedToName,
        assignedBy: req.user.uid, assignedByName: req.user.name || '',
        planReference: d.planReference || '', changeOrderId: null,
        scheduledDate: d.scheduledDate, status: 'assigned',
        acknowledgedAt: null, startedAt: null, completedAt: null, blockedReason: null,
        requiredEquipmentIds: [], requiredMaterials: [], estimatedHours: null,
        estimatedCost: { labor: 0, equipment: 0, materials: 0, total: 0 },
        reworkFlag: false, createdAt: now,
      };
      await db.collection('tasks').doc(id).set(task);
      await db.collection('task_drafts').doc(draftId).delete();
      created.push(task);

      try {
        const empDoc = await db.collection('users').doc(d.assignedTo).get();
        const token = empDoc.exists ? empDoc.data().fcmToken : null;
        if (token) await messaging.send({ token, notification: { title: '📋 New Task Assigned', body: task.title } });
      } catch {}
    }

    res.status(201).json({ message: `${created.length} task(s) dispatched`, tasks: created });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── QUERY ────────────────────────────────────────────────────────────────────
function classifyIntent(text) {
  const t = text.toLowerCase();
  if (/where('s| is)?|find|locate/.test(t) && !/budget|task/.test(t)) return 'material_location';
  if (/budget|spend|spent|cost this week|variance/.test(t)) return 'budget_status';
  if (/task/.test(t)) return 'task_status';
  if (/status|health|equipment|machine/.test(t)) return 'equipment_status';
  return 'unknown';
}

function ageText(iso) {
  const hrs = (Date.now() - new Date(iso)) / 3600000;
  if (hrs < 1) return `${Math.round(hrs * 60)} minutes ago`;
  if (hrs < 48) return `${Math.round(hrs)} hours ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

router.post('/query', authenticate, async (req, res) => {
  try {
    const { text, siteId } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });
    const intent = classifyIntent(text);
    let answer = null, source = null, data = null;

    if (intent === 'material_location') {
      const term = text.toLowerCase()
        .replace(/where('s| is)?|find|locate|the|a |is |\?/g, ' ')
        .replace(/\s+/g, ' ').trim();
      let q = db.collection('material_items').where('isActive', '==', true);
      if (siteId) q = q.where('siteId', '==', siteId);
      const snap = await q.get();
      const hits = snap.docs.map(d => d.data())
        .filter(mn => mn.description.toLowerCase().includes(term) || term.split(' ').every(w => mn.description.toLowerCase().includes(w)));
      if (!hits.length) {
        answer = `I couldn't find a material matching "${term}".`;
      } else {
        const mI = hits[0];
        if (mI.currentLocation) {
          const z = mI.currentLocation.zone;
          const loc = [z.area && `Area ${z.area}`, z.aisle && `Aisle ${z.aisle}`, z.row && `Row ${z.row}`].filter(Boolean).join(', ');
          answer = `${mI.description}: ${loc} — logged ${ageText(mI.currentLocation.loggedAt)} by ${mI.currentLocation.loggedByName || 'unknown'}. ${mI.qtyOnHand} ${mI.unitOfMeasure} on hand.`;
          source = { materialId: mI.id, ticketId: mI.currentLocation.ticketId };
        } else {
          answer = `${mI.description} has no logged location yet. ${mI.qtyOnHand} ${mI.unitOfMeasure} on hand.`;
          source = { materialId: mI.id };
        }
        data = { qtyOnHand: mI.qtyOnHand, location: mI.currentLocation?.zone || null };
      }
    } else if (intent === 'budget_status') {
      if (!['supervisor', 'accountant', 'manager', 'admin'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Budget data is restricted' });
      }
      if (!siteId) return res.status(400).json({ error: 'siteId is required for budget queries' });
      const b = await getWeeklyBudget(siteId);
      answer = `This week: $${b.actualTotal.toLocaleString()} spent of $${b.plannedTotal.toLocaleString()} planned` +
        (b.plannedTotal ? ` (${b.variance > 0 ? '$' + b.variance.toLocaleString() + ' over' : '$' + Math.abs(b.variance).toLocaleString() + ' under'}).` : ' (no plan set).') +
        ` Labor $${b.actualLaborCost.toLocaleString()}, equipment $${b.actualEquipmentCost.toLocaleString()}, materials $${b.actualMaterialCost.toLocaleString()}.`;
      source = { budgetId: b.id, computedAt: b.computedAt };
      data = b;
    } else if (intent === 'task_status') {
      const snap = await db.collection('tasks').where('assignedTo', '==', req.user.uid).get();
      const mine = snap.docs.map(d => d.data()).filter(t => t.status !== 'complete');
      answer = mine.length
        ? `You have ${mine.length} open task(s): ` + mine.map(t => `"${t.title}" (${t.status.replace('_', ' ')})`).join('; ')
        : 'You have no open tasks.';
      data = mine.map(t => ({ id: t.id, title: t.title, status: t.status }));
    } else if (intent === 'equipment_status') {
      const term = text.toLowerCase().replace(/status|health|of|the|equipment|machine|what('s| is)|how('s| is)|\?/g, ' ').replace(/\s+/g, ' ').trim();
      let q = db.collection('equipment').where('isActive', '==', true);
      if (siteId) q = q.where('siteId', '==', siteId);
      const snap = await q.get();
      const hits = snap.docs.map(d => d.data()).filter(e => e.name.toLowerCase().includes(term));
      if (!hits.length) answer = `No equipment matches "${term}".`;
      else {
        const e = hits[0];
        answer = `${e.name}: ${e.status.replace('_', ' ')}, ${e.currentHours || 0} hours` +
          (e.lastMaintenanceDate ? `, last maintenance ${e.lastMaintenanceDate}.` : '.');
        source = { equipmentId: e.id };
        data = { status: e.status, currentHours: e.currentHours || 0 };
      }
    } else {
      answer = 'I can answer: where a material is, budget status this week, your tasks, or equipment status. Try rephrasing.';
    }

    await logVoice({ kind: 'query', input: text, siteId: siteId || null, userId: req.user.uid, intent, answer });
    res.json({ intent, answer, source, data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
