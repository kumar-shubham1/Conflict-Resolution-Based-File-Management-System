import { Hono } from 'hono';
import { osKernel } from '../services/osKernel.js';
import { dispatchNextProcess } from '../services/os.service.js';
import { requireAuth } from '../middleware/auth.js';

const osRoutes = new Hono();

// Dispatch the next READY process.
osRoutes.post('/processes/dispatch', async (c) => {
    try {
        const result = await dispatchNextProcess();
        const statusCode = result.status === 'IDLE' ? 200 : 200;

        return c.json(result, statusCode);
    } catch (error) {
        console.error('Process dispatch failed:', error);

        return c.json({
            success: false,
            message: error.message || 'Process dispatch failed'
        }, 500);
    }
});

// View all processes, scheduling metrics, and ready queue
osRoutes.get('/processes', (c) => {
    const snapshot = osKernel.snapshot();
    const state = c.req.query('state');

    const processes = state
        ? snapshot.processes.filter(
            (process) => process.state === state
        )
        : snapshot.processes;

    return c.json({
        algorithm: snapshot.algorithm,
        readyQueue: snapshot.readyQueue,
        averages: snapshot.averages,
        processes
    });
});

// Change the CPU scheduling algorithm
osRoutes.put('/scheduler/algorithm', async (c) => {
    try {
        const body = await c.req.json();
        const algorithm = osKernel.setAlgorithm(body.algorithm);

        return c.json({ algorithm });
    } catch (error) {
        return c.json({
            error: error.message || 'Invalid scheduling algorithm'
        }, 400);
    }
});

// View file locks and wait-for graph edges
osRoutes.get('/locks', (c) => {
    const snapshot = osKernel.snapshot();

    return c.json({
        locks: snapshot.locks,
        waitForEdges: snapshot.waitForEdges
    });
});

// View deadlock detection and recovery information
osRoutes.get('/deadlocks', (c) => {
    const snapshot = osKernel.snapshot();

    return c.json({
        activeCycle: osKernel.graph.findCycle(),
        waitForEdges: snapshot.waitForEdges,
        history: snapshot.deadlocks
    });
});

// Trigger deterministic deadlock simulation (educational/verification demonstration)
osRoutes.post('/deadlocks/simulate', requireAuth, async (c) => {
    try {
        const body = await c.req.json().catch(() => ({}));
        const mode = body.mode || 'auto'; // 'auto' | 'create' | 'resolve'
        const processCount = Number(body.processCount || 2);

        if (mode === 'resolve') {
            const recoveries = osKernel.detectAndRecoverDeadlocks();
            const snapshot = osKernel.snapshot();
            return c.json({
                success: true,
                message: recoveries.length > 0
                    ? `Deadlock resolved: victim P${recoveries[0].victimId} aborted, locks released`
                    : 'Wait-for graph was already acyclic',
                recoveries,
                activeCycle: osKernel.graph.findCycle(),
                waitForEdges: snapshot.waitForEdges,
                history: snapshot.deadlocks
            });
        }

        // Clean up any existing simulation processes and locks
        const simNames = ['Sim-P1', 'Sim-P2', 'Sim-P3'];
        for (const proc of osKernel.processes.list()) {
            if (simNames.includes(proc.name) && !['COMPLETED', 'FAILED', 'ABORTED'].includes(proc.state)) {
                try {
                    const { granted } = osKernel.locks.releaseAll(proc.id, osKernel.clock.now());
                    granted.forEach((g) => osKernel.processes.resumeWaiting(g.processId, osKernel.clock.now()));
                    // READY→FAILED, RUNNING→COMPLETED, WAITING→FAILED (state machine constraints)
                    const cleanupTarget = proc.state === 'RUNNING' ? 'COMPLETED' : 'FAILED';
                    osKernel.processes.transition(proc.id, cleanupTarget, osKernel.clock.now(), 'simulation cleanup');
                } catch {}
            }
        }
        for (const res of ['SIM-A', 'SIM-B', 'SIM-C']) {
            const holder = osKernel.locks.holderOf(res);
            if (holder != null) {
                try { osKernel.locks.releaseLock(holder, res, osKernel.clock.now()); } catch {}
            }
        }

        const prevSingleCpu = osKernel.singleCpu;
        osKernel.singleCpu = false;

        const time = osKernel.clock.now();
        const p1 = osKernel.submitOperation({ name: 'Sim-P1', userId: 1, fileId: 'SIM-A', operation: 'EDIT', priority: 2, arrivalTime: time });
        const p2 = osKernel.submitOperation({ name: 'Sim-P2', userId: 2, fileId: 'SIM-B', operation: 'EDIT', priority: 4, arrivalTime: time + 1 });
        let p3 = null;
        if (processCount === 3) {
            p3 = osKernel.submitOperation({ name: 'Sim-P3', userId: 3, fileId: 'SIM-C', operation: 'EDIT', priority: 6, arrivalTime: time + 2 });
        }

        osKernel.dispatch();
        osKernel.dispatch();
        if (p3) osKernel.dispatch();

        osKernel.acquire(p1.id, 'SIM-A');
        osKernel.acquire(p2.id, 'SIM-B');
        if (p3) osKernel.acquire(p3.id, 'SIM-C');

        // P1 waits for B
        osKernel.acquire(p1.id, 'SIM-B');

        if (p3) {
            // P2 waits for C
            osKernel.acquire(p2.id, 'SIM-C');
            // P3 waits for A -> closes 3-cycle
            osKernel.locks.requestLock(p3.id, 'SIM-A');
            osKernel.processes.transition(p3.id, 'WAITING', osKernel.clock.now(), 'waiting for SIM-A');
        } else {
            // P2 waits for A -> closes 2-cycle
            osKernel.locks.requestLock(p2.id, 'SIM-A');
            osKernel.processes.transition(p2.id, 'WAITING', osKernel.clock.now(), 'waiting for SIM-A');
        }

        const activeCycle = osKernel.graph.findCycle();
        const waitForEdges = osKernel.graph.edges();

        let recoveries = [];
        if (mode === 'auto') {
            recoveries = osKernel.detectAndRecoverDeadlocks();
        }

        osKernel.singleCpu = prevSingleCpu;

        return c.json({
            success: true,
            mode,
            processCount,
            activeCycle: osKernel.graph.findCycle(),
            detectedCycle: activeCycle,
            waitForEdges: osKernel.graph.edges(),
            recoveries,
            history: osKernel.deadlocks.history()
        });
    } catch (err) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

// Explicit deadlock recovery endpoint
osRoutes.post('/deadlocks/recover', requireAuth, (c) => {
    try {
        const recoveries = osKernel.detectAndRecoverDeadlocks();
        const snapshot = osKernel.snapshot();

        return c.json({
            success: true,
            message: recoveries.length > 0
                ? `Deadlock resolved: victim P${recoveries[0].victimId} aborted, locks released`
                : 'Wait-for graph is acyclic. No deadlocks to resolve.',
            recoveries,
            activeCycle: osKernel.graph.findCycle(),
            waitForEdges: snapshot.waitForEdges,
            history: snapshot.deadlocks
        });
    } catch (err) {
        return c.json({ success: false, error: err.message }, 500);
    }
});

export default osRoutes;
