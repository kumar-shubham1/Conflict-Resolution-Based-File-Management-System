
// Migration: Add FILE_VERSIONS and CONFLICTS tables
// Non-destructive: does not drop or replace existing tables.

import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'conflictcore_db',
  port: Number(process.env.DB_PORT || 3306)
});



async function indexExists(tableName, indexName) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS total
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND index_name = ?`,
    [tableName, indexName]
  );

  return rows[0].total > 0;
}

async function createIndexIfMissing(tableName, indexName, sql) {
  if (!(await indexExists(tableName, indexName))) {
    await conn.query(sql);
    console.log(`Created index: ${indexName}`);
  } else {
    console.log(`Index already exists: ${indexName}`);
  }
}

try {
  console.log('Connected to MySQL');

  // 1. Create FILE_VERSIONS
  await conn.query(`
    CREATE TABLE IF NOT EXISTS FILE_VERSIONS (
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

      CONSTRAINT uq_file_version
        UNIQUE (file_id, version_number)
    ) ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci
  `);

  // Ensure file_content exists in older FILE_VERSIONS tables
  const [fileContentColumn] = await conn.query(`
    SELECT COUNT(*) AS column_count
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'FILE_VERSIONS'
      AND COLUMN_NAME = 'file_content'
  `);

  if (Number(fileContentColumn[0].column_count) === 0) {
    await conn.query(`
      ALTER TABLE FILE_VERSIONS
      ADD COLUMN file_content LONGTEXT NULL AFTER file_path
    `);

    console.log('Added missing file_content column to FILE_VERSIONS');
  }

  console.log('FILE_VERSIONS table created/verified');

  // 2. Create CONFLICTS
  await conn.query(`
    CREATE TABLE IF NOT EXISTS CONFLICTS (
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
        ON DELETE SET NULL ON UPDATE CASCADE
    ) ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci
  `);

  console.log('CONFLICTS table created/verified');

  // 3. Create indexes only if missing
  await createIndexIfMissing(
    'FILE_VERSIONS',
    'idx_fv_file_id',
    'CREATE INDEX idx_fv_file_id ON FILE_VERSIONS (file_id)'
  );

  await createIndexIfMissing(
    'FILE_VERSIONS',
    'idx_fv_current',
    'CREATE INDEX idx_fv_current ON FILE_VERSIONS (file_id, is_current)'
  );

  await createIndexIfMissing(
    'CONFLICTS',
    'idx_conf_file',
    'CREATE INDEX idx_conf_file ON CONFLICTS (file_id)'
  );

  await createIndexIfMissing(
    'CONFLICTS',
    'idx_conf_status',
    'CREATE INDEX idx_conf_status ON CONFLICTS (status)'
  );

  // 4. Seed version 1 for existing files
  const [existingFiles] = await conn.query(`
    SELECT
      file_id,
      file_path,
      file_size_bytes,
      mime_type,
      owner_id,
      created_at
    FROM FILES
    WHERE status IN ('ACTIVE', 'LOCKED')
  `);

  let seeded = 0;

  for (const file of existingFiles) {
    const [versions] = await conn.query(
      `SELECT version_id
       FROM FILE_VERSIONS
       WHERE file_id = ?
       LIMIT 1`,
      [file.file_id]
    );

    if (versions.length === 0) {
      await conn.query(
        `INSERT INTO FILE_VERSIONS (
          file_id,
          version_number,
          file_path,
          file_content,
          file_size_bytes,
          mime_type,
          created_by,
          created_at,
          is_current
        )
        VALUES (?, 1, ?, NULL, ?, ?, ?, ?, TRUE)`,
        [
          file.file_id,
          file.file_path,
          file.file_size_bytes,
          file.mime_type,
          file.owner_id,
          file.created_at
        ]
      );

      seeded++;
      console.log(`Seeded version 1 for file_id=${file.file_id}`);
    }
  }

  console.log(`Seeded ${seeded} initial versions`);

  // 5. Verify tables and row counts
  const [tables] = await conn.query('SHOW TABLES');

  console.log(
    '\nDatabase tables:',
    tables.map(table => Object.values(table)[0]).join(', ')
  );

  const [versionCount] = await conn.query(
    'SELECT COUNT(*) AS total FROM FILE_VERSIONS'
  );

  const [conflictCount] = await conn.query(
    'SELECT COUNT(*) AS total FROM CONFLICTS'
  );

  console.log('FILE_VERSIONS rows:', versionCount[0].total);
  console.log('CONFLICTS rows:', conflictCount[0].total);

  console.log('\nMigration completed successfully');
} catch (error) {
  console.error('\nMigration failed:', error.message);
  process.exitCode = 1;
} finally {
  await conn.end();
}
