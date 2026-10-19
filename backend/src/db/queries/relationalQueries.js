/**
 * ConflictCore - Relational Query Suite
 * Dedicated multi-table relational query functions matching the core DBMS requirements.
 */

const { getPool } = require('../connection');

function getExecutor(conn) {
  return conn || getPool();
}

/**
 * 1. Get all files owned by a specific user.
 * @param {number} userId
 * @param {Object} [conn]
 * @returns {Promise<Array>}
 */
async function getFilesOwnedByUser(userId, conn) {
  const sql = `
    SELECT
      f.file_id,
      f.file_name,
      f.file_size_bytes,
      f.mime_type,
      f.status AS file_status,
      f.file_path,
      u.username AS owner_name,
      COALESCE(fo.folder_name, '[Root]') AS folder_name
    FROM FILES f
    JOIN USERS u ON f.owner_id = u.user_id
    LEFT JOIN FOLDERS fo ON f.folder_id = fo.folder_id
    WHERE u.user_id = ?
    ORDER BY f.file_name ASC
  `;
  const [rows] = await getExecutor(conn).execute(sql, [userId]);
  return rows;
}

/**
 * 2. Get all files inside a folder (or root directory if folderId is null).
 * @param {number|null} folderId
 * @param {Object} [conn]
 * @returns {Promise<Array>}
 */
async function getFilesInFolder(folderId, conn) {
  let sql;
  const params = [];
  if (folderId === null || folderId === undefined) {
    sql = `
      SELECT
        f.file_id,
        f.file_name,
        f.file_size_bytes,
        f.mime_type,
        f.status,
        u.username AS owner_name,
        '[Root]' AS folder_name
      FROM FILES f
      JOIN USERS u ON f.owner_id = u.user_id
      WHERE f.folder_id IS NULL
      ORDER BY f.file_name ASC
    `;
  } else {
    sql = `
      SELECT
        f.file_id,
        f.file_name,
        f.file_size_bytes,
        f.mime_type,
        f.status,
        u.username AS owner_name,
        fo.folder_name
      FROM FILES f
      JOIN FOLDERS fo ON f.folder_id = fo.folder_id
      JOIN USERS u ON f.owner_id = u.user_id
      WHERE fo.folder_id = ?
      ORDER BY f.file_name ASC
    `;
    params.push(folderId);
  }
  const [rows] = await getExecutor(conn).execute(sql, params);
  return rows;
}

/**
 * 3. Get permissions granted for a file with user details.
 * @param {number} fileId
 * @param {Object} [conn]
 * @returns {Promise<Array>}
 */
async function getPermissionsForFile(fileId, conn) {
  const sql = `
    SELECT
      fp.permission_id,
      f.file_name,
      u.user_id,
      u.username AS authorized_user,
      u.email AS user_email,
      fp.permission_type,
      granter.username AS granted_by_user,
      fp.granted_at,
      fp.expires_at
    FROM FILE_PERMISSIONS fp
    JOIN FILES f ON fp.file_id = f.file_id
    JOIN USERS u ON fp.user_id = u.user_id
    LEFT JOIN USERS granter ON fp.granted_by = granter.user_id
    WHERE f.file_id = ?
    ORDER BY fp.permission_type ASC
  `;
  const [rows] = await getExecutor(conn).execute(sql, [fileId]);
  return rows;
}

/**
 * 4. Get operations created by a specific user.
 * @param {number} userId
 * @param {Object} [conn]
 * @returns {Promise<Array>}
 */
async function getOperationsCreatedByUser(userId, conn) {
  const sql = `
    SELECT
      o.operation_id,
      u.username,
      COALESCE(f.file_name, '[No File Target]') AS target_file,
      o.operation_type,
      o.status AS operation_status,
      o.priority,
      o.created_at,
      o.completed_at
    FROM OPERATIONS o
    JOIN USERS u ON o.user_id = u.user_id
    LEFT JOIN FILES f ON o.file_id = f.file_id
    WHERE u.user_id = ?
    ORDER BY o.created_at DESC
  `;
  const [rows] = await getExecutor(conn).execute(sql, [userId]);
  return rows;
}

/**
 * 5. Get process associated with an operation.
 * @param {number} operationId
 * @param {Object} [conn]
 * @returns {Promise<Object|null>}
 */
async function getProcessAssociatedWithOperation(operationId, conn) {
  const sql = `
    SELECT
      p.process_id,
      p.pid_alias,
      p.state AS process_state,
      p.priority AS process_priority,
      p.cpu_burst_time,
      p.memory_allocated_kb,
      o.operation_id,
      o.operation_type,
      o.status AS operation_status,
      f.file_name AS target_file,
      u.username AS triggered_by
    FROM PROCESSES p
    JOIN OPERATIONS o ON p.operation_id = o.operation_id
    LEFT JOIN FILES f ON o.file_id = f.file_id
    JOIN USERS u ON o.user_id = u.user_id
    WHERE o.operation_id = ?
    LIMIT 1
  `;
  const [rows] = await getExecutor(conn).execute(sql, [operationId]);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * 6. Get active lock(s) on a file, including lock holder information.
 * @param {number} fileId
 * @param {Object} [conn]
 * @returns {Promise<Array>}
 */
async function getActiveLocksOnFile(fileId, conn) {
  const sql = `
    SELECT
      fl.lock_id,
      f.file_id,
      f.file_name,
      p.process_id,
      p.pid_alias,
      u.user_id,
      u.username AS lock_holder,
      fl.lock_type,
      fl.lock_status,
      fl.acquired_at
    FROM FILE_LOCKS fl
    JOIN FILES f ON fl.file_id = f.file_id
    JOIN PROCESSES p ON fl.process_id = p.process_id
    JOIN OPERATIONS o ON p.operation_id = o.operation_id
    JOIN USERS u ON o.user_id = u.user_id
    WHERE fl.file_id = ? AND fl.lock_status = 'ACQUIRED'
  `;
  const [rows] = await getExecutor(conn).execute(sql, [fileId]);
  return rows;
}

/**
 * 7. Get waiting processes queued for a file lock (conflict/queue representation).
 * @param {number} fileId
 * @param {Object} [conn]
 * @returns {Promise<Array>}
 */
async function getWaitingProcessesForFile(fileId, conn) {
  const sql = `
    SELECT
      fl.lock_id,
      f.file_id,
      f.file_name,
      p.process_id,
      p.pid_alias AS waiting_pid,
      p.state AS process_state,
      u.user_id,
      u.username AS requesting_user,
      fl.lock_type AS requested_lock_type,
      fl.lock_status,
      fl.requested_at
    FROM FILE_LOCKS fl
    JOIN FILES f ON fl.file_id = f.file_id
    JOIN PROCESSES p ON fl.process_id = p.process_id
    JOIN OPERATIONS o ON p.operation_id = o.operation_id
    JOIN USERS u ON o.user_id = u.user_id
    WHERE fl.file_id = ? AND fl.lock_status = 'WAITING'
    ORDER BY fl.requested_at ASC
  `;
  const [rows] = await getExecutor(conn).execute(sql, [fileId]);
  return rows;
}

/**
 * 8. Get complete process and operation history for a target file.
 * @param {number} fileId
 * @param {Object} [conn]
 * @returns {Promise<Array>}
 */
async function getProcessAndOperationHistory(fileId, conn) {
  const sql = `
    SELECT
      o.operation_id,
      o.operation_type,
      o.status AS operation_status,
      o.priority AS operation_priority,
      o.created_at AS operation_created_at,
      o.completed_at AS operation_completed_at,
      p.process_id,
      p.pid_alias,
      p.state AS process_state,
      p.cpu_burst_time,
      fl.lock_id,
      fl.lock_type,
      fl.lock_status,
      u.username AS initiated_by
    FROM OPERATIONS o
    JOIN USERS u ON o.user_id = u.user_id
    LEFT JOIN PROCESSES p ON p.operation_id = o.operation_id
    LEFT JOIN FILE_LOCKS fl ON fl.process_id = p.process_id
    WHERE o.file_id = ?
    ORDER BY o.created_at DESC
  `;
  const [rows] = await getExecutor(conn).execute(sql, [fileId]);
  return rows;
}

module.exports = {
  getFilesOwnedByUser,
  getFilesInFolder,
  getPermissionsForFile,
  getOperationsCreatedByUser,
  getProcessAssociatedWithOperation,
  getActiveLocksOnFile,
  getWaitingProcessesForFile,
  getProcessAndOperationHistory,
};
