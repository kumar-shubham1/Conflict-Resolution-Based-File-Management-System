'use strict';

const { OSKernel } = require('../src/OSKernel');

// P1 holds A and waits for B; P2 holds B and waits for A (PRD section 9).
const kernel = new OSKernel({ algorithm: 'PRIORITY' });

const p1 = kernel.submitOperation({ name: 'P1', userId: 'A', fileId: 'A', operation: 'MOVE', priority: 2 });
const p2 = kernel.submitOperation({ name: 'P2', userId: 'B', fileId: 'B', operation: 'MOVE', priority: 3 });

kernel.dispatch();
kernel.dispatch();
console.log('P1 acquires A:', kernel.acquire(p1.id, 'A').status);
console.log('P2 acquires B:', kernel.acquire(p2.id, 'B').status);
console.log('P1 requests B:', kernel.acquire(p1.id, 'B').status);
const last = kernel.acquire(p2.id, 'A');
console.log('P2 requests A:', last.status);
console.log('Recovery:', JSON.stringify(last.deadlock, null, 2));

kernel.dispatch();
console.log('P1 completes:', kernel.complete(p1.id).state);
console.log('\nEvent log:');
for (const e of kernel.log.entries()) console.log(`t=${e.time} #${e.seq} ${e.type}: ${e.message}`);
