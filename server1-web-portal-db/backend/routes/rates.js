const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');

/**
 * GET /api/rates
 * Returns active destination call rates
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, country_name, country_code, rate_per_minute, is_active
       FROM destination_rates
       WHERE is_active = 1
       ORDER BY country_name ASC`
    );
    return res.json({ rates: rows });
  } catch (err) {
    console.error('[Rates] Fetch error:', err);
    return res.status(500).json({ error: 'Failed to retrieve call rates' });
  }
});

/**
 * GET /api/rates/estimate?destination=...
 * Calculates rate and estimated talktime based on logged-in user balance
 */
router.get('/estimate', authenticateToken, async (req, res) => {
  const dest = String(req.query.destination || '').replace(/[^0-9]/g, '');

  try {
    const [userRows] = await pool.query('SELECT balance FROM users WHERE id = ?', [req.user.id]);
    const balance = parseFloat(userRows[0]?.balance || 0);

    const [rates] = await pool.query('SELECT country_name, country_code, rate_per_minute FROM destination_rates WHERE is_active = 1');

    let matchedRate = null;
    if (dest) {
      let longestMatch = -1;
      for (const r of rates) {
        if (dest.startsWith(r.country_code) && r.country_code.length > longestMatch) {
          longestMatch = r.country_code.length;
          matchedRate = r;
        }
      }
    }

    if (!matchedRate) {
      matchedRate = rates.find(r => r.country_code === '0') || {
        country_name: 'Standard Destination',
        country_code: 'Default',
        rate_per_minute: 0.0500
      };
    }

    const ratePerMin = parseFloat(matchedRate.rate_per_minute);
    const estMinutes = ratePerMin > 0 ? Math.floor(balance / ratePerMin) : 0;

    return res.json({
      destination: dest,
      country_name: matchedRate.country_name,
      country_code: matchedRate.country_code,
      rate_per_minute: ratePerMin,
      user_balance: balance,
      estimated_talktime_minutes: estMinutes,
      can_call: balance >= ratePerMin
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;