const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getFirestore } = require('../config/firebase');
const { isConfigured: isSupabaseConfigured } = require('./supabaseStorage');

const DATA_DIR = path.join(__dirname, '../../data');
const DATA_FILE = path.join(DATA_DIR, 'db.json');

/*
  Collections réellement utilisées par le projet.
  Supprimées car plus aucune route/controller ne les utilise :
  - companies, staff, roles, sectors, services (pas de routes actives)
  - dossiers, documents, document_requests (pages client supprimées)
  - tasks, quotes, invoices, reports (pages supprimées)
  - appointments (option supprimée)
  - faqs, testimonials (pages supprimées)
*/
const COLLECTIONS = [
  'users',
  'clients',
  'articles',
  'inscriptions',
  'conversations',
  'messages',
  'notifications',
  'activity_logs',
  'settings',
  'service_requests',
  'contact_messages',
];

let db = null;
let writeQueue = Promise.resolve();
let firestore = null;

function emptyDb() {
  const data = {};
  COLLECTIONS.forEach((c) => { data[c] = []; });
  data.settings = [
    {
      id: 'main',
      cabinetName: 'Cabinet Comptable',
      tagline: 'Votre partenaire de confiance pour la comptabilité et la fiscalité',
      phone: '+22376928012',
      email: 'hd684500@gmail.com',
      whatsapp: '+22376928012',
      address: 'Kalanban Coura, Bamako, Mali',
      hours: 'Lun–Ven 8h–17h',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];
  return data;
}

function loadFromDisk() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    db = emptyDb();
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
    return;
  }
  db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  /* S'assurer que toutes les collections actives existent */
  COLLECTIONS.forEach((c) => {
    if (!db[c]) db[c] = c === 'settings' ? emptyDb().settings : [];
  });
}

function persist() {
  writeQueue = writeQueue.then(() => {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
    if (!firestore) return null;

    return Promise.all(
      COLLECTIONS.map(async (collectionName) => {
        const snapshot = await firestore.collection(collectionName).get();
        const expectedIds = new Set(db[collectionName].map((item) => item.id));
        const batch = firestore.batch();
        snapshot.docs.forEach((doc) => {
          if (!expectedIds.has(doc.id)) batch.delete(doc.ref);
        });
        db[collectionName].forEach((item) => {
          batch.set(firestore.collection(collectionName).doc(item.id), item);
        });
        await batch.commit();
      })
    );
  });
  return writeQueue;
}

async function ensureDataReady() {
  firestore = getFirestore();
  if (!firestore) {
    loadFromDisk();
  } else {
    db = emptyDb();
    const collections = await Promise.all(
      COLLECTIONS.map(async (c) => [c, await firestore.collection(c).get()])
    );
    collections.forEach(([c, snapshot]) => {
      db[c] = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    });
    console.log('✅ Stockage Firestore activé.');
  }
  const { seedIfEmpty } = require('../utils/seed');
  await seedIfEmpty(module.exports);
}

async function getHealthStatus() {
  const status = {
    server:   { ok: true,            label: 'Serveur API' },
    database: { ok: false,           label: firestore ? 'Firestore' : 'JSON local' },
    storage:  { ok: isSupabaseConfigured(), label: 'Supabase Storage' },
  };

  if (!firestore) {
    status.database.ok = Boolean(db);
    return status;
  }

  try {
    await firestore.collection('settings').limit(1).get();
    status.database.ok = true;
  } catch (err) {
    status.database.error = err.message;
  }
  return status;
}

function getCollection(name) {
  if (!db[name]) throw new Error(`Collection inconnue : ${name}`);
  return db[name];
}

function findAll(name, filterFn) {
  const items = getCollection(name);
  return filterFn ? items.filter(filterFn) : [...items];
}

function findById(name, id) {
  return getCollection(name).find((item) => item.id === id) || null;
}

function findOne(name, filterFn) {
  return getCollection(name).find(filterFn) || null;
}

async function create(name, data) {
  const now = new Date().toISOString();
  const item = {
    id: data.id || uuidv4(),
    ...data,
    createdAt: data.createdAt || now,
    updatedAt: now,
  };
  getCollection(name).push(item);
  await persist();
  return item;
}

async function update(name, id, patch) {
  const items = getCollection(name);
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return null;
  items[index] = { ...items[index], ...patch, id, updatedAt: new Date().toISOString() };
  await persist();
  return items[index];
}

async function remove(name, id) {
  const items = getCollection(name);
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return false;
  items.splice(index, 1);
  await persist();
  return true;
}

async function softDelete(name, id) {
  return update(name, id, { status: 'disabled', disabledAt: new Date().toISOString() });
}

module.exports = {
  COLLECTIONS,
  ensureDataReady,
  getHealthStatus,
  findAll,
  findById,
  findOne,
  create,
  update,
  remove,
  softDelete,
  persist,
  getDb: () => db,
};
