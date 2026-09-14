const bcrypt = require('bcryptjs');
const { z } = require('zod');
const store = require('../services/store');
const { signToken, sanitizeUser, ROLES } = require('../middlewares/auth');
const { logActivity, createNotification } = require('../services/activity');
const { asyncHandler } = require('../middlewares/errorHandler');
const crypto = require('crypto');
const { sendPasswordResetEmail } = require('../services/email');

function setSessionCookie(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('cab_token', token, {
    httpOnly: true,
    sameSite: isProd ? 'none' : 'lax',
    secure: isProd,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

const registerSchema = z.object({
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  email: z.string().email(),
  phone: z.string().min(8),
  password: z.string().min(8),
  companyName: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

exports.register = asyncHandler(async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Données invalides.', errors: parsed.error.issues });
  }
  const data = parsed.data;
  const existing = store.findOne('users', (u) => u.email.toLowerCase() === data.email.toLowerCase());
  if (existing) {
    return res.status(409).json({ success: false, message: 'Cet e-mail est déjà utilisé.' });
  }

  const passwordHash = await bcrypt.hash(data.password, 10);
  const user = await store.create('users', {
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email.toLowerCase(),
    phone: data.phone,
    passwordHash,
    role: ROLES.CLIENT,
    emailVerified: false,
    status: 'active',
    companyId: null,
    preferences: { emailNotifications: true },
  });

  /* clients collection supprimée — les clients sont identifiés par user.role === 'client' */

  await logActivity({
    userId: user.id,
    action: 'register',
    objectType: 'user',
    objectId: user.id,
    ip: req.ip,
  });

  const token = signToken(user);
  setSessionCookie(res, token);
  res.status(201).json({ success: true, user: sanitizeUser(user) });
});

exports.login = asyncHandler(async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, message: 'Identifiants invalides.' });
  }
  const { email, password } = parsed.data;
  const user = store.findOne('users', (u) => u.email.toLowerCase() === email.toLowerCase());
  if (!user || user.status === 'disabled') {
    return res.status(401).json({ success: false, message: 'E-mail ou mot de passe incorrect.' });
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ success: false, message: 'E-mail ou mot de passe incorrect.' });
  }

  await logActivity({
    userId: user.id,
    action: 'login',
    objectType: 'user',
    objectId: user.id,
    ip: req.ip,
  });

  setSessionCookie(res, signToken(user));
  res.json({ success: true, user: sanitizeUser(user) });
});

exports.logout = (_req, res) => {
  res.clearCookie('cab_token', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
  res.json({ success: true });
};

exports.me = asyncHandler(async (req, res) => {
  res.json({ success: true, user: sanitizeUser(req.user) });
});

exports.updateProfile = asyncHandler(async (req, res) => {
  const allowed = ['firstName', 'lastName', 'phone', 'address', 'photoUrl', 'preferences'];
  const patch = {};
  allowed.forEach((key) => {
    if (req.body[key] !== undefined) patch[key] = req.body[key];
  });
  const updated = await store.update('users', req.user.id, patch);
  await logActivity({
    userId: req.user.id,
    action: 'update_profile',
    objectType: 'user',
    objectId: req.user.id,
    ip: req.ip,
  });
  res.json({ success: true, user: sanitizeUser(updated) });
});

exports.forgotPassword = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Veuillez saisir un e-mail valide.' });
  }

  const user = store.findOne('users', (u) => u.email.toLowerCase() === email);
  if (!user) {
    return res.status(400).json({ success: false, message: 'E-mail introuvable dans la base de données.' });
  }

  const resetCode = String(Math.floor(100000 + Math.random() * 900000));
  await store.update('users', user.id, {
    resetToken: resetCode,
    resetTokenAt: new Date().toISOString(),
  });
  await createNotification({
    userId: user.id,
    title: 'Réinitialisation de mot de passe',
    content: 'Une demande de réinitialisation a été enregistrée. Contactez le cabinet si ce n’était pas vous.',
    category: 'security',
  });

  await sendPasswordResetEmail({ to: user.email, firstName: user.firstName, resetCode });

  res.json({
    success: true,
    message: 'Un code de vérification a été envoyé à votre e-mail.',
  });
});

exports.resetPassword = asyncHandler(async (req, res) => {
  const { email, newPassword, code, token } = req.body;
  const suppliedCode = String(code ?? token ?? '').trim();

  if (!email || !newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ success: false, message: 'Mot de passe invalide (min. 8 caractères).' });
  }
  if (!suppliedCode) {
    return res.status(400).json({ success: false, message: 'Code de vérification requis.' });
  }

  const user = store.findOne('users', (u) => u.email.toLowerCase() === String(email).toLowerCase());
  const expiresIn = (Number(process.env.PASSWORD_RESET_EXPIRES_MINUTES) || 30) * 60 * 1000;
  const storedToken = user?.resetToken ? String(user.resetToken) : '';
  const hexMatch = storedToken && suppliedCode && storedToken.length === suppliedCode.length && crypto.timingSafeEqual(Buffer.from(storedToken), Buffer.from(suppliedCode));
  const directMatch = storedToken && suppliedCode && storedToken === suppliedCode;
  const tokenMatches = Boolean(hexMatch || directMatch);
  const tokenExpired = !user?.resetTokenAt || Date.now() - new Date(user.resetTokenAt).getTime() > expiresIn;

  if (!user || !user.resetToken || !tokenMatches || tokenExpired) {
    return res.status(400).json({ success: false, message: 'Code de vérification invalide ou expiré.' });
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await store.update('users', user.id, {
    passwordHash,
    resetToken: null,
    resetTokenAt: null,
  });
  res.json({ success: true, message: 'Mot de passe mis à jour.' });
});

exports.verifyEmail = asyncHandler(async (req, res) => {
  const updated = await store.update('users', req.user.id, { emailVerified: true });
  res.json({ success: true, user: sanitizeUser(updated) });
});
