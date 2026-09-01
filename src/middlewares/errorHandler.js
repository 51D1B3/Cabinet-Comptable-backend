function notFound(_req, res) {
  res.status(404).json({ success: false, message: 'Ressource introuvable.' });
}

function errorHandler(err, _req, res, _next) {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || 'Erreur serveur.',
    ...(process.env.NODE_ENV !== 'production' && err.details
      ? { details: err.details }
      : {}),
  });
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { notFound, errorHandler, asyncHandler };
