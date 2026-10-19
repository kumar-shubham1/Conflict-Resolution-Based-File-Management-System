'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OSKernel } = require('../src/OSKernel');
const { WaitForGraph } = require('../src/deadlock/WaitForGraph');
const { STATES, LOCK_STATUS } = require('../src/constants');

function classicDeadlock(priorities = [2, 3], hooks = {}) {
  const k = new OSKernel({ algorithm: 'PRIORITY', ...hooks });
  const p1 = k.submitOperation({ userId: 1, fileId: 'A', operation: 'MOVE', priority: priorities[0] });
  const p2 = k.submitOperation({ userId: 2, fileId: 'B', operation: 'MOVE', priority: priorities[1] });
  k.dispatch();
  k.dispatch();
  k.acquire(p1.id, 'A');
  k.acquire(p2.id, 'B');
  return { k, p1, p2 };
}

test('WaitForGraph finds a 2-cycle and a 3-cycle, and none in a chain', () => {
  const g = new WaitForGraph();
  g.addEdge(1, 2, 'A');
  g.addEdge(2, 3, 'B');
  assert.equal(g.findCycle(), null);
  g.addEdge(3, 1, 'C');
  assert.deepEqual(g.findCycle(), [1, 2, 3]);

  const g2 = new WaitForGraph();
  g2.addEdge(1, 2, 'A');
  g2.addEdge(2, 1, 'B');
  assert.deepEqual(g2.findCycle(), [1, 2]);
});

test('WaitForGraph ignores self edges and duplicates', () => {
  const g = new WaitForGraph();
  assert.equal(g.addEdge(1, 1, 'A'), false);
  assert.equal(g.addEdge(1, 2, 'A'), true);
  assert.equal(g.addEdge(1, 2, 'A'), false);
  assert.equal(g.edges().length, 1);
});

test('DEAD-01: crossing lock requests are detected as cycle [P1, P2]', () => {
  const { k, p1, p2 } = classicDeadlock();
  assert.equal(k.acquire(p1.id, 'B').status, LOCK_STATUS.WAITING);
  assert.equal(k.graph.findCycle(), null);
  // Build the closing edge without auto-recovery to observe detection alone.
  k.locks.requestLock(p2.id, 'A');
  assert.deepEqual(k.deadlocks.detect(), [p1.id, p2.id]);
});

test('DEAD-02: victim aborted, locks released, survivor resumes, graph acyclic', () => {
  const rollbacks = [];
  const { k, p1, p2 } = classicDeadlock([2, 3], { onRollback: (p, cycle) => rollbacks.push([p.id, cycle]) });
  k.acquire(p1.id, 'B');
  const r = k.acquire(p2.id, 'A');

  assert.equal(r.status, STATES.ABORTED); // P2 has the larger priority number -> victim
  assert.equal(r.deadlock.length, 1);
  assert.equal(r.deadlock[0].victimId, p2.id);
  assert.deepEqual(r.deadlock[0].resumed, [p1.id]);
  assert.equal(r.deadlock[0].resolved, true);
  assert.deepEqual(rollbacks, [[p2.id, [p1.id, p2.id]]]);

  assert.equal(k.processes.get(p2.id).state, STATES.ABORTED);
  assert.equal(k.processes.get(p1.id).state, STATES.READY);
  assert.equal(k.locks.holderOf('B'), p1.id);
  assert.equal(k.graph.findCycle(), null);
  assert.equal(k.graph.edges().length, 0);

  k.dispatch();
  const done = k.complete(p1.id);
  assert.equal(done.state, STATES.COMPLETED);
  assert.deepEqual(k.locks.snapshot(), []);
});

test('victim tie-break: equal priority -> most recently arrived, then highest id', () => {
  const k = new OSKernel();
  const early = k.submitOperation({ userId: 1, fileId: 'A', operation: 'MOVE', priority: 2, arrivalTime: 0 });
  const late = k.submitOperation({ userId: 2, fileId: 'B', operation: 'MOVE', priority: 2, arrivalTime: 5 });
  assert.equal(k.deadlocks.selectVictim([early.id, late.id]).id, late.id);

  const same1 = k.submitOperation({ userId: 3, fileId: 'C', operation: 'MOVE', priority: 2, arrivalTime: 5 });
  assert.equal(k.deadlocks.selectVictim([late.id, same1.id]).id, same1.id);
});

test('a lower-priority-number victim is not chosen when the other has larger number', () => {
  const { k, p1, p2 } = classicDeadlock([5, 1]); // P1 is the low-priority one
  k.acquire(p1.id, 'B');
  const r = k.acquire(p2.id, 'A');
  assert.equal(r.deadlock[0].victimId, p1.id);
  assert.equal(r.status, LOCK_STATUS.GRANTED); // P2 obtained A during recovery
  assert.equal(k.processes.get(p2.id).state, STATES.READY);
});

test('three-process cycle is resolved and the event log tells the story', () => {
  const k = new OSKernel({ algorithm: 'FCFS' });
  const ps = ['A', 'B', 'C'].map((f, i) =>
    k.submitOperation({ userId: i, fileId: f, operation: 'MOVE', priority: i + 1 })
  );
  ps.forEach(() => k.dispatch());
  ps.forEach((p, i) => k.acquire(p.id, ['A', 'B', 'C'][i]));
  k.acquire(ps[0].id, 'B');
  k.acquire(ps[1].id, 'C');
  const last = k.acquire(ps[2].id, 'A');
  assert.equal(last.deadlock[0].cycle.length, 3);
  assert.equal(last.deadlock[0].victimId, ps[2].id);
  assert.equal(k.graph.findCycle(), null);

  const types = k.log.entries().map((e) => e.type);
  for (const t of ['DEADLOCK_DETECTED', 'VICTIM_SELECTED', 'ROLLBACK', 'DEADLOCK_RESOLVED']) {
    assert.ok(types.includes(t), `missing ${t}`);
  }
});

test('no false positives: plain contention is not a deadlock', () => {
  const k = new OSKernel();
  const a = k.submitOperation({ userId: 1, fileId: 'f', operation: 'EDIT' });
  const b = k.submitOperation({ userId: 2, fileId: 'f', operation: 'EDIT' });
  k.dispatch();
  k.dispatch();
  k.acquire(a.id, 'f');
  const r = k.acquire(b.id, 'f');
  assert.equal(r.deadlock, null);
  assert.deepEqual(k.detectAndRecoverDeadlocks(), []);
});
