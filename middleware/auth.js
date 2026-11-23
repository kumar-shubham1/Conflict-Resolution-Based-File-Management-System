/**
 * Auth middleware for ConflictCore
 *
 * requireAuth   — attaches the verified session user to Hono context (c.set('user', user))
 *                 or returns HTTP 401 when the token is missing / invalid.
 *
 * canAccessFile — checks whether a user may access a specific file:
 *                 • ADMIN role → always allowed
 *                 • owner (file.owner_id === userId) → always allowed
 *                 • explicit FILE_PERMISSIONS row that has not expired → allowed
 *
 * requireFileAccess — Hono middleware factory that calls canAccessFile and returns 403
 *                     when access is denied.
 *
 * getCallerUser — convenience helper to read the user set by requireAuth from context.
 */

import pool from '../config/db.js';
import { getUserByToken } from '../services/auth.service.js';

// ---------------------------------------------------------------------------
// Token extraction (mirrors the helper in auth.routes.js)
// ---------------------------------------------------------------------------
const extractToken = (c) => {
    const authHeader = c.req.header('Authorization') || '';
    if (authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7).trim();
    }
    return c.req.query('token') || null;
};

// ---------------------------------------------------------------------------
// requireAuth middleware
// ---------------------------------------------------------------------------
export const requireAuth = async (c, next) => {
    const token = extractToken(c);
    const user = getUserByToken(token);
    if (!user) {
        return c.json({ message: 'Authentication required' }, 401);
    }
    c.set('user', user);
    await next();
};

// ---------------------------------------------------------------------------
// Retrieve the verified caller from Hono context (set by requireAuth)
// ---------------------------------------------------------------------------
export const getCallerUser = (c) => c.get('user');

// ---------------------------------------------------------------------------
// canAccessFile — returns true when userId may access fileId with minPerm
//
// minPerm values: 'READ' | 'WRITE' | 'ADMIN_ONLY'
// Permission hierarchy: READ < WRITE < ADMIN_ONLY
// ---------------------------------------------------------------------------
const PERM_RANK = { READ: 1, WRITE: 2, ADMIN_ONLY: 3 };

export const canAccessFile = async (userId, fileId, minPerm = 'READ') => {
    // 1. Fetch the file to get owner
    const [fileRows] = await pool.query(
        'SELECT owner_id FROM FILES WHERE file_id = ?',
        [fileId]
    );
    if (!fileRows || fileRows.length === 0) return false; // file not found

    // 2. Fetch user role
    const [userRows] = await pool.query(
        'SELECT role FROM USERS WHERE user_id = ?',
        [userId]
    );
    if (!userRows || userRows.length === 0) return false;

    const { role } = userRows[0];
    const { owner_id } = fileRows[0];

    // 3. Admin sees everything
    if (role === 'ADMIN') return true;

    // 4. Owner always has full access
    if (Number(owner_id) === Number(userId)) return true;

    // 5. Explicit FILE_PERMISSIONS grant (not expired)
const [permRows] = await pool.query(
    `SELECT permission_type FROM FILE_PERMISSIONS
     WHERE file_id = ? AND user_id = ?
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY CASE permission_type
         WHEN 'ADMIN_ONLY' THEN 3
         WHEN 'WRITE' THEN 2
         WHEN 'READ' THEN 1
         ELSE 0
     END DESC
     LIMIT 1`,
    [fileId, userId]
);

if (!permRows || permRows.length === 0) return false;

const grantedRank = PERM_RANK[permRows[0].permission_type] || 0;
const requiredRank = PERM_RANK[minPerm] || 1;

return grantedRank >= requiredRank;
};
// ---------------------------------------------------------------------------
// requireFileAccess middleware factory
//
// Usage:
//   fileRoutes.get('/:id', requireAuth, requireFileAccess('READ'), getFile);
// ---------------------------------------------------------------------------
export const requireFileAccess = (minPerm = 'READ') => async (c, next) => {
    const user = getCallerUser(c);
    const fileId = Number(c.req.param('id'));
    if (isNaN(fileId)) {
        return c.json({ message: 'Invalid file ID' }, 400);
    }
    const allowed = await canAccessFile(user.user_id, fileId, minPerm);
    if (!allowed) {
        return c.json({ message: 'Access denied' }, 403);
    }
    await next();
};
