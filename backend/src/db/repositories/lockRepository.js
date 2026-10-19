/**
 * ConflictCore - Lock Repository
 * Data access layer for the FILE_LOCKS table representing file-level lock persistence.
 */

const { getPool } = require('../connection');

function getExecutor(conn) {
  return conn || getPool();
}

/**
 * Creates a lock record (request or direct acquisition).
 * @param {Object} lock
 * @param {number} lock.file_id
 * @param {number} lock.process_id
 * @param {string} [lock.lock_type='EXCLUSIVE'] - SHARED | EXCLUSIVE
 * @param {string} [lock.lock_status='WAITING'] - WAITING | ACQUIRED | RELEASED | ABORTED
 * @param {Object} [conn]
 * @returns {Promise<Object>}
 */
async function acquireOrRequestLock({
  file_id,
  process_id,
  lock_type = 'EXCLUSIVE',
  lock_status = 'WAITING',
}, conn) {
  const sql = `
    INSERT INTO FILE_LOCKS (file_id, process_id, lock_type, lock_status, acquired_at)
    VALUES (?, ?, ?, ?, ${lock_status === 'ACQUIRED' ? 'CURRENT_TIMESTAMP' : 'NULL'})
  `;
  const [result] = await getExecutor(conn).execute(sql, [file_id, process_id, lock_type, lock_status]);
  return findLockById(result.insertId, conn);
}

/**
 * Finds a lock record by lock_id.
 * @param {number} lockId
 * @param {Object} [conn]
 * @returns {Promise<Object|null>}
 */
async function findLockById(lockId, conn) {
  const sql = `
    SELECT
      fl.*,
      f.file_name,
      p.pid_alias,
      p.state AS process_state,
      u.user_id,
      u.username AS lock_holder
    FROM FILE_LOCKS fl
    JOIN FILES f ON fl.file_id = f.file_id
    JOIN PROCESSES p ON fl.process_id = p.process_id
    JOIN OPERATIONS o ON p.operation_id = o.operation_id
    JOIN USERS u ON o.user_id = u.user_id
    WHERE fl.lock_id = ?
    LIMIT 1
  `;
  const [rows] = await getExecutor(conn).execute(sql, [lockId]);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Retrieves all currently ACQUIRED locks for a file (or all active locks across files).
 * @param {number} [fileId]
 * @param {Object} [conn]
 * @returns {Promise<Array>}
 */
async function retrieveActiveLocks(fileId, conn) {
  let sql = `
    SELECT
      fl.*,
      f.file_name,
      p.pid_alias,
      p.state AS process_state,
      u.user_id,
      u.username AS lock_holder
    FROM FILE_LOCKS fl
    JOIN FILES f ON fl.file_id = f.file_id
    JOIN PROCESSES p ON fl.process_id = p.process_id
    JOIN OPERATIONS o ON p.operation_id = o.operation_id
    JOIN USERS u ON o.user_id = u.user_id
    WHERE fl.lock_status = 'ACQUIRED'
  `;
  const params = [];
  if (fileId !== undefined && fileId !== null) {
    sql += ` AND fl.file_id = ?`;
    params.push(fileId);
  }
  sql += ` ORDER BY fl.acquired_at ASC`;
  const [rows] = await getExecutor(conn).execute(sql, params);
  return rows;
}

/**
 * Retrieves all WAITING lock requests for a file (or across all files).
 * Used by deadlock detection and wait-for graph construction.
 * @param {number} [fileId]
 * @param {Object} [conn]
 * @returns {Promise<Array>}
 */
async function retrieveWaitingLocks(fileId, conn) {
  let sql = `
    SELECT
      fl.*,
      f.file_name,
      p.pid_alias AS waiting_pid,
      p.state AS process_state,
      u.user_id,
      u.username AS requesting_user
    FROM FILE_LOCKS fl
    JOIN FILES f ON fl.file_id = f.file_id
    JOIN PROCESSES p ON fl.process_id = p.process_id
    JOIN OPERATIONS o ON p.operation_id = o.operation_id
    JOIN USERS u ON o.user_id = u.user_id
    WHERE fl.lock_status = 'WAITING'
  `;
  const params = [];
  if (fileId !== undefined && fileId !== null) {
    sql += ` AND fl.file_id = ?`;
    params.push(fileId);
  }
  sql += ` ORDER BY fl.requested_at ASC`;
  const [rows] = await getExecutor(conn).execute(sql, params);
  return rows;
}

/**
 * Updates a lock's status (e.g. from WAITING to ACQUIRED, or to RELEASED / ABORTED).
 * Automatically updates acquired_at and released_at timestamps.
 * @param {number} lockId
 * @param {string} lockStatus - WAITING | ACQUIRED | RELEASED | ABORTED
 * @param {Object} [updates]
 * @param {Object} [conn]
 * @returns {Promise<Object|null>}
 */
async function updateLockStatus(lockId, lockStatus, updates = {}, conn) {
  const fields = ['lock_status = ?'];
  const params = [lockStatus];

  if (lockStatus === 'ACQUIRED') {
    fields.push('acquired_at = CURRENT_TIMESTAMP');
  } else if (['RELEASED', 'ABORTED'].includes(lockStatus)) {
    fields.push('released_at = CURRENT_TIMESTAMP');
  }

  if (updates.lock_type) {
    fields.push('lock_type = ?');
    params.push(updates.lock_type);
  }

  params.push(lockId);
  const sql = `UPDATE FILE_LOCKS SET ${fields.join(', ')} WHERE lock_id = ?`;
  await getExecutor(conn).execute(sql, params);
  return findLockById(lockId, conn);
}

/**
 * Releases an active lock record (sets lock_status = 'RELEASED' and released_at).
 * @param {number} lockId
 * @param {Object} [conn]
 * @returns {Promise<Object|null>}
 */
async function releaseLock(lockId, conn) {
  return updateLockStatus(lockId, 'RELEASED', {}, conn);
}

module.exports = {
  acquireOrRequestLock,
  findLockById,
  retrieveActiveLocks,
  retrieveWaitingLocks,
  updateLockStatus,
  releaseLock,
};
