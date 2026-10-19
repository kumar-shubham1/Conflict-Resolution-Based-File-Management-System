import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import operationRoutes from './routes/operation.routes.js';
import testRoutes from './routes/test.routes.js';
import fileRoutes from './routes/file.routes.js';
import { initializeStorage } from './services/storage.service.js';
import osRoutes from './routes/os.routes.js';
import folderRoutes from './routes/folder.routes.js';
import { restoreQueuedProcesses } from './services/os.service.js';

const app = new Hono();

app.use('*', cors());

app.get('/', (c) => {
    return c.text('Backend is working!');
});

app.route('/api/test', testRoutes);
app.route('/api/files', fileRoutes);
app.route('/api/folders', folderRoutes);
app.route('/api/operations', operationRoutes);
app.route('/api', osRoutes);

const port = 3000;

await initializeStorage();
await restoreQueuedProcesses();

console.log(`Server running on http://localhost:${port}`);

serve({
    fetch: app.fetch,
    port
});