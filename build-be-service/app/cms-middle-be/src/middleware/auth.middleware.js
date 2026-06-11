const jwt = require('jsonwebtoken');

/**
 * Middleware to verify JWT token from Authorization header
 */
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Expected "Bearer <token>"

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRETKEY || '12345');
    req.user = decoded;
    next();
  } catch (err) {
    console.error('[AUTH_ERROR]', err.message);
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

module.exports = authMiddleware;
