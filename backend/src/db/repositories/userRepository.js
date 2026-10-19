/**
 * ConflictCore - User Repository
 * Data access layer for the USERS table.
 */

const { getPool } = require('../connection');

function getExecutor(conn) {
  return conn || getPool();
}

/**
 * Creates a new user record.
 * @param {Object} user
 * @param {string} user.username
 * @param {string} user.email
 * @param {string} user.password_hash
 * @param {string} [user.role='USER'] - ADMIN | USER | COLLABORATOR
 * @param {string} [user.status='ACTIVE'] - ACTIVE | SUSPENDED | INACTIVE
 * @param {Object} [conn] - Optional active transaction connection
 * @returns {Promise<Object>} Created user object with user_id
 */
async function createUser({ username, email, password_hash, role = 'USER', status = 'ACTIVE' }, conn) {
  const sql = `
    INSERT INTO USERS (username, email, password_hash, role, status)
    VALUES (?, ?, ?, ?, ?)
  `;
  const [result] = await getExecutor(conn).execute(sql, [username, email, password_hash, role, status]);
  return findUserById(result.insertId, conn);
}

/**
 * Finds a user by their primary key user_id.
 * @param {number} userId
 * @param {Object} [conn]
 * @returns {Promise<Object|null>}
 */
async function findUserById(userId, conn) {
  const sql = `SELECT * FROM USERS WHERE user_id = ? LIMIT 1`;
  const [rows] = await getExecutor(conn).execute(sql, [userId]);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Finds a user by email address.
 * @param {string} email
 * @param {Object} [conn]
 * @returns {Promise<Object|null>}
 */
async function findUserByEmail(email, conn) {
  const sql = `SELECT * FROM USERS WHERE email = ? LIMIT 1`;
  const [rows] = await getExecutor(conn).execute(sql, [email]);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Finds a user by unique username.
 * @param {string} username
 * @param {Object} [conn]
 * @returns {Promise<Object|null>}
 */
async function findUserByUsername(username, conn) {
  const sql = `SELECT * FROM USERS WHERE username = ? LIMIT 1`;
  const [rows] = await getExecutor(conn).execute(sql, [username]);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Lists all users with optional role or status filtering.
 * @param {Object} [filters]
 * @param {string} [filters.role]
 * @param {string} [filters.status]
 * @param {Object} [conn]
 * @returns {Promise<Array>}
 */
async function listUsers({ role, status } = {}, conn) {
  let sql = `SELECT user_id, username, email, role, status, created_at, updated_at FROM USERS WHERE 1=1`;
  const params = [];
  if (role) {
    sql += ` AND role = ?`;
    params.push(role);
  }
  if (status) {
    sql += ` AND status = ?`;
    params.push(status);
  }
  sql += ` ORDER BY user_id ASC`;
  const [rows] = await getExecutor(conn).execute(sql, params);
  return rows;
}

/**
 * Updates a user's details.
 * @param {number} userId
 * @param {Object} updates
 * @param {Object} [conn]
 * @returns {Promise<Object|null>} Updated user record
 */
async function updateUser(userId, updates, conn) {
  const allowed = ['username', 'email', 'password_hash', 'role', 'status'];
  const fields = [];
  const params = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowed.includes(key)) {
      fields.push(`${key} = ?`);
      params.push(value);
    }
  }

  if (fields.length === 0) return findUserById(userId, conn);

  params.push(userId);
  const sql = `UPDATE USERS SET ${fields.join(', ')} WHERE user_id = ?`;
  await getExecutor(conn).execute(sql, params);
  return findUserById(userId, conn);
}

/**
 * Deactivates a user (sets status to INACTIVE).
 * @param {number} userId
 * @param {Object} [conn]
 * @returns {Promise<Object|null>}
 */
async function deactivateUser(userId, conn) {
  return updateUser(userId, { status: 'INACTIVE' }, conn);
}

/**
 * Permanently deletes a user (used primarily in cleanup/tests).
 * @param {number} userId
 * @param {Object} [conn]
 * @returns {Promise<boolean>}
 */
async function deleteUser(userId, conn) {
  const sql = `DELETE FROM USERS WHERE user_id = ?`;
  const [result] = await getExecutor(conn).execute(sql, [userId]);
  return result.affectedRows > 0;
}

module.exports = {
  createUser,
  findUserById,
  findUserByEmail,
  findUserByUsername,
  listUsers,
  updateUser,
  deactivateUser,
  deleteUser,
};
