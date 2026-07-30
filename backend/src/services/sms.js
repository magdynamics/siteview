// SMS dispatch (technical guideline-style upgrade, same pattern as nlp.js):
// active only when TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER
// are set in backend/.env. Without them, sendSMS logs and returns a
// { skipped: true } result instead of throwing, so the rest of the app
// keeps working without Twilio configured.

let client = null;
function getClient() {
  if (!isEnabled()) return null;
  if (!client) {
    const twilio = require('twilio');
    client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return client;
}

function isEnabled() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}

// Send one SMS. Returns { sent, skipped, error, sid }.
async function sendSMS(to, body) {
  if (!to) return { sent: false, skipped: true, error: 'No phone number on file' };
  if (!isEnabled()) {
    console.log(`[sms disabled] would send to ${to}: ${body}`);
    return { sent: false, skipped: true, error: 'Twilio not configured' };
  }
  try {
    const msg = await getClient().messages.create({ to, from: process.env.TWILIO_FROM_NUMBER, body });
    return { sent: true, skipped: false, sid: msg.sid };
  } catch (err) {
    return { sent: false, skipped: false, error: err.message };
  }
}

// Send the same message to a list of {id, name, phone} recipients.
// Returns per-recipient results so the caller can show who was actually texted.
async function sendBulkSMS(recipients, body) {
  const results = [];
  for (const r of recipients) {
    const result = await sendSMS(r.phone, body);
    results.push({ id: r.id, name: r.name, ...result });
  }
  return results;
}

module.exports = { isEnabled, sendSMS, sendBulkSMS };
