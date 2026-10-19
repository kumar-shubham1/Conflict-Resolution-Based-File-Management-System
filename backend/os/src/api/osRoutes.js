'use strict';

const { createOsController } = require('./osController');

/**
 * Express router factory. `express` is injected so this module has no hard
 * dependency on it. Mount with:  app.use('/api', createOsRouter(express, kernel, { adminOnly }))
 *
 * `adminOnly` is Anshika's role middleware; it protects the scheduler switch.
 */
function createOsRouter(express, kernel, { adminOnly } = {}) {
  const router = express.Router();
  const controller = createOsController(kernel);
  const guard = adminOnly || ((req, res, next) => next());

  router.get('/processes', controller.listProcesses);
  router.put('/scheduler/algorithm', guard, controller.setAlgorithm);
  router.get('/locks', controller.listLocks);
  router.get('/deadlocks', controller.getDeadlocks);
  return router;
}

module.exports = { createOsRouter };
