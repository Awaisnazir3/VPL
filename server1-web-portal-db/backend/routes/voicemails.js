const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('../db');
const { authenticateToken } = require('../middleware/auth');

// Storage destination for Voicemail Audio Files
const RECORDINGS_DIR = path.join(__dirname, '../../public/recordings/voicemails');
if (!fs.existsSync(RECORDINGS_DIR)) {
  fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

// Multer Disk Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, RECORDINGS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.wav';
    const cleanDid = String(req.body.did_number || 'vm').replace(/[^0-9]/g, '');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E6);
    cb(null, `vm-${cleanDid}-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 } // 20 MB max
});

/**
 * GET /api/voicemails
 * Returns all voicemails belonging to logged-in user (or all if admin)
 */
router.get('/', authenticateToken, async (req, res) => {
  try {
    // Strictly isolate: each user only sees voicemails left for their own account / assigned numbers
    const [rows] = await pool.query(
      `SELECT id, user_id, did_number, caller_id, duration, file_name, status, created_at
       FROM voicemails
       WHERE user_id = ?
       ORDER BY id DESC`,
      [req.user.id]
    );

    const voicemails = rows.map(v => ({
      ...v,
      audio_url: `/recordings/voicemails/${v.file_name}`
    }));

    return res.json({ voicemails });
  } catch (err) {
    console.error('[Fetch Voicemails Error]:', err);
    return res.status(500).json({ error: 'Failed to retrieve voicemails' });
  }
});

/**
 * GET /api/voicemails/unread-count
 * Returns count of unread voicemails for header badge
 */
router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    // Strictly count unread voicemails for THIS user only
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS unread_count FROM voicemails WHERE user_id = ? AND status = 'unread'`,
      [req.user.id]
    );
    return res.json({ unread_count: rows[0].unread_count || 0 });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch unread count' });
  }
});

/**
 * PUT /api/voicemails/:id/read
 * Marks a voicemail as read
 */
router.put('/:id/read', authenticateToken, async (req, res) => {
  try {
    await pool.query(
      `UPDATE voicemails SET status = 'read' WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    );
    return res.json({ message: 'Marked as read' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update voicemail status' });
  }
});

/**
 * DELETE /api/voicemails/:id
 * Deletes a voicemail and removes associated audio file
 */
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, file_name FROM voicemails WHERE id = ? AND user_id = ?`,
      [req.params.id, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Voicemail not found or unauthorized' });
    }

    const fileName = rows[0].file_name;
    const filePath = path.join(RECORDINGS_DIR, fileName);

    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (e) {
        console.warn(`[Voicemail Delete] Could not remove audio file: ${filePath}`, e.message);
      }
    }

    await pool.query(`DELETE FROM voicemails WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]);

    return res.json({ message: 'Voicemail deleted successfully' });
  } catch (err) {
    console.error('[Delete Voicemail Error]:', err);
    return res.status(500).json({ error: 'Failed to delete voicemail' });
  }
});

/**
 * POST /api/voicemails/upload
 * Webhook endpoint for Asterisk to upload completed voicemail recording
 * Matches either:
 *   1. Full DID Number (e.g. +12025550143)
 *   2. Extension / Order ID (e.g. 2013, 2001)
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const rawDid = String(req.body.did_number || '').trim();
    const callerId = String(req.body.caller_id || 'Anonymous').trim();
    let duration = parseInt(req.body.duration || '0', 10);

    if (!req.file) {
      return res.status(400).json({ error: 'Audio file is required' });
    }

    // Auto-calculate duration from WAV file size if empty or 0 (16-bit 8kHz PCM is 16000 bytes/sec)
    if (!duration || isNaN(duration)) {
      const fileSize = req.file.size || 0;
      duration = Math.max(1, Math.round((fileSize - 44) / 16000));
    }

    if (!rawDid) {
      return res.status(400).json({ error: 'did_number is required' });
    }

    const cleanNum = rawDid.replace(/[^0-9]/g, '');
    const withPlus = '+' + cleanNum;

    let userId = null;
    let didNumber = rawDid;

    // 1. Try matching against purchased DIDs in inventory_dids
    const [didRows] = await pool.query(
      `SELECT ud.user_id, idid.did_number
       FROM user_dids ud
       JOIN inventory_dids idid ON idid.id = ud.did_id
       WHERE idid.did_number = ? OR idid.did_number = ? OR idid.did_number = ?
       LIMIT 1`,
      [rawDid, withPlus, cleanNum]
    );

    if (didRows.length > 0) {
      userId = didRows[0].user_id;
      didNumber = didRows[0].did_number;
    } else {
      // 2. Try matching Extension in sip_accounts (e.g. order_id = 2013)
      const [sipRows] = await pool.query(
        `SELECT user_id, order_id FROM sip_accounts WHERE order_id = ? LIMIT 1`,
        [cleanNum]
      );

      if (sipRows.length > 0) {
        userId = sipRows[0].user_id;
        const [userDidRows] = await pool.query(
          `SELECT idid.did_number
           FROM user_dids ud
           JOIN inventory_dids idid ON idid.id = ud.did_id
           WHERE ud.user_id = ? AND ud.is_active = 1
           ORDER BY ud.id DESC LIMIT 1`,
          [userId]
        );
        if (userDidRows.length > 0) {
          didNumber = `${userDidRows[0].did_number} (UID ${sipRows[0].order_id})`;
        } else {
          didNumber = `UID ${sipRows[0].order_id}`;
        }
      } else {
        // 3. Try matching in users table
        const [userRows] = await pool.query(
          `SELECT id, order_id FROM users WHERE order_id = ? OR id = ? LIMIT 1`,
          [cleanNum, cleanNum]
        );

        if (userRows.length > 0) {
          userId = userRows[0].id;
          didNumber = `UID ${cleanNum}`;
        } else {
          // 4. Try matching user_dids destination
          const [fwdRows] = await pool.query(
            `SELECT ud.user_id, idid.did_number 
             FROM user_dids ud
             JOIN inventory_dids idid ON idid.id = ud.did_id
             WHERE ud.forward_destination = ? OR ud.forward_destination = ?
             LIMIT 1`,
            [rawDid, cleanNum]
          );

          if (fwdRows.length > 0) {
            userId = fwdRows[0].user_id;
            didNumber = fwdRows[0].did_number;
          }
        }
      }
    }

    if (!userId) {
      console.warn(`[Voicemail Upload] No user assigned for DID/Ext ${rawDid}. Cleaning file.`);
      const orphanPath = path.join(RECORDINGS_DIR, req.file.filename);
      if (fs.existsSync(orphanPath)) fs.unlinkSync(orphanPath);
      return res.status(404).json({ error: `No user assigned for DID or Extension ${rawDid}` });
    }

    const fileName = req.file.filename;
    const filePath = path.join(RECORDINGS_DIR, fileName);

    // Save to database
    const [insertResult] = await pool.query(
      `INSERT INTO voicemails (user_id, did_number, caller_id, duration, file_name, file_path, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'unread', NOW())`,
      [userId, didNumber, callerId, duration, fileName, filePath]
    );

    console.log(`[Voicemail Saved] ID #${insertResult.insertId} for User #${userId} (Target: ${didNumber}, Caller: ${callerId}, Duration: ${duration}s)`);

    return res.status(201).json({
      success: true,
      message: 'Voicemail saved successfully',
      voicemail_id: insertResult.insertId,
      user_id: userId,
      did_number: didNumber,
      duration
    });
  } catch (err) {
    console.error('[Voicemail Upload Error]:', err);
    return res.status(500).json({ error: 'Internal server error processing voicemail' });
  }
});

module.exports = router;