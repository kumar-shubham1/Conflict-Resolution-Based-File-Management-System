import { Hono } from 'hono';

const testRoutes = new Hono();

testRoutes.get('/', (c) => {
    return c.json({
        message: 'Test route is working!'
    });
});

export default testRoutes;