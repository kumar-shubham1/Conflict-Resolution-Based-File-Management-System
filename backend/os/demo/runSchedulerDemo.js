'use strict';

const { simulateSchedule } = require('../src/scheduler/simulate');
const { REFERENCE_DATASET } = require('../src/fixtures/referenceDataset');

for (const algo of ['FCFS', 'SJF', 'PRIORITY']) {
  const r = simulateSchedule(REFERENCE_DATASET, algo);
  console.log(`\n=== ${algo} ===`);
  console.log('Gantt:', r.timeline.map((t) => `${t.name}[${t.start}-${t.end}]`).join(' '));
  console.table(
    r.processes.map((p) => ({
      process: p.name,
      arrival: p.arrivalTime,
      burst: p.burstTime,
      priority: p.priority,
      start: p.firstStartTime,
      completion: p.completionTime,
      waiting: p.waitingTime,
      turnaround: p.turnaroundTime,
      response: p.responseTime,
    }))
  );
  console.log('Averages:', r.averages);
}
