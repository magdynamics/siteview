const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    }),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
}

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });
const storage = admin.storage();
const auth = admin.auth();
const messaging = admin.messaging();

module.exports = { admin, db, storage, auth, messaging };
