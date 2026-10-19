'use strict';

/**
 * Deterministic logical clock. Using a logical clock instead of Date.now()
 * makes scheduler, lock and deadlock demos exactly repeatable.
 * The backend may map one tick to any real unit (e.g. 1 tick = 1 second).
 */
class LogicalClock {
  constructor(start = 0) {
    this._t = start;
  }

  now() {
    return this._t;
  }

  advance(ticks = 1) {
    this._t += ticks;
    return this._t;
  }

  set(time) {
    if (time < this._t) {
      throw new RangeError('LogicalClock cannot move backwards');
    }
    this._t = time;
    return this._t;
  }
}

module.exports = { LogicalClock };
