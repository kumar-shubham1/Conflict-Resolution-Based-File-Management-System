
-- ============================================================================
-- ConflictCore - Multi-User File Management System
-- Database Schema
-- ============================================================================

CREATE DATABASE IF NOT EXISTS conflictcore_db
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE conflictcore_db;

-- ============================================================================
-- DROP TABLES IN REVERSE DEPENDENCY ORDER
-- ============================================================================

DROP TABLE IF EXISTS CONFLICTS;
DROP TABLE IF EXISTS FILE_VERSIONS;
DROP TABLE IF EXISTS FILE_LOCKS;
DROP TABLE IF EXISTS PROCESSES;
DROP TABLE IF EXISTS OPERATIONS;
DROP TABLE IF EXISTS FILE_PERMISSIONS;
DROP TABLE IF EXISTS FILES;
DROP TABLE IF EXISTS FOLDERS;
DROP TABLE IF EXISTS USERS;


-- ============================================================================
-- 1. USERS
-- ============================================================================

CREATE TABLE USERS (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    email VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'USER',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT uq_users_username UNIQUE (username),
    CONSTRAINT uq_users_email UNIQUE (email),
    CONSTRAINT chk_users_role CHECK (role IN ('ADMIN', 'USER', 'COLLABORATOR')),
    CONSTRAINT chk_users_status CHECK (status IN ('ACTIVE', 'SUSPENDED', 'INACTIVE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================
-- 2. FOLDERS
-- ============================================================================

CREATE TABLE FOLDERS (
    folder_id INT AUTO_INCREMENT PRIMARY KEY,
    folder_name VARCHAR(255) NOT NULL,
    parent_folder_id INT NULL,
    owner_id INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_folders_parent
        FOREIGN KEY (parent_folder_id) REFERENCES FOLDERS(folder_id)
        ON DELETE CASCADE ON UPDATE CASCADE,

    CONSTRAINT fk_folders_owner
        FOREIGN KEY (owner_id) REFERENCES USERS(user_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT chk_folders_name_not_empty CHECK (CHAR_LENGTH(TRIM(folder_name)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_folders_owner_parent ON FOLDERS (owner_id, parent_folder_id);
CREATE INDEX idx_folders_parent ON FOLDERS (parent_folder_id);


-- ============================================================================
-- 3. FILES
-- ============================================================================

CREATE TABLE FILES (
    file_id INT AUTO_INCREMENT PRIMARY KEY,
    file_name VARCHAR(255) NOT NULL,
    folder_id INT NULL,
    owner_id INT NOT NULL,
    file_size_bytes BIGINT NOT NULL DEFAULT 0,
    file_path VARCHAR(500) NOT NULL,
    mime_type VARCHAR(100) NOT NULL DEFAULT 'text/plain',
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT fk_files_folder
        FOREIGN KEY (folder_id) REFERENCES FOLDERS(folder_id)
        ON DELETE SET NULL ON UPDATE CASCADE,

    CONSTRAINT fk_files_owner
        FOREIGN KEY (owner_id) REFERENCES USERS(user_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT chk_files_name_not_empty CHECK (CHAR_LENGTH(TRIM(file_name)) > 0),
    CONSTRAINT chk_files_size_non_negative CHECK (file_size_bytes >= 0),
    CONSTRAINT chk_files_status CHECK (status IN ('ACTIVE', 'TRASHED', 'LOCKED', 'DELETED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_files_folder_id ON FILES (folder_id);
CREATE INDEX idx_files_owner_id ON FILES (owner_id);
CREATE INDEX idx_files_status ON FILES (status);


-- ============================================================================
-- 4. FILE_PERMISSIONS
-- ============================================================================

CREATE TABLE FILE_PERMISSIONS (
    permission_id INT AUTO_INCREMENT PRIMARY KEY,
    file_id INT NOT NULL,
    user_id INT NOT NULL,
    permission_type VARCHAR(20) NOT NULL DEFAULT 'READ',
    granted_by INT NULL,
    granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NULL,

    CONSTRAINT fk_file_permissions_file
        FOREIGN KEY (file_id) REFERENCES FILES(file_id)
        ON DELETE CASCADE ON UPDATE CASCADE,

    CONSTRAINT fk_file_permissions_user
        FOREIGN KEY (user_id) REFERENCES USERS(user_id)
        ON DELETE CASCADE ON UPDATE CASCADE,

    CONSTRAINT fk_file_permissions_granted_by
        FOREIGN KEY (granted_by) REFERENCES USERS(user_id)
        ON DELETE SET NULL ON UPDATE CASCADE,

    CONSTRAINT uq_file_user_permission UNIQUE (file_id, user_id, permission_type),
    CONSTRAINT chk_permission_type CHECK (permission_type IN ('READ', 'WRITE', 'EXECUTE', 'ADMIN', 'READ_WRITE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_permissions_user_id ON FILE_PERMISSIONS (user_id);
CREATE INDEX idx_permissions_file_id ON FILE_PERMISSIONS (file_id);


-- ============================================================================
-- 5. FILE_VERSIONS
-- ============================================================================

CREATE TABLE FILE_VERSIONS (
    version_id INT AUTO_INCREMENT PRIMARY KEY,
    file_id INT NOT NULL,
    version_number INT NOT NULL DEFAULT 1,

    file_path VARCHAR(500) NOT NULL,
    file_content LONGTEXT NULL,

    file_size_bytes BIGINT NOT NULL DEFAULT 0,
    mime_type VARCHAR(100) NOT NULL DEFAULT 'text/plain',
    checksum VARCHAR(64) NULL,
    change_summary TEXT NULL,

    created_by INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,

    CONSTRAINT fk_fv_file
        FOREIGN KEY (file_id) REFERENCES FILES(file_id)
        ON DELETE CASCADE ON UPDATE CASCADE,

    CONSTRAINT fk_fv_user
        FOREIGN KEY (created_by) REFERENCES USERS(user_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT uq_file_version UNIQUE (file_id, version_number),

    INDEX idx_fv_file_id (file_id),
    INDEX idx_fv_current (file_id, is_current)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================
-- 6. CONFLICTS
-- ============================================================================

CREATE TABLE CONFLICTS (
    conflict_id INT AUTO_INCREMENT PRIMARY KEY,
    file_id INT NOT NULL,

    base_version_id INT NULL,
    current_version_id INT NULL,
    incoming_version_id INT NULL,

    initiated_by INT NOT NULL,
    conflict_type VARCHAR(30) NOT NULL DEFAULT 'CONCURRENT_EDIT',
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN',

    resolution_strategy VARCHAR(30) NULL,
    resolved_by INT NULL,
    resolved_at TIMESTAMP NULL,

    details JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_conf_file
        FOREIGN KEY (file_id) REFERENCES FILES(file_id)
        ON DELETE CASCADE ON UPDATE CASCADE,

    CONSTRAINT fk_conf_initiator
        FOREIGN KEY (initiated_by) REFERENCES USERS(user_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT fk_conf_resolver
        FOREIGN KEY (resolved_by) REFERENCES USERS(user_id)
        ON DELETE SET NULL ON UPDATE CASCADE,

    CONSTRAINT fk_conf_base_ver
        FOREIGN KEY (base_version_id) REFERENCES FILE_VERSIONS(version_id)
        ON DELETE SET NULL ON UPDATE CASCADE,

    CONSTRAINT fk_conf_curr_ver
        FOREIGN KEY (current_version_id) REFERENCES FILE_VERSIONS(version_id)
        ON DELETE SET NULL ON UPDATE CASCADE,

    CONSTRAINT fk_conf_inc_ver
        FOREIGN KEY (incoming_version_id) REFERENCES FILE_VERSIONS(version_id)
        ON DELETE SET NULL ON UPDATE CASCADE,

    INDEX idx_conf_file (file_id),
    INDEX idx_conf_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================================
-- 7. OPERATIONS
-- ============================================================================

CREATE TABLE OPERATIONS (
    operation_id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    file_id INT NULL,
    operation_type VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    priority INT NOT NULL DEFAULT 1,
    details JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,

    CONSTRAINT fk_operations_user
        FOREIGN KEY (user_id) REFERENCES USERS(user_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,

    CONSTRAINT fk_operations_file
        FOREIGN KEY (file_id) REFERENCES FILES(file_id)
        ON DELETE CASCADE ON UPDATE CASCADE,

    CONSTRAINT chk_operations_type CHECK (operation_type IN ('UPLOAD', 'DOWNLOAD', 'EDIT', 'DELETE', 'MOVE', 'SHARE')),
    CONSTRAINT chk_operations_status CHECK (status IN ('PENDING', 'QUEUED', 'EXECUTING', 'COMPLETED', 'FAILED', 'ABORTED')),
    CONSTRAINT chk_operations_priority CHECK (priority BETWEEN 1 AND 10)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_operations_user_id ON OPERATIONS (user_id);
CREATE INDEX idx_operations_file_id ON OPERATIONS (file_id);
CREATE INDEX idx_operations_status ON OPERATIONS (status);
CREATE INDEX idx_operations_priority ON OPERATIONS (priority);


-- ============================================================================
-- 8. PROCESSES
-- ============================================================================

CREATE TABLE PROCESSES (
    process_id INT AUTO_INCREMENT PRIMARY KEY,
    operation_id INT NOT NULL,
    pid_alias VARCHAR(50) NOT NULL,
    state VARCHAR(20) NOT NULL DEFAULT 'NEW',
    priority INT NOT NULL DEFAULT 1,
    cpu_burst_time INT NOT NULL DEFAULT 10,
    memory_allocated_kb INT NOT NULL DEFAULT 1024,
    started_at TIMESTAMP NULL,
    finished_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_processes_operation
        FOREIGN KEY (operation_id) REFERENCES OPERATIONS(operation_id)
        ON DELETE CASCADE ON UPDATE CASCADE,

    CONSTRAINT uq_processes_pid_alias UNIQUE (pid_alias),
    CONSTRAINT chk_processes_state CHECK (state IN ('NEW', 'READY', 'RUNNING', 'WAITING', 'TERMINATED', 'KILLED')),
    CONSTRAINT chk_processes_priority CHECK (priority BETWEEN 1 AND 10),
    CONSTRAINT chk_processes_cpu_burst CHECK (cpu_burst_time >= 0),
    CONSTRAINT chk_processes_memory CHECK (memory_allocated_kb >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_processes_operation_id ON PROCESSES (operation_id);
CREATE INDEX idx_processes_state ON PROCESSES (state);
CREATE INDEX idx_processes_priority ON PROCESSES (priority);


-- ============================================================================
-- 9. FILE_LOCKS
-- ============================================================================

CREATE TABLE FILE_LOCKS (
    lock_id INT AUTO_INCREMENT PRIMARY KEY,
    file_id INT NOT NULL,
    process_id INT NOT NULL,
    lock_type VARCHAR(20) NOT NULL DEFAULT 'EXCLUSIVE',
    lock_status VARCHAR(20) NOT NULL DEFAULT 'WAITING',
    requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    acquired_at TIMESTAMP NULL,
    released_at TIMESTAMP NULL,

    CONSTRAINT fk_file_locks_file
        FOREIGN KEY (file_id) REFERENCES FILES(file_id)
        ON DELETE CASCADE ON UPDATE CASCADE,

    CONSTRAINT fk_file_locks_process
        FOREIGN KEY (process_id) REFERENCES PROCESSES(process_id)
        ON DELETE CASCADE ON UPDATE CASCADE,

    CONSTRAINT chk_file_locks_type CHECK (lock_type IN ('SHARED', 'EXCLUSIVE')),
    CONSTRAINT chk_file_locks_status CHECK (lock_status IN ('WAITING', 'ACQUIRED', 'RELEASED', 'ABORTED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_file_locks_file_id ON FILE_LOCKS (file_id);
CREATE INDEX idx_file_locks_process_id ON FILE_LOCKS (process_id);
CREATE INDEX idx_file_locks_status ON FILE_LOCKS (lock_status);
CREATE INDEX idx_file_locks_lookup ON FILE_LOCKS (file_id, lock_status);
