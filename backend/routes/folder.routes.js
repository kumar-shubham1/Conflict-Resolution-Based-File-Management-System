import { Hono } from 'hono';
import pool from '../config/db.js';

const folderRoutes = new Hono();

// GET /api/folders - List all folders with owner details
folderRoutes.get('/', async (c) => {
    try {
        const [folders] = await pool.query(`
            SELECT
                f.folder_id,
                f.folder_name,
                f.parent_folder_id,
                f.owner_id,
                f.created_at,
                f.updated_at,
                u.username AS owner_name
            FROM FOLDERS f
            JOIN USERS u ON f.owner_id = u.user_id
            ORDER BY f.folder_name ASC
        `);

        return c.json({
            message: 'Folders retrieved successfully',
            folders
        });
    } catch (error) {
        console.error('Error retrieving folders:', error);

        return c.json({
            message: 'Failed to retrieve folders',
            error: error.message
        }, 500);
    }
});

// POST /api/folders - Create a new folder
folderRoutes.post('/', async (c) => {
    try {
        const body = await c.req.json();
        const folderName = typeof body.folder_name === 'string' ? body.folder_name.trim() : '';
        const parentFolderId = body.parent_folder_id ? Number(body.parent_folder_id) : null;
        const ownerId = Number(body.owner_id || 1);

        if (!folderName) {
            return c.json({
                message: 'folder_name is required and must not be empty'
            }, 400);
        }

        const [result] = await pool.query(
            `INSERT INTO FOLDERS (folder_name, parent_folder_id, owner_id)
             VALUES (?, ?, ?)`,
            [folderName, parentFolderId, ownerId]
        );

        const [created] = await pool.query(
            `SELECT f.folder_id, f.folder_name, f.parent_folder_id, f.owner_id,
                    f.created_at, f.updated_at, u.username AS owner_name
             FROM FOLDERS f
             JOIN USERS u ON f.owner_id = u.user_id
             WHERE f.folder_id = ?`,
            [result.insertId]
        );

        return c.json({
            message: 'Folder created successfully',
            folder: created[0]
        }, 201);
    } catch (error) {
        console.error('Error creating folder:', error);

        return c.json({
            message: 'Failed to create folder',
            error: error.message
        }, 500);
    }
});

export default folderRoutes;
