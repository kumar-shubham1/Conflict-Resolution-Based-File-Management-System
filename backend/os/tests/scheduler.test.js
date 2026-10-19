'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { simulateSchedule } = require('../src/scheduler/simulate');
const { REFERENCE_DATASET } = require('../src/fixtures/referenceDataset');
const { OSKernel } = require('../src/OSKernel');
const { InvalidAlgorithmError } = require('../src/errors');

const waits = (r) => r.processes.map((p) => p.waitingTime);

test('SCH-01 FCFS matches the reference table', () => {
  const r = simulateSchedule(REFERENCE_DATASET, 'FCFS');
  assert.deepEqual(r.order, [1, 2, 3, 4]);
  assert.deepEqual(r.timeline.map((t) => [t.start, t.end]), [[0, 5], [5, 8], [8, 16], [16, 22]]);
  assert.deepEqual(waits(r), [0, 4, 6, 13]);
  assert.deepEqual(r.averages, { waitingTime: 5.75, turnaroundTime: 11.25, responseTime: 5.75 });
});

test('SCH-01 SJF matches the reference table', () => {
  const r = simulateSchedule(REFERENCE_DATASET, 'SJF');
  assert.deepEqual(r.order, [1, 2, 4, 3]);
  assert.deepEqual(waits(r), [0, 4, 12, 5]);
  assert.deepEqual(r.averages, { waitingTime: 5.25, turnaroundTime: 10.75, responseTime: 5.25 });
});

test('SCH-01 PRIORITY matches the reference table', () => {
  const r = simulateSchedule(REFERENCE_DATASET, 'PRIORITY');
  assert.deepEqual(r.order, [1, 3, 2, 4]);
  assert.deepEqual(waits(r), [0, 12, 3, 13]);
  assert.deepEqual(r.averages, { waitingTime: 7.0, turnaroundTime: 12.5, responseTime: 7.0 });
});

test('simulation is repeatable (deterministic)', () => {
  const a = simulateSchedule(REFERENCE_DATASET, 'SJF');
  const b = simulateSchedule(REFERENCE_DATASET, 'sjf');
  assert.deepEqual(a, b);
});

test('OS-06 ties break by arrival then id', () => {
  const tied = [
    { id: 2, arrivalTime: 0, burstTime: 4, priority: 1 },
    { id: 1, arrivalTime: 0, burstTime: 4, priority: 1 },
    { id: 3, arrivalTime: 0, burstTime: 4, priority: 1 },
  ];
  for (const algo of ['FCFS', 'SJF', 'PRIORITY']) {
    assert.deepEqual(simulateSchedule(tied, algo).order, [1, 2, 3]);
  }
});

test('CPU idle gap is skipped correctly', () => {
  const r = simulateSchedule([{ id: 1, arrivalTime: 10, burstTime: 2, priority: 1 }], 'FCFS');
  assert.deepEqual(r.timeline[0], { processId: 1, name: 'P1', start: 10, end: 12 });
  assert.equal(r.processes[0].waitingTime, 0);
});

test('live scheduler dispatches by selected algorithm', () => {
  const k = new OSKernel({ algorithm: 'FCFS' });
  for (const d of REFERENCE_DATASET) {
    k.submitOperation({
      name: d.name, userId: 1, fileId: `f${d.id}`, operation: 'EDIT',
      arrivalTime: d.arrivalTime, burstTime: d.burstTime, priority: d.priority,
    });
  }
  assert.deepEqual(k.snapshot().readyQueue, [1, 2, 3, 4]);
  k.setAlgorithm('sjf');
  assert.deepEqual(k.snapshot().readyQueue, [2, 1, 4, 3]);
  k.setAlgorithm('PRIORITY');
  assert.deepEqual(k.snapshot().readyQueue, [3, 2, 4, 1]);
  assert.equal(k.dispatch().id, 3);
  assert.equal(k.snapshot().processes.length, 4); // SCH-02: nothing lost on switch
});

test('SCH-02 switching algorithm is logged; invalid names rejected', () => {
  const k = new OSKernel();
  k.setAlgorithm('SJF');
  assert.equal(k.log.entries({ type: 'ALGORITHM_CHANGED' }).length, 1);
  assert.throws(() => k.setAlgorithm('ROUND_ROBIN'), InvalidAlgorithmError);
  assert.equal(k.scheduler.getAlgorithm(), 'SJF');
});

test('singleCpu mode blocks a second dispatch while one process is RUNNING', () => {
  const k = new OSKernel({ singleCpu: true });
  k.submitOperation({ userId: 1, fileId: 'a', operation: 'EDIT' });
  k.submitOperation({ userId: 1, fileId: 'b', operation: 'EDIT' });
  assert.ok(k.dispatch());
  assert.equal(k.dispatch(), null);
});
