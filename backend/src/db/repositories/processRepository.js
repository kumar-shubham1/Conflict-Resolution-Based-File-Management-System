/**
 * ConflictCore - Process Repository
 * Data access layer for the PROCESSES table representing OS process scheduling units.
 */

const { getPool } = require('../connection');

function getExecutor(conn) {
  return conn || getPool();
}

/**
 * Creates a new process record.
 * @param {Object} proc
 * @param {number} proc.operation_id
 * @param {string} proc.pid_alias
 * @param {string} [proc.state='NEW'] - NEW | READY | RUNNING | WAITING | TERMINATED | KILLED
 * @param {number} [proc.priority=1] - 1 to 10
 * @param {number} [proc.cpu_burst_time=10]
 * @param {number} [proc.memory_allocated_kb=1024]
 * @param {Object} [conn]
 * @returns {Promise<Object>}
 */
async function createProcess({
  operation_id,
  pid_alias,
  state = 'NEW',
  priority = 1,
  cpu_burst_time = 10,
  memory_allocated_kb = 1024,
}, conn) {
  const sql = `
    INSERT INTO PROCESSES (operation_id, pid_alias, state, priority, cpu_burst_time, memory_allocated_kb)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  const [result] = await getExecutor(conn).execute(sql, [
    operation_id,
    pid_alias,
    state,
    priority,
    cpu_burst_time,
    memory_allocated_kb,
  ]);
  return retrieveProcess(result.insertId, conn);
}

/**
 * Retrieves a process by primary key process_id.
 * @param {number} processId
 * @param {Object} [conn]
 * @returns {Promise<Object|null>}
 */
async function retrieveProcess(processId, conn) {
  const sql = `
    SELECT
      p.*,
      o.operation_type,
      o.status AS operation_status,
      o.file_id,
      f.file_name,
      u.user_id,
      u.username AS triggered_by
    FROM PROCESSES p
    JOIN OPERATIONS o ON p.operation_id = o.operation_id
    LEFT JOIN FILES f ON o.file_id = f.file_id
    JOIN USERS u ON o.user_id = u.user_id
    WHERE p.process_id = ?
    LIMIT 1
  `;
  const [rows] = await getExecutor(conn).execute(sql, [processId]);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Retrieves a process by unique pid_alias.
 * @param {string} pidAlias
 * @param {Object} [conn]
 * @returns {Promise<Object|null>}
 */
async function retrieveProcessByPid(pidAlias, conn) {
  const sql = `
    SELECT
      p.*,
      o.operation_type,
      o.status AS operation_status,
      o.file_id,
      f.file_name,
      u.user_id,
      u.username AS triggered_by
    FROM PROCESSES p
    JOIN OPERATIONS o ON p.operation_id = o.operation_id
    LEFT JOIN FILES f ON o.file_id = f.file_id
    JOIN USERS u ON o.user_id = u.user_id
    WHERE p.pid_alias = ?
    LIMIT 1
  `;
  const [rows] = await getExecutor(conn).execute(sql, [pidAlias]);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Retrieves all processes currently in a given state.
 * @param {string} state - NEW | READY | RUNNING | WAITING | TERMINATED | KILLED
 * @param {Object} [conn]
 * @returns {Promise<Array>}
 */
async function retrieveProcessesByState(state, conn) {
  const sql = `
    SELECT
      p.*,
      o.operation_type,
      o.status AS operation_status,
      f.file_name,
      u.username AS triggered_by
    FROM PROCESSES p
    JOIN OPERATIONS o ON p.operation_id = o.operation_id
    LEFT JOIN FILES f ON o.file_id = f.file_id
    JOIN USERS u ON o.user_id = u.user_id
    WHERE p.state = ?
    ORDER BY p.priority DESC, p.created_at ASC
  `;
  const [rows] = await getExecutor(conn).execute(sql, [state]);
  return rows;
}

/**
 * Retrieves process associated with a specific operation ID.
 * @param {number} operationId
 * @param {Object} [conn]
 * @returns {Promise<Object|null>}
 */
async function getProcessByOperationId(operationId, conn) {
  const sql = `
    SELECT p.*, o.operation_type, o.status AS operation_status
    FROM PROCESSES p
    JOIN OPERATIONS o ON p.operation_id = o.operation_id
    WHERE p.operation_id = ?
    LIMIT 1
  `;
  const [rows] = await getExecutor(conn).execute(sql, [operationId]);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Updates process execution state and tracks timestamps (started_at, finished_at).
 * @param {number} processId
 * @param {string} state - NEW | READY | RUNNING | WAITING | TERMINATED | KILLED
 * @param {Object} [updates]
 * @param {Object} [conn]
 * @returns {Promise<Object|null>}
 */
async function updateProcessState(processId, state, updates = {}, conn) {
  const allowed = ['priority', 'cpu_burst_time', 'memory_allocated_kb'];
  const fields = ['state = ?'];
  const params = [state];

  if (state === 'RUNNING' && updates.started_at === undefined) {
    fields.push('started_at = COALESCE(started_at, CURRENT_TIMESTAMP)');
  } else if (updates.started_at !== undefined) {
    fields.push('started_at = ?');
    params.push(updates.started_at);
  }

  if (['TERMINATED', 'KILLED'].includes(state) && updates.finished_at === undefined) {
    fields.push('finished_at = CURRENT_TIMESTAMP');
  } else if (updates.finished_at !== undefined) {
    fields.push('finished_at = ?');
    params.push(updates.finished_at);
  }

  for (const [key, value] of Object.entries(updates)) {
    if (allowed.includes(key)) {
      fields.push(`${key} = ?`);
      params.push(value);
    }
  }

  params.push(processId);
  const sql = `UPDATE PROCESSES SET ${fields.join(', ')} WHERE process_id = ?`;
  await getExecutor(conn).execute(sql, params);
  return retrieveProcess(processId, conn);
}

module.exports = {
  createProcess,
  retrieveProcess,
  retrieveProcessByPid,
  retrieveProcessesByState,
  getProcessByOperationId,
  updateProcessState,
};
