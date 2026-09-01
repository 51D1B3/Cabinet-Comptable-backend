const multer = require('multer');

const ALLOWED = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: (Number(process.env.UPLOAD_MAX_MB) || 10) * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(new Error('Type de fichier non autorisé.'));
    }
    cb(null, true);
  },
});

module.exports = { upload };
