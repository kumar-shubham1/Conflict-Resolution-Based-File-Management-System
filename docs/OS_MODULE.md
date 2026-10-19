# ConflictCore — OS Module

**Owner:** Avni Negi (OS / Process Manager + Scheduling)
**Team:** ConflictCore, OSDBMS-V-2026-T206 · B.Tech CSE, Graphic Era (Deemed to be University)

This module is the Operating Systems part of ConflictCore. Every file operation (upload, edit,
delete, move) is treated as a **process**. The module decides **when** it runs (scheduler),
**whether** it can touch the file (lock manager) and **what to do** if two processes block each
other (deadlock handler).

It is plain Node.js (CommonJS) with **no dependencies**, so there is no `npm install` step.

---

## 1. Quick start

Requirements: **Node.js 18 or newer** (check with `node --version`).

Open a terminal **inside the module folder** (the one that contains `package.json`) and run:

```
npm test                   # runs all 34 tests, expect: pass 34, fail 0
npm run demo:scheduler     # FCFS vs SJF vs Priority on the reference dataset
npm run demo:deadlock      # P1/P2 deadlock -> detect -> recover -> resume
```

On Windows, click inside the **TERMINAL** panel in VS Code before typing. If you type while a
file tab is selected, the text goes into the file and breaks it (this has happened once already).

### What a good run looks like

- `npm test` ends with `pass 34` and `fail 0`.
- `demo:scheduler` prints three Gantt lines:

| Algorithm | Execution order | Avg waiting | Avg turnaround |
|---|---|---|---|
| FCFS | P1, P2, P3, P4 | 5.75 | 11.25 |
| SJF | P1, P2, P4, P3 | 5.25 | 10.75 |
| Priority | P1, P3, P2, P4 | 7.00 | 12.50 |

- `demo:deadlock` ends with `P1 completes: COMPLETED`. Along the way `P2 requests A: ABORTED`
  is **correct**: P2 was chosen as the deadlock victim.

---

## 2. How it works

```
OPERATION -> PROCESS -> SCHEDULER -> LOCK -> DEADLOCK CHECK -> EXECUTE -> LOG
```

1. A user action becomes a **process** (`submitOperation`), state `READY`.
2. The **scheduler** picks the next READY process using FCFS, SJF or Priority (`dispatch`), state `RUNNING`.
3. The process asks the **lock manager** for the file (`acquire`). If another process holds it, this one goes to `WAITING` in that file's queue.
4. Every wait adds an edge to the **wait-for graph** (`waiter -> holder`). If the graph has a cycle, that is a **deadlock**.
5. The **deadlock handler** picks a victim, rolls it back, aborts it, releases its locks, and wakes the others.
6. The backend does the real file work, then calls `complete` (or `fail`). Locks are released and waiters resume.
7. Every step is written to the **event log**.

### Process states

```
NEW -> READY -> RUNNING -> COMPLETED
                  |
                  +-> WAITING   (file locked; goes back to READY when granted)
                  +-> ABORTED   (deadlock victim)
                  +-> FAILED    (error)
```

Illegal changes (for example `COMPLETED -> RUNNING`) throw an error and are not logged.

---

## 3. Folder structure

```
conflictcore-os/
├── package.json                 npm commands
├── README.md                    this file
├── src/
│   ├── index.js                 exports everything
│   ├── OSKernel.js              MAIN ENTRY POINT - the backend calls this
│   ├── constants.js             states, algorithms, event names
│   ├── errors.js                error types
│   ├── process/
│   │   ├── Process.js               one process record
│   │   ├── ProcessStateMachine.js   allowed state changes
│   │   └── ProcessManager.js        creates processes, changes state
│   ├── scheduler/
│   │   ├── algorithms.js            FCFS / SJF / Priority ordering and tie-breaks
│   │   ├── Scheduler.js             picks the next process
│   │   ├── simulate.js              Gantt timeline + metrics (for the UI)
│   │   ├── metrics.js               waiting / turnaround / response / completion
│   │   └── burstEstimator.js        default burst time and priority per operation
│   ├── locks/LockManager.js         file locks and waiting queues
│   ├── deadlock/
│   │   ├── WaitForGraph.js          graph and cycle detection
│   │   └── DeadlockHandler.js       victim selection and recovery
│   ├── logging/EventLog.js          event log
│   ├── util/LogicalClock.js         fixed clock so demos repeat exactly
│   ├── api/
│   │   ├── osController.js          handlers for the 4 endpoints
│   │   └── osRoutes.js              Express router
│   └── fixtures/referenceDataset.js P1-P4 test data
├── tests/                       34 tests
└── demo/                        runSchedulerDemo.js, runDeadlockDemo.js
```

---

## 4. Using it from the backend

```js
const { OSKernel } = require('./src');

const kernel = new OSKernel({
  algorithm: 'FCFS',     // FCFS | SJF | PRIORITY
  // singleCpu: true,    // optional: dispatch() returns null while one process is RUNNING
  // onPersist, onLog, onLockChange, onRollback   (see section 5)
});

// 1. A user action arrives -> create a process (state READY)
const p = kernel.submitOperation({
  userId: 7, fileId: 'file-12', operation: 'EDIT', sizeBytes: 250000,
});

// 2. Scheduler picks the next READY process (READY -> RUNNING)
const running = kernel.dispatch();      // may be a different process than p; null if none

// 3. Lock the file before touching it
const lock = kernel.acquire(running.id, 'file-12');
//   lock.status: 'GRANTED' | 'WAITING' | 'ABORTED'
//   lock.deadlock: null, or the recovery records if this request caused a deadlock

// 4. If GRANTED: do the real file work here (Backend / File System Layer)

// 5. Finish
const done = kernel.complete(running.id);   // COMPLETED + metrics, locks released, waiters resumed
// on error instead: kernel.fail(running.id, 'disk error');
```

If `acquire` returns `WAITING`, stop and wait: when the holder finishes, this process moves back
to `READY` and `dispatch()` will pick it again. If it returns `ABORTED`, the process was the
deadlock victim; tell the user and let them retry.

### Methods

| Method | What it does |
|---|---|
| `submitOperation({ userId, fileId, operation, name?, arrivalTime?, burstTime?, priority?, sizeBytes? })` | Create a READY process |
| `dispatch()` | Next process by the active algorithm, READY -> RUNNING (or `null`) |
| `acquire(processId, fileId)` | Request the file lock. Process must be RUNNING |
| `release(processId, fileId)` | Release one lock early, resume the next waiter |
| `complete(processId)` | RUNNING -> COMPLETED, release all locks, return process + metrics |
| `fail(processId, reason)` | RUNNING/READY/WAITING -> FAILED, run rollback hook, release locks |
| `setAlgorithm('SJF')` | Switch scheduler; applies to the next dispatch |
| `detectAndRecoverDeadlocks()` | Admin-triggered deadlock check |
| `snapshot()` | Everything for dashboards (see section 6) |

**Operations:** `UPLOAD`, `EDIT`, `DELETE`, `MOVE`, `DOWNLOAD`, `SHARE`.

**Defaults when `burstTime` / `priority` are not given** (lower priority number = more important):

| Operation | Burst | Priority |
|---|---|---|
| UPLOAD | 4 | 3 |
| EDIT | 3 | 2 |
| DELETE | 1 | 2 |
| MOVE | 2 | 3 |
| DOWNLOAD | 2 | 4 |
| SHARE | 1 | 4 |

Burst also grows by 1 per started MB of `sizeBytes` (maximum +5).

---

## 5. Integration hooks (who connects what)

| Hook / function | Teammate | Purpose |
|---|---|---|
| `onPersist(processJson)` | Shubham | Save every process change to the `processes` table |
| `onLog(entry)` | Shubham | Save every event to the `logs` table |
| `onLockChange(event)` | Shubham | Mirror `locks` and `wait_for_edges` tables |
| `onRollback(processJson, cycle)` | Shubham | Roll back the victim's DB transaction |
| `createOsRouter(express, kernel, { adminOnly })` | Anshika | Mount the 4 endpoints under `/api` |
| `kernel.snapshot()` | Jahnvi | Data for process monitor, lock view, deadlock alerts |
| `simulateSchedule(list, algo)` | Jahnvi | Gantt timeline + metrics for the scheduler chart |

Hook data shapes:

- `onLog` entry: `{ seq, time, type, processId, message, data }`
- `onLockChange` event: `{ type: 'GRANT' | 'WAIT' | 'RELEASE', fileId, processId, holderId?, time }`
- `onPersist` process: `{ id, name, userId, fileId, operation, state, arrivalTime, burstTime, priority, firstStartTime, completionTime, turnaroundTime, responseTime, waitingTime }`

### Mounting the API (Anshika)

```js
const express = require('express');
const { OSKernel, createOsRouter } = require('./os-module/src');

const app = express();
app.use(express.json());
const kernel = new OSKernel({ algorithm: 'FCFS' /* , hooks */ });
app.use('/api', createOsRouter(express, kernel, { adminOnly: yourAdminMiddleware }));
```

| Method | Endpoint | Returns |
|---|---|---|
| GET | `/api/processes` | `{ algorithm, readyQueue, averages, processes }` (optional `?state=READY`) |
| PUT | `/api/scheduler/algorithm` | body `{ "algorithm": "SJF" }` -> `{ algorithm }`; bad name gives 400 `{ error, code }` |
| GET | `/api/locks` | `{ locks: [{ fileId, holderId, acquiredAt, waitingQueue }], waitForEdges }` |
| GET | `/api/deadlocks` | `{ activeCycle, waitForEdges, history }` |

---

## 6. What the dashboard gets from `snapshot()`

```
{ time, algorithm, processes[], readyQueue[], locks[], waitForEdges[], deadlocks[], averages }
```

- `processes[]` has state and all four metrics (waiting, turnaround, response, completion).
- `readyQueue` is the list of process ids in the order they will run.
- `waitForEdges[]` is `{ waiter, holder, fileId, createdAt }`, ready to draw as a graph.
- `deadlocks[]` is the recovery history: `{ cycle, victimId, releasedLocks, resumed, resolved }`.

---

## 7. Rules used (confirm with mentor)

- **Non-preemptive** scheduling on one simulated CPU; time comes from a logical clock, so results are repeatable.
- **Lower priority number = higher priority.**
- **Ties:** earlier arrival first, then lower process id.
- **Locks:** one exclusive lock per file, FIFO waiting queue.
- **Deadlock victim:** the process with the highest priority number in the cycle; ties go to the latest arrival, then the highest id.
- **Metrics:** Turnaround = Completion - Arrival. Response = First start - Arrival. Waiting = Turnaround - Burst.

---

## 8. Tests

| File | Covers |
|---|---|
| `tests/processStateMachine.test.js` | states, illegal transitions, metrics, hooks |
| `tests/scheduler.test.js` | FCFS/SJF/Priority vs the reference table, ties, switching algorithm |
| `tests/lockManager.test.js` | lock contention, FIFO queue, release on fail/complete |
| `tests/deadlock.test.js` | cycle detection, victim choice, recovery, 3-process cycle |
| `tests/api.test.js` | the 4 endpoint handlers and router |

---

## 9. Troubleshooting

| Problem | Fix |
|---|---|
| `SyntaxError: Unexpected identifier` on line 1 of a file | Stray text was typed into that file. Make line 1 exactly `'use strict';` and save |
| `'node' is not recognized` | Install Node.js 18+ from nodejs.org and reopen the terminal |
| `npm` commands say no `package.json` | You are in the wrong folder. `cd` into the one containing `package.json` |
| All events show `t=0` in the demo | Normal. The logical clock only moves if code calls `kernel.clock.advance()`. Use `#` for order |

---

## 10. Known limits and open items

- **Not yet connected** to the real backend routes, the database, or the frontend. The hooks in section 5 are the connection points and are empty until teammates fill them.
- `src/api/osRoutes.js` is tested with a fake router only. Run it once against real Express.
- Only exclusive locks (no shared read locks) and no priority aging.
- The rules in section 7 are proposals; confirm them with Dr. Ashwini Kumar.