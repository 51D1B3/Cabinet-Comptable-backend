const store = require('../services/store');
const { asyncHandler } = require('../middlewares/errorHandler');
const { logActivity, createNotification } = require('../services/activity');
const { sanitizeUser, STAFF_ROLES } = require('../middlewares/auth');
const { uploadFile } = require('../services/supabaseStorage');
const { sendContactNotification, sendContactAutoReply, sendAcademicRequestEmails } = require('../services/email');

const SERVICES = [
  { id: 'comptabilite', slug: 'comptabilite', name: 'Comptabilité', category: 'Comptabilité', description: 'Tenue comptable, bilans et états financiers adaptés à votre activité.', objectives: ['Fiabiliser les comptes', 'Respecter les échéances'], problems: ['Retards de saisie', 'Manque de visibilité'], advantages: ['Reporting clair', 'Suivi personnalisé'], process: ['Diagnostic', 'Mise en place', 'Suivi mensuel'] },
  { id: 'gestion-pilotage', slug: 'gestion-pilotage', name: 'Gestion & pilotage', category: 'Gestion', description: 'Des tableaux de bord utiles pour piloter votre entreprise avec confiance.', objectives: ['Suivre la performance', 'Anticiper la trésorerie'], problems: ['Décisions sans indicateurs', 'Prévisions incertaines'], advantages: ['Indicateurs adaptés', 'Alertes utiles'], process: ['Analyse', 'Paramétrage', 'Points réguliers'] },
  { id: 'fiscalite', slug: 'fiscalite', name: 'Fiscalité', category: 'Fiscalité', description: 'Vos déclarations et obligations fiscales suivies avec rigueur.', objectives: ['Sécuriser les déclarations', 'Réduire les risques'], problems: ['Échéances oubliées', 'Erreurs déclaratives'], advantages: ['Veille réglementaire', 'Calendrier partagé'], process: ['Collecte', 'Contrôle', 'Déclaration'] },
  { id: 'audit-conseil', slug: 'audit-conseil', name: 'Audit & conseil', category: 'Conseil', description: 'Un regard indépendant pour améliorer vos processus et vos décisions.', objectives: ['Identifier les risques', 'Améliorer les processus'], problems: ['Contrôles insuffisants', 'Coûts mal maîtrisés'], advantages: ['Recommandations concrètes', 'Plan d’action'], process: ['Cadrage', 'Audit', 'Restitution'] },
];

const SECTORS = ['Commerce & distribution', 'BTP & immobilier', 'Restauration & hôtellerie', 'Santé & cliniques', 'ONG & associations', 'Professions libérales', 'Agriculture & agro-industrie', 'Transport & logistique'];

exports.getServices = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: SERVICES });
});

exports.getServiceBySlug = asyncHandler(async (req, res) => {
  const service = SERVICES.find((item) => item.slug === req.params.slug);
  if (!service) return res.status(404).json({ success: false, message: 'Service introuvable.' });
  res.json({ success: true, data: service });
});

exports.getSectors = asyncHandler(async (_req, res) => {
  res.json({ success: true, data: SECTORS.map((name) => ({ id: name, name })) });
});

/* ── Settings ── */
exports.getSettings = asyncHandler(async (_req, res) => {
  const settings = store.findById('settings', 'main') || store.findAll('settings')[0];
  res.json({ success: true, data: settings });
});

/* ── Articles publics ── */
exports.getArticles = asyncHandler(async (_req, res) => {
  const data = store
    .findAll('articles', (a) => a.status === 'published')
    .sort((a, b) => String(b.publishedAt || b.createdAt).localeCompare(String(a.publishedAt || a.createdAt)));
  res.json({ success: true, data });
});

exports.getArticleBySlug = asyncHandler(async (req, res) => {
  const article = store.findOne('articles', (a) => a.slug === req.params.slug && a.status === 'published');
  if (!article) return res.status(404).json({ success: false, message: 'Article introuvable.' });
  res.json({ success: true, data: article });
});

/* ── Contact ── */
exports.createContact = asyncHandler(async (req, res) => {
  const { firstName, lastName, company, email, subject, message, type = 'contact' } = req.body;
  if (!firstName || !lastName || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Champs obligatoires manquants.' });
  }

  const attachment = req.file ? await uploadFile(req.file, 'contact') : null;
  const item = await store.create('contact_messages', {
    firstName, lastName,
    company: company || '',
    email,
    subject: subject || 'Contact',
    message: message || subject || 'Contact',
    status: 'new',
    consent: Boolean(req.body.consent),
    attachment,
  });

  const admins = store.findAll('users', (u) => ['admin', 'super_admin', 'director'].includes(u.role));
  await Promise.all(
    admins.map((admin) =>
      createNotification({
        userId: admin.id,
        title: 'Nouveau message de contact',
        content: `De : ${email} | ${firstName} ${lastName} — Objet : ${subject || 'Contact'}`,
        category: 'contact',
        link: '/admin/notifications',
        meta: { senderEmail: email, senderName: `${firstName} ${lastName}`, subject: subject || 'Contact' },
      })
    )
  );

  let emailSent = true;
  try {
    await Promise.all([
      sendContactNotification({ firstName, lastName, email, company, subject, message: item.message, type }),
      sendContactAutoReply({ to: email, firstName, type }),
    ]);
  } catch (error) {
    emailSent = false;
    console.error('E-mail contact non envoyé:', error.message);
  }

  res.status(201).json({ success: true, data: item, emailSent });
});

/* ── Demandes de service / devis / académique ── */
exports.createServiceRequest = asyncHandler(async (req, res) => {
  const { firstName, lastName, company, need, phone, email, type = 'service' } = req.body;

  if (!firstName || !lastName || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !need) {
    return res.status(400).json({ success: false, message: 'Champs obligatoires manquants.' });
  }

  const attachment = req.file ? await uploadFile(req.file, 'requests') : null;
  const item = await store.create('service_requests', {
    type: ['quote', 'academic'].includes(type) ? type : 'service',
    userId: req.user?.id || null,
    firstName, lastName,
    company: company || '',
    need,
    phone: phone || '',
    email,
    status: 'new',
    responsibleId: null,
    attachment,
  });

  const staff = store.findAll('users', (u) => STAFF_ROLES.includes(u.role));
  await Promise.all(
    staff.map((s) =>
      createNotification({
        userId: s.id,
        title: type === 'quote' ? 'Nouvelle demande de devis' : type === 'academic' ? 'Nouvelle demande académique' : 'Nouvelle demande de prestation',
        content: `De : ${email} | ${firstName} ${lastName} — ${need.slice(0, 80)}`,
        category: 'request',
        link: '/admin/notifications',
        meta: { senderEmail: email, senderName: `${firstName} ${lastName}`, type },
      })
    )
  );

  if (type === 'academic') {
    await sendAcademicRequestEmails({
      to: email,
      firstName,
      lastName,
      email,
      company,
      need,
    });
  }

  res.status(201).json({ success: true, data: item });
});

exports.getMyRequests = asyncHandler(async (req, res) => {
  const data = store
    .findAll('service_requests', (r) => r.userId === req.user.id)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({ success: true, data });
});

/* ── Notifications ── */
exports.getNotifications = asyncHandler(async (req, res) => {
  const data = store
    .findAll('notifications', (n) => n.userId === req.user.id)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  res.json({ success: true, data });
});

exports.markNotificationRead = asyncHandler(async (req, res) => {
  const n = store.findById('notifications', req.params.id);
  if (!n || n.userId !== req.user.id) {
    return res.status(404).json({ success: false, message: 'Notification introuvable.' });
  }
  const updated = await store.update('notifications', n.id, { read: true, readAt: new Date().toISOString() });
  res.json({ success: true, data: updated });
});

exports.markAllNotificationsRead = asyncHandler(async (req, res) => {
  const items = store.findAll('notifications', (n) => n.userId === req.user.id && !n.read);
  await Promise.all(items.map((n) => store.update('notifications', n.id, { read: true, readAt: new Date().toISOString() })));
  res.json({ success: true, message: 'Toutes les notifications ont été lues.' });
});

exports.deleteNotification = asyncHandler(async (req, res) => {
  const notification = store.findById('notifications', req.params.id);
  if (!notification || notification.userId !== req.user.id) {
    return res.status(404).json({ success: false, message: 'Notification introuvable.' });
  }
  await store.remove('notifications', notification.id);
  res.json({ success: true, message: 'Notification supprimée.' });
});

/* ── Conversations / Messages ── */
exports.getConversations = asyncHandler(async (req, res) => {
  const isStaff = STAFF_ROLES.includes(req.user.role);
  const convos = store.findAll('conversations', (c) => {
    if (isStaff) return true;
    return c.clientId === req.user.id || c.participantIds?.includes(req.user.id);
  });
  // Ajouter le compteur de messages non lus
  const data = convos.map((c) => {
    const unreadCount = store.findAll(
      'messages',
      (m) => m.conversationId === c.id && !STAFF_ROLES.includes(store.findById('users', m.senderId)?.role) && !m.readBy?.includes(req.user.id)
    ).length;
    return { ...c, unreadCount };
  });
  res.json({ success: true, data });
});

exports.createConversation = asyncHandler(async (req, res) => {
  const { subject, message } = req.body;
  if (!message) return res.status(400).json({ success: false, message: 'Message requis.' });

  const conversation = await store.create('conversations', {
    subject: subject || 'Échange avec le cabinet',
    clientId: req.user.id,
    participantIds: [req.user.id],
    status: 'open',
    lastMessageAt: new Date().toISOString(),
  });

  const msg = await store.create('messages', {
    conversationId: conversation.id,
    senderId: req.user.id,
    content: message,
    attachments: [],
    readBy: [req.user.id],
  });

  const staff = store.findAll('users', (u) => STAFF_ROLES.includes(u.role));
  await Promise.all(
    staff.map((s) =>
      createNotification({
        userId: s.id,
        title: 'Nouveau message client',
        content: message.slice(0, 100),
        category: 'message',
        link: '/admin/notifications',
      })
    )
  );

  res.status(201).json({ success: true, data: { conversation, message: msg } });
});

exports.getMessages = asyncHandler(async (req, res) => {
  const conversation = store.findById('conversations', req.params.id);
  if (!conversation) return res.status(404).json({ success: false, message: 'Conversation introuvable.' });
  const isStaff = STAFF_ROLES.includes(req.user.role);
  const allowed = isStaff || conversation.clientId === req.user.id || conversation.participantIds?.includes(req.user.id);
  if (!allowed) return res.status(403).json({ success: false, message: 'Accès refusé.' });

  const data = store
    .findAll('messages', (m) => m.conversationId === conversation.id)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  if (isStaff) {
    await Promise.all(
      data
        .filter((m) => m.senderId !== req.user.id && !m.readBy?.includes(req.user.id))
        .map((m) => store.update('messages', m.id, { readBy: [...(m.readBy || []), req.user.id] }))
    );
  }

  res.json({ success: true, data });
});

exports.sendMessage = asyncHandler(async (req, res) => {
  const conversation = store.findById('conversations', req.params.id);
  if (!conversation) return res.status(404).json({ success: false, message: 'Conversation introuvable.' });
  const isStaff = STAFF_ROLES.includes(req.user.role);
  const allowed = isStaff || conversation.clientId === req.user.id || conversation.participantIds?.includes(req.user.id);
  if (!allowed) return res.status(403).json({ success: false, message: 'Accès refusé.' });

  const content = req.body.content || req.body.message;
  if (!content) return res.status(400).json({ success: false, message: 'Message requis.' });

  const attachment = req.file ? await uploadFile(req.file, 'messages') : null;
  const msg = await store.create('messages', {
    conversationId: conversation.id,
    senderId: req.user.id,
    content,
    attachments: attachment ? [attachment] : [],
    readBy: [req.user.id],
  });

  await store.update('conversations', conversation.id, { lastMessageAt: new Date().toISOString() });

  const recipients = new Set();
  if (conversation.clientId && conversation.clientId !== req.user.id) recipients.add(conversation.clientId);
  if (!isStaff) {
    store.findAll('users', (u) => STAFF_ROLES.includes(u.role)).forEach((u) => recipients.add(u.id));
  }

  await Promise.all(
    [...recipients].map((userId) =>
      createNotification({
        userId,
        title: 'Nouveau message',
        content: content.slice(0, 100),
        category: 'message',
        link: isStaff ? '/client/messages' : '/admin/notifications',
      })
    )
  );

  res.status(201).json({ success: true, data: msg });
});

/* ── Dashboard client (simplifié) ── */
exports.getClientDashboard = asyncHandler(async (req, res) => {
  const requests = store
    .findAll('service_requests', (r) => r.userId === req.user.id)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const notifications = store.findAll('notifications', (n) => n.userId === req.user.id && !n.read);
  const conversations = store.findAll('conversations', (c) => c.clientId === req.user.id);

  res.json({
    success: true,
    data: {
      requests,
      unreadNotifications: notifications.length,
      openConversations: conversations.length,
      user: sanitizeUser(req.user),
    },
  });
});

/* ── Inscriptions aux formations ── */
exports.createInscription = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, phone, articleId, articleTitle } = req.body;

  if (!firstName || !lastName || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !articleId) {
    return res.status(400).json({ success: false, message: 'Prénom, nom, email et formation sont obligatoires.' });
  }

  const article = store.findById('articles', articleId);
  if (!article) {
    return res.status(404).json({ success: false, message: 'Formation introuvable.' });
  }

  const inscription = await store.create('inscriptions', {
    firstName, lastName,
    email: email.toLowerCase(),
    phone: phone || '',
    articleId,
    articleTitle: articleTitle || article.title,
    articleSlug: article.slug || '',
    status: 'pending',
  });

  const staff = store.findAll('users', (u) => STAFF_ROLES.includes(u.role));
  await Promise.all(
    staff.map((s) =>
      createNotification({
        userId: s.id,
        title: '🎓 Nouvelle inscription formation',
        content: `De : ${email} | ${firstName} ${lastName} — Formation : ${articleTitle || article.title}`,
        category: 'inscription',
        link: '/admin/notifications',
        meta: { senderEmail: email, senderName: `${firstName} ${lastName}`, formationTitle: articleTitle || article.title, articleId },
      })
    )
  );

  res.status(201).json({ success: true, data: inscription });
});

exports.listInscriptions = asyncHandler(async (_req, res) => {
  const inscriptions = store
    .findAll('inscriptions')
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  const grouped = {};
  for (const ins of inscriptions) {
    const key = ins.articleId;
    if (!grouped[key]) {
      grouped[key] = { articleId: ins.articleId, articleTitle: ins.articleTitle, count: 0, inscriptions: [] };
    }
    grouped[key].count += 1;
    grouped[key].inscriptions.push(ins);
  }

  res.json({
    success: true,
    data: {
      total: inscriptions.length,
      byFormation: Object.values(grouped).sort((a, b) => b.count - a.count),
      all: inscriptions,
    },
  });
});
