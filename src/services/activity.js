const store = require('../services/store');

async function logActivity({
  userId,
  action,
  objectType,
  objectId,
  result = 'success',
  meta = {},
  ip,
}) {
  return store.create('activity_logs', {
    userId: userId || null,
    action,
    objectType,
    objectId: objectId || null,
    result,
    meta,
    ip: ip || null,
    at: new Date().toISOString(),
  });
}

async function createNotification({
  userId,
  title,
  content,
  category,
  link = '',
  meta = {},
}) {
  return store.create('notifications', {
    userId,
    title,
    content,
    category,
    link,
    meta,
    read: false,
    readAt: null,
  });
}

module.exports = { logActivity, createNotification };
