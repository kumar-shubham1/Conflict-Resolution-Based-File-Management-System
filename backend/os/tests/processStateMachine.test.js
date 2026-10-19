'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OSKernel } = require('../src/OSKernel');
const { STATES } = require('../src/constants');
const { InvalidTransitionError, ValidationError, UnknownProcessError } = require('../src/errors');

test('OS-01: submitting an operation creates a READY process with timestamps', () => {
  const k = new OSKernel();
  k.clock.set(4);
  const p = k.submitOperation({ userId: 1, fileId: 'f1', operation: 'UPLOAD' });
  assert.equal(p.state, STATES.READY);
  assert.equal(p.arrivalTime, 4);
  assert.equal(p.burstTime, 4);
  assert.equal(p.priority, 3);
  assert.equal(p.name, 'P1');
});

test('OS-T01: illegal transition COMPLETED -> RUNNING is rejected and not logged', () => {
  const k = new OSKernel();
  const p = k.submitOperation({ userId: 1, fileId: 'f1', operation: 'EDIT' });
  k.dispatch();
  k.complete(p.id);
  const before = k.log.entries().length;
  assert.throws(() => k.processes.transition(p.id, STATES.RUNNING), InvalidTransitionError);
  assert.equal(k.log.entries().length, before);
  assert.equal(k.processes.get(p.id).state, STATES.COMPLETED);
});

test('READY cannot jump straight to COMPLETED', () => {
  const k = new OSKernel();
  const p = k.submitOperation({ userId: 1, fileId: 'f1', operation: 'EDIT' });
  assert.throws(() => k.processes.transition(p.id, STATES.COMPLETED), InvalidTransitionError);
});

test('invalid input and unknown ids raise typed errors', () => {
  const k = new OSKernel();
  assert.throws(() => k.submitOperation({ operation: 'TELEPORT' }), ValidationError);
  assert.throws(() => k.submitOperation({ operation: 'EDIT', burstTime: 0 }), ValidationError);
  assert.throws(() => k.processes.get(99), UnknownProcessError);
});

test('first start time is set once; metrics computed on completion', () => {
  const k = new OSKernel();
  const p = k.submitOperation({ userId: 1, fileId: 'f1', operation: 'EDIT', burstTime: 3, priority: 1 });
  k.clock.set(2);
  k.dispatch();
  k.clock.set(5);
  const done = k.complete(p.id);
  assert.equal(done.firstStartTime, 2);
  assert.equal(done.completionTime, 5);
  assert.equal(done.responseTime, 2);
  assert.equal(done.turnaroundTime, 5);
  assert.equal(done.waitingTime, 2);
});

test('persistence and log hooks receive every change', () => {
  const saved = [];
  const logged = [];
  const k = new OSKernel({ onPersist: (p) => saved.push(p), onLog: (e) => logged.push(e) });
  const p = k.submitOperation({ userId: 1, fileId: 'f1', operation: 'DELETE' });
  k.dispatch();
  k.complete(p.id);
  assert.ok(saved.length >= 4); // NEW, READY, RUNNING, COMPLETED
  assert.equal(saved.at(-1).state, STATES.COMPLETED);
  assert.ok(logged.some((e) => e.type === 'STATE_CHANGED'));
});
