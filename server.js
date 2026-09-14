require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { ensureDataReady } = require('./src/services/store');
const routes = require('./src/routes');
const { errorHandler, notFound } = require('./src/middlewares/errorHandler');

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:3000',
].filter(Boolean);

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin non autorisée par CORS'));
    },
    credentials: true,
  })
);
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  res.cookie = (name, value, options = {}) => {
    const attributes = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path || '/'}`];
    if (options.httpOnly) attributes.push('HttpOnly');
    if (options.sameSite) attributes.push(`SameSite=${options.sameSite}`);
    if (options.secure) attributes.push('Secure');
    if (options.maxAge) attributes.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
    res.append('Set-Cookie', attributes.join('; '));
  };
  res.clearCookie = (name, options = {}) => {
    res.append('Set-Cookie', `${name}=; Path=${options.path || '/'}; Max-Age=0; HttpOnly; SameSite=${options.sameSite || 'lax'}`);
  };
  next();
});

app.use(
  '/api/',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 400,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Trop de requêtes, réessayez plus tard.' },
  })
);

app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'API CabComptable opérationnelle', version: '1.0.0' });
});

app.use('/api/v1', routes);
app.use(notFound);
app.use(errorHandler);

async function start() {
  await ensureDataReady();
  app.listen(PORT, () => {
    console.log(`✅ API Cabinet Comptable sur http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Échec démarrage:', err);
  process.exit(1);
});
