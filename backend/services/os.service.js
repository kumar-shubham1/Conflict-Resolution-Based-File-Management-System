
import pool from '../config/db.js';
import { osKernel } from './osKernel.js';
import {
    readStoredFile,
    deleteStoredFile
} from './storage.service.js';
import fs from 'fs/promises';
import path from 'path';

const VALID_OPERATIONS = new Set([
    'UPLOAD',
    'DOWNLOAD',
    'EDIT',
    'DELETE',
    'MOVE',
    'SHARE'
]);

const EXECUTABLE_OPERATIONS = new Set([
    'UPLOAD',
    'DOWNLOAD',
    'MOVE'
]);

const mapProcessState = (state) => {
    switch (state) {
        case 'COMPLETED':
            return 'TERMINATED';
        case 'FAILED':
        case 'ABORTED':
            return 'KILLED';
        case 'NEW':
        case 'READY':
        case 'RUNNING':
        case 'WAITING':
            return state;
        default:
            throw new Error(`Unsupported OS process state: ${state}`);
    }
};

const parseOperationDetails = (details) => {
    if (details == null || details === '') {
        return {};
    }

    if (typeof details === 'string') {
        try {
            details = JSON.parse(details);
        } catch {
            throw new Error('Operation details contain invalid JSON');
        }
    }

    if (
        typeof details !== 'object' ||
        Array.isArray(details)
    ) {
        throw new Error('Operation details must be a JSON object');
    }

    return details;
};

const validatePriority = (value) => {
    const priority = Number(value ?? 1);

    if (
        !Number.isInteger(priority) ||
        priority < 1 ||
        priority > 10
    ) {
        throw new Error(
            'Operation priority must be an integer from 1 to 10'
        );
    }

    return priority;
};

const validatePositiveId = (value, label) => {
    const id = Number(value);

    if (!Number.isInteger(id) || id <= 0) {
        throw new Error(`${label} must be a positive integer`);
    }

    return id;
};

const getOsProcessBurstTime = (process) => {
    const burstTime = Number(
        process.burstTime ?? process.toJSON().burstTime
    );

    if (!Number.isFinite(burstTime) || burstTime <= 0) {
        throw new Error('Invalid process CPU burst time');
    }

    return burstTime;
};

/**
 * Submit a pending database operation to the OS scheduler.
 *
 * This function creates the OS process and its corresponding database
 * process record. Actual file-operation execution occurs in
 * dispatchNextProcess().
 */
export const executeFileOperation = async (operation) => {
    if (!operation) {
        throw new Error('Operation not found');
    }

    const operationId = validatePositiveId(
        operation.operation_id,
        'Operation ID'
    );

    const connection = await pool.getConnection();
    let transactionOpen = false;
    let submittedProcess = null;

    try {
        await connection.beginTransaction();
        transactionOpen = true;

        const [rows] = await connection.query(
            `SELECT *
             FROM OPERATIONS
             WHERE operation_id = ?
             FOR UPDATE`,
            [operationId]
        );

        const current = rows[0];

        if (!current) {
            throw new Error('Operation not found');
        }

        if (current.status === 'COMPLETED') {
            await connection.commit();
            transactionOpen = false;

            return {
                success: true,
                status: 'COMPLETED',
                message: 'This operation has already completed'
            };
        }

        if (['FAILED', 'ABORTED'].includes(current.status)) {
            throw new Error(
                `Cannot execute an operation with status ${current.status}`
            );
        }

        if (['QUEUED', 'EXECUTING'].includes(current.status)) {
            const [existingProcesses] = await connection.query(
                `SELECT *
                 FROM PROCESSES
                 WHERE operation_id = ?
                 ORDER BY process_id DESC
                 LIMIT 1`,
                [operationId]
            );

            await connection.commit();
            transactionOpen = false;

            return {
                success: true,
                status: current.status,
                message: existingProcesses.length
                    ? 'Operation has already been submitted'
                    : 'Operation is already marked as submitted; no duplicate was created',
                operationId,
                process: existingProcesses[0] ?? null
            };
        }

        if (current.status !== 'PENDING') {
            throw new Error(
                `Cannot submit operation with status ${current.status}`
            );
        }

        const operationType = String(
            current.operation_type || ''
        ).toUpperCase();

        if (!VALID_OPERATIONS.has(operationType)) {
            throw new Error('Unsupported operation type');
        }

        if (!EXECUTABLE_OPERATIONS.has(operationType)) {
            throw new Error(
                `Execution is not implemented for ${operationType} yet.`
            );
        }

        const details = parseOperationDetails(current.details);
        const priority = validatePriority(current.priority);

        if (operationType === 'MOVE') {
            validatePositiveId(
                details.destination_folder_id,
                'MOVE destination_folder_id'
            );
        }

        if (operationType === 'UPLOAD') {
            if (
                typeof details.stagedFilePath !== 'string' ||
                !details.stagedFilePath.trim()
            ) {
                throw new Error(
                    'UPLOAD requires details.stagedFilePath'
                );
            }

            if (
                typeof details.originalName !== 'string' ||
                !details.originalName.trim() ||
                path.basename(details.originalName) !== details.originalName
            ) {
                throw new Error('UPLOAD requires a valid originalName');
            }
        } else if (current.file_id == null) {
            throw new Error(`${operationType} requires a file_id`);
        }

        const burstTime = details.burstTime === undefined
            ? undefined
            : Number(details.burstTime);

        if (
            burstTime !== undefined &&
            (!Number.isFinite(burstTime) || burstTime <= 0)
        ) {
            throw new Error(
                'Operation burstTime must be a positive number'
            );
        }

        submittedProcess = osKernel.submitOperation({
            name: `Operation-${operationId}`,
            userId: Number(current.user_id),
            fileId: current.file_id == null
                ? null
                : Number(current.file_id),
            operation: operationType,
            priority,
            ...(burstTime !== undefined ? { burstTime } : {})
        });

        const processData = submittedProcess.toJSON();
        const dbState = mapProcessState(processData.state);
        const pidAlias = `OS-${operationId}-${processData.id}`;
        const actualBurstTime = getOsProcessBurstTime(submittedProcess);

        const [insertResult] = await connection.query(
            `INSERT INTO PROCESSES
                (operation_id, pid_alias, state, priority,
                 cpu_burst_time, memory_allocated_kb)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                operationId,
                pidAlias,
                dbState,
                priority,
                actualBurstTime,
                1024
            ]
        );

        const [operationUpdate] = await connection.query(
            `UPDATE OPERATIONS
             SET status = 'QUEUED'
             WHERE operation_id = ?
               AND status = 'PENDING'`,
            [operationId]
        );

        if (operationUpdate.affectedRows !== 1) {
            throw new Error(
                'Could not queue the operation in the database'
            );
        }

        await connection.commit();
        transactionOpen = false;

        return {
            success: true,
            status: 'QUEUED',
            message: 'Operation queued and process saved to the database',
            operationId,
            databaseProcessId: insertResult.insertId,
            osProcessId: processData.id,
            process: processData,
            scheduler: osKernel.snapshot().algorithm
        };
    } catch (error) {
        if (transactionOpen) {
            try {
                await connection.rollback();
            } catch {
                // Preserve the original error.
            }

            transactionOpen = false;
        }

        if (submittedProcess) {
            try {
                osKernel.fail(
                    submittedProcess.id,
                    error.message || 'Operation submission failed'
                );
            } catch (kernelError) {
                console.error(
                    'OS process failure handling failed:',
                    kernelError
                );
            }
        }

        throw error;
    } finally {
        connection.release();
    }
};

let dispatchInProgress = false;

/**
 * Dispatch and execute the next READY process selected by the OS scheduler.
 *
 * Supported operations:
 * - UPLOAD
 * - DOWNLOAD
 * - MOVE
 *
 * Other operation types are rejected and marked FAILED.
 */

export const dispatchNextProcess = async () => {
    if (dispatchInProgress) {
        return {
            success: true,
            status: 'IDLE',
            message: 'A dispatch request is already in progress'
        };
    }

    dispatchInProgress = true;

    let connection;
    let dispatchedProcess = null;
    let candidateProcess = null;
    let databaseProcessId = null;
    let operationId = null;
    let stagedUploadPath = null;
    let transactionOpen = false;

    try {
        connection = await pool.getConnection();

        await connection.beginTransaction();
        transactionOpen = true;

        const snapshot = osKernel.snapshot();
        const nextOsProcessId = snapshot.readyQueue[0];

        if (nextOsProcessId === undefined) {
            await connection.commit();
            transactionOpen = false;

            return {
                success: true,
                status: 'IDLE',
                message: 'No process is ready to be dispatched'
            };
        }

        const candidate = snapshot.processes.find(
            (process) => process.id === nextOsProcessId
        );
        candidateProcess = candidate;
        const match = candidate
            ? /^Operation-(\d+)$/.exec(candidate.name)
            : null;

        if (!match) {
            throw new Error(
                'Cannot identify the queued operation'
            );
        }

        operationId = Number(match[1]);

        const pidAlias = `OS-${operationId}-${candidate.id}`;

        const [processRows] = await connection.query(
            `SELECT process_id, state
             FROM PROCESSES
             WHERE operation_id = ?
               AND pid_alias = ?
             FOR UPDATE`,
            [operationId, pidAlias]
        );

        if (
            !processRows.length ||
            processRows[0].state !== 'READY'
        ) {
            throw new Error(
                'No matching READY database process was found'
            );
        }

        databaseProcessId = processRows[0].process_id;

        const [operationRows] = await connection.query(
            `SELECT operation_id, user_id, file_id,
                    operation_type, status, details
             FROM OPERATIONS
             WHERE operation_id = ?
             FOR UPDATE`,
            [operationId]
        );

        const operation = operationRows[0];

        if (!operation || operation.status !== 'QUEUED') {
            throw new Error('Operation is not QUEUED');
        }

        const operationType = String(
            operation.operation_type || ''
        ).toUpperCase();

        if (!EXECUTABLE_OPERATIONS.has(operationType)) {
            const message =
                `Execution is not implemented for ${operationType} yet`;

            dispatchedProcess = osKernel.dispatch();

            if (
                !dispatchedProcess ||
                dispatchedProcess.id !== candidate.id
            ) {
                throw new Error(
                    'Could not dispatch the unsupported process safely'
                );
            }

            osKernel.fail(dispatchedProcess.id, message);

            const [processUpdate] = await connection.query(
                `UPDATE PROCESSES
                 SET state = 'KILLED',
                     finished_at = CURRENT_TIMESTAMP
                 WHERE process_id = ?
                   AND state = 'READY'`,
                [databaseProcessId]
            );

            const [operationUpdate] = await connection.query(
                `UPDATE OPERATIONS
                 SET status = 'FAILED',
                     completed_at = CURRENT_TIMESTAMP
                 WHERE operation_id = ?
                   AND status = 'QUEUED'`,
                [operationId]
            );

            if (
                processUpdate.affectedRows !== 1 ||
                operationUpdate.affectedRows !== 1
            ) {
                throw new Error(
                    'Could not persist the rejected operation state'
                );
            }

            await connection.commit();
            transactionOpen = false;

            return {
                success: false,
                status: 'FAILED',
                operationId,
                databaseProcessId,
                osProcessId: dispatchedProcess.id,
                message
            };
        }

        const details = parseOperationDetails(operation.details);

        /*
         * UPLOAD
         */
        if (operationType === 'UPLOAD') {
            const originalName = details.originalName;
            const mimeType =
                details.mimeType || 'application/octet-stream';

            const stagedFilePath = path.resolve(
                String(details.stagedFilePath || '')
            );

            const storageDirectory = path.resolve(
                process.cwd(),
                'storage'
            );

            if (
                typeof details.originalName !== 'string' ||
                !originalName.trim() ||
                path.basename(originalName) !== originalName
            ) {
                throw new Error(
                    'UPLOAD requires a valid originalName'
                );
            }

            const relativeStagedPath = path.relative(
                storageDirectory,
                stagedFilePath
            );

            if (
                !relativeStagedPath ||
                relativeStagedPath === '..' ||
                relativeStagedPath.startsWith(`..${path.sep}`) ||
                path.isAbsolute(relativeStagedPath)
            ) {
                throw new Error(
                    'UPLOAD path must be inside the storage directory'
                );
            }

            stagedUploadPath = stagedFilePath;

            const stagedFile = await fs.stat(stagedFilePath);

            if (!stagedFile.isFile()) {
                throw new Error('Staged upload is not a file');
            }

            if (
                Number(details.fileSize) !== stagedFile.size ||
                !Number.isInteger(Number(operation.user_id)) ||
                Number(operation.user_id) <= 0
            ) {
                throw new Error('UPLOAD metadata is invalid');
            }

            dispatchedProcess = osKernel.dispatch();

            if (
                !dispatchedProcess ||
                dispatchedProcess.id !== candidate.id
            ) {
                throw new Error(
                    'Could not dispatch the expected UPLOAD process'
                );
            }

            const [processStart] = await connection.query(
                `UPDATE PROCESSES
                 SET state = 'RUNNING',
                     started_at = COALESCE(
                         started_at,
                         CURRENT_TIMESTAMP
                     )
                 WHERE process_id = ?
                   AND state = 'READY'`,
                [databaseProcessId]
            );

            const [operationStart] = await connection.query(
                `UPDATE OPERATIONS
                 SET status = 'EXECUTING'
                 WHERE operation_id = ?
                   AND status = 'QUEUED'`,
                [operationId]
            );

            if (
                processStart.affectedRows !== 1 ||
                operationStart.affectedRows !== 1
            ) {
                throw new Error(
                    'Could not start the UPLOAD operation safely'
                );
            }

            await connection.commit();
            transactionOpen = false;

            // Insert the file record only when the scheduler executes UPLOAD.
            await connection.beginTransaction();
            transactionOpen = true;

            const [fileInsert] = await connection.query(
                `INSERT INTO FILES
                    (file_name, owner_id, file_size_bytes,
                     file_path, mime_type)
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    originalName,
                    Number(operation.user_id),
                    stagedFile.size,
                    stagedFilePath,
                    mimeType
                ]
            );

            const fileId = fileInsert.insertId;

            const [processFinish] = await connection.query(
                `UPDATE PROCESSES
                 SET state = 'TERMINATED',
                     finished_at = CURRENT_TIMESTAMP
                 WHERE process_id = ?
                   AND state = 'RUNNING'`,
                [databaseProcessId]
            );

            const [operationFinish] = await connection.query(
                `UPDATE OPERATIONS
                 SET file_id = ?,
                     status = 'COMPLETED',
                     completed_at = CURRENT_TIMESTAMP
                 WHERE operation_id = ?
                   AND status = 'EXECUTING'`,
                [fileId, operationId]
            );

            if (
                processFinish.affectedRows !== 1 ||
                operationFinish.affectedRows !== 1
            ) {
                throw new Error(
                    'Could not persist UPLOAD completion'
                );
            }

            osKernel.clock.advance(
                getOsProcessBurstTime(dispatchedProcess)
            );

            const completedProcess = osKernel.complete(
                dispatchedProcess.id
            );

            await connection.commit();
            transactionOpen = false;

            return {
                success: true,
                status: 'COMPLETED',
                operationId,
                databaseProcessId,
                osProcessId: dispatchedProcess.id,
                fileId,
                fileName: originalName,
                fileSize: stagedFile.size,
                process: completedProcess
            };
        }

        /*
         * MOVE
         */
        if (operationType === 'MOVE') {
            if (operation.file_id == null) {
                throw new Error('MOVE requires a file_id');
            }

            const destinationFolderId = validatePositiveId(
                details.destination_folder_id,
                'MOVE destination_folder_id'
            );

            const [fileRows] = await connection.query(
                `SELECT file_id, file_name, owner_id,
                        folder_id, status
                 FROM FILES
                 WHERE file_id = ?
                 FOR UPDATE`,
                [operation.file_id]
            );

            if (!fileRows.length) {
                throw new Error(
                    'The file associated with MOVE was not found'
                );
            }

            const file = fileRows[0];

            if (
                Number(file.owner_id) !== Number(operation.user_id)
            ) {
                throw new Error(
                    'Only the file owner can move this file'
                );
            }

            if (file.status !== 'ACTIVE') {
                throw new Error(
                    'Only ACTIVE files can be moved'
                );
            }

            const [folderRows] = await connection.query(
                `SELECT folder_id, owner_id
                 FROM FOLDERS
                 WHERE folder_id = ?
                 FOR UPDATE`,
                [destinationFolderId]
            );

            if (!folderRows.length) {
                throw new Error(
                    'Destination folder was not found'
                );
            }

            if (
                Number(folderRows[0].owner_id) !==
                Number(file.owner_id)
            ) {
                throw new Error(
                    'Destination folder must belong to the file owner'
                );
            }

            dispatchedProcess = osKernel.dispatch();

            if (
                !dispatchedProcess ||
                dispatchedProcess.id !== candidate.id
            ) {
                throw new Error(
                    'The scheduler could not dispatch the expected MOVE process'
                );
            }

            const [processStart] = await connection.query(
                `UPDATE PROCESSES
                 SET state = 'RUNNING',
                     started_at = COALESCE(
                         started_at,
                         CURRENT_TIMESTAMP
                     )
                 WHERE process_id = ?
                   AND state = 'READY'`,
                [databaseProcessId]
            );

            const [operationStart] = await connection.query(
                `UPDATE OPERATIONS
                 SET status = 'EXECUTING'
                 WHERE operation_id = ?
                   AND status = 'QUEUED'`,
                [operationId]
            );

            if (
                processStart.affectedRows !== 1 ||
                operationStart.affectedRows !== 1
            ) {
                throw new Error(
                    'Could not start the MOVE operation safely'
                );
            }

            await connection.commit();
            transactionOpen = false;

            await connection.beginTransaction();
            transactionOpen = true;

            const [fileUpdate] = await connection.query(
                `UPDATE FILES
                 SET folder_id = ?
                 WHERE file_id = ?
                   AND owner_id = ?
                   AND status = 'ACTIVE'`,
                [
                    destinationFolderId,
                    operation.file_id,
                    operation.user_id
                ]
            );

            if (fileUpdate.affectedRows !== 1) {
                throw new Error(
                    'Could not update the file destination'
                );
            }

            osKernel.clock.advance(
                getOsProcessBurstTime(dispatchedProcess)
            );

            const completedProcess = osKernel.complete(
                dispatchedProcess.id
            );

            const [processFinish] = await connection.query(
                `UPDATE PROCESSES
                 SET state = 'TERMINATED',
                     finished_at = CURRENT_TIMESTAMP
                 WHERE process_id = ?
                   AND state = 'RUNNING'`,
                [databaseProcessId]
            );

            const [operationFinish] = await connection.query(
                `UPDATE OPERATIONS
                 SET status = 'COMPLETED',
                     completed_at = CURRENT_TIMESTAMP
                 WHERE operation_id = ?
                   AND status = 'EXECUTING'`,
                [operationId]
            );

            if (
                processFinish.affectedRows !== 1 ||
                operationFinish.affectedRows !== 1
            ) {
                throw new Error(
                    'Could not persist MOVE completion'
                );
            }

            await connection.commit();
            transactionOpen = false;

            return {
                success: true,
                status: 'COMPLETED',
                operationId,
                databaseProcessId,
                osProcessId: dispatchedProcess.id,
                fileId: file.file_id,
                fileName: file.file_name,
                previousFolderId: file.folder_id,
                destinationFolderId,
                process: completedProcess
            };
        }

        /*
         * DOWNLOAD
         */
        if (operation.file_id == null) {
            throw new Error('DOWNLOAD requires a file_id');
        }

        const [fileRows] = await connection.query(
            `SELECT file_id, file_name, file_path, owner_id, status
             FROM FILES
             WHERE file_id = ?
             FOR UPDATE`,
            [operation.file_id]
        );

        if (!fileRows.length) {
            throw new Error(
                'The file associated with this operation was not found'
            );
        }

        const file = fileRows[0];

        if (Number(file.owner_id) !== Number(operation.user_id)) {
            throw new Error(
                'Only the file owner can download this file'
            );
        }

        if (file.status !== 'ACTIVE') {
            throw new Error(
                'Only ACTIVE files can be downloaded'
            );
        }

        dispatchedProcess = osKernel.dispatch();

        if (
            !dispatchedProcess ||
            dispatchedProcess.id !== candidate.id
        ) {
            throw new Error(
                'The scheduler could not dispatch the expected DOWNLOAD process'
            );
        }

        const [processStart] = await connection.query(
            `UPDATE PROCESSES
             SET state = 'RUNNING',
                 started_at = COALESCE(
                     started_at,
                     CURRENT_TIMESTAMP
                 )
             WHERE process_id = ?
               AND state = 'READY'`,
            [databaseProcessId]
        );

        const [operationStart] = await connection.query(
            `UPDATE OPERATIONS
             SET status = 'EXECUTING'
             WHERE operation_id = ?
               AND status = 'QUEUED'`,
            [operationId]
        );

        if (
            processStart.affectedRows !== 1 ||
            operationStart.affectedRows !== 1
        ) {
            throw new Error(
                'Could not start the DOWNLOAD operation safely'
            );
        }

        await connection.commit();
        transactionOpen = false;

        const fileData = await readStoredFile(file.file_path);

        if (!Buffer.isBuffer(fileData)) {
            throw new Error('Stored file could not be read');
        }

        osKernel.clock.advance(
            getOsProcessBurstTime(dispatchedProcess)
        );

        const completedProcess = osKernel.complete(
            dispatchedProcess.id
        );

        await connection.beginTransaction();
        transactionOpen = true;

        const [processFinish] = await connection.query(
            `UPDATE PROCESSES
             SET state = 'TERMINATED',
                 finished_at = CURRENT_TIMESTAMP
             WHERE process_id = ?
               AND state = 'RUNNING'`,
            [databaseProcessId]
        );

        const [operationFinish] = await connection.query(
            `UPDATE OPERATIONS
             SET status = 'COMPLETED',
                 completed_at = CURRENT_TIMESTAMP
             WHERE operation_id = ?
               AND status = 'EXECUTING'`,
            [operationId]
        );

        if (
            processFinish.affectedRows !== 1 ||
            operationFinish.affectedRows !== 1
        ) {
            throw new Error(
                'Could not persist DOWNLOAD completion'
            );
        }

        await connection.commit();
        transactionOpen = false;

        return {
            success: true,
            status: 'COMPLETED',
            operationId,
            databaseProcessId,
            osProcessId: dispatchedProcess.id,
            fileId: file.file_id,
            fileName: file.file_name,
            bytesRead: fileData.length,
            process: completedProcess
        };
    } catch (error) {
        if (connection && transactionOpen) {
            try {
                await connection.rollback();
            } catch {
                // Preserve the original error.
            }

            transactionOpen = false;
        }

        // Fail the in-memory process, including validation failures
        // that happen before normal dispatch.
        const processToFail = dispatchedProcess || candidateProcess;

        if (processToFail) {
            try {
                const snapshot = osKernel.snapshot();
                const currentProcess = snapshot.processes.find(
                    (process) => process.id === processToFail.id
                );

                if (
                    currentProcess &&
                    !['COMPLETED', 'FAILED', 'ABORTED', 'TERMINATED', 'KILLED']
                        .includes(currentProcess.state)
                ) {
                    osKernel.fail(
                        processToFail.id,
                        error.message || 'Operation execution failed'
                    );
                }
            } catch (kernelError) {
                console.error(
                    'OS process failure handling failed:',
                    kernelError
                );
            }
        }

        // Reconcile the database independently of whether dispatch occurred.
        if (connection && operationId && databaseProcessId) {
            try {
                await connection.beginTransaction();
                transactionOpen = true;

                await connection.query(
                    `UPDATE PROCESSES
                     SET state = 'KILLED',
                         finished_at = CURRENT_TIMESTAMP
                     WHERE process_id = ?
                       AND state IN ('READY', 'RUNNING')`,
                    [databaseProcessId]
                );

                await connection.query(
                    `UPDATE OPERATIONS
                     SET status = 'FAILED',
                         completed_at = CURRENT_TIMESTAMP
                     WHERE operation_id = ?
                       AND status IN ('QUEUED', 'EXECUTING')`,
                    [operationId]
                );

                await connection.commit();
                transactionOpen = false;
            } catch (reconcileError) {
                if (transactionOpen) {
                    try {
                        await connection.rollback();
                    } catch {
                        // Preserve the original error.
                    }

                    transactionOpen = false;
                }

                console.error(
                    'Failed to reconcile operation state:',
                    reconcileError
                );
            }
        }

        if (stagedUploadPath) {
            try {
                const [storedFiles] = await pool.query(
                    `SELECT file_id
                     FROM FILES
                     WHERE file_path = ?
                     LIMIT 1`,
                    [stagedUploadPath]
                );

                // Never delete a file referenced by a database record.
                if (storedFiles.length === 0) {
                    await deleteStoredFile(stagedUploadPath);
                }
            } catch (cleanupError) {
                console.error(
                    'Could not clean up failed staged upload:',
                    cleanupError
                );
            }
        }
        throw error;
    }finally {
        if (connection) {
            connection.release();
        }

        dispatchInProgress = false;
    }
};

/**
 * Restore READY database processes into the in-memory OS scheduler
 * after a server restart.
 */
export const restoreQueuedProcesses = async () => {
    const [rows] = await pool.query(
        `SELECT
            o.operation_id,
            p.process_id,
            o.user_id,
            o.file_id,
            o.operation_type,
            o.priority,
            p.cpu_burst_time
         FROM OPERATIONS o
         INNER JOIN PROCESSES p
             ON p.operation_id = o.operation_id
         WHERE o.status = 'QUEUED'
           AND p.state = 'READY'
         ORDER BY p.created_at ASC, p.process_id ASC`
    );

    const existingNames = new Set(
        osKernel.snapshot().processes.map(
            (process) => process.name
        )
    );

    let restoredCount = 0;

    for (const row of rows) {
        const operationId = Number(row.operation_id);
        const processName = `Operation-${operationId}`;

        if (existingNames.has(processName)) {
            continue;
        }

        const restoredProcess = osKernel.submitOperation({
            name: processName,
            userId: Number(row.user_id),
            fileId: row.file_id == null
                ? null
                : Number(row.file_id),
            operation: row.operation_type,
            arrivalTime: osKernel.clock.now(),
            burstTime: Number(row.cpu_burst_time),
            priority: Number(row.priority)
        });

        const [result] = await pool.query(
            `UPDATE PROCESSES
             SET pid_alias = ?
             WHERE process_id = ?
               AND operation_id = ?
               AND state = 'READY'`,
            [
                `OS-${operationId}-${restoredProcess.id}`,
                row.process_id,
                operationId
            ]
        );

        if (result.affectedRows !== 1) {
            try {
                osKernel.fail(
                    restoredProcess.id,
                    'Could not restore the database process alias'
                );
            } catch (kernelError) {
                console.error(
                    'Could not clean up restored OS process:',
                    kernelError
                );
            }

            throw new Error(
                `Could not update the process alias for operation ${operationId}`
            );
        }

        existingNames.add(processName);
        restoredCount++;
    }

    console.log(
        `Restored ${restoredCount} queued OS process(es).`
    );

    return restoredCount;
};
