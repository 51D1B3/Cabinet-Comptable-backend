const jwt = require('jsonwebtoken');
const store = require('../services/store');
const { STAFF_ROLES, ADMIN_ROLES, ROLES } = require('../utils/seed');

function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      email: user.email,
      companyId: user.companyId || null,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

function sanitizeUser(user) {
  if (!user) return null;
  const { passwordHash, ...safe } = user;
  return safe;
}

function getToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  const cookies = req.headers.cookie || '';
  const token = cookies.match(/(?:^|;\s*)cab_token=([^;]+)/)?.[1];
  return token ? decodeURIComponent(token) : null;
}

async function authenticate(req, res, next) {
  try {
    const token = getToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: 'Authentification requise.' });
    }
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = store.findById('users', payload.sub);
    if (!user || user.status === 'disabled') {
      return res.status(401).json({ success: false, message: 'Session invalide.' });
    }
    req.user = user;
    req.auth = payload;
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Token invalide ou expiré.' });
  }
}

function optionalAuth(req, _res, next) {
  const token = getToken(req);
  if (!token) return next();
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = store.findById('users', payload.sub);
    if (user && user.status !== 'disabled') {
      req.user = user;
      req.auth = payload;
    }
  } catch {
    // ignore
  }
  next();
}

function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentification requise.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Accès refusé pour ce rôle.' });
    }
    next();
  };
}

function requireStaff(req, res, next) {
  if (!req.user || !STAFF_ROLES.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Accès réservé au personnel.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !ADMIN_ROLES.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Accès administrateur requis.' });
  }
  next();
}

function canAccessClientData(actor, clientId, companyId) {
  if (!actor) return false;
  if (STAFF_ROLES.includes(actor.role)) return true;
  if (actor.id === clientId) return true;
  if (companyId && actor.companyId === companyId) return true;
  return false;
}

module.exports = {
  signToken,
  sanitizeUser,
  getToken,
  authenticate,
  optionalAuth,
  requireRoles,
  requireStaff,
  requireAdmin,
  canAccessClientData,
  ROLES,
  STAFF_ROLES,
  ADMIN_ROLES,
};
