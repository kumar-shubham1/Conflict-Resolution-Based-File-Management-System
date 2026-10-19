import {
    getAllOperations,
    getOperationById,
    createOperation as createOperationRecord
} from '../services/operation.service.js';

import { executeFileOperation } from '../services/os.service.js';
export const getOperations = async (c) => {
    try {
        const operations = await getAllOperations();

        return c.json({
            message: 'Operations retrieved successfully',
            operations
        });

    } catch (error) {
        console.error('Error retrieving operations:', error);

        return c.json({
            message: 'Failed to retrieve operations',
            error: error.message
        }, 500);
    }
};

export const getOperation = async (c) => {
    try {
        const id = c.req.param('id');

        const operation = await getOperationById(id);

        if (!operation) {
            return c.json({
                message: 'Operation not found'
            }, 404);
        }

        return c.json({
            message: 'Operation retrieved successfully',
            operation
        });

    } catch (error) {
        console.error('Error retrieving operation:', error);

        return c.json({
            message: 'Failed to retrieve operation',
            error: error.message
        }, 500);
    }
};

export const executeOperation = async (c) => {
    try {
        const id = c.req.param('id');

        const operation = await getOperationById(id);

        if (!operation) {
            return c.json({
                message: 'Operation not found'
            }, 404);
        }

        const result = await executeFileOperation(operation);

        return c.json({
            message: 'Operation sent to OS layer',
            operation,
            result
        });

    } catch (error) {
if (
    error.message?.startsWith('Execution is not implemented for ')
) {
    return c.json({
        message: 'Operation execution is not implemented yet',
        error: error.message
    }, 501);
}
        console.error('Error executing operation:', error);

        return c.json({
            message: 'Failed to execute operation',
            error: error.message
        }, 500);
    }
};

export const createOperation = async (c) => {
    try {
        const body = await c.req.json();
        const operation = await createOperationRecord(body);

        return c.json({
            message: 'Operation created successfully',
            operation
        }, 201);
    } catch (error) {
        console.error('Error creating operation:', error);

        const validationError = [
            'user_id must be a positive integer',
            'Invalid operation_type',
            'DOWNLOAD requires a valid file_id',
            'EDIT requires a valid file_id',
            'DELETE requires a valid file_id',
            'MOVE requires a valid file_id',
            'SHARE requires a valid file_id',
            'file_id must be a positive integer or null',
            'priority must be an integer from 1 to 10',
            'details must contain valid JSON',
            'details must be a JSON object'
        ].includes(error.message);

        return c.json({
            message: 'Failed to create operation',
            error: error.message
        }, validationError ? 400 : 500);
    }
};
