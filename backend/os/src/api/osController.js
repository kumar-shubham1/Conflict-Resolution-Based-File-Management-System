'use strict';

const { OsModuleError } = require('../errors');

/**
 * Framework-agnostic controllers for the four endpoints this module backs.
 * Signature (req, res) matches Express, so Anshika can mount them directly.
 */
function createOsController(kernel) {
  const handle = (fn) => (req, res, next) => {
    try {
      return fn(req, res);
    } catch (err) {
      if (err instanceof OsModuleError) {
        return res.status(400).json({ error: err.message, code: err.code });
      }
      if (typeof next === 'function') return next(err);
      throw err;
    }
  };

  return {
    // GET /api/processes
    listProcesses: handle((req, res) => {
      const snap = kernel.snapshot();
      const state = req.query && req.query.state;
      res.json({
        algorithm: snap.algorithm,
        readyQueue: snap.readyQueue,
        averages: snap.averages,
        processes: state ? snap.processes.filter((p) => p.state === state) : snap.processes,
      });
    }),

    // PUT /api/scheduler/algorithm   body: { algorithm }
    setAlgorithm: handle((req, res) => {
      const algorithm = kernel.setAlgorithm(req.body && req.body.algorithm);
      res.json({ algorithm });
    }),

    // GET /api/locks
    listLocks: handle((req, res) => {
      const snap = kernel.snapshot();
      res.json({ locks: snap.locks, waitForEdges: snap.waitForEdges });
    }),

    // GET /api/deadlocks
    getDeadlocks: handle((req, res) => {
      const snap = kernel.snapshot();
      res.json({
        activeCycle: kernel.graph.findCycle(),
        waitForEdges: snap.waitForEdges,
        history: snap.deadlocks,
      });
    }),
  };
}

module.exports = { createOsController };
