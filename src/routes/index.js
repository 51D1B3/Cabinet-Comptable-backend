const express = require('express');
const auth  = require('../controllers/authController');
const pub   = require('../controllers/publicController');
const admin = require('../controllers/adminController');
const { authenticate, requireStaff, requireAdmin } = require('../middlewares/auth');
const { upload } = require('../middlewares/upload');
const store = require('../services/store');

const router = express.Router();

/* ── Health ── */
router.get('/health', async (_req, res) => {
  const services = await store.getHealthStatus();
  const ok = Object.values(services).every((s) => s.ok);
  res.status(ok ? 200 : 503).json({ success: ok, status: ok ? 'operational' : 'degraded', services });
});

/* ── Auth ── */
router.post('/auth/login',           auth.login);
router.post('/auth/logout',          auth.logout);
router.post('/auth/forgot-password', auth.forgotPassword);
router.post('/auth/reset-password',  auth.resetPassword);
router.get('/auth/me',               authenticate, auth.me);
router.patch('/profile',             authenticate, auth.updateProfile);

/* ── Public ── */
router.get('/settings',          pub.getSettings);
router.get('/articles',          pub.getArticles);
router.get('/articles/:slug',    pub.getArticleBySlug);
router.get('/services',          pub.getServices);
router.get('/services/:slug',    pub.getServiceBySlug);
router.get('/sectors',            pub.getSectors);

router.post('/contact',          upload.single('attachment'), pub.createContact);
router.post('/requests',         upload.single('attachment'), pub.createServiceRequest);

router.get('/notifications',              authenticate, requireStaff, pub.getNotifications);
router.patch('/notifications/read-all',   authenticate, requireStaff, pub.markAllNotificationsRead);
router.patch('/notifications/:id/read',   authenticate, requireStaff, pub.markNotificationRead);
router.delete('/notifications/:id',       authenticate, requireStaff, pub.deleteNotification);

/* ── Inscriptions formations (sans compte) ── */
router.post('/inscriptions',         pub.createInscription);
router.get('/admin/inscriptions',    authenticate, requireStaff, pub.listInscriptions);

/* ── Notifications ── */

/* ── Admin ── */
router.get('/admin/dashboard',       authenticate, requireStaff, admin.getDashboard);
router.get('/admin/stats',           authenticate, requireStaff, admin.getStats);
router.get('/admin/activity-logs',   authenticate, requireAdmin, admin.getActivityLogs);
router.get('/admin/clients',         authenticate, requireStaff, admin.listClients);
router.get('/admin/users',           authenticate, requireAdmin, admin.listUsers);
router.post('/admin/staff',          authenticate, requireAdmin, admin.createStaffUser);

router.get('/admin/requests',              authenticate, requireStaff, admin.listServiceRequests);
router.patch('/admin/requests/:id/status', authenticate, requireStaff, admin.updateServiceRequestStatus);
router.delete('/admin/requests/:id',         authenticate, requireStaff, admin.deleteServiceRequest);
router.get('/admin/contact-messages',      authenticate, requireStaff, admin.listContactMessages);
router.delete('/admin/contact-messages/:id', authenticate, requireStaff, admin.deleteContactMessage);

router.post('/admin/articles',           authenticate, requireStaff, upload.single('image'), admin.createArticle);
router.patch('/admin/articles/:id',      authenticate, requireStaff, admin.updateArticle);
router.delete('/admin/articles/:id',     authenticate, requireStaff, admin.deleteArticle);

router.patch('/admin/settings',         authenticate, requireStaff, admin.updateSettings);

module.exports = router;
