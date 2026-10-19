'use strict';

const { STATES, OPERATIONS } = require('../constants');
const { ValidationError } = require('../errors');
const { computeMetrics } = require('../scheduler/metrics');

/**
 * Process control block for one file operation (PRD section 4.1).
 */
class Process {
  constructor({ id, name, userId, fileId, operation, arrivalTime, burstTime, priority }) {
    if (!(operation in OPERATIONS)) throw new ValidationError(`Unknown operation: ${operation}`);
    if (!Number.isFinite(arrivalTime) || arrivalTime < 0) {
      throw new ValidationError('arrivalTime must be a number >= 0');
    }
    if (!Number.isFinite(burstTime) || burstTime <= 0) {
      throw new ValidationError('burstTime must be a number > 0');
    }
    if (!Number.isInteger(priority)) throw new ValidationError('priority must be an integer');

    this.id = id;
    this.name = name || `P${id}`;
    this.userId = userId === undefined ? null : userId;
    this.fileId = fileId === undefined ? null : fileId;
    this.operation = operation;
    this.state = STATES.NEW;
    this.arrivalTime = arrivalTime;
    this.burstTime = burstTime;
    this.priority = priority;
    this.firstStartTime = null;
    this.completionTime = null;
    this.stateReason = null;
  }

  get metrics() {
    return computeMetrics(this);
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      userId: this.userId,
      fileId: this.fileId,
      operation: this.operation,
      state: this.state,
      arrivalTime: this.arrivalTime,
      burstTime: this.burstTime,
      priority: this.priority,
      firstStartTime: this.firstStartTime,
      stateReason: this.stateReason,
      ...this.metrics,
    };
  }
}

module.exports = { Process };
