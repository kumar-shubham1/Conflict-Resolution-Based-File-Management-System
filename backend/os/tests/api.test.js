'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OSKernel } = require('../src/OSKernel');
const { createOsController } = require('../src/api/osController');
const { createOsRouter } = require('../src/api/osRoutes');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

test('GET /processes lists processes, queue and averages', () => {
  const k = new OSKernel();
  k.submitOperation({ userId: 1, fileId: 'f', operation: 'EDIT' });
  const res = mockRes();
  createOsController(k).listProcesses({ query: {} }, res);
  assert.equal(res.body.algorithm, 'FCFS');
  assert.equal(res.body.processes.length, 1);
  assert.deepEqual(res.body.readyQueue, [1]);
});

test('PUT /scheduler/algorithm switches or returns 400 for a bad name', () => {
  const k = new OSKernel();
  const c = createOsController(k);
  let res = mockRes();
  c.setAlgorithm({ body: { algorithm: 'sjf' } }, res);
  assert.equal(res.body.algorithm, 'SJF');
  res = mockRes();
  c.setAlgorithm({ body: { algorithm: 'nope' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'INVALID_ALGORITHM');
});

test('GET /locks and /deadlocks expose queues, edges and history', () => {
  const k = new OSKernel();
  const a = k.submitOperation({ userId: 1, fileId: 'f', operation: 'EDIT' });
  const b = k.submitOperation({ userId: 2, fileId: 'f', operation: 'EDIT' });
  k.dispatch(); k.dispatch();
  k.acquire(a.id, 'f');
  k.acquire(b.id, 'f');
  const c = createOsController(k);
  let res = mockRes();
  c.listLocks({}, res);
  assert.deepEqual(res.body.locks[0].waitingQueue, [b.id]);
  res = mockRes();
  c.getDeadlocks({}, res);
  assert.equal(res.body.activeCycle, null);
  assert.equal(res.body.waitForEdges.length, 1);
});

test('router registers the four endpoints and applies the admin guard to the switch', () => {
  const routes = [];
  const fakeExpress = {
    Router: () => ({
      get: (path, ...h) => routes.push(['GET', path, h.length]),
      put: (path, ...h) => routes.push(['PUT', path, h.length]),
    }),
  };
  createOsRouter(fakeExpress, new OSKernel(), { adminOnly: () => {} });
  assert.deepEqual(routes, [
    ['GET', '/processes', 1],
    ['PUT', '/scheduler/algorithm', 2],
    ['GET', '/locks', 1],
    ['GET', '/deadlocks', 1],
  ]);
});
