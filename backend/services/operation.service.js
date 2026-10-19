
import pool from '../config/db.js';

const VALID_OPERATIONS = new Set([
    'UPLOAD',
    'DOWNLOAD',
    'EDIT',
    'DELETE',
    'MOVE',
    'SHARE'
]);

export const getAllOperations = async () => {
    const [rows] = await pool.query(`
        SELECT *
        FROM OPERATIONS
        ORDER BY operation_id DESC
    `);

    return rows;
};

export const getOperationById = async (id) => {
    const [rows] = await pool.query(
        `SELECT * FROM OPERATIONS WHERE operation_id = ?`,
        [id]
    );

    return rows[0] || null;
};

export const createOperation = async (data) => {
    const userId = Number(data.user_id);
    const fileId =
        data.file_id == null || data.file_id === ''
            ? null
            : Number(data.file_id);
    const priority = Number(data.priority ?? 1);
    const operationType = String(
        data.operation_type ?? ''
    ).toUpperCase();

    if (!Number.isInteger(userId) || userId <= 0) {
        throw new Error('user_id must be a positive integer');
    }

    if (!VALID_OPERATIONS.has(operationType)) {
        throw new Error('Invalid operation_type');
    }

    if (
        operationType !== 'UPLOAD' &&
        (!Number.isInteger(fileId) || fileId <= 0)
    ) {
        throw new Error(
            `${operationType} requires a valid file_id`
        );
    }

    if (
        fileId !== null &&
        (!Number.isInteger(fileId) || fileId <= 0)
    ) {
        throw new Error('file_id must be a positive integer or null');
    }

    if (
        !Number.isInteger(priority) ||
        priority < 1 ||
        priority > 10
    ) {
        throw new Error('priority must be an integer from 1 to 10');
    }

    let details = data.details ?? null;

    if (typeof details === 'string') {
        try {
            details = JSON.parse(details);
        } catch {
            throw new Error('details must contain valid JSON');
        }
    }

    if (
        details !== null &&
        (typeof details !== 'object' || Array.isArray(details))
    ) {
        throw new Error('details must be a JSON object');
    }

    const [result] = await pool.query(
        `INSERT INTO OPERATIONS
            (user_id, file_id, operation_type, priority, details)
         VALUES (?, ?, ?, ?, ?)`,
        [
            userId,
            fileId,
            operationType,
            priority,
            details === null ? null : JSON.stringify(details)
        ]
    );

    return getOperationById(result.insertId);
};
