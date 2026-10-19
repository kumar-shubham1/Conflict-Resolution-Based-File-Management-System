/**
 * ConflictCore - Automated DB Layer Test Suite
 * Validates connection pooling, all 7 repository CRUD operations,
 * relational queries, and transaction commit/rollback mechanics.
 */

const assert = require('assert');
const {
  testConnection,
  closePool,
  withTransaction,
  userRepository,
  folderRepository,
  fileRepository,
  permissionRepository,
  operationRepository,
  processRepository,
  lockRepository,
  relationalQueries,
} = require('../src/db');

let testsPassed = 0;
let testsFailed = 0;

async function runTest(name, fn) {
  process.stdout.write(`  [TEST] ${name} ... `);
  try {
    await fn();
    console.log('PASSED');
    testsPassed++;
  } catch (err) {
    console.log('FAILED');
    console.error(`    -> Error: ${err.message}`);
    testsFailed++;
  }
}

async function main() {
  console.log('==================================================');
  console.log('ConflictCore - Data Access Layer Test Suite');
  console.log('==================================================\n');

  // 1. Connection Test
  await runTest('Database Connection & Pool Health', async () => {
    const res = await testConnection();
    assert.strictEqual(res.success, true, `Connection failed: ${res.error}`);
    assert.ok(res.serverTime, 'Expected valid server time from MySQL');
  });

  // Unique timestamp suffix for non-colliding test entities
  const ts = Date.now();
  let testUserId = null;
  let testFolderId = null;
  let testChildFolderId = null;
  let testFileId = null;
  let testPermId = null;
  let testOpId = null;
  let testProcId = null;
  let testLockId = null;

  // 2. User CRUD
  await runTest('User CRUD (Create, Find, Update, Deactivate)', async () => {
    const username = `test_u_${ts}`;
    const email = `test_${ts}@conflictcore.io`;

    // Create
    const user = await userRepository.createUser({
      username,
      email,
      password_hash: '$2b$12$faketestpasswordhashforsuite',
      role: 'USER',
    });
    assert.ok(user.user_id, 'User ID should be generated');
    testUserId = user.user_id;

    // Find by ID, Email, Username
    const byId = await userRepository.findUserById(testUserId);
    assert.strictEqual(byId.email, email);
    const byEmail = await userRepository.findUserByEmail(email);
    assert.strictEqual(byEmail.user_id, testUserId);
    const byUsername = await userRepository.findUserByUsername(username);
    assert.strictEqual(byUsername.user_id, testUserId);

    // Update
    const updated = await userRepository.updateUser(testUserId, { role: 'COLLABORATOR' });
    assert.strictEqual(updated.role, 'COLLABORATOR');

    // Deactivate
    const deactivated = await userRepository.deactivateUser(testUserId);
    assert.strictEqual(deactivated.status, 'INACTIVE');
  });

  // 3. Folder CRUD
  await runTest('Folder CRUD & Hierarchy (Create, List, Child Folders, Update)', async () => {
    // Root Folder
    const rootFolder = await folderRepository.createFolder({
      folder_name: `Test_Root_${ts}`,
      owner_id: testUserId,
    });
    assert.ok(rootFolder.folder_id, 'Folder ID should be generated');
    testFolderId = rootFolder.folder_id;

    // Nested Child Folder
    const childFolder = await folderRepository.createFolder({
      folder_name: `Test_Sub_${ts}`,
      parent_folder_id: testFolderId,
      owner_id: testUserId,
    });
    testChildFolderId = childFolder.folder_id;
    assert.strictEqual(childFolder.parent_folder_id, testFolderId);

    // List Children
    const children = await folderRepository.getChildFolders(testFolderId);
    assert.strictEqual(children.length, 1);
    assert.strictEqual(children[0].folder_id, testChildFolderId);

    // Update
    const renamed = await folderRepository.updateFolder(testChildFolderId, {
      folder_name: `Test_Sub_Renamed_${ts}`,
    });
    assert.strictEqual(renamed.folder_name, `Test_Sub_Renamed_${ts}`);
  });

  // 4. File CRUD
  await runTest('File CRUD (Create Metadata, Get, List, Update)', async () => {
    const file = await fileRepository.createFile({
      file_name: `matrix_${ts}.dat`,
      folder_id: testFolderId,
      owner_id: testUserId,
      file_size_bytes: 4096,
      file_path: `/Test_Root_${ts}/matrix_${ts}.dat`,
      mime_type: 'application/octet-stream',
      status: 'ACTIVE',
    });
    assert.ok(file.file_id, 'File ID should be generated');
    testFileId = file.file_id;

    // Get by ID
    const fetched = await fileRepository.getFileById(testFileId);
    assert.strictEqual(fetched.file_name, `matrix_${ts}.dat`);
    assert.strictEqual(fetched.owner_name, `test_u_${ts}`);

    // List by folder
    const list = await fileRepository.listFiles({ folder_id: testFolderId });
    assert.ok(list.some(f => f.file_id === testFileId));

    // Update
    const updated = await fileRepository.updateFile(testFileId, {
      file_size_bytes: 8192,
      status: 'LOCKED',
    });
    assert.strictEqual(Number(updated.file_size_bytes), 8192);
    assert.strictEqual(updated.status, 'LOCKED');
  });

  // 5. File Permissions
  await runTest('File Permissions (Grant, Check, Update, Revoke)', async () => {
    // Grant READ to user 4 (jahnvi_s from seeds)
    const perm = await permissionRepository.grantPermission({
      file_id: testFileId,
      user_id: 4,
      permission_type: 'READ',
      granted_by: testUserId,
    });
    assert.ok(perm.permission_id);
    testPermId = perm.permission_id;

    // Check permission
    const hasRead = await permissionRepository.checkPermission(testFileId, 4, 'READ');
    assert.strictEqual(hasRead, true, 'User 4 should have READ permission');
    const hasWrite = await permissionRepository.checkPermission(testFileId, 4, 'WRITE');
    assert.strictEqual(hasWrite, false, 'User 4 should NOT have WRITE permission');

    // Owner always has full permission
    const ownerHasAdmin = await permissionRepository.checkPermission(testFileId, testUserId, 'ADMIN');
    assert.strictEqual(ownerHasAdmin, true, 'Owner should implicitly have permission');

    // Update permission to WRITE
    const updatedPerm = await permissionRepository.updatePermission(testPermId, { permission_type: 'WRITE' });
    assert.strictEqual(updatedPerm.permission_type, 'WRITE');

    // Revoke
    const revoked = await permissionRepository.revokePermission(testPermId);
    assert.strictEqual(revoked, true);
    const hasWriteAfterRevoke = await permissionRepository.checkPermission(testFileId, 4, 'WRITE');
    assert.strictEqual(hasWriteAfterRevoke, false);
  });

  // 6. Operations Lifecycle
  await runTest('Operations Lifecycle (Create, Retrieve, Status Updates)', async () => {
    const op = await operationRepository.createOperation({
      user_id: testUserId,
      file_id: testFileId,
      operation_type: 'EDIT',
      status: 'PENDING',
      priority: 4,
      details: { action: 'syntax_check', line_count: 50 },
    });
    assert.ok(op.operation_id);
    testOpId = op.operation_id;
    assert.strictEqual(op.details.action, 'syntax_check');

    // Update status to EXECUTING
    const executing = await operationRepository.updateOperationStatus(testOpId, 'EXECUTING');
    assert.strictEqual(executing.status, 'EXECUTING');

    // Update status to COMPLETED
    const completed = await operationRepository.updateOperationStatus(testOpId, 'COMPLETED');
    assert.strictEqual(completed.status, 'COMPLETED');
    assert.ok(completed.completed_at, 'completed_at timestamp should be set');
  });

  // 7. Processes Representation
  await runTest('Process Representation (Create, State Transition, Query by State)', async () => {
    const pid = `PROC-TEST-${ts}`;
    const proc = await processRepository.createProcess({
      operation_id: testOpId,
      pid_alias: pid,
      state: 'NEW',
      priority: 4,
      cpu_burst_time: 40,
      memory_allocated_kb: 2048,
    });
    assert.ok(proc.process_id);
    testProcId = proc.process_id;

    // Transition to RUNNING
    const running = await processRepository.updateProcessState(testProcId, 'RUNNING');
    assert.strictEqual(running.state, 'RUNNING');
    assert.ok(running.started_at, 'started_at should be recorded');

    // Query by state
    const runningList = await processRepository.retrieveProcessesByState('RUNNING');
    assert.ok(runningList.some(p => p.process_id === testProcId));

    // Transition to TERMINATED
    const terminated = await processRepository.updateProcessState(testProcId, 'TERMINATED');
    assert.strictEqual(terminated.state, 'TERMINATED');
    assert.ok(terminated.finished_at, 'finished_at should be recorded');
  });

  // 8. File Locks
  await runTest('File Locks (Request, Active/Waiting Queries, Status Updates, Release)', async () => {
    // Acquire Lock
    const lock = await lockRepository.acquireOrRequestLock({
      file_id: testFileId,
      process_id: testProcId,
      lock_type: 'EXCLUSIVE',
      lock_status: 'ACQUIRED',
    });
    assert.ok(lock.lock_id);
    testLockId = lock.lock_id;
    assert.strictEqual(lock.lock_status, 'ACQUIRED');

    // Active lock query
    const activeLocks = await lockRepository.retrieveActiveLocks(testFileId);
    assert.ok(activeLocks.some(l => l.lock_id === testLockId));

    // Release lock
    const released = await lockRepository.releaseLock(testLockId);
    assert.strictEqual(released.lock_status, 'RELEASED');
    assert.ok(released.released_at);
  });

  // 9. Relational Query Suite
  await runTest('Relational Queries (Files by User, Hierarchy, Active/Waiting Locks)', async () => {
    // Files owned by user 2 (shubham_k from seeds)
    const user2Files = await relationalQueries.getFilesOwnedByUser(2);
    assert.ok(user2Files.length >= 3, 'User 2 should own files from seeds');

    // Files in folder 3 (Kernel_Source)
    const folder3Files = await relationalQueries.getFilesInFolder(3);
    assert.ok(folder3Files.length >= 2, 'Kernel_Source should contain files');

    // Active lock on file 2 (scheduler_core.c from seeds)
    const activeOnF2 = await relationalQueries.getActiveLocksOnFile(2);
    assert.ok(activeOnF2.length > 0, 'File 2 should have active lock from seeds');
    assert.strictEqual(activeOnF2[0].lock_holder, 'avni_n');

    // Waiting lock on file 2 (contention from seeds)
    const waitingOnF2 = await relationalQueries.getWaitingProcessesForFile(2);
    assert.ok(waitingOnF2.length > 0, 'File 2 should have waiting lock request');
    assert.strictEqual(waitingOnF2[0].requesting_user, 'shubham_k');
  });

  // 10. Transactions: Atomic Commit & Rollback
  await runTest('Transaction Support: Atomic Multi-Step Commit', async () => {
    const txPid = `PROC-TX-${ts}`;
    let createdTxOpId = null;

    const result = await withTransaction(async (conn) => {
      // Step 1: Create Operation
      const op = await operationRepository.createOperation(
        {
          user_id: testUserId,
          file_id: testFileId,
          operation_type: 'EDIT',
          status: 'QUEUED',
          priority: 5,
          details: { tx_test: true },
        },
        conn
      );
      createdTxOpId = op.operation_id;

      // Step 2: Spawn Process
      const proc = await processRepository.createProcess(
        {
          operation_id: op.operation_id,
          pid_alias: txPid,
          state: 'READY',
          priority: 5,
        },
        conn
      );

      // Step 3: Request Lock
      const lock = await lockRepository.acquireOrRequestLock(
        {
          file_id: testFileId,
          process_id: proc.process_id,
          lock_type: 'SHARED',
          lock_status: 'WAITING',
        },
        conn
      );

      return { op, proc, lock };
    });

    assert.ok(result.op.operation_id);
    assert.ok(result.proc.process_id);
    assert.ok(result.lock.lock_id);

    // Verify persisted in database
    const verifiedOp = await operationRepository.retrieveOperation(createdTxOpId);
    assert.strictEqual(verifiedOp.status, 'QUEUED');

    // Clean up transaction test records
    const pool = require('../src/db').getPool();
    await pool.execute('DELETE FROM FILE_LOCKS WHERE lock_id = ?', [result.lock.lock_id]);
    await pool.execute('DELETE FROM PROCESSES WHERE process_id = ?', [result.proc.process_id]);
    await pool.execute('DELETE FROM OPERATIONS WHERE operation_id = ?', [result.op.operation_id]);
  });

  await runTest('Transaction Support: Automatic Rollback on Failure', async () => {
    const failPid = `PROC-FAIL-${ts}`;
    let intermediateOpId = null;

    let errorThrown = false;
    try {
      await withTransaction(async (conn) => {
        // Step 1: Create operation (valid)
        const op = await operationRepository.createOperation(
          {
            user_id: testUserId,
            file_id: testFileId,
            operation_type: 'DELETE',
            status: 'PENDING',
          },
          conn
        );
        intermediateOpId = op.operation_id;

        // Step 2: Intentionally fail with invalid foreign key or duplicate pid
        // This causes an immediate rollback of Step 1!
        throw new Error('Simulated business logic failure during multi-step operation');
      });
    } catch (err) {
      errorThrown = true;
      assert.strictEqual(err.message, 'Simulated business logic failure during multi-step operation');
    }

    assert.strictEqual(errorThrown, true, 'Error should have been caught');

    // Verify intermediate operation was NOT persisted (properly rolled back!)
    const rolledBackOp = await operationRepository.retrieveOperation(intermediateOpId);
    assert.strictEqual(rolledBackOp, null, 'Operation created before failure MUST be rolled back');
  });

  // Cleanup temporary test records
  try {
    if (testLockId) await lockRepository.releaseLock(testLockId);
    if (testFileId) await fileRepository.deleteFile(testFileId);
    if (testChildFolderId) await folderRepository.deleteFolder(testChildFolderId);
    if (testFolderId) await folderRepository.deleteFolder(testFolderId);
    if (testUserId) await userRepository.deleteUser(testUserId);
  } catch (cleanErr) {
    // Ignored in test cleanup
  }

  // Close connection pool
  await closePool();

  console.log('\n==================================================');
  console.log(`Test Results: ${testsPassed} Passed, ${testsFailed} Failed`);
  console.log('==================================================');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
