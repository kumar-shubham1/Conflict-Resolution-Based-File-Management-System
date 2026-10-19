'use strict';

/**
 * Scheduling metrics (PRD section 6):
 *   Turnaround = Completion - Arrival
 *   Response   = First Start - Arrival
 *   Waiting    = Turnaround - Burst   (equals Response for non-preemptive runs)
 * Returns nulls until the process has completed.
 */
function computeMetrics(p) {
  if (p.completionTime === null || p.completionTime === undefined || p.firstStartTime === null) {
    return { completionTime: null, turnaroundTime: null, responseTime: null, waitingTime: null };
  }
  const turnaroundTime = p.completionTime - p.arrivalTime;
  return {
    completionTime: p.completionTime,
    turnaroundTime,
    responseTime: p.firstStartTime - p.arrivalTime,
    waitingTime: turnaroundTime - p.burstTime,
  };
}

const round2 = (x) => Number(x.toFixed(2));

function averageMetrics(list) {
  const done = list.filter((m) => m.turnaroundTime !== null);
  if (done.length === 0) return { waitingTime: 0, turnaroundTime: 0, responseTime: 0 };
  const avg = (k) => round2(done.reduce((s, m) => s + m[k], 0) / done.length);
  return {
    waitingTime: avg('waitingTime'),
    turnaroundTime: avg('turnaroundTime'),
    responseTime: avg('responseTime'),
  };
}

module.exports = { computeMetrics, averageMetrics };
