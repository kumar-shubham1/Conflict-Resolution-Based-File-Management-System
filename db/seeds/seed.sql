-- ============================================================================
-- ConflictCore — Core Database Architecture
-- Seed Data: seed.sql
-- Description: Ingests realistic sample/demo data across all 7 core tables:
--              USERS, FOLDERS, FILES, FILE_PERMISSIONS, OPERATIONS, PROCESSES, FILE_LOCKS.
-- ============================================================================

USE conflictcore_db;

-- Clear any existing records safely (respecting foreign key order)
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE FILE_LOCKS;
TRUNCATE TABLE PROCESSES;
TRUNCATE TABLE OPERATIONS;
TRUNCATE TABLE FILE_PERMISSIONS;
TRUNCATE TABLE FILES;
TRUNCATE TABLE FOLDERS;
TRUNCATE TABLE USERS;
SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================================
-- 1. USERS
-- Realistic demo users covering ADMIN, USER (developer/researcher), and COLLABORATOR.
-- ============================================================================
INSERT INTO USERS (user_id, username, email, password_hash, role, status, created_at) VALUES
(1, 'admin_super',  'admin@conflictcore.io',     '$2b$12$e8YkZ7kG341N2V.9uS6YKe0L1j1K5d7T9W2x3z4y5a6b7c8d9e0f1', 'ADMIN',        'ACTIVE', '2026-09-01 08:00:00'),
(2, 'shubham_k',    'shubham@conflictcore.io',   '$2b$12$k8YkZ7kG341N2V.9uS6YKe0L1j1K5d7T9W2x3z4y5a6b7c8d9e0f2', 'USER',         'ACTIVE', '2026-09-02 09:15:00'),
(3, 'avni_n',       'avni@conflictcore.io',      '$2b$12$m8YkZ7kG341N2V.9uS6YKe0L1j1K5d7T9W2x3z4y5a6b7c8d9e0f3', 'USER',         'ACTIVE', '2026-09-02 10:30:00'),
(4, 'jahnvi_s',     'jahnvi@conflictcore.io',    '$2b$12$p8YkZ7kG341N2V.9uS6YKe0L1j1K5d7T9W2x3z4y5a6b7c8d9e0f4', 'COLLABORATOR', 'ACTIVE', '2026-09-03 11:00:00'),
(5, 'anshika_l',    'anshika@conflictcore.io',   '$2b$12$q8YkZ7kG341N2V.9uS6YKe0L1j1K5d7T9W2x3z4y5a6b7c8d9e0f5', 'USER',         'ACTIVE', '2026-09-03 11:30:00');

-- ============================================================================
-- 2. FOLDERS
-- Realistic directory hierarchy: Root folders & nested subfolders.
-- ============================================================================
INSERT INTO FOLDERS (folder_id, folder_name, parent_folder_id, owner_id, created_at) VALUES
(1, 'Workspace_Root',       NULL, 2, '2026-09-05 09:00:00'), -- shubham_k root
(2, 'Design_Docs',          1,    2, '2026-09-05 09:30:00'), -- nested inside 1
(3, 'Kernel_Source',        1,    2, '2026-09-05 10:00:00'), -- nested inside 1
(4, 'OS_Benchmarks',        NULL, 3, '2026-09-06 14:00:00'), -- avni_n root
(5, 'Shared_Artifacts',     NULL, 1, '2026-09-06 16:00:00'); -- admin root

-- ============================================================================
-- 3. FILES
-- Files stored inside various folders with realistic sizes and types.
-- ============================================================================
INSERT INTO FILES (file_id, file_name, folder_id, owner_id, file_size_bytes, file_path, mime_type, status, created_at) VALUES
(1, 'architecture_v1.pdf',   2, 2, 4587520, '/Workspace_Root/Design_Docs/architecture_v1.pdf',   'application/pdf',        'ACTIVE', '2026-09-07 10:00:00'),
(2, 'scheduler_core.c',      3, 2,   65536, '/Workspace_Root/Kernel_Source/scheduler_core.c',    'text/x-c',               'LOCKED', '2026-09-08 11:20:00'),
(3, 'priority_queue.h',      3, 2,   16384, '/Workspace_Root/Kernel_Source/priority_queue.h',    'text/x-c',               'ACTIVE', '2026-09-08 11:25:00'),
(4, 'cpu_traces_2026.csv',   4, 3, 8388608, '/OS_Benchmarks/cpu_traces_2026.csv',               'text/csv',               'ACTIVE', '2026-09-09 15:45:00'),
(5, 'system_manifest.json',  5, 1,    8192, '/Shared_Artifacts/system_manifest.json',            'application/json',       'ACTIVE', '2026-09-10 09:10:00');

-- ============================================================================
-- 4. FILE_PERMISSIONS
-- Demonstrates multi-user collaboration: READ, WRITE, ADMIN privileges.
-- ============================================================================
INSERT INTO FILE_PERMISSIONS (permission_id, file_id, user_id, permission_type, granted_by, granted_at, expires_at) VALUES
(1, 1, 2, 'ADMIN',      2, '2026-09-07 10:00:00', NULL),                  -- Shubham owns architecture doc
(2, 1, 4, 'READ',       2, '2026-09-07 10:30:00', NULL),                  -- Jahnvi can read architecture doc
(3, 1, 5, 'READ_WRITE', 2, '2026-09-07 10:35:00', NULL),                  -- Anshika can read/write architecture doc
(4, 2, 2, 'ADMIN',      2, '2026-09-08 11:20:00', NULL),                  -- Shubham owns scheduler_core.c
(5, 2, 3, 'READ_WRITE', 2, '2026-09-08 11:30:00', NULL),                  -- Avni can collaborate on scheduler
(6, 4, 3, 'ADMIN',      3, '2026-09-09 15:45:00', NULL),                  -- Avni owns benchmark csv
(7, 4, 2, 'READ',       3, '2026-09-09 16:00:00', NULL),                  -- Shubham can read benchmarks
(8, 5, 1, 'ADMIN',      1, '2026-09-10 09:10:00', NULL),                  -- Admin owns manifest
(9, 5, 2, 'READ',       1, '2026-09-10 09:15:00', '2026-12-31 23:59:59'); -- Shubham has temporary read access

-- ============================================================================
-- 5. OPERATIONS
-- High-level file operations initiated by users (UPLOAD, EDIT, DOWNLOAD, MOVE, SHARE).
-- ============================================================================
INSERT INTO OPERATIONS (operation_id, user_id, file_id, operation_type, status, priority, details, created_at, completed_at) VALUES
(1, 2, 1, 'UPLOAD',   'COMPLETED', 1, '{"origin": "client_web", "bytes": 4587520}',                 '2026-09-07 10:00:00', '2026-09-07 10:00:05'),
(2, 2, 2, 'UPLOAD',   'COMPLETED', 2, '{"origin": "git_sync", "bytes": 65536}',                     '2026-09-08 11:20:00', '2026-09-08 11:20:02'),
(3, 3, 2, 'EDIT',     'EXECUTING', 4, '{"lines_changed": 42, "reason": "optimize_context_switch"}', '2026-09-11 10:00:00', NULL),
(4, 2, 2, 'EDIT',     'QUEUED',    3, '{"lines_changed": 15, "reason": "fix_spinlock_boundary"}',   '2026-09-11 10:02:00', NULL),
(5, 4, 1, 'DOWNLOAD', 'COMPLETED', 1, '{"target": "browser_stream"}',                               '2026-09-11 10:15:00', '2026-09-11 10:15:03'),
(6, 2, 1, 'SHARE',    'COMPLETED', 1, '{"target_user_id": 4, "role": "COLLABORATOR"}',              '2026-09-11 10:20:00', '2026-09-11 10:20:01'),
(7, 3, 4, 'MOVE',     'PENDING',   2, '{"target_folder_id": 1, "previous_folder_id": 4}',          '2026-09-11 10:30:00', NULL);

-- ============================================================================
-- 6. PROCESSES
-- OS Processes corresponding to operations (used for scheduling & concurrency).
-- ============================================================================
INSERT INTO PROCESSES (process_id, operation_id, pid_alias, state, priority, cpu_burst_time, memory_allocated_kb, started_at, finished_at, created_at) VALUES
(1, 1, 'PROC-1001', 'TERMINATED', 1, 50,  2048, '2026-09-07 10:00:00', '2026-09-07 10:00:05', '2026-09-07 10:00:00'),
(2, 2, 'PROC-1002', 'TERMINATED', 2, 25,  1024, '2026-09-08 11:20:00', '2026-09-08 11:20:02', '2026-09-08 11:20:00'),
(3, 3, 'PROC-1003', 'RUNNING',    4, 120, 4096, '2026-09-11 10:00:05', NULL,                  '2026-09-11 10:00:00'),
(4, 4, 'PROC-1004', 'WAITING',    3, 80,  2048, NULL,                  NULL,                  '2026-09-11 10:02:00'),
(5, 5, 'PROC-1005', 'TERMINATED', 1, 30,  1024, '2026-09-11 10:15:00', '2026-09-11 10:15:03', '2026-09-11 10:15:00'),
(6, 7, 'PROC-1006', 'READY',      2, 45,  1024, NULL,                  NULL,                  '2026-09-11 10:30:00');

-- ============================================================================
-- 7. FILE_LOCKS
-- Concurrency lock representations:
-- Demonstrates an active EXCLUSIVE lock held by PROC-1003 on file 2 (scheduler_core.c),
-- and a WAITING lock requested by PROC-1004 on the same file (lock contention!).
-- Also includes historical released locks.
-- ============================================================================
INSERT INTO FILE_LOCKS (lock_id, file_id, process_id, lock_type, lock_status, requested_at, acquired_at, released_at) VALUES
(1, 1, 1, 'EXCLUSIVE', 'RELEASED', '2026-09-07 10:00:00', '2026-09-07 10:00:00', '2026-09-07 10:00:05'),
(2, 2, 2, 'EXCLUSIVE', 'RELEASED', '2026-09-08 11:20:00', '2026-09-08 11:20:00', '2026-09-08 11:20:02'),
(3, 2, 3, 'EXCLUSIVE', 'ACQUIRED', '2026-09-11 10:00:00', '2026-09-11 10:00:05', NULL),                 -- Active lock held by Avni's edit process
(4, 2, 4, 'EXCLUSIVE', 'WAITING',  '2026-09-11 10:02:00', NULL,                  NULL),                 -- Waiting lock: Shubham's edit process blocked
(5, 1, 5, 'SHARED',    'RELEASED', '2026-09-11 10:15:00', '2026-09-11 10:15:00', '2026-09-11 10:15:03');
