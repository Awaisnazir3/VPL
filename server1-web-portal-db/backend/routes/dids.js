const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');
const { syncDidRoutes } = require('../asteriskProvisioner');

/**
 * Helper to sync all active DID routes in the database to Asterisk
 */
async function pushAllDidRoutesToAsterisk() {
  try {
    const [rows] = await pool.query(`
      SELECT ud.id, ud.forward_type, ud.forward_destination, ud.voicemail_enabled, ud.voicemail_timeout, idid.did_number
      FROM user_dids ud
      JOIN inventory_dids idid ON idid.id = ud.did_id
      WHERE ud.is_active = 1
    `);
    await syncDidRoutes(rows);
  } catch (err) {
    console.error('[DID Sync to Asterisk Failed]:', err.message);
  }
}

/**
 * GET /api/dids/available
 * Returns unassigned DIDs from inventory
 */
router.get('/available', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, did_number, country, monthly_cost, status, created_at
       FROM inventory_dids
       WHERE status = 'available'
       ORDER BY id ASC`
    );
    return res.json({ dids: rows });
  } catch (err) {
    console.error('Fetch available DIDs error:', err);
    return res.status(500).json({ error: 'Failed to retrieve available numbers' });
  }
});

/**
 * GET /api/dids/my
 * Returns DIDs purchased by the logged-in user
 */
router.get('/my', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT ud.id AS user_did_id, ud.did_id, ud.forward_type, ud.forward_destination, 
              ud.voicemail_enabled, ud.voicemail_timeout,
              ud.is_active, ud.updated_at, ud.created_at,
              idid.did_number, idid.country, idid.monthly_cost
       FROM user_dids ud
       JOIN inventory_dids idid ON idid.id = ud.did_id
       WHERE ud.user_id = ?
       ORDER BY ud.id DESC`,
      [req.user.id]
    );
    return res.json({ dids: rows });
  } catch (err) {
    console.error('Fetch user DIDs error:', err);
    return res.status(500).json({ error: 'Failed to retrieve your numbers' });
  }
});

/**
 * POST /api/dids/purchase
 * Buys a DID, deducts monthly cost from balance, and assigns it to the user.
 */
router.post('/purchase', authenticateToken, async (req, res) => {
  const { did_id } = req.body;

  if (!did_id) {
    return res.status(400).json({ error: 'DID ID is required' });
  }

  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();

    // Lock user record to inspect and deduct balance
    const [userRows] = await conn.query(
      'SELECT id, balance FROM users WHERE id = ? FOR UPDATE',
      [req.user.id]
    );

    if (userRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'User not found' });
    }

    const currentBalance = parseFloat(userRows[0].balance);

    // Lock DID record
    const [didRows] = await conn.query(
      'SELECT id, did_number, country, monthly_cost, status FROM inventory_dids WHERE id = ? FOR UPDATE',
      [did_id]
    );

    if (didRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Selected DID not found' });
    }

    const did = didRows[0];
    if (did.status !== 'available') {
      await conn.rollback();
      return res.status(400).json({ error: 'This number is no longer available' });
    }

    const cost = parseFloat(did.monthly_cost);
    if (currentBalance < cost) {
      await conn.rollback();
      return res.status(400).json({
        error: `Insufficient balance. Required: $${cost.toFixed(2)}, Available: $${currentBalance.toFixed(2)}`
      });
    }

    const newBalance = currentBalance - cost;

    // Deduct balance
    await conn.query('UPDATE users SET balance = ? WHERE id = ?', [newBalance, req.user.id]);

    // Record into billing_ledger
    await conn.query(
      `INSERT INTO billing_ledger (user_id, type, amount, balance_before, balance_after, description, reference_type, reference_id, created_at)
       VALUES (?, 'DID_PURCHASE', ?, ?, ?, ?, 'inventory_dids', ?, NOW())`,
      [
        req.user.id,
        cost,
        currentBalance,
        newBalance,
        `DID Purchase: ${did.did_number} (${did.country})`,
        did.id
      ]
    );

    // Mark DID allocated
    await conn.query('UPDATE inventory_dids SET status = "allocated" WHERE id = ?', [did_id]);

    // Default forward destination to user's order_id extension
    const defaultDestination = String(req.user.order_id || '2001');

    // Create user_dids entry
    const [insertResult] = await conn.query(
      `INSERT INTO user_dids (user_id, did_id, forward_type, forward_destination, is_active)
       VALUES (?, ?, 'SIP_URI', ?, 1)`,
      [req.user.id, did_id, defaultDestination]
    );

    await conn.commit();

    // Trigger Asterisk dialplan reload in background
    pushAllDidRoutesToAsterisk().catch(console.error);

    return res.status(201).json({
      message: 'DID purchased successfully',
      user_did_id: insertResult.insertId,
      did: {
        id: did.id,
        did_number: did.did_number,
        country: did.country,
        monthly_cost: cost,
        forward_type: 'SIP_URI',
        forward_destination: defaultDestination
      },
      new_balance: newBalance
    });
  } catch (err) {
    if (conn) await conn.rollback();
    console.error('Purchase DID error:', err);
    return res.status(500).json({ error: 'Failed to complete DID purchase' });
  } finally {
    if (conn) conn.release();
  }
});

/**
 * POST /api/dids/forward
 * Sets or updates forwarding destination (e.g. sip:reception@myoffice.com or +12025550143)
 */
router.post('/forward', authenticateToken, async (req, res) => {
  const { user_did_id, forward_type, forward_destination, voicemail_enabled, voicemail_timeout } = req.body;

  if (!user_did_id || !forward_type || !forward_destination) {
    return res.status(400).json({ error: 'user_did_id, forward_type, and forward_destination are required' });
  }

  const cleanType = String(forward_type).trim().toUpperCase();
  if (cleanType !== 'SIP_URI' && cleanType !== 'PSTN') {
    return res.status(400).json({ error: "forward_type must be either 'SIP_URI' or 'PSTN'" });
  }

  const cleanDest = String(forward_destination).trim();
  if (!cleanDest) {
    return res.status(400).json({ error: 'Destination cannot be empty' });
  }

  // Voicemail is strictly available ONLY for WebRTC local extension lines
  // For PSTN forwarding and External SIP PBX forwarding, voicemail is strictly disabled
  const isWebRtcLine = cleanType === 'SIP_URI' && (/^[0-9]{4,6}$/.test(cleanDest) || String(cleanDest) === String(req.user.order_id));
  const vmEnabled = isWebRtcLine ? ((voicemail_enabled === false || voicemail_enabled === 0 || voicemail_enabled === '0') ? 0 : 1) : 0;
  const vmTimeout = parseInt(voicemail_timeout, 10) >= 0 ? parseInt(voicemail_timeout, 10) : 20;

  try {
    // Check ownership
    const [rows] = await pool.query(
      `SELECT ud.id, ud.did_id, idid.did_number
       FROM user_dids ud
       JOIN inventory_dids idid ON idid.id = ud.did_id
       WHERE ud.id = ? AND ud.user_id = ?`,
      [user_did_id, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Purchased DID not found or access denied' });
    }

    await pool.query(
      `UPDATE user_dids 
       SET forward_type = ?, forward_destination = ?, voicemail_enabled = ?, voicemail_timeout = ?, is_active = 1, updated_at = NOW()
       WHERE id = ?`,
      [cleanType, cleanDest, vmEnabled, vmTimeout, user_did_id]
    );

    // Sync to Asterisk extensions_vpl.conf
    await pushAllDidRoutesToAsterisk();

    return res.json({
      message: 'DID forwarding route updated successfully',
      route: {
        user_did_id,
        did_number: rows[0].did_number,
        forward_type: cleanType,
        forward_destination: cleanDest,
        voicemail_enabled: vmEnabled,
        voicemail_timeout: vmTimeout
      }
    });
  } catch (err) {
    console.error('Update DID forward error:', err);
    return res.status(500).json({ error: 'Failed to update forwarding route' });
  }
});

module.exports = router;

