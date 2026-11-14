const express = require('express');
const router = express.Router();
const pool = require('../db');

/**
 * GET /api/telephony/check-balance
 * Query params: ?ext=2001&destination=+923001234567 (or caller & called)
 * 
 * Returns plain text HTTP response:
 * 'ALLOWED' -> User extension active, balance > 0, and covers destination rate per minute
 * 'DENIED'  -> Insufficient balance / talktime or user suspended
 */
router.get('/check-balance', async (req, res) => {
  const ext = String(req.query.ext || req.query.caller || '').trim();
  const dest = String(req.query.destination || req.query.called || '').replace(/[^0-9]/g, '');

  res.setHeader('Content-Type', 'text/plain');

  if (!ext) {
    console.warn('[Balance Guard] Check balance failed: No extension specified.');
    return res.status(200).send('DENIED');
  }

  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.balance, s.status AS sip_status
       FROM sip_accounts s
       JOIN users u ON u.id = s.user_id
       WHERE s.order_id = ?
       LIMIT 1`,
      [ext]
    );

    if (rows.length === 0) {
      console.warn(`[Balance Guard] Call DENIED: Extension ${ext} not found in database.`);
      return res.status(200).send('DENIED');
    }

    const user = rows[0];
    const balance = parseFloat(user.balance || 0);

    if (user.sip_status === 'suspended') {
      console.warn(`[Balance Guard] Call DENIED: Extension ${ext} (${user.name}) is suspended.`);
      return res.status(200).send('DENIED');
    }

    if (balance <= 0) {
      console.warn(`[Balance Guard] Call DENIED: Extension ${ext} (${user.name}) has zero or negative balance ($${balance.toFixed(2)}).`);
      return res.status(200).send('DENIED');
    }

    // Match destination against destination_rates
    let requiredRate = 0.0150; // default baseline per-minute charge
    if (dest) {
      const [rates] = await pool.query('SELECT country_code, rate_per_minute FROM destination_rates WHERE is_active = 1');
      let longestMatch = -1;
      for (const r of rates) {
        if (dest.startsWith(r.country_code) && r.country_code.length > longestMatch) {
          longestMatch = r.country_code.length;
          requiredRate = parseFloat(r.rate_per_minute);
        }
      }
    }

    // Strict Talktime Guard: Balance must cover at least 1 minute of call
    if (balance < requiredRate) {
      console.warn(`[Balance Guard] Call DENIED: Extension ${ext} (${user.name}) balance ($${balance.toFixed(2)}) insufficient for destination rate ($${requiredRate.toFixed(4)}/min).`);
      return res.status(200).send('DENIED');
    }

    console.log(`[Balance Guard] Call ALLOWED: Extension ${ext} (${user.name}) balance: $${balance.toFixed(2)}, required rate: $${requiredRate}/min.`);
    return res.status(200).send('ALLOWED');
  } catch (err) {
    console.error(`[Balance Guard] Database error checking extension ${ext}:`, err);
    return res.status(200).send('DENIED');
  }
});

/**
 * GET /api/telephony/user-status/:ext
 * JSON diagnostic endpoint
 */
router.get('/user-status/:ext', async (req, res) => {
  const ext = String(req.params.ext || '').trim();
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.balance, s.status AS sip_status
       FROM sip_accounts s
       JOIN users u ON u.id = s.user_id
       WHERE s.order_id = ?
       LIMIT 1`,
      [ext]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Extension not found' });
    }

    const balance = parseFloat(rows[0].balance || 0);
    return res.json({
      extension: ext,
      name: rows[0].name,
      balance,
      can_call: balance > 0 && rows[0].sip_status === 'active',
      sip_status: rows[0].sip_status
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;