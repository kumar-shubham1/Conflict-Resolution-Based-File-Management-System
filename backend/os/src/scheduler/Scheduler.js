'use strict';

const { STATES, ALGORITHMS, EVENT_TYPES } = require('../constants');
const { normalizeAlgorithm, orderReady } = require('./algorithms');

/**
 * Live scheduler: picks the next READY process using the selected algorithm.
 * The algorithm can be switched at runtime (OS-04); it applies to the next dispatch.
 */
class Scheduler {
  constructor({ processManager, log, clock, algorithm = ALGORITHMS.FCFS }) {
    this._pm = processManager;
    this._log = log;
    this._clock = clock;
    this._algorithm = normalizeAlgorithm(algorithm);
  }

  getAlgorithm() {
    return this._algorithm;
  }

  setAlgorithm(name) {
    const next = normalizeAlgorithm(name);
    const previous = this._algorithm;
    this._algorithm = next;
    this._log.record(EVENT_TYPES.ALGORITHM_CHANGED, {
      message: `Scheduler algorithm ${previous} -> ${next}`,
      data: { from: previous, to: next },
    });
    return next;
  }

  /** READY processes in dispatch order (front of the array runs next). */
  readyQueue() {
    return orderReady(this._pm.list({ state: STATES.READY }), this._algorithm);
  }

  /** Next process without dispatching it, or null. */
  peek() {
    return this.readyQueue()[0] || null;
  }

  /** Dispatch the next READY process: READY -> RUNNING. Returns it, or null when idle. */
  dispatch() {
    const next = this.peek();
    if (!next) return null;
    const now = this._clock.now();
    this._pm.transition(next.id, STATES.RUNNING, now, `dispatched by ${this._algorithm}`);
    this._log.record(EVENT_TYPES.PROCESS_DISPATCHED, {
      processId: next.id,
      message: `${next.name} dispatched by ${this._algorithm}`,
      data: { algorithm: this._algorithm },
    });
    return next;
  }
}

module.exports = { Scheduler };
