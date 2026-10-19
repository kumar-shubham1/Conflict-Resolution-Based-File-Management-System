'use strict';

class OsModuleError extends Error {
  constructor(message, code) {
    super(message);
    this.name = this.constructor.name;
    this.code = code || 'OS_ERROR';
  }
}

class ValidationError extends OsModuleError {
  constructor(message) {
    super(message, 'VALIDATION_ERROR');
  }
}

class InvalidTransitionError extends OsModuleError {
  constructor(from, to) {
    super(`Illegal process state transition: ${from} -> ${to}`, 'INVALID_TRANSITION');
    this.from = from;
    this.to = to;
  }
}

class UnknownProcessError extends OsModuleError {
  constructor(id) {
    super(`Unknown process: ${id}`, 'UNKNOWN_PROCESS');
  }
}

class InvalidAlgorithmError extends OsModuleError {
  constructor(name) {
    super(`Unsupported scheduling algorithm: ${name}`, 'INVALID_ALGORITHM');
  }
}

class LockError extends OsModuleError {
  constructor(message) {
    super(message, 'LOCK_ERROR');
  }
}

module.exports = {
  OsModuleError,
  ValidationError,
  InvalidTransitionError,
  UnknownProcessError,
  InvalidAlgorithmError,
  LockError,
};
