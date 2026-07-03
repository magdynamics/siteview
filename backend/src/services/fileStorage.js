const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { storage } = require('./firebase');

// Storage driver abstraction. STORAGE_DRIVER=local writes files to
// backend/uploads/ and serves them via the Express /files route — used for
// the trial period until Firebase Storage (Blaze plan) is provisioned.
// Flip STORAGE_DRIVER=firebase to move new uploads to the cloud bucket;
// URLs already stored in Firestore keep working as long as their driver's
// backing store exists.

const DRIVER = process.env.STORAGE_DRIVER || 'local';
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');
const BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, '');

async function saveFile(relativePath, buffer, contentType) {
  if (DRIVER === 'firebase') {
    const token = uuidv4();
    const bucket = storage.bucket();
    const file = bucket.file(relativePath);
    await file.save(buffer, {
      metadata: { contentType, metadata: { firebaseStorageDownloadTokens: token } },
    });
    return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(relativePath)}?alt=media&token=${token}`;
  }

  // local driver — file names are server-constructed and contain UUIDs, so
  // the resulting URLs are capability URLs like Firebase's tokenized ones
  const safe = path.normalize(relativePath).replace(/^(\.\.[\\/])+/, '');
  const full = path.join(UPLOADS_DIR, safe);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buffer);
  return `${BASE_URL}/files/${safe.split(path.sep).join('/')}`;
}

module.exports = { saveFile, UPLOADS_DIR, DRIVER };
