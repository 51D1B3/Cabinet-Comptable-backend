const admin = require('firebase-admin');
const path = require('path');
const dns = require('dns');
const { getFirestore: getAdminFirestore } = require('firebase-admin/firestore');

if (dns.setDefaultResultOrder) dns.setDefaultResultOrder('ipv4first');

function getFirestore() {
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const hasInlineCredentials =
    process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY;

  if (!hasInlineCredentials && !serviceAccountPath) {
    return null;
  }

  let app = admin.getApps()[0];
  if (!app) {
    const credential = hasInlineCredentials
      ? admin.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        })
      : admin.cert(require(path.resolve(process.cwd(), serviceAccountPath)));
    app = admin.initializeApp({ credential });
  }

  return getAdminFirestore(app);
}

module.exports = { getFirestore };