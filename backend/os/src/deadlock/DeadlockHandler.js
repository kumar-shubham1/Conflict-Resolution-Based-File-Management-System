'use strict';

const { STATES, EVENT_TYPES } = require('../constants');

/**
 * Deadlock detection and r ecovery (OS-10, OS-11).
 *
 * Victim rule (deterministic): lowest priority in the cycle (highest priority
 * number); ties -> most recently arrived; ties -> highest process id.
 *
 * `onRollback(processJson, cycle)` is the hook into the DBMS transaction layer
 * so the victim's partial changes can be rolled back.
 */
class DeadlockHandler {
  constructor({ graph, lockManager, processManager, log, clock, onRollback }) {
    this._graph = graph;
    this._locks = lockManager;
    this._pm = processManager;
    this._log = log;
    this._clock = clock;
    this._onRollback = onRollback || null;
    this._history = [];
  }

  /** Returns a cycle (array of process ids) or null. */
  detect() {
    const cycle = this._graph.findCycle();
    if (cycle) {
      this._log.record(EVENT_TYPES.DEADLOCK_DETECTED, {
        message: `Deadlock cycle detected: ${cycle.map((id) => `P${id}`).join(' -> ')} -> P${cycle[0]}`,
        data: { cycle },
      });
    }
    return cycle;
  }

  selectVictim(cycle) {
    const candidates = cycle.map((id) => this._pm.get(id));
    candidates.sort(
      (a, b) => b.priority - a.priority || b.arrivalTime - a.arrivalTime || b.id - a.id
    );
    return candidates[0];
  }

  /** Recover from one detected cycle. */
  recover(cycle, time = this._clock.now()) {
    const victim = this.selectVictim(cycle);
    this._log.record(EVENT_TYPES.VICTIM_SELECTED, {
      processId: victim.id,
      time,
      message: `${victim.name} selected as deadlock victim`,
      data: { cycle, priority: victim.priority, arrivalTime: victim.arrivalTime },
    });

    if (this._onRollback) this._onRollback(victim.toJSON(), cycle);
    this._log.record(EVENT_TYPES.ROLLBACK, {
      processId: victim.id,
      time,
      message: `${victim.name} rolled back`,
    });

    this._pm.transition(victim.id, STATES.ABORTED, time, 'deadlock victim');
    const { released, granted } = this._locks.releaseAll(victim.id, time);

    const resumed = [];
    for (const g of granted) {
      const p = this._pm.resumeWaiting(g.processId, time, 'lock granted after deadlock recovery');
      if (p.state === STATES.READY) resumed.push(g.processId);
    }

    const stillDeadlocked = this._graph.findCycle() !== null;
    const record = {
      id: this._history.length + 1,
      time,
      cycle,
      victimId: victim.id,
      releasedLocks: released,
      resumed,
      resolved: !stillDeadlocked,
    };
    this._history.push(record);
    this._log.record(EVENT_TYPES.DEADLOCK_RESOLVED, {
      time,
      message: `Deadlock ${record.id} resolved: victim ${victim.name}, resumed [${resumed.map((i) => `P${i}`).join(', ')}]`,
      data: record,
    });
    return record;
  }

  /** Detect and recover until the graph is acyclic. Returns the recovery records. */
  resolveAll(time = this._clock.now()) {
    const records = [];
    const maxRounds = this._pm.list().length + 1; // each round aborts one process
    for (let i = 0; i < maxRounds; i += 1) {
      const cycle = this.detect();
      if (!cycle) break;
      records.push(this.recover(cycle, time));
    }
    return records;
  }

  history() {
    return this._history.map((h) => ({ ...h }));
  }
}

module.exports = { DeadlockHandler };
