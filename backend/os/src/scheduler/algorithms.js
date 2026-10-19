'use strict';

const { ALGORITHMS } = require('../constants');
const { InvalidAlgorithmError } = require('../errors');

// Deterministic comparators (OS-06). Ties: earlier arrival, then lower process id.
const byArrival = (a, b) => a.arrivalTime - b.arrivalTime || a.id - b.id;

const COMPARATORS = Object.freeze({
  [ALGORITHMS.FCFS]: byArrival,
  [ALGORITHMS.SJF]: (a, b) => a.burstTime - b.burstTime || byArrival(a, b),
  // Lower priority number = higher priority.
  [ALGORITHMS.PRIORITY]: (a, b) => a.priority - b.priority || byArrival(a, b),
});

function normalizeAlgorithm(name) {
  const key = typeof name === 'string' ? name.trim().toUpperCase() : '';
  if (!(key in COMPARATORS)) throw new InvalidAlgorithmError(name);
  return key;
}

/** Return a new array of `processes` ordered by the given algorithm. */
function orderReady(processes, algorithm) {
  return [...processes].sort(COMPARATORS[normalizeAlgorithm(algorithm)]);
}

module.exports = { COMPARATORS, normalizeAlgorithm, orderReady };
