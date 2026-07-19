// ─────────────────────────────────────────────────────────────────────────────
// src/middleware/authMiddleware.js
// JWT Verification Barrier
//
// Sits in front of any protected route. Reads the Bearer token from the
// Authorization header, verifies its signature, and attaches the decoded
// payload to req.user so downstream controllers can read userId and role.
// ─────────────────────────────────────────────────────────────────────────────
const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers['authorization'];

  // Header must be present and in "Bearer <token>" format
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or malformed Authorization header. Expected: Bearer <token>',
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Attach user payload { userId, role, email } to the request object
    req.user = decoded;
    console.log(`[authMiddleware] ✅ Authenticated user: ${decoded.email} (${decoded.role})`);
    next();
  } catch (err) {
    // Differentiate between expired tokens and outright invalid signatures
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'TokenExpired',
        message: 'Your session has expired. Please log in again.',
      });
    }
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid token signature.',
    });
  }
};

module.exports = authMiddleware;
