'use strict';

const { TRANSITIONS, TERMINAL_STATES } = require('../constants');
const { InvalidTransitionError } = require('../errors');

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

function assertTransition(from, to) {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

function isTerminal(state) {
  return TERMINAL_STATES.has(state);
}

module.exports = { canTransition, assertTransition, isTerminal };
