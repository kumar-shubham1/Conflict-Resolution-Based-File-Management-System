/**
 * ConflictCore - Operation Repository
 * Data access layer for the OPERATIONS table representing high-level file actions.
 */

const { getPool } = require('../connection');

function getExecutor(conn) {
  return conn || getPool();
}

/**
 * Creates a new file operation record.
 * @param {Object} op
 * @param {number} op.user_id
 * @param {number|null} [op.file_id=null]
 * @param {string} op.operation_type - UPLOAD | DOWNLOAD | EDIT | DELETE | MOVE | SHARE
 * @param {string} [op.status='PENDING'] - PENDING | QUEUED | EXECUTING | COMPLETED | FAILED | ABORTED
 * @param {number} [op.priority=1] - 1 to 10
 * @param {Object|null} [op.details=null]
 * @param {Object} [conn]
 * @returns {Promise<Object>}
 */
async function createOperation({
  user_id,
  file_id = null,
  operation_type,
  status = 'PENDING',
  priority = 1,
  details = null,
}, conn) {
  const sql = `
    INSERT INTO OPERATIONS (user_id, file_id, operation_type, status, priority, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  const detailsJson = details ? JSON.stringify(details) : null;
  const [result] = await getExecutor(conn).execute(sql, [
    user_id,
    file_id,
    operation_type,
    status,
    priority,
    detailsJson,
  ]);
  return retrieveOperation(result.insertId, conn);
}

/**
 * Retrieves an operation by ID.
 * @param {number} operationId
 * @param {Object} [conn]
 * @returns {Promise<Object|null>}
 */
async function retrieveOperation(operationId, conn) {
  const sql = `
    SELECT
      o.*,
      u.username,
      u.email AS user_email,
      f.file_name
    FROM OPERATIONS o
    JOIN USERS u ON o.user_id = u.user_id
    LEFT JOIN FILES f ON o.file_id = f.file_id
    WHERE o.operation_id = ?
    LIMIT 1
  `;
  const [rows] = await getExecutor(conn).execute(sql, [operationId]);
  if (rows.length === 0) return null;
  const op = rows[0];
  if (typeof op.details === 'string') {
    try { op.details = JSON.parse(op.details); } catch (e) {}
  }
  return op;
}

/**
 * Updates an operation's status and optional completed timestamp.
 * @param {number} operationId
 * @param {string} status - PENDING | QUEUED | EXECUTING | COMPLETED | FAILED | ABORTED
 * @param {string|Date|null} [completedAt=null]
 * @param {Object} [conn]
 * @returns {Promise<Object|null>}
 */
async function updateOperationStatus(operationId, status, completedAt = undefined, conn) {
  let sql = `UPDATE OPERATIONS SET status = ?`;
  const params = [status];

  if (completedAt !== undefined && completedAt !== null) {
    sql += `, completed_at = ?`;
    params.push(completedAt);
  } else if (['COMPLETED', 'FAILED', 'ABORTED'].includes(status)) {
    sql += `, completed_at = CURRENT_TIMESTAMP`;
  }

  sql += ` WHERE operation_id = ?`;
  params.push(operationId);

  await getExecutor(conn).execute(sql, params);
  return retrieveOperation(operationId, conn);
}

/**
 * Lists operations created by a specific user.
 * @param {number} userId
 * @param {Object} [conn]
 * @returns {Promise<Array>}
 */
async function listOperationsByUser(userId, conn) {
  const sql = `
    SELECT
      o.*,
      u.username,
      f.file_name
    FROM OPERATIONS o
    JOIN USERS u ON o.user_id = u.user_id
    LEFT JOIN FILES f ON o.file_id = f.file_id
    WHERE o.user_id = ?
    ORDER BY o.created_at DESC
  `;
  const [rows] = await getExecutor(conn).execute(sql, [userId]);
  return rows.map(r => {
    if (typeof r.details === 'string') {
      try { r.details = JSON.parse(r.details); } catch (e) {}
    }
    return r;
  });
}

/**
 * Lists operations by execution status.
 * @param {string} status
 * @param {Object} [conn]
 * @returns {Promise<Array>}
 */
async function listOperationsByStatus(status, conn) {
  const sql = `
    SELECT
      o.*,
      u.username,
      f.file_name
    FROM OPERATIONS o
    JOIN USERS u ON o.user_id = u.user_id
    LEFT JOIN FILES f ON o.file_id = f.file_id
    WHERE o.status = ?
    ORDER BY o.priority DESC, o.created_at ASC
  `;
  const [rows] = await getExecutor(conn).execute(sql, [status]);
  return rows.map(r => {
    if (typeof r.details === 'string') {
      try { r.details = JSON.parse(r.details); } catch (e) {}
    }
    return r;
  });
}

module.exports = {
  createOperation,
  retrieveOperation,
  updateOperationStatus,
  listOperationsByUser,
  listOperationsByStatus,
};
