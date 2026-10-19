'use strict';

const { STATES, EVENT_TYPES } = require('../constants');
const { UnknownProcessError } = require('../errors');
const { Process } = require('./Process');
const { assertTransition } = require('./ProcessStateMachine');
const { estimateBurst, defaultPriority } = require('../scheduler/burstEstimator');

/**
 * Process Manager: owns all process records and enforces the state machine.
 * Every file operation must be registered here before it touches file state (OS-01).
 *
 * `onPersist(processJson)` lets the DB layer save each change to the `processes` table.
 */
class ProcessManager {
  constructor({ clock, log, onPersist } = {}) {
    this._clock = clock;
    this._log = log;
    this._onPersist = onPersist || null;
    this._processes = new Map();
    this._nextId = 1;
  }

  createProcess({ userId, fileId, operation, name, arrivalTime, burstTime, priority, sizeBytes } = {}) {
    const proc = new Process({
      id: this._nextId,
      name,
      userId,
      fileId,
      operation,
      arrivalTime: arrivalTime !== undefined ? arrivalTime : this._clock.now(),
      burstTime: burstTime !== undefined ? burstTime : estimateBurst(operation, sizeBytes),
      priority: priority !== undefined ? priority : defaultPriority(operation),
    });
    this._nextId += 1;
    this._processes.set(proc.id, proc);
    this._persist(proc);
    this._log.record(EVENT_TYPES.PROCESS_CREATED, {
      processId: proc.id,
      message: `${proc.name} created for ${proc.operation} on file ${proc.fileId}`,
      data: { operation: proc.operation, fileId: proc.fileId },
    });
    this.transition(proc.id, STATES.READY, this._clock.now(), 'admitted to ready queue');
    return proc;
  }

  get(id) {
    const proc = this._processes.get(id);
    if (!proc) throw new UnknownProcessError(id);
    return proc;
  }

  list({ state } = {}) {
    const all = [...this._processes.values()].sort((a, b) => a.id - b.id);
    return state ? all.filter((p) => p.state === state) : all;
  }

  transition(id, to, time = this._clock.now(), reason = null) {
    const proc = this.get(id);
    const from = proc.state;
    assertTransition(from, to);
    proc.state = to;
    proc.stateReason = reason;
    if (to === STATES.RUNNING && proc.firstStartTime === null) proc.firstStartTime = time;
    if (to === STATES.COMPLETED) proc.completionTime = time;
    this._persist(proc);
    this._log.record(EVENT_TYPES.STATE_CHANGED, {
      processId: id,
      time,
      message: `${proc.name}: ${from} -> ${to}${reason ? ` (${reason})` : ''}`,
      data: { from, to, reason },
    });
    return proc;
  }

  /** Move a WAITING process back to READY (used after a lock grant). No-op otherwise. */
  resumeWaiting(id, time = this._clock.now(), reason = 'lock granted') {
    const proc = this.get(id);
    if (proc.state === STATES.WAITING) this.transition(id, STATES.READY, time, reason);
    return proc;
  }

  _persist(proc) {
    if (this._onPersist) this._onPersist(proc.toJSON());
  }
}

module.exports = { ProcessManager };
