const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'vpl_user',
  password: process.env.DB_PASS || 'Vpl_CRM@2026!Secure',
  database: process.env.DB_NAME || 'vpl_crm',
  waitForConnections: true,
  connectionLimit: 15,
  queueLimit: 0,
  decimalNumbers: true
});

// Test connection on boot
pool.getConnection()
  .then(conn => {
    console.log('✅ Connected to MySQL database:', process.env.DB_NAME || 'vpl_crm');
    conn.release();
  })
  .catch(err => {
    console.error('❌ Failed to connect to MySQL:', err.message);
  });

module.exports = pool;

