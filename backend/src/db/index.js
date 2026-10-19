/**
 * ConflictCore - DBMS & Data Layer Unified Export
 * Entry point exposing database connection pool, transaction helper,
 * all 7 table repositories, and relational queries.
 */

const connection = require('./connection');
const transactions = require('./transactions');
const userRepository = require('./repositories/userRepository');
const folderRepository = require('./repositories/folderRepository');
const fileRepository = require('./repositories/fileRepository');
const permissionRepository = require('./repositories/permissionRepository');
const operationRepository = require('./repositories/operationRepository');
const processRepository = require('./repositories/processRepository');
const lockRepository = require('./repositories/lockRepository');
const relationalQueries = require('./queries/relationalQueries');

module.exports = {
  // Connection & Pool
  getPool: connection.getPool,
  testConnection: connection.testConnection,
  closePool: connection.closePool,
  dbConfig: connection.config,

  // Transactions
  withTransaction: transactions.withTransaction,

  // Repositories for 7 Core Tables
  userRepository,
  folderRepository,
  fileRepository,
  permissionRepository,
  operationRepository,
  processRepository,
  lockRepository,

  // Relational Queries
  relationalQueries,
};
