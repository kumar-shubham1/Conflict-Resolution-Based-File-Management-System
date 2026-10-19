import { Hono } from 'hono';

import {
    getOperations,
    getOperation,
    executeOperation,
    createOperation
} from '../controllers/operation.controller.js';

const operationRoutes = new Hono();

operationRoutes.get('/', getOperations);
operationRoutes.get('/:id', getOperation);

operationRoutes.post('/:id/execute', executeOperation);
operationRoutes.post('/', createOperation);
export default operationRoutes;