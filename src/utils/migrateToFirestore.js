require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getFirestore } = require('../config/firebase');
const { COLLECTIONS } = require('../services/store');

async function migrate() {
  const firestore = getFirestore();
  if (!firestore) {
    throw new Error('Variables Firebase manquantes dans backend/.env');
  }

  const file = path.join(__dirname, '../../data/db.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  let operationCount = 0;
  let batch = firestore.batch();

  async function commitBatch() {
    if (!operationCount) return;
    await batch.commit();
    operationCount = 0;
    batch = firestore.batch();
  }

  for (const collectionName of COLLECTIONS) {
    for (const item of data[collectionName] || []) {
      if (!item.id) continue;
      batch.set(firestore.collection(collectionName).doc(item.id), item);
      operationCount += 1;
      if (operationCount === 450) await commitBatch();
    }
  }

  await commitBatch();
  console.log('Migration Firestore terminée.');
}

migrate().catch((error) => {
  console.error('Échec migration Firestore:', error.message);
  process.exitCode = 1;
});