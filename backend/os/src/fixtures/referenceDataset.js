'use strict';

// Deterministic dataset from the PRD (section 8). Lower priority number = higher priority.
const REFERENCE_DATASET = Object.freeze([
  Object.freeze({ id: 1, name: 'P1', arrivalTime: 0, burstTime: 5, priority: 3 }),
  Object.freeze({ id: 2, name: 'P2', arrivalTime: 1, burstTime: 3, priority: 2 }),
  Object.freeze({ id: 3, name: 'P3', arrivalTime: 2, burstTime: 8, priority: 1 }),
  Object.freeze({ id: 4, name: 'P4', arrivalTime: 3, burstTime: 6, priority: 2 }),
]);

module.exports = { REFERENCE_DATASET };
