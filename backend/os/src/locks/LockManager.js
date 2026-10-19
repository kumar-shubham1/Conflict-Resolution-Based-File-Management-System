'use strict';

const { LOCK_STATUS, EVENT_TYPES } = require('../constants');
const { LockError } = require('../errors');
const { WaitForGraph } = require('../deadlock/WaitForGraph');

/**
 * File-level exclusive lock manager with a FIFO waiting queue per file.
 * Keeps the wait-for graph in sync: an edge exists for every queued waiter
 * pointing at the file's current holder (OS-07, OS-08, OS-09).
 *
 * `onLockChange(event)` lets the DB layer mirror the `locks` / `wait_for_edges` tables.
 */
class LockManager {
  constructor({ clock, log, graph, onLockChange } = {}) {
    this._clock = clock;
    this._log = log;
    this._graph = graph || new WaitForGraph();
    this._onLockChange = onLockChange || null;
    this._locks = new Map(); // fileId -> { holderId, acquiredAt }
    this._queues = new Map(); // fileId -> [processId]
  }

  get graph() {
    return this._graph;
  }

  /** Request an exclusive lock. Returns { status, holderId }. Re-entrant for the holder. */
  requestLock(processId, fileId, time = this._clock.now()) {
    const lock = this._locks.get(fileId);

    if (!lock) {
      this._grant(processId, fileId, time);
      return { status: LOCK_STATUS.GRANTED, holderId: processId };
    }
    if (lock.holderId === processId) {
      return { status: LOCK_STATUS.GRANTED, holderId: processId };
    }

    const queue = this._queueFor(fileId);
    if (!queue.includes(processId)) {
      queue.push(processId);
      this._log.record(EVENT_TYPES.LOCK_WAITING, {
        processId,
        time,
        message: `P${processId} waits for file ${fileId} held by P${lock.holderId}`,
        data: { fileId, holderId: lock.holderId, queuePosition: queue.length },
      });
      this._rebuildEdges(fileId, time);
      this._notify({ type: 'WAIT', fileId, processId, holderId: lock.holderId, time });
    }
    return { status: LOCK_STATUS.WAITING, holderId: lock.holderId };
  }

  /**
   * Release a lock held by `processId`. Grants it to the head of the queue, if any.
   * Returns { released: true, grantedTo: processId|null }.
   */
  releaseLock(processId, fileId, time = this._clock.now()) {
    const lock = this._locks.get(fileId);
    if (!lock || lock.holderId !== processId) {
      throw new LockError(`P${processId} does not hold the lock on file ${fileId}`);
    }
    this._locks.delete(fileId);
    this._log.record(EVENT_TYPES.LOCK_RELEASED, {
      processId,
      time,
      message: `P${processId} released file ${fileId}`,
      data: { fileId },
    });
    this._notify({ type: 'RELEASE', fileId, processId, time });

    const queue = this._queues.get(fileId) || [];
    const next = queue.shift();
    if (queue.length === 0) this._queues.delete(fileId);
    if (next !== undefined) this._grant(next, fileId, time);
    this._rebuildEdges(fileId, time);
    return { released: true, grantedTo: next !== undefined ? next : null };
  }

  /** Remove a process from every waiting queue (used on abort/fail). */
  cancelWaits(processId) {
    for (const [fileId, queue] of [...this._queues.entries()]) {
      const idx = queue.indexOf(processId);
      if (idx !== -1) {
        queue.splice(idx, 1);
        if (queue.length === 0) this._queues.delete(fileId);
      }
    }
    this._graph.removeEdgesByWaiter(processId);
  }

  /**
   * Cancel all waits and release every lock held by `processId`.
   * Returns { released: [fileId...], granted: [{ fileId, processId }] }.
   */
  releaseAll(processId, time = this._clock.now()) {
    this.cancelWaits(processId);
    const released = this.heldBy(processId);
    const granted = [];
    for (const fileId of released) {
      const { grantedTo } = this.releaseLock(processId, fileId, time);
      if (grantedTo !== null) granted.push({ fileId, processId: grantedTo });
    }
    this._graph.removeEdgesInvolving(processId);
    return { released, granted };
  }

  heldBy(processId) {
    return [...this._locks.entries()]
      .filter(([, l]) => l.holderId === processId)
      .map(([fileId]) => fileId);
  }

  holderOf(fileId) {
    const lock = this._locks.get(fileId);
    return lock ? lock.holderId : null;
  }

  queueOf(fileId) {
    return [...(this._queues.get(fileId) || [])];
  }

  /** Locks and waiting queues for the admin API / dashboard. */
  snapshot() {
    const fileIds = new Set([...this._locks.keys(), ...this._queues.keys()]);
    return [...fileIds].map((fileId) => {
      const lock = this._locks.get(fileId);
      return {
        fileId,
        holderId: lock ? lock.holderId : null,
        acquiredAt: lock ? lock.acquiredAt : null,
        waitingQueue: this.queueOf(fileId),
      };
    });
  }

  // ---- internals ----

  _queueFor(fileId) {
    if (!this._queues.has(fileId)) this._queues.set(fileId, []);
    return this._queues.get(fileId);
  }

  _grant(processId, fileId, time) {
    this._locks.set(fileId, { holderId: processId, acquiredAt: time });
    this._log.record(EVENT_TYPES.LOCK_GRANTED, {
      processId,
      time,
      message: `P${processId} acquired file ${fileId}`,
      data: { fileId },
    });
    this._notify({ type: 'GRANT', fileId, processId, time });
  }

  /** Recreate edges for one file: every queued waiter -> current holder. */
  _rebuildEdges(fileId, time) {
    this._graph.removeEdgesForFile(fileId);
    const lock = this._locks.get(fileId);
    if (!lock) return;
    for (const waiter of this._queues.get(fileId) || []) {
      if (this._graph.addEdge(waiter, lock.holderId, fileId, time)) {
        this._log.record(EVENT_TYPES.WAIT_EDGE_ADDED, {
          processId: waiter,
          time,
          message: `wait-for edge P${waiter} -> P${lock.holderId} (file ${fileId})`,
          data: { waiter, holder: lock.holderId, fileId },
        });
      }
    }
  }

  _notify(event) {
    if (this._onLockChange) this._onLockChange(event);
  }
}

module.exports = { LockManager };
