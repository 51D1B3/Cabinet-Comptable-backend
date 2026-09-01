const store = require('../services/store');
const { asyncHandler } = require('../middlewares/errorHandler');
const { sanitizeUser, STAFF_ROLES } = require('../middlewares/auth');
const { logActivity, createNotification } = require('../services/activity');
const bcrypt = require('bcryptjs');
const { uploadFile, getPublicUrl } = require('../services/supabaseStorage');

/* ── Dashboard ── */
exports.getDashboard = asyncHandler(async (req, res) => {
  const staffIds  = new Set(store.findAll('users', (u) => STAFF_ROLES.includes(u.role)).map((u) => u.id));
  const unread    = store.findAll(
    'messages',
    (m) => !staffIds.has(m.senderId) && !m.readBy?.includes(req.user.id)
  ).length;
  const requests  = store.findAll('service_requests', (r) => r.status === 'new');
  /* Compte les clients réels (users avec rôle client) */
  const clientUsers = store.findAll('users', (u) => u.role === 'client');

  res.json({
    success: true,
    data: {
      clientsCount:  clientUsers.length,
      newRequests:   requests.length,
      articlesCount: store.findAll('articles', (a) => a.status === 'published').length,
      newMessages:   unread,
      recentRequests: store
        .findAll('service_requests')
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, 5),
    },
  });
});

/* ── Clients ── */
exports.listClients = asyncHandler(async (_req, res) => {
  const data = store
    .findAll('users', (u) => u.role === 'client')
    .map(sanitizeUser);
  res.json({ success: true, data });
});

/* ── Utilisateurs ── */
exports.listUsers = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: store.findAll('users').map(sanitizeUser) });
});

/* ── Staff ── */
exports.createStaffUser = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, phone, password, role, title, specialty } = req.body;
  if (!firstName || !lastName || !email || !password || !role) {
    return res.status(400).json({ success: false, message: 'Champs obligatoires manquants.' });
  }
  if (!STAFF_ROLES.includes(role)) {
    return res.status(400).json({ success: false, message: 'Rôle personnel invalide.' });
  }
  if (['admin', 'super_admin'].includes(role) && req.user.role !== 'super_admin') {
    return res.status(403).json({ success: false, message: 'Seul un super administrateur peut créer ce rôle.' });
  }
  const existing = store.findOne('users', (u) => u.email.toLowerCase() === email.toLowerCase());
  if (existing) return res.status(409).json({ success: false, message: 'E-mail déjà utilisé.' });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await store.create('users', {
    firstName, lastName,
    email: email.toLowerCase(),
    phone: phone || '',
    passwordHash, role,
    emailVerified: true,
    status: 'active',
    companyId: null,
    preferences: { emailNotifications: true },
  });

  res.status(201).json({ success: true, data: { user: sanitizeUser(user) } });
});

/* ── Demandes de service ── */
exports.listServiceRequests = asyncHandler(async (_req, res) => {
  const data = store
    .findAll('service_requests')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({ success: true, data });
});

exports.updateServiceRequestStatus = asyncHandler(async (req, res) => {
  const item = store.findById('service_requests', req.params.id);
  if (!item) return res.status(404).json({ success: false, message: 'Demande introuvable.' });
  const allowedStatuses = ['new', 'in_progress', 'completed', 'refused'];
  if (!allowedStatuses.includes(req.body.status)) {
    return res.status(400).json({ success: false, message: 'Statut invalide.' });
  }
  const updated = await store.update('service_requests', item.id, {
    status: req.body.status,
    responsibleId: req.body.responsibleId || item.responsibleId || req.user.id,
  });
  res.json({ success: true, data: updated });
});

exports.deleteServiceRequest = asyncHandler(async (req, res) => {
  const item = store.findById('service_requests', req.params.id);
  if (!item) return res.status(404).json({ success: false, message: 'Demande introuvable.' });
  await store.remove('service_requests', item.id);
  res.json({ success: true, message: 'Demande supprimée.' });
});

/* ── Messages de contact ── */
exports.listContactMessages = asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    data: store
      .findAll('contact_messages')
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
  });
});

exports.deleteContactMessage = asyncHandler(async (req, res) => {
  const item = store.findById('contact_messages', req.params.id);
  if (!item) return res.status(404).json({ success: false, message: 'Message introuvable.' });
  await store.remove('contact_messages', item.id);
  res.json({ success: true, message: 'Message supprimé.' });
});

/* ── Articles / Publications ── */
exports.createArticle = asyncHandler(async (req, res) => {
  const { title, summary, content, category, status, slug, imageUrl, software } = req.body;
  if (!title) {
    return res.status(400).json({ success: false, message: 'Titre requis.' });
  }
  const platformImageMap = {
    'Sage 100': '/sage.png',
    Odoo: '/odoo.png',
  };
  const image = req.file ? await uploadFile(req.file, 'articles') : null;
  const resolvedImageUrl = image ? getPublicUrl(image.storagePath) : imageUrl || platformImageMap[software] || platformImageMap['Sage 100'] || '';
  const article = await store.create('articles', {
    title,
    slug: slug || title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, ''),
    summary: summary || '',
    content: content || '-',
    category: category || 'Formation',
    software: software || 'Sage 100',
    authorId: req.user.id,
    authorName: `${req.user.firstName} ${req.user.lastName}`,
    image,
    imageUrl: resolvedImageUrl,
    status: status || 'published',
    publishedAt: new Date().toISOString(),
  });
  res.status(201).json({ success: true, data: article });
});

exports.updateArticle = asyncHandler(async (req, res) => {
  const article = store.findById('articles', req.params.id);
  if (!article) return res.status(404).json({ success: false, message: 'Article introuvable.' });
  const patch = { ...req.body };
  if (patch.status === 'published' && !article.publishedAt) {
    patch.publishedAt = new Date().toISOString();
  }
  const updated = await store.update('articles', article.id, patch);
  res.json({ success: true, data: updated });
});

exports.deleteArticle = asyncHandler(async (req, res) => {
  const article = store.findById('articles', req.params.id);
  if (!article) return res.status(404).json({ success: false, message: 'Publication introuvable.' });
  await store.remove('articles', article.id);
  res.json({ success: true, message: 'Publication supprimée.' });
});

/* ── Statistiques ── */
exports.getStats = asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    data: {
      clients:         store.findAll('users', (u) => u.role === 'client').length,
      articles:        store.findAll('articles', (a) => a.status === 'published').length,
      inscriptions:    store.findAll('inscriptions').length,
      serviceRequests: store.findAll('service_requests').length,
      contactMessages: store.findAll('contact_messages').length,
      staffCount:      store.findAll('users', (u) => STAFF_ROLES.includes(u.role)).length,
    },
  });
});

/* ── Paramètres ── */
exports.updateSettings = asyncHandler(async (req, res) => {
  const current = store.findById('settings', 'main') || store.findAll('settings')[0];
  if (!current) return res.status(404).json({ success: false, message: 'Paramètres introuvables.' });

  const allowed = ['cabinetName', 'tagline', 'phone', 'email', 'whatsapp', 'address', 'hours'];
  const patch = Object.fromEntries(allowed.filter((key) => req.body[key] !== undefined).map((key) => [key, req.body[key]]));

  if (req.body.adminEmail) {
    const adminEmail = String(req.body.adminEmail).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
      return res.status(400).json({ success: false, message: 'E-mail administrateur invalide.' });
    }
    const existing = store.findOne('users', (u) => u.id !== req.user.id && u.email.toLowerCase() === adminEmail);
    if (existing) {
      return res.status(409).json({ success: false, message: 'Cet e-mail est déjà utilisé par un autre compte.' });
    }
    const updatedUser = await store.update('users', req.user.id, { email: adminEmail });
    patch.email = patch.email || adminEmail;
    req.user.email = adminEmail;
    if (updatedUser) {
      req.user = updatedUser;
    }
  }

  const updated = await store.update('settings', current.id, patch);
  res.json({ success: true, data: updated });
});

/* ── Journal d'activité ── */
exports.getActivityLogs = asyncHandler(async (_req, res) => {
  const data = store
    .findAll('activity_logs')
    .sort((a, b) => String(b.createdAt || b.at).localeCompare(String(a.createdAt || a.at)))
    .slice(0, 200);
  res.json({ success: true, data });
});

/* ── Recherche ── */
exports.search = asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').toLowerCase().trim();
  if (!q) return res.json({ success: true, data: {} });
  const match = (v) => String(v || '').toLowerCase().includes(q);
  res.json({
    success: true,
    data: {
      clients:  store.findAll('users', (u) => u.role === 'client' && (match(u.firstName) || match(u.lastName) || match(u.email))).slice(0, 10).map(sanitizeUser),
      articles: store.findAll('articles', (a) => match(a.title) || match(a.summary)).slice(0, 10),
      requests: store.findAll('service_requests', (r) => match(r.need) || match(r.email)).slice(0, 10),
    },
  });
});
