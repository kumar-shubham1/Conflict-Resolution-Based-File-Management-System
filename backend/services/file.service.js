import pool from '../config/db.js';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute SHA-256 checksum of a file on disk (best-effort). */
const fileChecksum = async (filePath) => {
    try {
        const buf = await fs.readFile(filePath);
        return crypto.createHash('sha256').update(buf).digest('hex');
    } catch {
        return null;
    }
};

/** Copy a file on disk and return the new path. */
const copyPhysicalFile = async (srcPath, destSuffix) => {
    try {
        const parsed = path.parse(srcPath);
        const newName = `${parsed.name}_${destSuffix}${parsed.ext}`;
        const destPath = path.join(parsed.dir, newName);
        await fs.copyFile(srcPath, destPath);
        return destPath;
    } catch (err) {
        console.error('copyPhysicalFile error:', err.message);
        return srcPath; // fallback to original path
    }
};

// ---------------------------------------------------------------------------
// Core CRUD
// ---------------------------------------------------------------------------

/**
 * getAllFiles(userId, role)
 *
 * - ADMIN role: returns every file in the database.
 * - Regular user: returns files owned by the caller AND files explicitly
 *   shared with the caller via FILE_PERMISSIONS (not expired).
 *
 * When called without arguments (e.g. from legacy internal callers or tests
 * that do not yet pass a userId) it falls back to the old "all files" behaviour
 * to avoid breaking existing OS-layer code that does not carry a user context.
 */
export const getAllFiles = async (userId, role) => {
    // Legacy / internal callers that pass no userId get the full list
    if (userId == null) {
        const [rows] = await pool.query(`
            SELECT
                f.file_id, f.file_name, f.folder_id, f.owner_id,
                f.file_size_bytes, f.file_path, f.mime_type, f.status,
                f.created_at, f.updated_at,
                COALESCE(cv.version_number, 1) AS current_version,
                'OWNER' AS permission
            FROM FILES f
            LEFT JOIN FILE_VERSIONS cv ON cv.file_id = f.file_id AND cv.is_current = TRUE
            ORDER BY f.created_at DESC
        `);
        return rows;
    }

    // Admin sees everything
    if (role === 'ADMIN') {
        const [rows] = await pool.query(`
            SELECT
                f.file_id, f.file_name, f.folder_id, f.owner_id,
                f.file_size_bytes, f.file_path, f.mime_type, f.status,
                f.created_at, f.updated_at,
                COALESCE(cv.version_number, 1) AS current_version,
                CASE WHEN f.owner_id = ? THEN 'OWNER' ELSE 'ADMIN_VIEW' END AS permission,
                u.username AS owner_username
            FROM FILES f
            LEFT JOIN FILE_VERSIONS cv ON cv.file_id = f.file_id AND cv.is_current = TRUE
            LEFT JOIN USERS u ON u.user_id = f.owner_id
            ORDER BY f.created_at DESC
        `, [userId]);
        return rows;
    }

    // Regular user: owned files UNION shared files
    const [rows] = await pool.query(`
        SELECT
            f.file_id, f.file_name, f.folder_id, f.owner_id,
            f.file_size_bytes, f.file_path, f.mime_type, f.status,
            f.created_at, f.updated_at,
            COALESCE(cv.version_number, 1) AS current_version,
            CASE WHEN f.owner_id = ? THEN 'OWNER' ELSE fp.permission_type END AS permission,
            u.username AS owner_username
        FROM FILES f
        LEFT JOIN FILE_VERSIONS cv ON cv.file_id = f.file_id AND cv.is_current = TRUE
        LEFT JOIN FILE_PERMISSIONS fp
               ON fp.file_id = f.file_id
              AND fp.user_id = ?
              AND (fp.expires_at IS NULL OR fp.expires_at > NOW())
        LEFT JOIN USERS u ON u.user_id = f.owner_id
        WHERE f.owner_id = ?
           OR (fp.user_id = ? AND (fp.expires_at IS NULL OR fp.expires_at > NOW()))
        ORDER BY f.created_at DESC
    `, [userId, userId, userId, userId]);
    return rows;
};

export const getFileById = async (id) => {
    const [rows] = await pool.query(
        `SELECT
            f.file_id, f.file_name, f.folder_id, f.owner_id,
            f.file_size_bytes, f.file_path, f.mime_type, f.status,
            f.created_at, f.updated_at,
            COALESCE(cv.version_number, 1) AS current_version,
            cv.version_id AS current_version_id
         FROM FILES f
         LEFT JOIN FILE_VERSIONS cv ON cv.file_id = f.file_id AND cv.is_current = TRUE
         WHERE f.file_id = ?`,
        [id]
    );
    return rows[0] || null;
};

export const createNewFile = async (data) => {
    const { file_name, folder_id, owner_id, file_size_bytes, file_path, mime_type } = data;

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [result] = await connection.query(
            `INSERT INTO FILES (file_name, folder_id, owner_id, file_size_bytes, file_path, mime_type)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [file_name, folder_id || null, owner_id, file_size_bytes, file_path, mime_type]
        );
        const fileId = result.insertId;

        // Create initial version v1
        const checksum = await fileChecksum(file_path);
        await connection.query(
            `INSERT INTO FILE_VERSIONS
               (file_id, version_number, file_path, file_size_bytes, mime_type, checksum, change_summary, created_by, is_current)
             VALUES (?, 1, ?, ?, ?, ?, 'Initial upload', ?, TRUE)`,
            [fileId, file_path, file_size_bytes || 0, mime_type || 'application/octet-stream', checksum, owner_id]
        );

        await connection.commit();
        connection.release();
        return getFileById(fileId);
    } catch (err) {
        await connection.rollback();
        connection.release();
        throw err;
    }
};

export const updateExistingFile = async (id, data) => {
    const existingFile = await getFileById(id);
    if (!existingFile) return null;

    const updates = [];
    const values = [];

    if (data.file_name !== undefined) {
        updates.push('file_name = ?');
        values.push(data.file_name);
    }

    if (data.folder_id !== undefined) {
        updates.push('folder_id = ?');
        values.push((data.folder_id === null || data.folder_id === '' || data.folder_id === 'root') ? null : Number(data.folder_id));
    }

    if (data.status !== undefined) {
        updates.push('status = ?');
        values.push(data.status);
    }

    if (updates.length > 0) {
        values.push(id);
        await pool.query(
            `UPDATE FILES SET ${updates.join(', ')} WHERE file_id = ?`,
            values
        );
    }

    return getFileById(id);
};

/**
 * Update file content with optimistic concurrency control.
 * Detects stale-version conflicts using base_version_number.
 * Returns { file, newVersion, conflict } where conflict is non-null if detected.
 */
export const updateFileContent = async (fileId, {
    file_path: newFilePath,
    file_size_bytes: newSize,
    mime_type: newMimeType,
    base_version_number,
    user_id,
    change_summary
}) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // Lock the file row for update
        const [fileRows] = await connection.query(
            'SELECT file_id, file_name, file_path, owner_id FROM FILES WHERE file_id = ? FOR UPDATE',
            [fileId]
        );
        if (!fileRows.length) {
            await connection.rollback();
            connection.release();
            throw new Error('File not found');
        }
        const file = fileRows[0];

        // Get the current version
        const [currentVersionRows] = await connection.query(
            'SELECT version_id, version_number, file_path, checksum FROM FILE_VERSIONS WHERE file_id = ? AND is_current = TRUE',
            [fileId]
        );
        const currentVersion = currentVersionRows[0] || null;
        const currentVersionNumber = currentVersion ? currentVersion.version_number : 0;

        // --- Optimistic Concurrency Check ---
        if (base_version_number != null && Number(base_version_number) < currentVersionNumber) {
            // The client's base version is stale — a concurrent edit has occurred since they read the file.
            // Create a new version for the incoming content but mark it as a conflicting submission.
            const incomingVersionNumber = currentVersionNumber + 1;
            const checksum = await fileChecksum(newFilePath);

            await connection.query(
                'UPDATE FILE_VERSIONS SET is_current = FALSE WHERE file_id = ? AND is_current = TRUE',
                [fileId]
            );

            const [incomingVer] = await connection.query(
                `INSERT INTO FILE_VERSIONS
                   (file_id, version_number, file_path, file_size_bytes, mime_type, checksum, change_summary, created_by, is_current)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, FALSE)`,
                [fileId, incomingVersionNumber, newFilePath, newSize || 0, newMimeType || file.mime_type || 'application/octet-stream',
                 checksum, change_summary || 'Concurrent edit (conflict)', user_id]
            );

            // Re-mark the current version as current (the incoming is NOT current until resolved)
            if (currentVersion) {
                await connection.query(
                    'UPDATE FILE_VERSIONS SET is_current = TRUE WHERE version_id = ?',
                    [currentVersion.version_id]
                );
            }

            // Record the conflict
            const [conflictResult] = await connection.query(
                `INSERT INTO CONFLICTS
                   (file_id, base_version_id, current_version_id, incoming_version_id, initiated_by, conflict_type, status, details)
                 VALUES (?, ?, ?, ?, ?, 'STALE_UPDATE', 'OPEN', ?)`,
                [fileId,
                 currentVersion ? currentVersion.version_id : null,
                 currentVersion ? currentVersion.version_id : null,
                 incomingVer.insertId,
                 user_id,
                 JSON.stringify({
                     base_version: base_version_number,
                     current_version: currentVersionNumber,
                     incoming_version: incomingVersionNumber,
                     message: `User submitted changes based on v${base_version_number}, but file is at v${currentVersionNumber}`
                 })]
            );

            await connection.commit();
            connection.release();

            return {
                file: await getFileById(fileId),
                newVersion: null,
                conflict: {
                    conflict_id: conflictResult.insertId,
                    base_version: base_version_number,
                    current_version: currentVersionNumber,
                    incoming_version: incomingVersionNumber,
                    message: `Concurrent change detected: your edit was based on v${base_version_number}, but the file is now at v${currentVersionNumber}. Please review the conflict.`
                }
            };
        }

        // --- No conflict: create new version normally ---
        const newVersionNumber = currentVersionNumber + 1;
        const checksum = await fileChecksum(newFilePath);

        // Mark old version as not current
        await connection.query(
            'UPDATE FILE_VERSIONS SET is_current = FALSE WHERE file_id = ? AND is_current = TRUE',
            [fileId]
        );

        // Insert new version
        await connection.query(
            `INSERT INTO FILE_VERSIONS
               (file_id, version_number, file_path, file_size_bytes, mime_type, checksum, change_summary, created_by, is_current)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
            [fileId, newVersionNumber, newFilePath, newSize || 0, newMimeType || 'application/octet-stream',
             checksum, change_summary || `Updated to v${newVersionNumber}`, user_id]
        );

        // Update the FILES table to point to new content
        await connection.query(
            'UPDATE FILES SET file_path = ?, file_size_bytes = ?, mime_type = ? WHERE file_id = ?',
            [newFilePath, newSize || 0, newMimeType || 'application/octet-stream', fileId]
        );

        await connection.commit();
        connection.release();

        return {
            file: await getFileById(fileId),
            newVersion: newVersionNumber,
            conflict: null
        };
    } catch (err) {
        await connection.rollback();
        connection.release();
        throw err;
    }
};

export const deleteFileById = async (id) => {
    const [result] = await pool.query(
        `DELETE FROM FILES WHERE file_id = ?`,
        [id]
    );
    return { deleted: result.affectedRows > 0, id };
};

export const createUploadedFileRecord = async ({
    fileName, folderId = null, ownerId = 1, fileSize, filePath, mimeType
}) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [result] = await connection.query(
            `INSERT INTO FILES (file_name, folder_id, owner_id, file_size_bytes, file_path, mime_type)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [fileName, folderId || null, ownerId, fileSize, filePath, mimeType]
        );
        const fileId = result.insertId;

        // Create initial version v1
        const checksum = await fileChecksum(filePath);
        await connection.query(
            `INSERT INTO FILE_VERSIONS
               (file_id, version_number, file_path, file_size_bytes, mime_type, checksum, change_summary, created_by, is_current)
             VALUES (?, 1, ?, ?, ?, ?, 'Initial upload', ?, TRUE)`,
            [fileId, filePath, fileSize || 0, mimeType || 'application/octet-stream', checksum, ownerId]
        );

        await connection.commit();
        connection.release();
        return getFileById(fileId);
    } catch (err) {
        await connection.rollback();
        connection.release();
        throw err;
    }
};

// ---------------------------------------------------------------------------
// Version History (now reads from FILE_VERSIONS table)
// ---------------------------------------------------------------------------

export const getFileVersions = async (fileId) => {
    const file = await getFileById(fileId);
    if (!file) return null;

    // Get real versions from FILE_VERSIONS table
    const [versionRows] = await pool.query(
        `SELECT
            fv.version_id, fv.version_number, fv.file_path, fv.file_size_bytes,
            fv.mime_type, fv.checksum, fv.change_summary, fv.is_current,
            fv.created_by, fv.created_at,
            u.username AS author_name
         FROM FILE_VERSIONS fv
         JOIN USERS u ON fv.created_by = u.user_id
         WHERE fv.file_id = ?
         ORDER BY fv.version_number ASC`,
        [fileId]
    );

    // Also get operation-based activity for context
    const [opRows] = await pool.query(
        `SELECT
            o.operation_id, o.user_id, u.username AS author_name,
            o.operation_type, o.status, o.details,
            o.created_at, o.completed_at
         FROM OPERATIONS o
         JOIN USERS u ON o.user_id = u.user_id
         WHERE o.file_id = ?
         ORDER BY o.created_at ASC`,
        [fileId]
    );

    const versions = versionRows.map(v => ({
        version_id: v.version_id,
        version_number: v.version_number,
        author_id: v.created_by,
        author_name: v.author_name,
        file_size_bytes: v.file_size_bytes,
        checksum: v.checksum,
        change_summary: v.change_summary,
        is_current: Boolean(v.is_current),
        created_at: v.created_at,
        operation_type: 'VERSION',
        status: v.is_current ? 'CURRENT' : 'ARCHIVED'
    }));

    // Append operation entries that don't map to versions (for backward compat)
    const operationEntries = opRows.map((r, index) => {
        let parsedDetails = {};
        if (r.details) {
            try { parsedDetails = typeof r.details === 'string' ? JSON.parse(r.details) : r.details; }
            catch { parsedDetails = { raw: String(r.details) }; }
        }
        return {
            version_number: null, // operation, not a stored version
            operation_id: r.operation_id,
            author_id: r.user_id,
            author_name: r.author_name,
            operation_type: r.operation_type,
            status: r.status,
            created_at: r.created_at,
            completed_at: r.completed_at,
            details: parsedDetails
        };
    });

    return {
        file,
        total_versions: versions.length,
        versions,
        operations: operationEntries,
        total_operations: operationEntries.length
    };
};

/** Retrieve a specific version record. */
export const getFileVersion = async (fileId, versionNumber) => {
    const [rows] = await pool.query(
        `SELECT fv.*, u.username AS author_name
         FROM FILE_VERSIONS fv
         JOIN USERS u ON fv.created_by = u.user_id
         WHERE fv.file_id = ? AND fv.version_number = ?`,
        [fileId, versionNumber]
    );
    return rows[0] || null;
};

/** Restore a historical version as the new current version. */
export const restoreFileVersion = async (fileId, versionNumber, userId) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [targetRows] = await connection.query(
            'SELECT * FROM FILE_VERSIONS WHERE file_id = ? AND version_number = ?',
            [fileId, versionNumber]
        );
        if (!targetRows.length) {
            await connection.rollback();
            connection.release();
            throw new Error(`Version ${versionNumber} not found for file ${fileId}`);
        }
        const target = targetRows[0];

        // Get current max version number
        const [maxRows] = await connection.query(
            'SELECT MAX(version_number) AS maxVer FROM FILE_VERSIONS WHERE file_id = ?',
            [fileId]
        );
        const nextVersion = (maxRows[0].maxVer || 0) + 1;

        // Mark all versions as not current
        await connection.query(
            'UPDATE FILE_VERSIONS SET is_current = FALSE WHERE file_id = ?',
            [fileId]
        );

        // Create a new version that copies the target version's content
        const restoredPath = await copyPhysicalFile(target.file_path, `restored_v${versionNumber}`);
        const checksum = await fileChecksum(restoredPath);

        await connection.query(
            `INSERT INTO FILE_VERSIONS
               (file_id, version_number, file_path, file_size_bytes, mime_type, checksum, change_summary, created_by, is_current)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
            [fileId, nextVersion, restoredPath, target.file_size_bytes, target.mime_type,
             checksum, `Restored from v${versionNumber}`, userId]
        );

        // Update FILES table
        await connection.query(
            'UPDATE FILES SET file_path = ?, file_size_bytes = ?, mime_type = ? WHERE file_id = ?',
            [restoredPath, target.file_size_bytes, target.mime_type, fileId]
        );

        await connection.commit();
        connection.release();

        return { restored: true, from_version: versionNumber, new_version: nextVersion };
    } catch (err) {
        await connection.rollback();
        connection.release();
        throw err;
    }
};

// ---------------------------------------------------------------------------
// Conflict Detection & Resolution
// ---------------------------------------------------------------------------

export const getFileConflicts = async (fileId) => {
    const file = await getFileById(fileId);
    if (!file) return null;

    // Check lock-based conflicts (existing logic)
    const [locks] = await pool.query(
        `SELECT
            fl.lock_id, fl.file_id, fl.process_id, fl.lock_type,
            fl.lock_status, fl.requested_at, fl.acquired_at,
            p.pid_alias, p.state AS process_state,
            o.operation_id, o.operation_type,
            o.status AS operation_status, o.details AS operation_details,
            u.user_id, u.username
         FROM FILE_LOCKS fl
         JOIN PROCESSES p ON fl.process_id = p.process_id
         JOIN OPERATIONS o ON p.operation_id = o.operation_id
         JOIN USERS u ON o.user_id = u.user_id
         WHERE fl.file_id = ? AND fl.lock_status IN ('ACQUIRED', 'WAITING')
         ORDER BY fl.requested_at ASC`,
        [fileId]
    );

    const activeHolder = locks.find(l => l.lock_status === 'ACQUIRED') || null;
    const conflictingWaiters = locks.filter(l => l.lock_status === 'WAITING');
    const hasLockConflict = Boolean(activeHolder && conflictingWaiters.length > 0);

    // Check version-based conflicts (new)
    const [openConflicts] = await pool.query(
        `SELECT c.*, u.username AS initiator_name
         FROM CONFLICTS c
         JOIN USERS u ON c.initiated_by = u.user_id
         WHERE c.file_id = ? AND c.status = 'OPEN'
         ORDER BY c.created_at DESC`,
        [fileId]
    );

    const hasConflict = hasLockConflict || openConflicts.length > 0;

    return {
        file_id: file.file_id,
        file_name: file.file_name,
        hasConflict,
        // Lock-based conflict info
        activeHolder: activeHolder ? {
            lock_id: activeHolder.lock_id,
            process_id: activeHolder.process_id,
            pid_alias: activeHolder.pid_alias,
            user_id: activeHolder.user_id,
            username: activeHolder.username,
            operation_type: activeHolder.operation_type,
            acquired_at: activeHolder.acquired_at,
            details: activeHolder.operation_details
        } : null,
        conflictingWaiters: conflictingWaiters.map(w => ({
            lock_id: w.lock_id,
            process_id: w.process_id,
            pid_alias: w.pid_alias,
            user_id: w.user_id,
            username: w.username,
            operation_type: w.operation_type,
            requested_at: w.requested_at,
            details: w.operation_details
        })),
        // Version-based conflict info (new)
        openConflicts: openConflicts.map(c => ({
            conflict_id: c.conflict_id,
            conflict_type: c.conflict_type,
            status: c.status,
            initiated_by: c.initiated_by,
            initiator_name: c.initiator_name,
            base_version_id: c.base_version_id,
            current_version_id: c.current_version_id,
            incoming_version_id: c.incoming_version_id,
            details: c.details,
            created_at: c.created_at
        })),
        message: hasConflict
            ? hasLockConflict
                ? `Concurrent write conflict detected on "${file.file_name}": ${activeHolder.username} holds exclusive lock while ${conflictingWaiters.map(w => w.username).join(', ')} is waiting to apply changes.`
                : `Version conflict detected on "${file.file_name}": ${openConflicts.length} unresolved conflict(s).`
            : 'No active concurrency conflicts detected on this file.'
    };
};

export const resolveFileConflict = async (fileId, { strategy = 'KEEP_CURRENT', resolvedByUserId = 1, conflict_id = null }) => {
    const file = await getFileById(fileId);
    if (!file) throw new Error('File not found');

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        // First, check for lock-based conflicts (existing logic)
        const [locks] = await connection.query(
            `SELECT fl.lock_id, fl.process_id, fl.lock_status, p.operation_id, u.username, u.user_id
             FROM FILE_LOCKS fl
             JOIN PROCESSES p ON fl.process_id = p.process_id
             JOIN OPERATIONS o ON p.operation_id = o.operation_id
             JOIN USERS u ON o.user_id = u.user_id
             WHERE fl.file_id = ? AND fl.lock_status IN ('ACQUIRED', 'WAITING')
             ORDER BY fl.requested_at ASC`,
            [fileId]
        );

        const holder = locks.find(l => l.lock_status === 'ACQUIRED');
        const waiters = locks.filter(l => l.lock_status === 'WAITING');

        // If there are lock-based conflicts, resolve them
        if (holder && waiters.length > 0) {
            let resolutionNote = '';
            let branchedFile = null;

            if (strategy === 'KEEP_CURRENT') {
                for (const waiter of waiters) {
                    await connection.query(
                        `UPDATE FILE_LOCKS SET lock_status = 'ABORTED', released_at = CURRENT_TIMESTAMP WHERE lock_id = ?`,
                        [waiter.lock_id]
                    );
                    await connection.query(
                        `UPDATE PROCESSES SET state = 'TERMINATED', finished_at = CURRENT_TIMESTAMP WHERE process_id = ?`,
                        [waiter.process_id]
                    );
                    await connection.query(
                        `UPDATE OPERATIONS SET status = 'ABORTED' WHERE operation_id = ?`,
                        [waiter.operation_id]
                    );
                }
                resolutionNote = `Kept current changes from ${holder.username}. Aborted competing request(s) from ${waiters.map(w => w.username).join(', ')}.`;

            } else if (strategy === 'ACCEPT_INCOMING') {
                const primaryWaiter = waiters[0];
                await connection.query(
                    `UPDATE FILE_LOCKS SET lock_status = 'RELEASED', released_at = CURRENT_TIMESTAMP WHERE lock_id = ?`,
                    [holder.lock_id]
                );
                await connection.query(
                    `UPDATE FILE_LOCKS SET lock_status = 'ACQUIRED', acquired_at = CURRENT_TIMESTAMP WHERE lock_id = ?`,
                    [primaryWaiter.lock_id]
                );
                await connection.query(
                    `UPDATE PROCESSES SET state = 'RUNNING', started_at = CURRENT_TIMESTAMP WHERE process_id = ?`,
                    [primaryWaiter.process_id]
                );
                await connection.query(
                    `UPDATE OPERATIONS SET status = 'EXECUTING' WHERE operation_id = ?`,
                    [primaryWaiter.operation_id]
                );
                resolutionNote = `Accepted incoming changes from ${primaryWaiter.username}. Released lock previously held by ${holder.username}.`;

            } else if (strategy === 'CREATE_BRANCH') {
                const primaryWaiter = waiters[0];
                const nameParts = file.file_name.split('.');
                const ext = nameParts.length > 1 ? `.${nameParts.pop()}` : '';
                const baseName = nameParts.join('.');
                const branchName = `${baseName}_branch_${Date.now()}${ext}`;

                // Copy the physical file for the branch
                const branchPath = await copyPhysicalFile(file.file_path, `branch_${Date.now()}`);

                const [branchInsert] = await connection.query(
                    `INSERT INTO FILES (file_name, folder_id, owner_id, file_size_bytes, file_path, mime_type, status)
                     VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`,
                    [branchName, file.folder_id, primaryWaiter.user_id || resolvedByUserId,
                     file.file_size_bytes, branchPath, file.mime_type]
                );

                const newFileId = branchInsert.insertId;

                // Create v1 for the branched file
                const checksum = await fileChecksum(branchPath);
                await connection.query(
                    `INSERT INTO FILE_VERSIONS
                       (file_id, version_number, file_path, file_size_bytes, mime_type, checksum, change_summary, created_by, is_current)
                     VALUES (?, 1, ?, ?, ?, ?, ?, ?, TRUE)`,
                    [newFileId, branchPath, file.file_size_bytes, file.mime_type,
                     checksum, `Branched from "${file.file_name}" during conflict resolution`, primaryWaiter.user_id || resolvedByUserId]
                );

                await connection.query(
                    `UPDATE FILE_LOCKS SET file_id = ?, lock_status = 'RELEASED', released_at = CURRENT_TIMESTAMP WHERE lock_id = ?`,
                    [newFileId, primaryWaiter.lock_id]
                );
                await connection.query(
                    `UPDATE PROCESSES SET state = 'TERMINATED', finished_at = CURRENT_TIMESTAMP WHERE process_id = ?`,
                    [primaryWaiter.process_id]
                );
                await connection.query(
                    `UPDATE OPERATIONS SET file_id = ?, status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP WHERE operation_id = ?`,
                    [newFileId, primaryWaiter.operation_id]
                );

                branchedFile = { file_id: newFileId, file_name: branchName };
                resolutionNote = `Resolved conflict by branching incoming changes from ${primaryWaiter.username} into new file "${branchName}".`;
            }

            await connection.commit();
            connection.release();
            return { resolved: true, strategy, message: resolutionNote, branchedFile };
        }

        // If no lock conflicts, check for version-based conflicts
        const conflictQuery = conflict_id
            ? 'SELECT * FROM CONFLICTS WHERE conflict_id = ? AND file_id = ? AND status = ?'
            : 'SELECT * FROM CONFLICTS WHERE file_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1';
        const conflictParams = conflict_id
            ? [conflict_id, fileId, 'OPEN']
            : [fileId, 'OPEN'];

        const [conflictRows] = await connection.query(conflictQuery, conflictParams);

        if (!conflictRows.length) {
            await connection.rollback();
            connection.release();
            return { resolved: false, message: 'No active concurrent conflict found to resolve on this file.' };
        }

        const conflict = conflictRows[0];
        let resolutionNote = '';
        let branchedFile = null;

        if (strategy === 'KEEP_CURRENT') {
            // Keep the current version; discard the incoming conflicting version
            await connection.query(
                `UPDATE CONFLICTS SET status = 'RESOLVED', resolution_strategy = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP WHERE conflict_id = ?`,
                ['KEEP_CURRENT', resolvedByUserId, conflict.conflict_id]
            );
            // Remove the incoming version if desired (mark as non-current, it already is)
            resolutionNote = 'Kept the current version. The conflicting incoming changes were discarded.';

        } else if (strategy === 'ACCEPT_INCOMING') {
            // Make the incoming version the current one
            if (conflict.incoming_version_id) {
                await connection.query('UPDATE FILE_VERSIONS SET is_current = FALSE WHERE file_id = ?', [fileId]);
                await connection.query('UPDATE FILE_VERSIONS SET is_current = TRUE WHERE version_id = ?', [conflict.incoming_version_id]);

                // Update FILES table from the incoming version
                const [incVer] = await connection.query('SELECT * FROM FILE_VERSIONS WHERE version_id = ?', [conflict.incoming_version_id]);
                if (incVer.length) {
                    await connection.query(
                        'UPDATE FILES SET file_path = ?, file_size_bytes = ?, mime_type = ? WHERE file_id = ?',
                        [incVer[0].file_path, incVer[0].file_size_bytes, incVer[0].mime_type, fileId]
                    );
                }
            }
            await connection.query(
                `UPDATE CONFLICTS SET status = 'RESOLVED', resolution_strategy = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP WHERE conflict_id = ?`,
                ['ACCEPT_INCOMING', resolvedByUserId, conflict.conflict_id]
            );
            resolutionNote = 'Accepted incoming changes as the new current version.';

        } else if (strategy === 'CREATE_BRANCH') {
            // Create a new file from the incoming version
            if (conflict.incoming_version_id) {
                const [incVer] = await connection.query('SELECT * FROM FILE_VERSIONS WHERE version_id = ?', [conflict.incoming_version_id]);
                if (incVer.length) {
                    const nameParts = file.file_name.split('.');
                    const ext = nameParts.length > 1 ? `.${nameParts.pop()}` : '';
                    const baseName = nameParts.join('.');
                    const branchName = `${baseName}_branch_${Date.now()}${ext}`;

                    const branchPath = await copyPhysicalFile(incVer[0].file_path, `branch_${Date.now()}`);

                    const [branchInsert] = await connection.query(
                        `INSERT INTO FILES (file_name, folder_id, owner_id, file_size_bytes, file_path, mime_type, status)
                         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`,
                        [branchName, file.folder_id, conflict.initiated_by, incVer[0].file_size_bytes, branchPath, incVer[0].mime_type]
                    );

                    const newFileId = branchInsert.insertId;
                    const checksum = await fileChecksum(branchPath);

                    await connection.query(
                        `INSERT INTO FILE_VERSIONS
                           (file_id, version_number, file_path, file_size_bytes, mime_type, checksum, change_summary, created_by, is_current)
                         VALUES (?, 1, ?, ?, ?, ?, ?, ?, TRUE)`,
                        [newFileId, branchPath, incVer[0].file_size_bytes, incVer[0].mime_type,
                         checksum, `Branched from "${file.file_name}" conflict resolution`, conflict.initiated_by]
                    );

                    branchedFile = { file_id: newFileId, file_name: branchName };
                    resolutionNote = `Created branch file "${branchName}" from conflicting changes.`;
                }
            }

            await connection.query(
                `UPDATE CONFLICTS SET status = 'RESOLVED', resolution_strategy = ?, resolved_by = ?, resolved_at = CURRENT_TIMESTAMP WHERE conflict_id = ?`,
                ['CREATE_BRANCH', resolvedByUserId, conflict.conflict_id]
            );
            if (!resolutionNote) resolutionNote = 'Conflict resolved via branch creation.';
        }

        await connection.commit();
        connection.release();
        return { resolved: true, strategy, message: resolutionNote, branchedFile };
    } catch (err) {
        await connection.rollback();
        connection.release();
        throw err;
    }
};

/** List all open conflicts for a file or all files. */
export const getOpenConflicts = async (fileId = null) => {
    const query = fileId
        ? `SELECT c.*, f.file_name, u.username AS initiator_name
           FROM CONFLICTS c
           JOIN FILES f ON c.file_id = f.file_id
           JOIN USERS u ON c.initiated_by = u.user_id
           WHERE c.file_id = ? AND c.status = 'OPEN'
           ORDER BY c.created_at DESC`
        : `SELECT c.*, f.file_name, u.username AS initiator_name
           FROM CONFLICTS c
           JOIN FILES f ON c.file_id = f.file_id
           JOIN USERS u ON c.initiated_by = u.user_id
           WHERE c.status = 'OPEN'
           ORDER BY c.created_at DESC`;
    const [rows] = await pool.query(query, fileId ? [fileId] : []);
    return rows;
};

// ---------------------------------------------------------------------------
// File Sharing and Permissions
// ---------------------------------------------------------------------------

/**
 * Share a file with another user by username or userId.
 * Only owner or admin can share.
 */
export const shareFile = async (fileId, grantorUserId, { target_username, target_user_id, permission_type = 'READ', expires_at = null }) => {
    const [fileRows] = await pool.query('SELECT file_id, file_name, owner_id FROM FILES WHERE file_id = ?', [fileId]);
    if (!fileRows || fileRows.length === 0) {
        throw new Error('File not found');
    }
    const file = fileRows[0];

    // Check grantor role
    const [grantorRows] = await pool.query('SELECT role FROM USERS WHERE user_id = ?', [grantorUserId]);
    const grantorRole = grantorRows[0]?.role;
    if (file.owner_id !== grantorUserId && grantorRole !== 'ADMIN') {
        throw new Error('Only the file owner or an administrator can share this file');
    }

    // Find target user
    let targetUser = null;
    if (target_user_id) {
        const [u] = await pool.query('SELECT user_id, username, email FROM USERS WHERE user_id = ?', [target_user_id]);
        targetUser = u[0];
    } else if (target_username) {
        const [u] = await pool.query('SELECT user_id, username, email FROM USERS WHERE username = ?', [target_username.trim()]);
        targetUser = u[0];
    }

    if (!targetUser) {
        throw new Error('Target user not found');
    }

    if (targetUser.user_id === file.owner_id) {
        throw new Error('Cannot share a file with its owner');
    }

    const permType = ['READ', 'WRITE', 'ADMIN_ONLY'].includes(permission_type?.toUpperCase())
        ? permission_type.toUpperCase()
        : 'READ';

    // Insert or update permission
    // FILE_PERMISSIONS schema: permission_id, file_id, user_id, permission_type, granted_by, granted_at, expires_at
    const [existing] = await pool.query(
        'SELECT permission_id FROM FILE_PERMISSIONS WHERE file_id = ? AND user_id = ?',
        [fileId, targetUser.user_id]
    );

    if (existing && existing.length > 0) {
        await pool.query(
            `UPDATE FILE_PERMISSIONS
             SET permission_type = ?, granted_by = ?, granted_at = CURRENT_TIMESTAMP, expires_at = ?
             WHERE file_id = ? AND user_id = ?`,
            [permType, grantorUserId, expires_at, fileId, targetUser.user_id]
        );
    } else {
        await pool.query(
            `INSERT INTO FILE_PERMISSIONS (file_id, user_id, permission_type, granted_by, expires_at)
             VALUES (?, ?, ?, ?, ?)`,
            [fileId, targetUser.user_id, permType, grantorUserId, expires_at]
        );
    }

    return {
        file_id: file.file_id,
        file_name: file.file_name,
        shared_with: targetUser.username,
        target_user_id: targetUser.user_id,
        permission_type: permType,
        granted_by: grantorUserId
    };
};

/**
 * Revoke file sharing permission for a user.
 */
export const revokeFileShare = async (fileId, requesterUserId, targetUserId) => {
    const [fileRows] = await pool.query('SELECT file_id, owner_id FROM FILES WHERE file_id = ?', [fileId]);
    if (!fileRows || fileRows.length === 0) {
        throw new Error('File not found');
    }
    const file = fileRows[0];

    const [reqRows] = await pool.query('SELECT role FROM USERS WHERE user_id = ?', [requesterUserId]);
    const reqRole = reqRows[0]?.role;
    if (file.owner_id !== requesterUserId && reqRole !== 'ADMIN') {
        throw new Error('Only the file owner or an administrator can revoke access');
    }

    const [result] = await pool.query(
        'DELETE FROM FILE_PERMISSIONS WHERE file_id = ? AND user_id = ?',
        [fileId, targetUserId]
    );

    return { revoked: result.affectedRows > 0 };
};

/**
 * List permissions for a specific file.
 */
export const getFilePermissions = async (fileId) => {
    const [rows] = await pool.query(
        `SELECT fp.*, u.username, u.email, g.username AS granted_by_username
         FROM FILE_PERMISSIONS fp
         JOIN USERS u ON fp.user_id = u.user_id
         LEFT JOIN USERS g ON fp.granted_by = g.user_id
         WHERE fp.file_id = ? AND (fp.expires_at IS NULL OR fp.expires_at > NOW())`,
        [fileId]
    );
    return rows;
};

