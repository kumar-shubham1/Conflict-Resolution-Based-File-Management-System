'use strict';

/**
 * In-memory event log. Every state change, lock event and deadlock action is
 * recorded. Pass a `sink(entry)` to forward entries to the DBMS `logs` table.
 */
class EventLog {
  constructor({ clock, sink } = {}) {
    this._clock = clock;
    this._sink = sink || null;
    this._entries = [];
    this._seq = 0;
  }

  record(type, { processId = null, message = '', data = null, time } = {}) {
    const entry = {
      seq: ++this._seq,
      time: time !== undefined ? time : this._clock ? this._clock.now() : 0,
      type,
      processId,
      message,
      data,
    };
    this._entries.push(entry);
    if (this._sink) this._sink(entry);
    return entry;
  }

  entries({ type, processId } = {}) {
    return this._entries.filter(
      (e) =>
        (type === undefined || e.type === type) &&
        (processId === undefined || e.processId === processId)
    );
  }

  clear() {
    this._entries = [];
  }
}

module.exports = { EventLog };
