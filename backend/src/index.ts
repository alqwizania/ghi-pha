import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './db/schema';
import { eq, desc } from 'drizzle-orm';
import { BeaconCollector } from './services/beacon-collector';
import { sign } from 'hono/jwt';

type Bindings = {
    HYPERDRIVE: Hyperdrive;
    JWT_SECRET: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// Enable CORS for frontend access
app.use('*', cors({
    origin: '*', // In production, this should be restricted to the frontend domain
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
}));

const getDB = (hyperdrive: Hyperdrive) => {
    const client = postgres(hyperdrive.connectionString);
    return drizzle(client, { schema });
};

// --- AUTH ---

app.post('/api/v1/auth/login', async (c) => {
    try {
        const { email, password } = await c.req.json();
        const db = getDB(c.env.HYPERDRIVE);

        const user = await db.query.users.findFirst({
            where: eq(schema.users.email, email)
        });

        if (!user || user.passwordHash !== password) {
            return c.json({ error: 'Invalid credentials' }, 401);
        }

        // Strict PHA Domain Enforcement
        if (!user.email.endsWith('@pha.gov.sa')) {
            return c.json({ error: 'Access restricted to @pha.gov.sa domains' }, 403);
        }

        const token = await sign({
            id: user.id,
            role: user.role,
            permissions: user.permissions,
            exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24
        }, c.env.JWT_SECRET);

        return c.json({
            token,
            role: user.role,
            fullName: user.fullName,
            permissions: user.permissions
        });
    } catch (e) {
        return c.json({ error: 'Login failed' }, 500);
    }
});

// --- USER MANAGEMENT ---

app.get('/api/v1/users', async (c) => {
    const db = getDB(c.env.HYPERDRIVE);
    const result = await db.query.users.findMany();
    return c.json(result);
});

app.post('/api/v1/users', async (c) => {
    try {
        const body = await c.req.json();
        const db = getDB(c.env.HYPERDRIVE);

        // Ensure PHA email
        if (!body.email.endsWith('@pha.gov.sa')) {
            return c.json({ error: 'Email must be @pha.gov.sa' }, 400);
        }

        await db.insert(schema.users).values({
            username: body.username,
            email: body.email,
            fullName: body.fullName,
            role: body.role || 'Analyst',
            passwordHash: body.password, // In real app, hash this!
            permissions: body.permissions || {
                dashboard: 'view',
                triage: 'view',
                assessment: 'view',
                escalation: 'view'
            }
        });
        return c.json({ success: true });
    } catch (e) {
        return c.json({ error: 'Failed to create user' }, 500);
    }
});

// --- API ---

app.get('/', (c) => c.json({ status: 'GHI System API (TypeScript) is running' }));
app.get('/health', (c) => c.json({ status: 'healthy' }));

app.get('/api/v1/signals', async (c) => {
    const db = getDB(c.env.HYPERDRIVE);
    const result = await db.query.signals.findMany({
        orderBy: [desc(schema.signals.createdAt)],
        with: { assessments: true, escalations: true }
    });
    return c.json(result);
});

app.get('/api/v1/assessments', async (c) => {
    const db = getDB(c.env.HYPERDRIVE);
    const result = await db.query.assessments.findMany({
        with: { signal: true }
    });
    return c.json(result);
});

app.get('/api/v1/escalations', async (c) => {
    const db = getDB(c.env.HYPERDRIVE);
    const result = await db.query.escalations.findMany({
        with: { signal: true, assessment: true }
    });
    return c.json(result);
});

// --- WORKER ---

export default {
    fetch: app.fetch,
    async scheduled(event: any, env: Bindings, ctx: ExecutionContext) {
        const db = getDB(env.HYPERDRIVE);
        const collector = new BeaconCollector(db);
        ctx.waitUntil(collector.collect());
    },
};
