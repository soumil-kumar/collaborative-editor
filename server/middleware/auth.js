const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'collab-editor-dev-secret-change-in-prod';
const JWT_EXPIRY = '24h';

/**
 * Signs a JWT token for the given user payload.
 */
function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

/**
 * Express middleware — verifies Bearer token from Authorization header.
 * Attaches decoded payload to req.user.
 */
function verifyToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = authHeader.slice(7);
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token expired or invalid' });
  }
}

/**
 * Verifies a JWT token string directly (used during WebSocket upgrade).
 * Returns the decoded payload, or throws on failure.
 */
function verifyTokenWS(token) {
  if (!token) throw new Error('No token provided');
  return jwt.verify(token, JWT_SECRET);
}

module.exports = { signToken, verifyToken, verifyTokenWS };
