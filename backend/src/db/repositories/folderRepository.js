/**
 * ConflictCore - Folder Repository
 * Data access layer for the FOLDERS table representing directory hierarchy.
 */

const { getPool } = require('../connection');

function getExecutor(conn) {
  return conn || getPool();
}

/**
 * Creates a new folder.
 * @param {Object} folder
 * @param {string} folder.folder_name
 * @param {number|null} [folder.parent_folder_id=null]
 * @param {number} folder.owner_id
 * @param {Object} [conn]
 * @returns {Promise<Object>}
 */
async function createFolder({ folder_name, parent_folder_id = null, owner_id }, conn) {
  const sql = `
    INSERT INTO FOLDERS (folder_name, parent_folder_id, owner_id)
    VALUES (?, ?, ?)
  `;
  const [result] = await getExecutor(conn).execute(sql, [folder_name, parent_folder_id, owner_id]);
  return findFolderById(result.insertId, conn);
}

/**
 * Finds a folder by ID.
 * @param {number} folderId
 * @param {Object} [conn]
 * @returns {Promise<Object|null>}
 */
async function findFolderById(folderId, conn) {
  const sql = `
    SELECT f.*, u.username AS owner_name
    FROM FOLDERS f
    JOIN USERS u ON f.owner_id = u.user_id
    WHERE f.folder_id = ?
    LIMIT 1
  `;
  const [rows] = await getExecutor(conn).execute(sql, [folderId]);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Lists all folders owned by a specific user, or all folders if ownerId is omitted.
 * @param {number} [ownerId]
 * @param {Object} [conn]
 * @returns {Promise<Array>}
 */
async function listFolders(ownerId, conn) {
  let sql = `
    SELECT f.*, u.username AS owner_name, parent.folder_name AS parent_folder_name
    FROM FOLDERS f
    JOIN USERS u ON f.owner_id = u.user_id
    LEFT JOIN FOLDERS parent ON f.parent_folder_id = parent.folder_id
    WHERE 1=1
  `;
  const params = [];
  if (ownerId !== undefined && ownerId !== null) {
    sql += ` AND f.owner_id = ?`;
    params.push(ownerId);
  }
  sql += ` ORDER BY f.parent_folder_id ASC, f.folder_name ASC`;
  const [rows] = await getExecutor(conn).execute(sql, params);
  return rows;
}

/**
 * Retrieves direct child folders inside a parent folder.
 * If parentFolderId is null, returns root-level folders.
 * @param {number|null} parentFolderId
 * @param {Object} [conn]
 * @returns {Promise<Array>}
 */
async function getChildFolders(parentFolderId = null, conn) {
  let sql;
  const params = [];
  if (parentFolderId === null) {
    sql = `
      SELECT f.*, u.username AS owner_name
      FROM FOLDERS f
      JOIN USERS u ON f.owner_id = u.user_id
      WHERE f.parent_folder_id IS NULL
      ORDER BY f.folder_name ASC
    `;
  } else {
    sql = `
      SELECT f.*, u.username AS owner_name
      FROM FOLDERS f
      JOIN USERS u ON f.owner_id = u.user_id
      WHERE f.parent_folder_id = ?
      ORDER BY f.folder_name ASC
    `;
    params.push(parentFolderId);
  }
  const [rows] = await getExecutor(conn).execute(sql, params);
  return rows;
}

/**
 * Updates folder name or moves it to a new parent folder.
 * @param {number} folderId
 * @param {Object} updates
 * @param {Object} [conn]
 * @returns {Promise<Object|null>}
 */
async function updateFolder(folderId, updates, conn) {
  const allowed = ['folder_name', 'parent_folder_id', 'owner_id'];
  const fields = [];
  const params = [];

  for (const [key, value] of Object.entries(updates)) {
    if (allowed.includes(key)) {
      fields.push(`${key} = ?`);
      params.push(value);
    }
  }

  if (fields.length === 0) return findFolderById(folderId, conn);

  params.push(folderId);
  const sql = `UPDATE FOLDERS SET ${fields.join(', ')} WHERE folder_id = ?`;
  await getExecutor(conn).execute(sql, params);
  return findFolderById(folderId, conn);
}

/**
 * Deletes a folder (cascades to subfolders based on FK definition).
 * @param {number} folderId
 * @param {Object} [conn]
 * @returns {Promise<boolean>}
 */
async function deleteFolder(folderId, conn) {
  const sql = `DELETE FROM FOLDERS WHERE folder_id = ?`;
  const [result] = await getExecutor(conn).execute(sql, [folderId]);
  return result.affectedRows > 0;
}

module.exports = {
  createFolder,
  findFolderById,
  listFolders,
  getChildFolders,
  updateFolder,
  deleteFolder,
};
