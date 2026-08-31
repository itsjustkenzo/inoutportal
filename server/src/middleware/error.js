export function notFound(req, res) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
export function errorHandler(err, req, res, next) {
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      message: 'Validation failed',
      errors: Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.message])),
    });
  }
  if (err.code === 11000) {
    return res.status(409).json({ message: `Duplicate value for ${Object.keys(err.keyPattern).join(', ')}` });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ message: `Malformed ${err.path}` });
  }

  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    message: status >= 500 ? 'Internal server error' : err.message,
    ...(process.env.NODE_ENV === 'development' && status >= 500 ? { detail: err.message } : {}),
  });
}

// Wraps async route handlers so rejections reach errorHandler.
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
