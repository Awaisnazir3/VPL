const express = require('express');
const router = express.Router();
const pool = require('../db');
const { hashPassword, encryptPassword } = require('../cryptoUtils');
const { provisionExtension, unprovisionExtension, syncDidRoutes } = require('../asteriskProvisioner');
const { authenticateToken, requireAdmin } = require('../middleware/auth');


/**
 * Helper to sync all active DID routes in database to Asterisk extensions_vpl.conf
 */
async function pushAllDidRoutesToAsterisk() {
  try {
    const [rows] = await pool.query(`
      SELECT ud.id, ud.forward_type, ud.forward_destination, ud.voicemail_enabled, ud.voicemail_timeout, idid.did_number
      FROM user_dids ud
      JOIN inventory_dids idid ON idid.id = ud.did_id
      WHERE ud.is_active = 1
    `);
    if (typeof syncDidRoutes === 'function') {
      await syncDidRoutes(rows);
    }
  } catch (err) {
    console.error('[Admin DID Sync Failed]:', err.message);
  }
}

// Protect all admin routes with JWT and Admin guard
router.use(authenticateToken);
router.use(requireAdmin);

/**
 * GET /api/admin/global-search?q=...
 * Global omni-search matching Customer ID, DID Number, Name, Email, or SIP Extension
 */
router.get('/global-search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) {
    return res.json({ customers: [], dids: [], total: 0 });
  }

  const numericId = parseInt(q, 10);
  const isNumeric = !isNaN(numericId) && numericId > 0;
  const term = `%${q}%`;
  const cleanNum = `%${q.replace(/[^0-9]/g, '')}%`;

  try {
    // 1. Search customers by ID, name, email, or SIP extension
    let userQuery = `
      SELECT u.id, u.name, u.email, u.balance, u.role, u.is_admin, u.created_at,
             s.order_id, COALESCE(s.status, 'active') AS sip_status,
             (SELECT COUNT(*) FROM user_dids ud WHERE ud.user_id = u.id AND ud.is_active = 1) AS allocated_dids
      FROM users u
      LEFT JOIN sip_accounts s ON s.user_id = u.id
      WHERE u.name LIKE ? OR u.email LIKE ? OR s.order_id LIKE ?
    `;
    let userParams = [term, term, term];

    if (isNumeric) {
      userQuery += ` OR u.id = ?`;
      userParams.push(numericId);
    }
    userQuery += ` ORDER BY u.id DESC LIMIT 15`;

    const [matchedUsers] = await pool.query(userQuery, userParams);

    // 2. Search DIDs by number, country, destination, or assigned customer
    const [matchedDids] = await pool.query(`
      SELECT 
        d.id, d.did_number, d.country, d.monthly_cost, d.status,
        ud.id AS user_did_id, ud.user_id, ud.forward_type, ud.forward_destination,
        ud.voicemail_enabled, ud.voicemail_timeout,
        u.name AS owner_name, u.email AS owner_email, u.balance AS owner_balance,
        s.order_id AS owner_ext
      FROM inventory_dids d
      LEFT JOIN user_dids ud ON ud.did_id = d.id AND ud.is_active = 1
      LEFT JOIN users u ON u.id = ud.user_id
      LEFT JOIN sip_accounts s ON s.user_id = u.id
      WHERE d.did_number LIKE ? 
         OR d.country LIKE ? 
         OR ud.forward_destination LIKE ?
         OR u.name LIKE ?
      ORDER BY d.status ASC, d.id DESC
      LIMIT 15
    `, [term, term, term, term]);

    return res.json({
      customers: matchedUsers,
      dids: matchedDids,
      total: matchedUsers.length + matchedDids.length
    });
  } catch (err) {
    console.error('[Admin] Global search error:', err);
    return res.status(500).json({ error: err.message });
  }
});


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
 * GET /api/admin/users
 * Returns all users joined with their sip_accounts and global summary stats
 */
router.get('/users', async (req, res) => {
  try {
    const [users] = await pool.query(`
      SELECT 
        u.id, 
        u.name, 
        u.email, 
        u.phone,
        u.address,
        u.balance, 
        u.is_admin, 
        u.role, 
        u.created_at,
        s.order_id, 
        COALESCE(s.sip_password, s.secret) AS sip_password,
        COALESCE(s.status, 'active') AS sip_status,
        (SELECT COUNT(*) FROM user_dids ud WHERE ud.user_id = u.id AND ud.is_active = 1) AS allocated_dids
      FROM users u
      LEFT JOIN sip_accounts s ON s.user_id = u.id
      ORDER BY u.id DESC
    `);

    // System summary metrics
    const [summaryRows] = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM users) AS total_users,
        (SELECT COUNT(*) FROM sip_accounts WHERE status = 'active') AS active_extensions,
        (SELECT COALESCE(SUM(balance), 0) FROM users) AS total_balance,
        (SELECT COUNT(*) FROM user_dids WHERE is_active = 1) AS total_dids_allocated,
        (SELECT COUNT(*) FROM balance_requests WHERE status = 'pending') AS pending_requests
    `);

    const summary = summaryRows[0] || {
      total_users: users.length,
      active_extensions: users.filter(u => u.sip_status === 'active').length,
      total_balance: users.reduce((acc, u) => acc + parseFloat(u.balance || 0), 0),
      total_dids_allocated: 0,
      pending_requests: 0
    };

    return res.json({
      users: users.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone || '',
        address: u.address || '',
        order_id: u.order_id,
        sip_username: u.order_id ? String(u.order_id) : '--',
        sip_password: u.sip_password || '',
        balance: parseFloat(u.balance || 0),
        sip_status: u.sip_status,
        is_admin: Boolean(u.is_admin),
        role: u.role || 'user',
        allocated_dids: u.allocated_dids || 0,
        created_at: u.created_at
      })),
      summary: {
        total_users: Number(summary.total_users),
        active_extensions: Number(summary.active_extensions),
        total_balance: parseFloat(summary.total_balance || 0),
        total_dids_allocated: Number(summary.total_dids_allocated),
        pending_requests: Number(summary.pending_requests || 0)
      }
    });
  } catch (err) {
    console.error('[Admin] Fetch users error:', err);
    return res.status(500).json({ error: 'Failed to retrieve users' });
  }
});

/**
 * POST /api/admin/users
 * Manual user creation + Asterisk provisioning
 */
router.post('/users', async (req, res) => {
  const { name, email, password, initial_balance, is_admin, status } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  const cleanName = String(name).trim();
  const plainPassword = String(password).trim();
  const balance = parseFloat(initial_balance) || 10.00;
  const adminFlag = is_admin ? 1 : 0;
  const userRole = adminFlag ? 'admin' : 'user';
  const sipStatus = status === 'suspended' ? 'suspended' : 'active';

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // Check email uniqueness
    const [existing] = await conn.query('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existing.length > 0) {
      await conn.rollback();
      return res.status(409).json({ error: 'An account with this email already exists' });
    }

    // Auto-assign next sequential order_id
    const orderId = await getNextOrderId(conn);

    const passwordHash = await hashPassword(plainPassword);
    const encryptedSipPass = encryptPassword(plainPassword);

    const [userRes] = await conn.query(
      'INSERT INTO users (name, email, password_hash, raw_sip_pass, balance, is_admin, role) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [cleanName, cleanEmail, passwordHash, encryptedSipPass, balance, adminFlag, userRole]
    );
    const userId = userRes.insertId;

    await conn.query(
      'INSERT INTO sip_accounts (user_id, order_id, sip_password, secret, status) VALUES (?, ?, ?, ?, ?)',
      [userId, orderId, plainPassword, plainPassword, sipStatus]
    );

    // Sync to Kamailio subscriber table
    try {
      const defaultDomain = '192.168.88.47';
      await conn.query(
        `INSERT INTO subscriber (username, domain, password) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE password = VALUES(password)`,
        [String(orderId), defaultDomain, plainPassword]
      );
      console.log(`[Admin] Kamailio subscriber created for username ${orderId}`);
    } catch (subErr) {
      console.warn(`[Admin] Subscriber insert warning:`, subErr.message);
    }

    await conn.commit();

    // Auto-provision on Asterisk
    let asteriskStatus = 'Provisioned';
    try {
      await provisionExtension(orderId, plainPassword);
    } catch (astErr) {
      console.warn(`[Admin] Asterisk provisioning warning for ${orderId}:`, astErr.message);
      asteriskStatus = `Warning: ${astErr.message}`;
    }

    return res.status(201).json({
      message: 'User created successfully',
      user: {
        id: userId,
        name: cleanName,
        email: cleanEmail,
        order_id: orderId,
        sip_username: String(orderId),
        sip_password: plainPassword,
        balance,
        is_admin: Boolean(adminFlag),
        role: userRole,
        sip_status: sipStatus,
        asterisk_status: asteriskStatus
      }
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('[Admin] Create user error:', err);
    return res.status(500).json({ error: 'Failed to create user: ' + err.message });
  } finally {
    if (conn) conn.release();
  }
});

/**
 * PUT /api/admin/users/:id
 * Update user details and sync with Asterisk if credentials changed
 */
router.put('/users/:id', async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const { name, email, phone, address, sip_password, status, is_admin, balance } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [userRows] = await conn.query(
      `SELECT u.id, u.email, s.order_id, COALESCE(s.sip_password, s.secret) AS current_pass
       FROM users u
       LEFT JOIN sip_accounts s ON s.user_id = u.id
       WHERE u.id = ?`,
      [userId]
    );

    if (userRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'User not found' });
    }

    const current = userRows[0];
    const orderId = current.order_id;
    let passwordChanged = false;

    // Check email uniqueness if email changed
    if (email && email.toLowerCase() !== current.email.toLowerCase()) {
      const [emailCheck] = await conn.query('SELECT id FROM users WHERE email = ? AND id != ?', [email.toLowerCase(), userId]);
      if (emailCheck.length > 0) {
        await conn.rollback();
        return res.status(409).json({ error: 'Email already in use by another user' });
      }
      await conn.query('UPDATE users SET email = ? WHERE id = ?', [email.toLowerCase().trim(), userId]);
    }

    if (name) {
      await conn.query('UPDATE users SET name = ? WHERE id = ?', [name.trim(), userId]);
    }
    if (typeof phone !== 'undefined') {
      await conn.query('UPDATE users SET phone = ? WHERE id = ?', [phone ? phone.trim() : null, userId]);
    }
    if (typeof address !== 'undefined') {
      await conn.query('UPDATE users SET address = ? WHERE id = ?', [address ? address.trim() : null, userId]);
    }
    if (typeof balance !== 'undefined') {
      const b = parseFloat(balance);
      if (!isNaN(b)) {
        await conn.query('UPDATE users SET balance = ? WHERE id = ?', [b, userId]);
      }
    }

    if (typeof is_admin !== 'undefined') {
      const flag = is_admin ? 1 : 0;
      await conn.query('UPDATE users SET is_admin = ?, role = ? WHERE id = ?', [flag, flag ? 'admin' : 'user', userId]);
    }

    let finalPass = current.current_pass;
    if (sip_password && sip_password.trim() !== '' && sip_password.trim() !== current.current_pass) {
      passwordChanged = true;
      finalPass = sip_password.trim();
      const hash = await hashPassword(finalPass);
      const enc = encryptPassword(finalPass);
      await conn.query('UPDATE users SET password_hash = ?, raw_sip_pass = ? WHERE id = ?', [hash, enc, userId]);
      await conn.query('UPDATE sip_accounts SET sip_password = ?, secret = ? WHERE user_id = ?', [finalPass, finalPass, userId]);
    }

    if (status && (status === 'active' || status === 'suspended')) {
      await conn.query('UPDATE sip_accounts SET status = ? WHERE user_id = ?', [status, userId]);
    }

    await conn.commit();

    // If password changed and order_id exists, sync to Asterisk
    if (passwordChanged && orderId) {
      try {
        await conn.query(
          'UPDATE subscriber SET password = ? WHERE username = ?',
          [finalPass, String(orderId)]
        );
        console.log(`[Admin] Kamailio subscriber updated for username ${orderId}`);
      } catch (subErr) {
        console.warn(`[Admin] Subscriber table update warning:`, subErr.message);
      }

      try {
        await provisionExtension(orderId, finalPass);
        console.log(`[Admin] Asterisk updated for extension ${orderId} with new secret`);
      } catch (astErr) {
        console.warn(`[Admin] Asterisk sync warning for ${orderId}:`, astErr.message);
      }
    }

    return res.json({
      message: 'User updated successfully',
      password_changed: passwordChanged
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('[Admin] Update user error:', err);
    return res.status(500).json({ error: 'Failed to update user: ' + err.message });
  } finally {
    if (conn) conn.release();
  }
});

/**
 * PUT /api/admin/users/:id/balance
 * Update or adjust balance for a user
 */
router.put('/users/:id/balance', async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const { type, amount, balance } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }

  try {
    const [rows] = await pool.query('SELECT id, balance, name FROM users WHERE id = ?', [userId]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    let newBalance;
    const currentBalance = parseFloat(rows[0].balance || 0);

    let delta = 0;
    if (type === 'adjust') {
      delta = parseFloat(amount);
      if (isNaN(delta)) return res.status(400).json({ error: 'Invalid adjustment amount' });
      newBalance = Math.max(0, currentBalance + delta);
    } else {
      const explicit = parseFloat(typeof balance !== 'undefined' ? balance : amount);
      if (isNaN(explicit) || explicit < 0) return res.status(400).json({ error: 'Invalid balance amount' });
      newBalance = explicit;
      delta = newBalance - currentBalance;
    }

    await pool.query('UPDATE users SET balance = ? WHERE id = ?', [newBalance.toFixed(2), userId]);

    // Log to billing_ledger
    const noteText = (req.body.reason || req.body.notes || (delta >= 0 ? 'Admin Manual Credit' : 'Admin Manual Debit')).trim();
    const ledgerDesc = `${noteText} (${delta >= 0 ? '+' : ''}$${delta.toFixed(2)})`;
    await pool.query(
      `INSERT INTO billing_ledger (user_id, type, amount, balance_before, balance_after, description, reference_type, created_by, created_at)
       VALUES (?, 'ADMIN_ADJUSTMENT', ?, ?, ?, ?, 'admin', ?, NOW())`,
      [
        userId,
        Math.abs(delta),
        currentBalance,
        newBalance,
        ledgerDesc,
        req.user.id
      ]
    );

    return res.json({
      message: 'Balance updated successfully',
      user_id: userId,
      previous_balance: currentBalance,
      new_balance: parseFloat(newBalance.toFixed(2))
    });
  } catch (err) {
    console.error('[Admin] Update balance error:', err);
    return res.status(500).json({ error: 'Failed to update balance' });
  }
});

/**
 * DELETE /api/admin/users/:id
 * Delete user + release DIDs + unprovision from Asterisk
 */
router.delete('/users/:id', async (req, res) => {
  const userId = parseInt(req.params.id, 10);

  if (!userId) {
    return res.status(400).json({ error: 'Invalid user ID' });
  }

  // Prevent admin from deleting their own account
  if (req.user && req.user.id === userId) {
    return res.status(400).json({ error: 'Cannot delete your own active admin account' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [userRows] = await conn.query(
      `SELECT u.id, u.name, u.email, s.order_id 
       FROM users u 
       LEFT JOIN sip_accounts s ON s.user_id = u.id 
       WHERE u.id = ?`,
      [userId]
    );

    if (userRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userRows[0];
    const orderId = user.order_id;

    // Release allocated DIDs back to inventory
    await conn.query(
      'UPDATE inventory_dids SET status = "available" WHERE id IN (SELECT did_id FROM user_dids WHERE user_id = ?)',
      [userId]
    );
    await conn.query('DELETE FROM user_dids WHERE user_id = ?', [userId]);

    // Delete SIP account and CDRs
    await conn.query('DELETE FROM sip_accounts WHERE user_id = ?', [userId]);
    await conn.query('DELETE FROM cdrs WHERE user_id = ?', [userId]);

    // Delete user
    await conn.query('DELETE FROM users WHERE id = ?', [userId]);

    await conn.commit();

    // Unprovision from Asterisk
    let asteriskRemoved = false;
    if (orderId) {
      try {
        await unprovisionExtension(orderId);
        asteriskRemoved = true;
      } catch (astErr) {
        console.warn(`[Admin] Asterisk unprovision warning for ${orderId}:`, astErr.message);
      }
    }

    return res.json({
      message: `User ${user.name} (UID ${orderId || 'N/A'}) deleted successfully`,
      user_id: userId,
      order_id: orderId,
      asterisk_removed: asteriskRemoved
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('[Admin] Delete user error:', err);
    return res.status(500).json({ error: 'Failed to delete user: ' + err.message });
  } finally {
    if (conn) conn.release();
  }
});


// ============================================================================
// ADMIN BALANCE TOP-UP REQUESTS
// ============================================================================
router.get('/balance-requests', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        br.id, br.user_id, br.amount, br.payment_method, br.transaction_ref, br.notes, 
        br.status, br.admin_notes, br.created_at, br.updated_at,
        u.name AS user_name, u.email AS user_email, u.balance AS current_balance, s.order_id
      FROM balance_requests br
      JOIN users u ON u.id = br.user_id
      LEFT JOIN sip_accounts s ON s.user_id = u.id
      ORDER BY FIELD(br.status, 'pending', 'approved', 'rejected'), br.id DESC
    `);
    return res.json({ requests: rows });
  } catch (err) {
    console.error('[Admin] Fetch balance requests error:', err);
    return res.status(500).json({ error: 'Failed to fetch balance requests' });
  }
});

router.put('/balance-requests/:id/approve', async (req, res) => {
  const reqId = parseInt(req.params.id, 10);
  const { admin_notes } = req.body;

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [rows] = await conn.query(
      'SELECT id, user_id, amount, status FROM balance_requests WHERE id = ? FOR UPDATE',
      [reqId]
    );

    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Balance request not found' });
    }

    const item = rows[0];
    if (item.status === 'approved') {
      await conn.rollback();
      return res.status(400).json({ error: 'This request is already approved' });
    }

    const amount = parseFloat(item.amount);

    // Get current balance before credit
    const [currentBalRow] = await conn.query('SELECT balance, name FROM users WHERE id = ? FOR UPDATE', [item.user_id]);
    const prevBal = parseFloat(currentBalRow[0]?.balance || 0);
    const newBal = prevBal + amount;

    // Credit user balance
    await conn.query('UPDATE users SET balance = balance + ? WHERE id = ?', [amount, item.user_id]);

    // Update request status
    await conn.query(
      'UPDATE balance_requests SET status = "approved", admin_notes = ?, processed_by = ?, updated_at = NOW() WHERE id = ?',
      [admin_notes || 'Approved by Admin', req.user.id, reqId]
    );

    // Record in billing_ledger
    await conn.query(
      `INSERT INTO billing_ledger (user_id, type, amount, balance_before, balance_after, description, reference_type, reference_id, created_by, created_at)
       VALUES (?, 'TOPUP_CREDIT', ?, ?, ?, ?, 'balance_requests', ?, ?, NOW())`,
      [
        item.user_id,
        amount,
        prevBal,
        newBal,
        `Top-up Approved: ${item.payment_method || 'Online'} (Ref: ${item.transaction_ref || 'N/A'})${admin_notes ? ' - ' + admin_notes : ''}`,
        reqId,
        req.user.id
      ]
    );

    const userRows = currentBalRow;

    await conn.commit();
    console.log(`[Admin] Balance Request #${reqId} approved! Credited ${amount.toFixed(2)} to User #${item.user_id}. New Balance: ${newBal.toFixed(2)}`);

    return res.json({
      message: `Balance request approved successfully! Credited ${amount.toFixed(2)} to ${userRows[0]?.name}.`,
      new_balance: newBal,
      status: 'approved'
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('[Admin] Approve balance request error:', err);
    return res.status(500).json({ error: 'Failed to approve request: ' + err.message });
  } finally {
    if (conn) conn.release();
  }
});

router.put('/balance-requests/:id/reject', async (req, res) => {
  const reqId = parseInt(req.params.id, 10);
  const { admin_notes } = req.body;

  try {
    const [result] = await pool.query(
      'UPDATE balance_requests SET status = "rejected", admin_notes = ?, processed_by = ?, updated_at = NOW() WHERE id = ? AND status = "pending"',
      [admin_notes || 'Rejected by Admin', req.user.id, reqId]
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({ error: 'Request not found or not in pending state' });
    }

    return res.json({ message: 'Balance request rejected', status: 'rejected' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// ADMIN DESTINATION RATES & TALKTIME
// ============================================================================
router.get('/rates', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM destination_rates ORDER BY country_name ASC');
    return res.json({ rates: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/rates', async (req, res) => {
  const { country_name, country_code, rate_per_minute } = req.body;

  if (!country_name || !country_code || rate_per_minute === undefined) {
    return res.status(400).json({ error: 'Country name, code/prefix, and rate per minute are required' });
  }

  const cleanName = String(country_name).trim();
  const cleanCode = String(country_code).trim().replace(/[^0-9]/g, '');
  const cleanRate = parseFloat(rate_per_minute);

  if (isNaN(cleanRate) || cleanRate <= 0) {
    return res.status(400).json({ error: 'Rate must be a positive number' });
  }

  try {
    const [result] = await pool.query(
      `INSERT INTO destination_rates (country_name, country_code, rate_per_minute, is_active)
       VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE country_name = VALUES(country_name), rate_per_minute = VALUES(rate_per_minute), is_active = 1`,
      [cleanName, cleanCode, cleanRate.toFixed(4)]
    );

    return res.status(201).json({
      message: 'Rate configured successfully',
      rate: { id: result.insertId, country_name: cleanName, country_code: cleanCode, rate_per_minute: cleanRate }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/rates/:id', async (req, res) => {
  const rateId = parseInt(req.params.id, 10);
  const { country_name, country_code, rate_per_minute, is_active } = req.body;

  try {
    await pool.query(
      `UPDATE destination_rates 
       SET country_name = COALESCE(?, country_name),
           country_code = COALESCE(?, country_code),
           rate_per_minute = COALESCE(?, rate_per_minute),
           is_active = COALESCE(?, is_active)
       WHERE id = ?`,
      [
        country_name ? String(country_name).trim() : null,
        country_code ? String(country_code).trim().replace(/[^0-9]/g, '') : null,
        rate_per_minute !== undefined ? parseFloat(rate_per_minute).toFixed(4) : null,
        is_active !== undefined ? (is_active ? 1 : 0) : null,
        rateId
      ]
    );

    return res.json({ message: 'Rate updated successfully' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/rates/:id', async (req, res) => {
  const rateId = parseInt(req.params.id, 10);
  try {
    await pool.query('DELETE FROM destination_rates WHERE id = ?', [rateId]);
    return res.json({ message: 'Rate deleted successfully' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// ADMIN DID INVENTORY & ROUTING MANAGEMENT
// ============================================================================

/**
 * GET /api/admin/dids
 * Returns all DIDs with complete owner and routing information
 */
router.get('/dids', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        d.id, d.did_number, d.country, d.monthly_cost, d.status, d.created_at,
        ud.id AS user_did_id, ud.user_id, ud.forward_type, ud.forward_destination,
        ud.voicemail_enabled, ud.voicemail_timeout, ud.created_at AS allocated_at,
        u.name AS owner_name, u.email AS owner_email, u.balance AS owner_balance,
        s.order_id AS owner_ext, s.status AS owner_sip_status
      FROM inventory_dids d
      LEFT JOIN user_dids ud ON ud.did_id = d.id AND ud.is_active = 1
      LEFT JOIN users u ON u.id = ud.user_id
      LEFT JOIN sip_accounts s ON s.user_id = u.id
      ORDER BY d.status ASC, d.id DESC
    `);
    return res.json({ dids: rows });
  } catch (err) {
    console.error('[Admin] Fetch DIDs error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/dids/search?q=...
 * Search DIDs by number, country, customer name, email, extension, or routing target
 */
router.get('/dids/search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (!query) {
    return res.json({ dids: [], count: 0 });
  }

  const term = `%${query}%`;
  try {
    const [rows] = await pool.query(`
      SELECT 
        d.id, d.did_number, d.country, d.monthly_cost, d.status, d.created_at,
        ud.id AS user_did_id, ud.user_id, ud.forward_type, ud.forward_destination,
        ud.voicemail_enabled, ud.voicemail_timeout, ud.created_at AS allocated_at,
        u.name AS owner_name, u.email AS owner_email, u.balance AS owner_balance,
        s.order_id AS owner_ext, s.status AS owner_sip_status
      FROM inventory_dids d
      LEFT JOIN user_dids ud ON ud.did_id = d.id AND ud.is_active = 1
      LEFT JOIN users u ON u.id = ud.user_id
      LEFT JOIN sip_accounts s ON s.user_id = u.id
      WHERE d.did_number LIKE ? 
         OR d.country LIKE ? 
         OR u.name LIKE ? 
         OR u.email LIKE ? 
         OR s.order_id LIKE ? 
         OR ud.forward_destination LIKE ?
      ORDER BY d.status ASC, d.id DESC
    `, [term, term, term, term, term, term]);

    return res.json({ dids: rows, count: rows.length });
  } catch (err) {
    console.error('[Admin] Search DIDs error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/dids
 * Batch add new DIDs into inventory
 */
router.post('/dids', async (req, res) => {
  const { numbers, country, monthly_cost } = req.body;

  if (!numbers || !country) {
    return res.status(400).json({ error: 'Numbers list and country are required' });
  }

  const cost = parseFloat(monthly_cost) || 2.50;
  const cleanCountry = String(country).trim();

  let numList = [];
  if (Array.isArray(numbers)) {
    numList = numbers;
  } else {
    numList = String(numbers).split(/[\r\n,; ]+/).map(s => s.trim()).filter(Boolean);
  }

  if (numList.length === 0) {
    return res.status(400).json({ error: 'Please provide at least one valid DID number' });
  }

  let added = 0;
  let skipped = 0;

  for (let raw of numList) {
    let clean = raw.replace(/[^0-9+]/g, '');
    if (!clean.startsWith('+')) clean = '+' + clean;
    if (clean.length < 5) continue;

    try {
      await pool.query(
        `INSERT INTO inventory_dids (did_number, country, monthly_cost, status)
         VALUES (?, ?, ?, 'available')
         ON DUPLICATE KEY UPDATE status = status`,
        [clean, cleanCountry, cost.toFixed(2)]
      );
      added++;
    } catch (e) {
      skipped++;
    }
  }

  return res.status(201).json({
    message: `Added ${added} new DID number(s) to inventory! (Available immediately in Marketplace)`,
    added,
    skipped
  });
});

/**
 * DELETE /api/admin/dids/:id
 * Delete available DID from inventory
 */
router.delete('/dids/:id', async (req, res) => {
  const didId = parseInt(req.params.id, 10);
  try {
    const [result] = await pool.query('DELETE FROM inventory_dids WHERE id = ? AND status = "available"', [didId]);
    if (result.affectedRows === 0) {
      return res.status(400).json({ error: 'Cannot delete an allocated number or DID not found' });
    }
    return res.json({ message: 'DID deleted from inventory' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/admin/dids/:id/release
 * Release allocated DID back to available pool and sync dialplan
 */
router.put('/dids/:id/release', async (req, res) => {
  const didId = parseInt(req.params.id, 10);
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    await conn.query('DELETE FROM user_dids WHERE did_id = ?', [didId]);
    await conn.query('UPDATE inventory_dids SET status = "available" WHERE id = ?', [didId]);

    await conn.commit();
    await pushAllDidRoutesToAsterisk();

    return res.json({ message: 'DID released back to available inventory' });
  } catch (err) {
    if (conn) await conn.rollback();
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

/**
 * PUT /api/admin/dids/:id/routing
 * Admin updates routing destination or voicemail settings on behalf of customer
 */
router.put('/dids/:id/routing', async (req, res) => {
  const didId = parseInt(req.params.id, 10);
  const { forward_type, forward_destination, voicemail_enabled, voicemail_timeout } = req.body;

  if (!didId || !forward_destination) {
    return res.status(400).json({ error: 'DID ID and forward destination are required' });
  }

  const fType = String(forward_type || 'SIP_URI').trim().toUpperCase();
  const fDest = String(forward_destination).trim();
  const vmEnabled = (voicemail_enabled === false || voicemail_enabled === 0 || voicemail_enabled === '0') ? 0 : 1;
  const vmTimeout = parseInt(voicemail_timeout, 10) >= 0 ? parseInt(voicemail_timeout, 10) : 20;

  try {
    const [existing] = await pool.query('SELECT id, user_id FROM user_dids WHERE did_id = ?', [didId]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'This DID is not currently allocated to any customer' });
    }

    await pool.query(
      `UPDATE user_dids 
       SET forward_type = ?, forward_destination = ?, voicemail_enabled = ?, voicemail_timeout = ?, is_active = 1, updated_at = NOW()
       WHERE did_id = ?`,
      [fType, fDest, vmEnabled, vmTimeout, didId]
    );

    // Sync to Asterisk dialplan
    await pushAllDidRoutesToAsterisk();

    return res.json({
      message: 'DID routing and voicemail updated successfully by Admin',
      route: {
        did_id: didId,
        forward_type: fType,
        forward_destination: fDest,
        voicemail_enabled: vmEnabled,
        voicemail_timeout: vmTimeout
      }
    });
  } catch (err) {
    console.error('[Admin] Update routing error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/dids/:id/assign
 * Admin directly assigns an available DID to a customer
 */
router.post('/dids/:id/assign', async (req, res) => {
  const didId = parseInt(req.params.id, 10);
  const { user_id } = req.body;

  if (!didId || !user_id) {
    return res.status(400).json({ error: 'DID ID and User ID are required' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const [didRows] = await conn.query('SELECT * FROM inventory_dids WHERE id = ? FOR UPDATE', [didId]);
    if (didRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'DID not found' });
    }

    const [userRows] = await conn.query(
      `SELECT u.id, u.name, u.email, s.order_id 
       FROM users u 
       LEFT JOIN sip_accounts s ON s.user_id = u.id 
       WHERE u.id = ?`,
      [user_id]
    );

    if (userRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Selected customer not found' });
    }

    const user = userRows[0];
    const defaultDest = user.order_id ? String(user.order_id) : '2001';

    // Remove any old assignment
    await conn.query('DELETE FROM user_dids WHERE did_id = ?', [didId]);

    // Create user_dids assignment
    await conn.query(
      `INSERT INTO user_dids (user_id, did_id, forward_type, forward_destination, voicemail_enabled, voicemail_timeout, is_active)
       VALUES (?, ?, 'SIP_URI', ?, 1, 20, 1)`,
      [user.id, didId, defaultDest]
    );

    // Mark DID allocated
    await conn.query('UPDATE inventory_dids SET status = "allocated" WHERE id = ?', [didId]);

    // Record into billing_ledger
    await conn.query(
      `INSERT INTO billing_ledger (user_id, type, amount, balance_before, balance_after, description, reference_type, reference_id, created_by, created_at)
       VALUES (?, 'DID_PURCHASE', ?, 0.00, 0.00, ?, 'inventory_dids', ?, ?, NOW())`,
      [
        user.id,
        didRows[0].monthly_cost,
        `Assigned by Admin: ${didRows[0].did_number} (${didRows[0].country})`,
        didId,
        req.user.id
      ]
    );

    await conn.commit();
    await pushAllDidRoutesToAsterisk();

    return res.json({
      message: `DID ${didRows[0].did_number} successfully assigned to ${user.name} (UID ${defaultDest})!`
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('[Admin] Assign DID error:', err);
    return res.status(500).json({ error: err.message });
  } finally {
    if (conn) conn.release();
  }
});

// ============================================================================
// CUSTOMER 360? PROFILE & FINANCIAL LEDGER
// ============================================================================

/**
 * GET /api/admin/users/:id/profile
 * Returns 360? customer profile: account, SIP credentials, DIDs, full ledger, CDRs, and voicemails
 */
router.get('/users/:id/profile', async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (!userId) return res.status(400).json({ error: 'Invalid user ID' });

  try {
    // 1. User & SIP info
    const [userRows] = await pool.query(`
      SELECT 
        u.id, u.name, u.email, u.phone, u.address, u.balance, u.is_admin, u.role, u.created_at,
        s.order_id, 
        COALESCE(s.sip_password, s.secret) AS sip_password,
        COALESCE(s.status, 'active') AS sip_status
      FROM users u
      LEFT JOIN sip_accounts s ON s.user_id = u.id
      WHERE u.id = ?
    `, [userId]);

    if (userRows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    const user = userRows[0];

    // 2. User DIDs & live routing
    const [didRows] = await pool.query(`
      SELECT 
        ud.id AS user_did_id, ud.did_id, ud.forward_type, ud.forward_destination,
        ud.voicemail_enabled, ud.voicemail_timeout, ud.is_active, ud.created_at AS allocated_at,
        idid.did_number, idid.country, idid.monthly_cost
      FROM user_dids ud
      JOIN inventory_dids idid ON idid.id = ud.did_id
      WHERE ud.user_id = ? AND ud.is_active = 1
      ORDER BY ud.id DESC
    `, [userId]);

    // 3. User Financial Ledger
    const [ledgerRows] = await pool.query(`
      SELECT id, type, amount, balance_before, balance_after, description, reference_type, reference_id, created_at
      FROM billing_ledger
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 200
    `, [userId]);

    // 4. Financial Totals
    const [totalsRows] = await pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN type = 'TOPUP_CREDIT' THEN amount ELSE 0 END), 0) AS total_topup,
        COALESCE(SUM(CASE WHEN type = 'CALL_DEBIT' THEN amount ELSE 0 END), 0) AS total_call_cost,
        COALESCE(SUM(CASE WHEN type = 'DID_PURCHASE' THEN amount ELSE 0 END), 0) AS total_did_cost,
        COALESCE(SUM(CASE WHEN type = 'ADMIN_ADJUSTMENT' THEN amount ELSE 0 END), 0) AS total_adjustments
      FROM billing_ledger
      WHERE user_id = ?
    `, [userId]);

    // 5. Recent CDRs
    const [cdrRows] = await pool.query(`
      SELECT id, caller, callee, duration, disposition, cost, created_at
      FROM cdrs
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 30
    `, [userId]);

    // 6. Recent Voicemails
    const [vmRows] = await pool.query(`
      SELECT id, did_number, caller_id, duration, file_name, file_path, status, created_at
      FROM voicemails
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 30
    `, [userId]);

    return res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        order_id: user.order_id,
        sip_extension: user.order_id ? String(user.order_id) : '--',
        sip_password: user.sip_password || '',
        balance: parseFloat(user.balance || 0),
        sip_status: user.sip_status,
        is_admin: Boolean(user.is_admin),
        role: user.role || 'user',
        created_at: user.created_at
      },
      dids: didRows,
      ledger: ledgerRows,
      financials: {
        current_balance: parseFloat(user.balance || 0),
        total_topup: parseFloat(totalsRows[0]?.total_topup || 0),
        total_call_cost: parseFloat(totalsRows[0]?.total_call_cost || 0),
        total_did_cost: parseFloat(totalsRows[0]?.total_did_cost || 0),
        total_adjustments: parseFloat(totalsRows[0]?.total_adjustments || 0)
      },
      cdrs: cdrRows,
      voicemails: vmRows
    });
  } catch (err) {
    console.error('[Admin] Customer profile error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/users/:id/ledger
 * Return complete ledger history for user
 */
router.get('/users/:id/ledger', async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (!userId) return res.status(400).json({ error: 'Invalid user ID' });

  try {
    const [rows] = await pool.query(`
      SELECT id, type, amount, balance_before, balance_after, description, reference_type, reference_id, created_at
      FROM billing_ledger
      WHERE user_id = ?
      ORDER BY id DESC
      LIMIT 300
    `, [userId]);
    return res.json({ ledger: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/ledger
 * System-wide Global Financial Ledger across all customers
 */
router.get('/ledger', async (req, res) => {
  const { type, user_id, limit } = req.query;
  const maxRows = Math.min(parseInt(limit, 10) || 100, 500);

  let whereClauses = [];
  let params = [];

  if (type) {
    whereClauses.push('bl.type = ?');
    params.push(type);
  }
  if (user_id) {
    whereClauses.push('bl.user_id = ?');
    params.push(parseInt(user_id, 10));
  }

  const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

  try {
    const [rows] = await pool.query(`
      SELECT 
        bl.*, 
        u.name AS user_name, u.email AS user_email, s.order_id AS user_ext
      FROM billing_ledger bl
      JOIN users u ON u.id = bl.user_id
      LEFT JOIN sip_accounts s ON s.user_id = u.id
      ${whereSql}
      ORDER BY bl.id DESC
      LIMIT ?
    `, [...params, maxRows]);

    return res.json({ ledger: rows, count: rows.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
