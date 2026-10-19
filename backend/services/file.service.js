import pool from '../config/db.js';

export const getAllFiles = async () => {
    const [rows] = await pool.query(`
        SELECT
            file_id,
            file_name,
            folder_id,
            owner_id,
            file_size_bytes,
            file_path,
            mime_type,
            status,
            created_at,
            updated_at
        FROM FILES
        ORDER BY created_at DESC
    `);

    return rows;
};

export const getFileById = async (id) => {
    const [rows] = await pool.query(
        `SELECT
            file_id,
            file_name,
            folder_id,
            owner_id,
            file_size_bytes,
            file_path,
            mime_type,
            status,
            created_at,
            updated_at
         FROM FILES
         WHERE file_id = ?`,
        [id]
    );

    return rows[0] || null;
};

export const createNewFile = async (data) => {
    const {
        file_name,
        folder_id,
        owner_id,
        file_size_bytes,
        file_path,
        mime_type
    } = data;

    const [result] = await pool.query(
        `INSERT INTO FILES
        (
            file_name,
            folder_id,
            owner_id,
            file_size_bytes,
            file_path,
            mime_type
        )
        VALUES (?, ?, ?, ?, ?, ?)`,
        [
            file_name,
            folder_id || null,
            owner_id,
            file_size_bytes,
            file_path,
            mime_type
        ]
    );

    return getFileById(result.insertId);
};

export const updateExistingFile = async (id, data) => {
    const {
        file_name,
        folder_id,
        status
    } = data;

    const existingFile = await getFileById(id);

    if (!existingFile) {
        return null;
    }

    await pool.query(
        `UPDATE FILES
         SET
            file_name = COALESCE(?, file_name),
            folder_id = COALESCE(?, folder_id),
            status = COALESCE(?, status)
         WHERE file_id = ?`,
        [
            file_name || null,
            folder_id ?? null,
            status || null,
            id
        ]
    );

    return getFileById(id);
};

export const deleteFileById = async (id) => {
    const [result] = await pool.query(
        `DELETE FROM FILES WHERE file_id = ?`,
        [id]
    );

    return {
        deleted: result.affectedRows > 0,
        id
    };
};

export const createUploadedFileRecord = async ({
    fileName,
    ownerId,
    fileSize,
    filePath,
    mimeType
}) => {
    const [result] = await pool.query(
        `INSERT INTO FILES
        (
            file_name,
            owner_id,
            file_size_bytes,
            file_path,
            mime_type
        )
        VALUES (?, ?, ?, ?, ?)`,
        [
            fileName,
            ownerId,
            fileSize,
            filePath,
            mimeType
        ]
    );

    return getFileById(result.insertId);
};