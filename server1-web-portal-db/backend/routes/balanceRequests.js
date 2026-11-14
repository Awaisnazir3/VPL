const express = require('express');
const router = express.Router();
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

/**
 * POST /api/balance-requests
 * Customer submits a top-up request
 */
router.post('/', async (req, res) => {
  const { amount, payment_method, transaction_ref, notes } = req.body;

  const topupAmount = parseFloat(amount);
  if (isNaN(topupAmount) || topupAmount <= 0) {
    return res.status(400).json({ error: 'Please enter a valid amount greater than $0.00' });
  }

  const method = String(payment_method || 'Bank Transfer').trim();
  const txRef = transaction_ref ? String(transaction_ref).trim() : null;
  const noteText = notes ? String(notes).trim() : null;

  try {
    const [result] = await pool.query(
      `INSERT INTO balance_requests (user_id, amount, payment_method, transaction_ref, notes, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', NOW())`,
      [req.user.id, topupAmount.toFixed(2), method, txRef, noteText]
    );

    return res.status(201).json({
      message: 'Balance top-up request submitted successfully! An administrator will review and credit your account shortly.',
      request_id: result.insertId,
      amount: topupAmount,
      status: 'pending'
    });
  } catch (err) {
    console.error('[Balance Request] Create error:', err);
    return res.status(500).json({ error: 'Failed to submit balance request' });
  }
});

/**
 * GET /api/balance-requests/my
 * Customer views their own top-up history
 */
router.get('/my', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, amount, payment_method, transaction_ref, notes, status, admin_notes, created_at, updated_at
       FROM balance_requests
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT 50`,
      [req.user.id]
    );

    return res.json({ requests: rows });
  } catch (err) {
    console.error('[Balance Request] Fetch history error:', err);
    return res.status(500).json({ error: 'Failed to retrieve balance history' });
  }
});

/**
 * GET /api/balance-requests/ledger
 * Customer views their complete financial ledger statement
 */
router.get('/ledger', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, type, amount, balance_before, balance_after, description, reference_type, reference_id, created_at
       FROM billing_ledger
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT 100`,
      [req.user.id]
    );

    return res.json({ ledger: rows });
  } catch (err) {
    console.error('[Balance Request] Fetch ledger error:', err);
    return res.status(500).json({ error: 'Failed to retrieve billing ledger' });
  }
});

module.exports = router;