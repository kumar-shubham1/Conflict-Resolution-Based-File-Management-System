/**
 * ConflictCore - Permission Repository
 * Data access layer for FILE_PERMISSIONS table controlling user authorization on files.
 */

const { getPool } = require('../connection');

function getExecutor(conn) {
  return conn || getPool();
}

/**
 * Grants a new permission to a user for a file.
 * @param {Object} permission
 * @param {number} permission.file_id
 * @param {number} permission.user_id
 * @param {string} [permission.permission_type='READ'] - READ | WRITE | EXECUTE | ADMIN | READ_WRITE
 * @param {number|null} [permission.granted_by=null]
 * @param {string|Date|null} [permission.expires_at=null]
 * @param {Object} [conn]
 * @returns {Promise<Object>} Created permission record
 */
async function grantPermission({
  file_id,
  user_id,
  permission_type = 'READ',
  granted_by = null,
  expires_at = null,
}, conn) {
  const sql = `
    INSERT INTO FILE_PERMISSIONS (file_id, user_id, permission_type, granted_by, expires_at)
    VALUES (?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      permission_type = VALUES(permission_type),
      granted_by = VALUES(granted_by),
      expires_at = VALUES(expires_at)
  `;
  const [result] = await getExecutor(conn).execute(sql, [file_id, user_id, permission_type, granted_by, expires_at]);
  const permissionId = result.insertId || (await findPermissionId(file_id, user_id, permission_type, conn));
  return getPermissionById(permissionId, conn);
}

/**
 * Internal helper to find permission ID by composite keys.
 */
async function findPermissionId(fileId, userId, permissionType, conn) {
  const sql = `
    SELECT permission_id FROM FILE_PERMISSIONS
    WHERE file_id = ? AND user_id = ? AND permission_type = ?
    LIMIT 1
  `;
  const [rows] = await getExecutor(conn).execute(sql, [fileId, userId, permissionType]);
  return rows.length > 0 ? rows[0].permission_id : null;
}

/**
 * Retrieves a permission by its ID.
 * @param {number} permissionId
 * @param {Object} [conn]
 * @returns {Promise<Object|null>}
 */
async function getPermissionById(permissionId, conn) {
  const sql = `
    SELECT
      fp.*,
      f.file_name,
      u.username AS authorized_user,
      granter.username AS granted_by_user
    FROM FILE_PERMISSIONS fp
    JOIN FILES f ON fp.file_id = f.file_id
    JOIN USERS u ON fp.user_id = u.user_id
    LEFT JOIN USERS granter ON fp.granted_by = granter.user_id
    WHERE fp.permission_id = ?
    LIMIT 1
  `;
  const [rows] = await getExecutor(conn).execute(sql, [permissionId]);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Checks whether a user has a specific permission (or ADMIN) on a file.
 * Handles owner privilege and expiration checking.
 * @param {number} fileId
 * @param {number} userId
 * @param {string} requiredPermission - READ | WRITE | EXECUTE | ADMIN
 * @param {Object} [conn]
 * @returns {Promise<boolean>}
 */
async function checkPermission(fileId, userId, requiredPermission, conn) {
  // Check if user is owner of the file (owners have full permissions)
  const ownerSql = `SELECT owner_id FROM FILES WHERE file_id = ? LIMIT 1`;
  const [fileRows] = await getExecutor(conn).execute(ownerSql, [fileId]);
  if (fileRows.length > 0 && fileRows[0].owner_id === userId) {
    return true;
  }

  // Check explicit permissions
  const permSql = `
    SELECT permission_type, expires_at
    FROM FILE_PERMISSIONS
    WHERE file_id = ? AND user_id = ?
  `;
  const [rows] = await getExecutor(conn).execute(permSql, [fileId, userId]);
  if (rows.length === 0) return false;

  const now = new Date();
  for (const row of rows) {
    if (row.expires_at && new Date(row.expires_at) < now) {
      continue; // expired
    }
    if (row.permission_type === 'ADMIN') return true;
    if (row.permission_type === requiredPermission) return true;
    if (row.permission_type === 'READ_WRITE' && (requiredPermission === 'READ' || requiredPermission === 'WRITE')) {
      return true;
    }
  }

  return false;
}

/**
 * Updates an existing permission.
 * @param {number} permissionId
 * @param {Object} updates
 * @param {Object} [conn]
 * @returns {Promise<Object|null>}
 */
async function updatePermission(permissionId, updates, conn) {
  const allowed = ['permission_type', 'expires_at'];
  const fields = [];
  const params = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowed.includes(key)) {
      fields.push(`${key} = ?`);
      params.push(value);
    }
  }

  if (fields.length === 0) return getPermissionById(permissionId, conn);

  params.push(permissionId);
  const sql = `UPDATE FILE_PERMISSIONS SET ${fields.join(', ')} WHERE permission_id = ?`;
  await getExecutor(conn).execute(sql, params);
  return getPermissionById(permissionId, conn);
}

/**
 * Revokes a permission by ID.
 * @param {number} permissionId
 * @param {Object} [conn]
 * @returns {Promise<boolean>}
 */
async function revokePermission(permissionId, conn) {
  const sql = `DELETE FROM FILE_PERMISSIONS WHERE permission_id = ?`;
  const [result] = await getExecutor(conn).execute(sql, [permissionId]);
  return result.affectedRows > 0;
}

/**
 * Retrieves all permissions granted for a given file.
 * @param {number} fileId
 * @param {Object} [conn]
 * @returns {Promise<Array>}
 */
async function getPermissionsByFile(fileId, conn) {
  const sql = `
    SELECT
      fp.permission_id,
      fp.file_id,
      f.file_name,
      fp.user_id,
      u.username AS authorized_user,
      u.email AS user_email,
      fp.permission_type,
      fp.granted_by,
      granter.username AS granted_by_user,
      fp.granted_at,
      fp.expires_at
    FROM FILE_PERMISSIONS fp
    JOIN FILES f ON fp.file_id = f.file_id
    JOIN USERS u ON fp.user_id = u.user_id
    LEFT JOIN USERS granter ON fp.granted_by = granter.user_id
    WHERE fp.file_id = ?
    ORDER BY fp.permission_type ASC
  `;
  const [rows] = await getExecutor(conn).execute(sql, [fileId]);
  return rows;
}

module.exports = {
  grantPermission,
  getPermissionById,
  checkPermission,
  updatePermission,
  revokePermission,
  getPermissionsByFile,
};
