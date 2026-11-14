const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');

/**
 * GET /api/cdrs
 * Returns CDR history for logged in user
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, caller, callee, duration, disposition, cost, created_at
       FROM cdrs
       WHERE user_id = ? OR caller = ? OR callee = ?
       ORDER BY id DESC
       LIMIT 50`,
      [req.user.id, String(req.user.order_id), String(req.user.order_id)]
    );
    return res.json({ cdrs: rows });
  } catch (err) {
    console.error('Fetch CDRs error:', err);
    return res.status(500).json({ error: 'Failed to retrieve call detail records' });
  }
});

/**
 * POST /api/cdrs
 * Log a completed or failed call
 */
router.post('/', authenticateToken, async (req, res) => {
  const { caller, callee, duration, disposition, cost } = req.body;

  const cleanCaller = String(caller || req.user.order_id).trim();
  const cleanCallee = String(callee || 'Unknown').trim();
  const dur = parseInt(duration || 0, 10);
  const disp = String(disposition || 'ANSWERED').toUpperCase();
  const callCost = parseFloat(cost || 0.00);

  try {
    const [result] = await pool.query(
      `INSERT INTO cdrs (user_id, caller, callee, duration, disposition, cost)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.user.id, cleanCaller, cleanCallee, dur, disp, callCost]
    );

    return res.status(201).json({
      message: 'CDR logged successfully',
      cdr_id: result.insertId
    });
  } catch (err) {
    console.error('Log CDR error:', err);
    return res.status(500).json({ error: 'Failed to log call detail record' });
  }
});

module.exports = router;
