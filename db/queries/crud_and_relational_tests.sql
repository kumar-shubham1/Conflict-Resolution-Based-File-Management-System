-- ============================================================================
-- ConflictCore — Core Database Architecture
-- CRUD & Relational Test Suite: crud_and_relational_tests.sql
-- Description: Demonstrates CRUD operations and executes the required
--              multi-table relational queries for the ConflictCore DBMS layer.
-- ============================================================================

USE conflictcore_db;

-- ############################################################################
-- PART 1: REQUIRED RELATIONAL QUERIES
-- ############################################################################

-- 1. Get all files belonging to a user (e.g. user_id = 2, 'shubham_k')
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
WHERE u.user_id = 2
ORDER BY f.file_name ASC;

-- 2. Get files inside a folder (e.g. folder_id = 3, 'Kernel_Source')
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
WHERE fo.folder_id = 3
ORDER BY f.file_name ASC;

-- 3. Get permissions for a file (e.g. file_id = 2, 'scheduler_core.c')
SELECT
    fp.permission_id,
    f.file_name,
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
WHERE f.file_id = 2
ORDER BY fp.permission_type ASC;

-- 4. Get operations performed by a user (e.g. user_id = 2, 'shubham_k')
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
WHERE u.user_id = 2
ORDER BY o.created_at DESC;

-- 5. Get processes related to file operations
SELECT
    p.process_id,
    p.pid_alias,
    p.state AS process_state,
    p.priority AS process_priority,
    p.cpu_burst_time,
    o.operation_id,
    o.operation_type,
    o.status AS operation_status,
    f.file_name AS target_file,
    u.username AS triggered_by
FROM PROCESSES p
JOIN OPERATIONS o ON p.operation_id = o.operation_id
LEFT JOIN FILES f ON o.file_id = f.file_id
JOIN USERS u ON o.user_id = u.user_id
ORDER BY p.process_id ASC;

-- 6. Get active locks for a file (e.g. file_id = 2, 'scheduler_core.c')
SELECT
    fl.lock_id,
    f.file_name,
    p.pid_alias,
    u.username AS lock_holder,
    fl.lock_type,
    fl.lock_status,
    fl.acquired_at
FROM FILE_LOCKS fl
JOIN FILES f ON fl.file_id = f.file_id
JOIN PROCESSES p ON fl.process_id = p.process_id
JOIN OPERATIONS o ON p.operation_id = o.operation_id
JOIN USERS u ON o.user_id = u.user_id
WHERE fl.file_id = 2 AND fl.lock_status = 'ACQUIRED';

-- 7. Get processes waiting for a file lock (demonstrates conflict detection)
SELECT
    fl.lock_id,
    f.file_name,
    p.pid_alias AS waiting_pid,
    p.state AS process_state,
    u.username AS requesting_user,
    fl.lock_type AS requested_lock_type,
    fl.lock_status,
    fl.requested_at
FROM FILE_LOCKS fl
JOIN FILES f ON fl.file_id = f.file_id
JOIN PROCESSES p ON fl.process_id = p.process_id
JOIN OPERATIONS o ON p.operation_id = o.operation_id
JOIN USERS u ON o.user_id = u.user_id
WHERE fl.lock_status = 'WAITING'
ORDER BY fl.requested_at ASC;


-- ############################################################################
-- PART 2: BASIC CRUD TESTING (CREATE, READ, UPDATE, DELETE)
-- ############################################################################

-- [C] CREATE: Insert a new temporary user, folder, file, operation, process, and lock
INSERT INTO USERS (user_id, username, email, password_hash, role, status)
VALUES (99, 'test_tester', 'tester99@conflictcore.io', '$2b$12$testpasswordhashforentityverification', 'USER', 'ACTIVE');

INSERT INTO FOLDERS (folder_id, folder_name, parent_folder_id, owner_id)
VALUES (99, 'Temp_Test_Folder', NULL, 99);

INSERT INTO FILES (file_id, file_name, folder_id, owner_id, file_size_bytes, file_path, mime_type, status)
VALUES (99, 'test_doc.txt', 99, 99, 1024, '/Temp_Test_Folder/test_doc.txt', 'text/plain', 'ACTIVE');

INSERT INTO FILE_PERMISSIONS (permission_id, file_id, user_id, permission_type, granted_by)
VALUES (99, 99, 99, 'ADMIN', 99);

INSERT INTO OPERATIONS (operation_id, user_id, file_id, operation_type, status, priority, details)
VALUES (99, 99, 99, 'EDIT', 'PENDING', 5, '{"test": true}');

INSERT INTO PROCESSES (process_id, operation_id, pid_alias, state, priority, cpu_burst_time, memory_allocated_kb)
VALUES (99, 99, 'PROC-9999', 'NEW', 5, 20, 1024);

INSERT INTO FILE_LOCKS (lock_id, file_id, process_id, lock_type, lock_status)
VALUES (99, 99, 99, 'EXCLUSIVE', 'WAITING');

-- [R] READ: Verify inserted test record
SELECT
    u.username,
    fo.folder_name,
    f.file_name,
    fp.permission_type,
    o.operation_type,
    p.pid_alias,
    fl.lock_type,
    fl.lock_status
FROM USERS u
JOIN FOLDERS fo ON fo.owner_id = u.user_id
JOIN FILES f ON f.folder_id = fo.folder_id
JOIN FILE_PERMISSIONS fp ON fp.file_id = f.file_id
JOIN OPERATIONS o ON o.user_id = u.user_id
JOIN PROCESSES p ON p.operation_id = o.operation_id
JOIN FILE_LOCKS fl ON fl.process_id = p.process_id
WHERE u.user_id = 99;

-- [U] UPDATE: Transition operation and lock states
UPDATE OPERATIONS
SET status = 'EXECUTING'
WHERE operation_id = 99;

UPDATE PROCESSES
SET state = 'RUNNING', started_at = CURRENT_TIMESTAMP
WHERE process_id = 99;

UPDATE FILE_LOCKS
SET lock_status = 'ACQUIRED', acquired_at = CURRENT_TIMESTAMP
WHERE lock_id = 99;

-- Verify updated state
SELECT
    p.pid_alias,
    p.state AS updated_process_state,
    o.status AS updated_op_status,
    fl.lock_status AS updated_lock_status,
    fl.acquired_at
FROM PROCESSES p
JOIN OPERATIONS o ON p.operation_id = o.operation_id
JOIN FILE_LOCKS fl ON fl.process_id = p.process_id
WHERE p.process_id = 99;

-- [D] DELETE: Clean up temporary test data
-- Deleting the user will cascade or be tested via cascading dependencies
DELETE FROM FILE_LOCKS WHERE lock_id = 99;
DELETE FROM PROCESSES WHERE process_id = 99;
DELETE FROM OPERATIONS WHERE operation_id = 99;
DELETE FROM FILE_PERMISSIONS WHERE permission_id = 99;
DELETE FROM FILES WHERE file_id = 99;
DELETE FROM FOLDERS WHERE folder_id = 99;
DELETE FROM USERS WHERE user_id = 99;

-- Verify clean deletion
SELECT COUNT(*) AS remaining_test_records
FROM USERS WHERE user_id = 99;
