// Claude-powered parsing for voice dispatch and queries (technical guideline §18
// "LLM upgrade path"). Active only when ANTHROPIC_API_KEY is set in backend/.env;
// routes/voice.js falls back to its rule-based parsers otherwise, so the backend
// runs unchanged without a key.

const MODEL = 'claude-opus-4-8';

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) {
    const Anthropic = require('@anthropic-ai/sdk');
    client = new Anthropic();
  }
  return client;
}

function isEnabled() {
  return !!process.env.ANTHROPIC_API_KEY;
}

// Parse a supervisor's briefing into task-assignment drafts. Returns the same
// { drafts, unmatched } shape as the rule-based parseDispatch in routes/voice.js.
async function parseDispatch(text, employees, zoneTags) {
  const anthropic = getClient();
  const roster = employees.map(e => ({ uid: e.uid, name: e.name }));

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    thinking: { type: 'adaptive' },
    system:
      'You parse a construction supervisor\'s spoken morning briefing into task assignments. ' +
      'Match each instruction to exactly one employee from the roster (tolerate nicknames, ' +
      'first names, and speech-to-text misspellings). If a name matches no one or more than ' +
      'one person, put that segment in unmatched with a short reason. Write each task title ' +
      'as a clear imperative sentence. If the instruction mentions a location matching one of ' +
      'the plan zone tags, set planReference to that exact tag, else "".',
    messages: [{
      role: 'user',
      content: JSON.stringify({ briefing: text, roster, zoneTags }),
    }],
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            assignments: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  employeeUid: { type: 'string' },
                  title: { type: 'string' },
                  planReference: { type: 'string' },
                  sourceSegment: { type: 'string' },
                },
                required: ['employeeUid', 'title', 'planReference', 'sourceSegment'],
                additionalProperties: false,
              },
            },
            unmatched: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  segment: { type: 'string' },
                  reason: { type: 'string' },
                },
                required: ['segment', 'reason'],
                additionalProperties: false,
              },
            },
          },
          required: ['assignments', 'unmatched'],
          additionalProperties: false,
        },
      },
    },
  });

  const textBlock = response.content.find(b => b.type === 'text');
  const parsed = JSON.parse(textBlock.text);

  const byUid = new Map(roster.map(r => [r.uid, r]));
  const drafts = [];
  const unmatched = [...parsed.unmatched];
  for (const a of parsed.assignments) {
    const emp = byUid.get(a.employeeUid);
    if (!emp) {
      // hallucination guard: uid must come from the roster we sent
      unmatched.push({ segment: a.sourceSegment, reason: 'Model returned an unknown employee' });
      continue;
    }
    drafts.push({
      assignedTo: emp.uid,
      assignedToName: emp.name,
      title: a.title,
      planReference: zoneTags.includes(a.planReference) ? a.planReference : '',
      sourceSegment: a.sourceSegment,
    });
  }
  return { drafts, unmatched };
}

// Classify a field query into one of the intents routes/voice.js can answer.
async function classifyIntent(text) {
  const anthropic = getClient();
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 256,
    system:
      'Classify a construction-site field query into exactly one intent: ' +
      'material_location (where is a material stored), budget_status (spend/variance this week), ' +
      'task_status (the speaker\'s assigned tasks), equipment_status (machine condition/hours), ' +
      'or unknown.',
    messages: [{ role: 'user', content: text }],
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            intent: {
              type: 'string',
              enum: ['material_location', 'budget_status', 'task_status', 'equipment_status', 'unknown'],
            },
          },
          required: ['intent'],
          additionalProperties: false,
        },
      },
    },
  });
  const textBlock = response.content.find(b => b.type === 'text');
  return JSON.parse(textBlock.text).intent;
}

module.exports = { isEnabled, parseDispatch, classifyIntent };
