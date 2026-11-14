const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'vpl_super_secret_jwt_key_2026_voip';

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = decoded;
    next();
  });
}

async function requireAdmin(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.user.is_admin || req.user.role === 'admin') {
    return next();
  }

  try {
    const pool = require('../db');
    const [rows] = await pool.query('SELECT is_admin, role FROM users WHERE id = ?', [req.user.id]);
    if (rows.length > 0 && (rows[0].is_admin || rows[0].role === 'admin')) {
      req.user.is_admin = 1;
      req.user.role = rows[0].role || 'admin';
      return next();
    }
    return res.status(403).json({ error: 'Admin privileges required' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to verify admin privileges' });
  }
}

module.exports = {
  authenticateToken,
  requireAdmin,
  JWT_SECRET
};

