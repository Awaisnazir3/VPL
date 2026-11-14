const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { encryptPassword, hashPassword, comparePassword } = require('../cryptoUtils');
const { provisionExtension } = require('../asteriskProvisioner');
const { authenticateToken, JWT_SECRET } = require('../middleware/auth');

/**
 * Assign next numeric sequential order_id starting at 2001
 */
async function getNextOrderId(connection) {
  const [rows] = await connection.query(
    'SELECT COALESCE(MAX(order_id), 2000) + 1 AS next_id FROM sip_accounts WHERE order_id >= 2000 FOR UPDATE'
  );
  return rows[0].next_id;
}

/**
 * POST /api/auth/register
 */
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Full Name, email, and password are required' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const cleanName = String(name).trim();
  const plainPassword = String(password).trim();

  if (plainPassword.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters long' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // 1. Validate email uniqueness
    const [existing] = await conn.query('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existing.length > 0) {
      await conn.rollback();
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    // 2. Query sip_accounts to assign the next numeric sequential order_id (starts at 2001)
    const orderId = await getNextOrderId(conn);

    // 3. Hash password and insert record into users
    const passwordHash = await hashPassword(plainPassword);
    const encryptedSipPass = encryptPassword(plainPassword);

    const [userResult] = await conn.query(
      'INSERT INTO users (name, email, password_hash, raw_sip_pass, balance) VALUES (?, ?, ?, ?, 10.00)',
      [cleanName, cleanEmail, passwordHash, encryptedSipPass]
    );
    const userId = userResult.insertId;

    // 4. Store order_id, user_id, and plain password in sip_accounts
    await conn.query(
      'INSERT INTO sip_accounts (user_id, order_id, sip_password, secret, status) VALUES (?, ?, ?, ?, "active")',
      [userId, orderId, plainPassword, plainPassword]
    );

    await conn.commit();

    // 5. Automatically push this newly created extension to Asterisk on 192.168.88.47
    let asteriskProvisioned = false;
    let asteriskMessage = '';
    try {
      await provisionExtension(orderId, plainPassword);
      asteriskProvisioned = true;
      asteriskMessage = 'Extension provisioned to Asterisk 192.168.88.47';
    } catch (astErr) {
      console.error(`[Asterisk Provisioning Error for ${orderId}]:`, astErr.message);
      asteriskMessage = 'User created; Asterisk sync error: ' + astErr.message;
    }

    // 6. Return JWT token and user profile
    const token = jwt.sign(
      { id: userId, email: cleanEmail, order_id: orderId, is_admin: false, role: 'user' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      message: 'Registration successful',
      token,
      user: {
        id: userId,
        name: cleanName,
        email: cleanEmail,
        order_id: orderId,
        sip_password: plainPassword,
        balance: 10.00,
        is_admin: false,
        role: 'user',
        sip_status: 'active',
        asterisk_provisioned: asteriskProvisioned,
        provision_status: asteriskMessage
      }
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('Registration Error:', err);
    return res.status(500).json({ error: 'Internal server error during registration' });
  } finally {
    if (conn) conn.release();
  }
});

/**
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const cleanEmail = String(email).trim().toLowerCase();

  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.password_hash, u.balance, u.is_admin, u.role,
              s.order_id, COALESCE(s.sip_password, s.secret) AS sip_password, s.status AS sip_status
       FROM users u
       LEFT JOIN sip_accounts s ON s.user_id = u.id
       WHERE u.email = ?
       LIMIT 1`,
      [cleanEmail]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = rows[0];
    const passwordValid = await comparePassword(password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isAdmin = Boolean(user.is_admin || user.role === 'admin');

    const token = jwt.sign(
      { id: user.id, email: user.email, order_id: user.order_id, is_admin: isAdmin, role: user.role || 'user' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        order_id: user.order_id,
        sip_password: user.sip_password,
        balance: parseFloat(user.balance || 0),
        phone: user.phone || '',
        address: user.address || '',
        is_admin: isAdmin,
        role: user.role || 'user',
        sip_status: user.sip_status,
        created_at: user.created_at
      }
    });
  } catch (err) {
    console.error('Login Error:', err);
    return res.status(500).json({ error: 'Internal server error during login' });
  }
});

/**
 * GET /api/auth/me
 */
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.address, u.balance, u.is_admin, u.role, u.created_at,
              s.order_id, COALESCE(s.sip_password, s.secret) AS sip_password, s.status AS sip_status
       FROM users u
       LEFT JOIN sip_accounts s ON s.user_id = u.id
       WHERE u.id = ?
       LIMIT 1`,
      [req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = rows[0];
    const isAdmin = Boolean(user.is_admin || user.role === 'admin');

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        order_id: user.order_id,
        sip_password: user.sip_password,
        balance: parseFloat(user.balance || 0),
        phone: user.phone || '',
        address: user.address || '',
        is_admin: isAdmin,
        role: user.role || 'user',
        sip_status: user.sip_status,
        created_at: user.created_at
      }
    });
  } catch (err) {
    console.error('User Me Error:', err);
    return res.status(500).json({ error: 'Failed to retrieve profile' });
  }
});

module.exports = router;
