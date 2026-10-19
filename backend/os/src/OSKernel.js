'use strict';

const { STATES, ALGORITHMS, LOCK_STATUS } = require('./constants');
const { OsModuleError } = require('./errors');
const { LogicalClock } = require('./util/LogicalClock');
const { EventLog } = require('./logging/EventLog');
const { ProcessManager } = require('./process/ProcessManager');
const { Scheduler } = require('./scheduler/Scheduler');
const { averageMetrics } = require('./scheduler/metrics');
const { WaitForGraph } = require('./deadlock/WaitForGraph');
const { LockManager } = require('./locks/LockManager');
const { DeadlockHandler } = require('./deadlock/DeadlockHandler');

/**
 * OSKernel: single entry point the Backend calls. Every protected file operation
 * goes  submitOperation -> dispatch -> acquire -> (work) -> complete/fail.
 *
 * Options:
 *   algorithm   FCFS | SJF | PRIORITY (default FCFS)
 *   singleCpu   when true, dispatch() returns null while a process is RUNNING
 *   onPersist   (processJson) => void       save to `processes` table
 *   onLog       (logEntry) => void          save to `logs` table
 *   onLockChange(event) => void             mirror `locks` / `wait_for_edges`
 *   onRollback  (processJson, cycle) => void  DB transaction rollback hook
 */
class OSKernel {
  constructor({
    algorithm = ALGORITHMS.FCFS,
    singleCpu = false,
    clock,
    onPersist,
    onLog,
    onLockChange,
    onRollback,
  } = {}) {
    this.clock = clock || new LogicalClock();
    this.log = new EventLog({ clock: this.clock, sink: onLog });
    this.singleCpu = singleCpu;
    this._onRollback = onRollback || null;

    this.processes = new ProcessManager({ clock: this.clock, log: this.log, onPersist });
    this.scheduler = new Scheduler({
      processManager: this.processes,
      log: this.log,
      clock: this.clock,
      algorithm,
    });
    this.graph = new WaitForGraph();
    this.locks = new LockManager({
      clock: this.clock,
      log: this.log,
      graph: this.graph,
      onLockChange,
    });
    this.deadlocks = new DeadlockHandler({
      graph: this.graph,
      lockManager: this.locks,
      processManager: this.processes,
      log: this.log,
      clock: this.clock,
      onRollback,
    });
  }

  // ---- process / scheduling ----

  /** OS-01: register a file operation as a READY process. */
  submitOperation(spec) {
    return this.processes.createProcess(spec);
  }

  setAlgorithm(name) {
    return this.scheduler.setAlgorithm(name);
  }

  /** Dispatch the next READY process (READY -> RUNNING), or null. */
  dispatch() {
    if (this.singleCpu && this.processes.list({ state: STATES.RUNNING }).length > 0) return null;
    return this.scheduler.dispatch();
  }

  // ---- locking ----

  /**
   * A RUNNING process asks for a file lock.
   * Returns { status: GRANTED | WAITING | ABORTED, holderId, deadlock }.
   * If the request closes a wait-for cycle, recovery runs immediately.
   */
  acquire(processId, fileId) {
    const proc = this.processes.get(processId);
    if (proc.state !== STATES.RUNNING) {
      throw new OsModuleError(
        `P${processId} must be RUNNING to request a lock (is ${proc.state})`,
        'NOT_RUNNING'
      );
    }
    const result = this.locks.requestLock(processId, fileId, this.clock.now());
    if (result.status === LOCK_STATUS.GRANTED) {
      return { status: LOCK_STATUS.GRANTED, holderId: result.holderId, deadlock: null };
    }

    this.processes.transition(processId, STATES.WAITING, this.clock.now(), `waiting for file ${fileId}`);
    const recoveries = this.deadlocks.resolveAll(this.clock.now());

    const after = this.processes.get(processId).state;
    let status = LOCK_STATUS.WAITING;
    if (after === STATES.ABORTED) status = STATES.ABORTED;
    else if (after === STATES.READY) status = LOCK_STATUS.GRANTED; // got the lock during recovery
    return {
      status,
      holderId: result.holderId,
      deadlock: recoveries.length > 0 ? recoveries : null,
    };
  }

  /** Release one lock and resume the next waiter (WAITING -> READY). */
  release(processId, fileId) {
    const res = this.locks.releaseLock(processId, fileId, this.clock.now());
    if (res.grantedTo !== null) this.processes.resumeWaiting(res.grantedTo, this.clock.now());
    return res;
  }

  /** RUNNING -> COMPLETED, release all locks, resume waiters. Returns process JSON with metrics. */
  complete(processId) {
    const now = this.clock.now();
    this.processes.transition(processId, STATES.COMPLETED, now, 'operation finished');
    const { granted } = this.locks.releaseAll(processId, now);
    granted.forEach((g) => this.processes.resumeWaiting(g.processId, now));
    return this.processes.get(processId).toJSON();
  }

  /** Mark a process FAILED (error path): roll back hook, release locks, resume waiters. */
  fail(processId, reason = 'operation failed') {
    const now = this.clock.now();
    const proc = this.processes.get(processId);
    if (this._onRollback) this._onRollback(proc.toJSON(), null);
    this.processes.transition(processId, STATES.FAILED, now, reason);
    const { granted } = this.locks.releaseAll(processId, now);
    granted.forEach((g) => this.processes.resumeWaiting(g.processId, now));
    return this.processes.get(processId).toJSON();
  }

  /** Admin-triggered deadlock check (OS-10). */
  detectAndRecoverDeadlocks() {
    return this.deadlocks.resolveAll(this.clock.now());
  }

  // ---- observability (OS-12) ----

  snapshot() {
    const processes = this.processes.list().map((p) => p.toJSON());
    return {
      time: this.clock.now(),
      algorithm: this.scheduler.getAlgorithm(),
      processes,
      readyQueue: this.scheduler.readyQueue().map((p) => p.id),
      locks: this.locks.snapshot(),
      waitForEdges: this.graph.edges(),
      deadlocks: this.deadlocks.history(),
      averages: averageMetrics(processes),
    };
  }
}

module.exports = { OSKernel };
