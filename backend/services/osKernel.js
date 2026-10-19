
import osModule from '../os/src/index.js';

const { OSKernel } = osModule;

export const osKernel = new OSKernel({
    algorithm: 'FCFS',
    singleCpu: true
});
