/**
 * ConflictCore - Transaction Manager
 * Provides atomic execution wrapper with automatic rollback on error
 * and guaranteed connection release.
 */

const { getPool } = require('./connection');

/**
 * Executes a callback within a managed MySQL database transaction.
 *
 * If the callback succeeds, changes are committed to the database.
 * If an exception is thrown, the transaction is automatically rolled back,
 * ensuring no partial or corrupted records are persisted.
 *
 * @param {Function} callback - Async function receiving (connection): Promise<T>
 * @param {Object} [existingConnection] - Optional existing transaction connection for nested calls
 * @returns {Promise<T>} Result of the callback
 */
async function withTransaction(callback, existingConnection = null) {
  if (existingConnection) {
    // Already within an active transaction context
    return await callback(existingConnection);
  }

  const pool = getPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error('[DB Transaction] Rollback error:', rollbackError.message);
    }
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  withTransaction,
};
