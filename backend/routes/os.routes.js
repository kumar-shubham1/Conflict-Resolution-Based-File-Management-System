import { Hono } from 'hono';
import { osKernel } from '../services/osKernel.js';
import { dispatchNextProcess } from '../services/os.service.js';

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

export default osRoutes;
