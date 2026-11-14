const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const pool = require('./db');
const { testAsterisk } = require('./asteriskProvisioner');

const authRoutes = require('./routes/auth');
const didRoutes = require('./routes/dids');
const cdrRoutes = require('./routes/cdrs');
const adminRoutes = require('./routes/admin');
const telephonyRoutes = require('./routes/telephony');
const voicemailRoutes = require('./routes/voicemails');
const balanceRequestRoutes = require('./routes/balanceRequests');
const ratesRoutes = require('./routes/rates');

const app = express();
const PORT = process.env.PORT || 3000;

// Security & Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static frontend assets
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/dids', didRoutes);
app.use('/api/cdrs', cdrRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/telephony', telephonyRoutes);
app.use('/api/voicemails', voicemailRoutes);
app.use('/api/balance-requests', balanceRequestRoutes);
app.use('/api/rates', ratesRoutes);

// System Health & Telemetry
app.get('/api/health', async (req, res) => {
  let dbStatus = 'disconnected';
  let dbError = null;
  try {
    const [rows] = await pool.query('SELECT 1 + 1 AS result');
    if (rows && rows[0].result === 2) {
      dbStatus = 'connected';
    }
  } catch (e) {
    dbError = e.message;
  }

  const asteriskStatus = await testAsterisk();

  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    database: {
      status: dbStatus,
      error: dbError
    },
    asterisk: asteriskStatus,
    wss_url: process.env.ASTERISK_WSS_URL || 'wss://192.168.88.47:8089/ws',
    node_version: process.version,
    uptime_seconds: Math.floor(process.uptime())
  });
});

// Single Page Application Fallback Middleware (compatible with Express 4 and 5)
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(path.join(__dirname, '../public/index.html'));
  }
  next();
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]:', err);
  res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`ðŸš€ call.me Web Portal & Backend Service running on port ${PORT}`);
  console.log(`ðŸ“ Web Interface: http://192.168.88.119:${PORT}`);
  console.log(`ðŸ“ž Asterisk WebRTC Target: ${process.env.ASTERISK_WSS_URL}`);
  console.log(`=======================================================`);
});
