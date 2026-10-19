'use strict';

module.exports = {
  ...require('./constants'),
  ...require('./errors'),
  OSKernel: require('./OSKernel').OSKernel,
  ProcessManager: require('./process/ProcessManager').ProcessManager,
  Process: require('./process/Process').Process,
  Scheduler: require('./scheduler/Scheduler').Scheduler,
  simulateSchedule: require('./scheduler/simulate').simulateSchedule,
  LockManager: require('./locks/LockManager').LockManager,
  WaitForGraph: require('./deadlock/WaitForGraph').WaitForGraph,
  DeadlockHandler: require('./deadlock/DeadlockHandler').DeadlockHandler,
  EventLog: require('./logging/EventLog').EventLog,
  LogicalClock: require('./util/LogicalClock').LogicalClock,
  createOsController: require('./api/osController').createOsController,
  createOsRouter: require('./api/osRoutes').createOsRouter,
};
