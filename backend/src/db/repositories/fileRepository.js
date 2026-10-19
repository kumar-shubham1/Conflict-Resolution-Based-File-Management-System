/**
 * ConflictCore - File Repository
 * Data access layer for the FILES table.
 */

const { getPool } = require('../connection');

function getExecutor(conn) {
  return conn || getPool();
}

/**
 * Creates a new file metadata record.
 * @param {Object} file
 * @param {string} file.file_name
 * @param {number|null} [file.folder_id=null]
 * @param {number} file.owner_id
 * @param {number} [file.file_size_bytes=0]
 * @param {string} file.file_path
 * @param {string} [file.mime_type='text/plain']
 * @param {string} [file.status='ACTIVE'] - ACTIVE | TRASHED | LOCKED | DELETED
 * @param {Object} [conn]
 * @returns {Promise<Object>} Created file record
 */
async function createFile({
  file_name,
  folder_id = null,
  owner_id,
  file_size_bytes = 0,
  file_path,
  mime_type = 'text/plain',
  status = 'ACTIVE',
}, conn) {
  const sql = `
    INSERT INTO FILES (file_name, folder_id, owner_id, file_size_bytes, file_path, mime_type, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
  const [result] = await getExecutor(conn).execute(sql, [
    file_name,
    folder_id,
    owner_id,
    file_size_bytes,
    file_path,
    mime_type,
    status,
  ]);
  return getFileById(result.insertId, conn);
}

/**
 * Retrieves a file by its ID with owner and folder details.
 * @param {number} fileId
 * @param {Object} [conn]
 * @returns {Promise<Object|null>}
 */
async function getFileById(fileId, conn) {
  const sql = `
    SELECT
      f.*,
      u.username AS owner_name,
      fo.folder_name
    FROM FILES f
    JOIN USERS u ON f.owner_id = u.user_id
    LEFT JOIN FOLDERS fo ON f.folder_id = fo.folder_id
    WHERE f.file_id = ?
    LIMIT 1
  `;
  const [rows] = await getExecutor(conn).execute(sql, [fileId]);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Lists files based on folder, owner, and status filters.
 * @param {Object} [filters]
 * @param {number|null} [filters.folder_id]
 * @param {number} [filters.owner_id]
 * @param {string} [filters.status]
 * @param {Object} [conn]
 * @returns {Promise<Array>}
 */
async function listFiles({ folder_id, owner_id, status } = {}, conn) {
  let sql = `
    SELECT
      f.*,
      u.username AS owner_name,
      fo.folder_name
    FROM FILES f
    JOIN USERS u ON f.owner_id = u.user_id
    LEFT JOIN FOLDERS fo ON f.folder_id = fo.folder_id
    WHERE 1=1
  `;
  const params = [];

  if (folder_id !== undefined) {
    if (folder_id === null) {
      sql += ` AND f.folder_id IS NULL`;
    } else {
      sql += ` AND f.folder_id = ?`;
      params.push(folder_id);
    }
  }

  if (owner_id !== undefined && owner_id !== null) {
    sql += ` AND f.owner_id = ?`;
    params.push(owner_id);
  }

  if (status) {
    sql += ` AND f.status = ?`;
    params.push(status);
  }

  sql += ` ORDER BY f.file_name ASC`;
  const [rows] = await getExecutor(conn).execute(sql, params);
  return rows;
}

/**
 * Updates a file's metadata, status, or path.
 * @param {number} fileId
 * @param {Object} updates
 * @param {Object} [conn]
 * @returns {Promise<Object|null>}
 */
async function updateFile(fileId, updates, conn) {
  const allowed = ['file_name', 'folder_id', 'file_size_bytes', 'file_path', 'mime_type', 'status'];
  const fields = [];
  const params = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowed.includes(key)) {
      fields.push(`${key} = ?`);
      params.push(value);
    }
  }

  if (fields.length === 0) return getFileById(fileId, conn);

  params.push(fileId);
  const sql = `UPDATE FILES SET ${fields.join(', ')} WHERE file_id = ?`;
  await getExecutor(conn).execute(sql, params);
  return getFileById(fileId, conn);
}

/**
 * Deletes a file record (cascades to locks and permissions per FKs).
 * @param {number} fileId
 * @param {Object} [conn]
 * @returns {Promise<boolean>}
 */
async function deleteFile(fileId, conn) {
  const sql = `DELETE FROM FILES WHERE file_id = ?`;
  const [result] = await getExecutor(conn).execute(sql, [fileId]);
  return result.affectedRows > 0;
}

module.exports = {
  createFile,
  getFileById,
  listFiles,
  updateFile,
  deleteFile,
};
