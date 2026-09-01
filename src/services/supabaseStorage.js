const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const crypto = require('crypto');

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'cabcomptable-files';

let client = null;

function isConfigured() {
  return Boolean(
    supabaseUrl &&
    serviceRoleKey &&
    bucket &&
    !supabaseUrl.includes('remplacez-par') &&
    !serviceRoleKey.includes('remplacez-par')
  );
}

function getClient() {
  if (!isConfigured()) {
    throw new Error('Supabase Storage n\'est pas configuré. Définissez SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY.');
  }
  if (!client) client = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  return client;
}

function createStoragePath(file, folder = 'uploads') {
  const extension = path.extname(file.originalname).toLowerCase();
  return `${folder}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}${extension}`;
}

async function uploadFile(file, folder) {
  const storagePath = createStoragePath(file, folder);
  const { error } = await getClient().storage.from(bucket).upload(storagePath, file.buffer, {
    contentType: file.mimetype,
    upsert: false,
  });
  if (error) throw new Error(`Échec de l'envoi du fichier : ${error.message}`);
  return { bucket, storagePath, originalName: file.originalname, mimeType: file.mimetype, size: file.size };
}

async function getSignedUrl(storagePath, expiresIn = 3600) {
  const { data, error } = await getClient().storage.from(bucket).createSignedUrl(storagePath, expiresIn);
  if (error) throw new Error(`Impossible de générer le lien du fichier : ${error.message}`);
  return data.signedUrl;
}

function getPublicUrl(storagePath) {
  const { data } = getClient().storage.from(bucket).getPublicUrl(storagePath);
  return data.publicUrl;
}

module.exports = { uploadFile, getSignedUrl, getPublicUrl, isConfigured, bucket };
