/**
 * ConflictCore - Database Connection & Pool Manager
 * Manages MySQL connection pooling with environment variable configuration
 * and robust error diagnostics.
 */

const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'conflictcore_db',
  waitForConnections: process.env.DB_WAIT_FOR_CONNECTIONS !== 'false',
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
  queueLimit: parseInt(process.env.DB_QUEUE_LIMIT || '0', 10),
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  namedPlaceholders: true,
};

let pool = null;

/**
 * Returns the active MySQL connection pool, initializing it if necessary.
 * @returns {mysql.Pool}
 */
function getPool() {
  if (!pool) {
    try {
      pool = mysql.createPool(config);
    } catch (err) {
      console.error('[DB] Failed to initialize connection pool:', err.message);
      throw err;
    }
  }
  return pool;
}

/**
 * Validates the database connection by acquiring a connection and running a ping query.
 * @returns {Promise<boolean>} True if connection is successful.
 */
async function testConnection() {
  try {
    const activePool = getPool();
    const conn = await activePool.getConnection();
    try {
      const [rows] = await conn.query('SELECT 1 AS connected, CURRENT_TIMESTAMP AS server_time');
      conn.release();
      return {
        success: true,
        host: config.host,
        port: config.port,
        database: config.database,
        serverTime: rows[0].server_time,
      };
    } catch (queryErr) {
      conn.release();
      throw queryErr;
    }
  } catch (err) {
    console.error(`[DB Error] Cannot connect to MySQL (${config.host}:${config.port}/${config.database}):`, err.message);
    return {
      success: false,
      error: err.message,
      code: err.code,
    };
  }
}

/**
 * Gracefully closes the connection pool.
 */
async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  getPool,
  testConnection,
  closePool,
  config: {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
  },
};
