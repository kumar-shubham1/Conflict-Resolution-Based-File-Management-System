'use strict';

const { COMPARATORS, normalizeAlgorithm } = require('./algorithms');
const { averageMetrics } = require('./metrics');

/**
 * Pure, non-preemptive schedule simulation on one CPU.
 * Used for the reference dataset, unit tests and the Gantt/timeline payload for the UI.
 *
 * @param {Array<{id:number,name?:string,arrivalTime:number,burstTime:number,priority?:number}>} input
 * @param {string} algorithm FCFS | SJF | PRIORITY
 */
function simulateSchedule(input, algorithm) {
  const algo = normalizeAlgorithm(algorithm);
  const compare = COMPARATORS[algo];
  const pending = input.map((p) => ({ priority: 0, ...p })).sort(COMPARATORS.FCFS);
  const timeline = [];
  const results = [];
  let time = 0;

  while (pending.length > 0) {
    let ready = pending.filter((p) => p.arrivalTime <= time);
    if (ready.length === 0) {
      time = Math.min(...pending.map((p) => p.arrivalTime)); // CPU idle until next arrival
      ready = pending.filter((p) => p.arrivalTime <= time);
    }
    ready.sort(compare);
    const next = ready[0];
    pending.splice(pending.indexOf(next), 1);

    const start = time;
    const end = start + next.burstTime;
    time = end;

    const turnaroundTime = end - next.arrivalTime;
    timeline.push({ processId: next.id, name: next.name || `P${next.id}`, start, end });
    results.push({
      id: next.id,
      name: next.name || `P${next.id}`,
      arrivalTime: next.arrivalTime,
      burstTime: next.burstTime,
      priority: next.priority,
      firstStartTime: start,
      completionTime: end,
      turnaroundTime,
      responseTime: start - next.arrivalTime,
      waitingTime: turnaroundTime - next.burstTime,
    });
  }

  return {
    algorithm: algo,
    order: timeline.map((t) => t.processId),
    timeline,
    processes: [...results].sort((a, b) => a.id - b.id),
    averages: averageMetrics(results),
  };
}

module.exports = { simulateSchedule };
