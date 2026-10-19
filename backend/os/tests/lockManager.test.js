'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OSKernel } = require('../src/OSKernel');
const { STATES, LOCK_STATUS } = require('../src/constants');
const { LockError, OsModuleError } = require('../src/errors');

function twoRunning() {
  const k = new OSKernel();
  const a = k.submitOperation({ userId: 1, fileId: 'f', operation: 'EDIT' });
  const b = k.submitOperation({ userId: 2, fileId: 'f', operation: 'EDIT' });
  k.dispatch();
  k.dispatch();
  return { k, a, b };
}

test('LOCK-01: second process waits until the lock is released, then is granted (FIFO)', () => {
  const { k, a, b } = twoRunning();
  assert.equal(k.acquire(a.id, 'f').status, LOCK_STATUS.GRANTED);
  const r = k.acquire(b.id, 'f');
  assert.equal(r.status, LOCK_STATUS.WAITING);
  assert.equal(k.processes.get(b.id).state, STATES.WAITING);
  assert.deepEqual(k.locks.queueOf('f'), [b.id]);
  assert.deepEqual(k.graph.edges().map((e) => [e.waiter, e.holder]), [[b.id, a.id]]);

  k.release(a.id, 'f');
  assert.equal(k.locks.holderOf('f'), b.id);
  assert.equal(k.processes.get(b.id).state, STATES.READY);
  assert.equal(k.graph.edges().length, 0);
});

test('waiters are granted in FIFO order and edges follow the new holder', () => {
  const k = new OSKernel();
  const ps = [1, 2, 3].map((u) => k.submitOperation({ userId: u, fileId: 'f', operation: 'EDIT' }));
  ps.forEach(() => k.dispatch());
  k.acquire(ps[0].id, 'f');
  k.acquire(ps[1].id, 'f');
  k.acquire(ps[2].id, 'f');
  assert.deepEqual(k.locks.queueOf('f'), [2, 3]);
  k.release(1, 'f');
  assert.equal(k.locks.holderOf('f'), 2);
  assert.deepEqual(k.graph.edges().map((e) => [e.waiter, e.holder]), [[3, 2]]);
});

test('lock request is re-entrant for the holder and never duplicates queue entries', () => {
  const { k, a, b } = twoRunning();
  k.acquire(a.id, 'f');
  assert.equal(k.acquire(a.id, 'f').status, LOCK_STATUS.GRANTED);
  k.locks.requestLock(b.id, 'f');
  k.locks.requestLock(b.id, 'f');
  assert.deepEqual(k.locks.queueOf('f'), [b.id]);
});

test('releasing a lock you do not hold throws', () => {
  const { k, a, b } = twoRunning();
  k.acquire(a.id, 'f');
  assert.throws(() => k.locks.releaseLock(b.id, 'f'), LockError);
});

test('only RUNNING processes may request locks', () => {
  const k = new OSKernel();
  const p = k.submitOperation({ userId: 1, fileId: 'f', operation: 'EDIT' });
  assert.throws(() => k.acquire(p.id, 'f'), OsModuleError);
});

test('LOCK-02: a failed process releases its lock and the queue advances', () => {
  const { k, a, b } = twoRunning();
  k.acquire(a.id, 'f');
  k.acquire(b.id, 'f');
  k.fail(a.id, 'disk error');
  assert.equal(k.processes.get(a.id).state, STATES.FAILED);
  assert.equal(k.locks.holderOf('f'), b.id);
  assert.equal(k.processes.get(b.id).state, STATES.READY);
});

test('completing a process releases all its locks', () => {
  const k = new OSKernel();
  const p = k.submitOperation({ userId: 1, fileId: 'x', operation: 'MOVE' });
  k.dispatch();
  k.acquire(p.id, 'x');
  k.acquire(p.id, 'y');
  k.complete(p.id);
  assert.deepEqual(k.locks.snapshot(), []);
});
