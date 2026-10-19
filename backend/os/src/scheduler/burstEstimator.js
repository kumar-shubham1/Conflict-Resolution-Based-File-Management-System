'use strict';

const { OPERATIONS } = require('../constants');
const { ValidationError } = require('../errors');

// Deterministic burst estimate: fixed base per operation + 1 tick per started MB (max +5).
const BASE_BURST = Object.freeze({
  [OPERATIONS.UPLOAD]: 4,
  [OPERATIONS.EDIT]: 3,
  [OPERATIONS.DELETE]: 1,
  [OPERATIONS.MOVE]: 2,
  [OPERATIONS.DOWNLOAD]: 2,
  [OPERATIONS.SHARE]: 1,
});

// Lower number = higher priority.
const DEFAULT_PRIORITY = Object.freeze({
  [OPERATIONS.EDIT]: 2,
  [OPERATIONS.DELETE]: 2,
  [OPERATIONS.UPLOAD]: 3,
  [OPERATIONS.MOVE]: 3,
  [OPERATIONS.DOWNLOAD]: 4,
  [OPERATIONS.SHARE]: 4,
});

const MB = 1024 * 1024;

function estimateBurst(operation, sizeBytes = 0) {
  if (!(operation in BASE_BURST)) throw new ValidationError(`Unknown operation: ${operation}`);
  const extra = Math.min(5, Math.ceil(Math.max(0, sizeBytes) / MB));
  return BASE_BURST[operation] + extra;
}

function defaultPriority(operation) {
  if (!(operation in DEFAULT_PRIORITY)) throw new ValidationError(`Unknown operation: ${operation}`);
  return DEFAULT_PRIORITY[operation];
}

module.exports = { estimateBurst, defaultPriority };
