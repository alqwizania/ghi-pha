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

// 1. ATOMIC CORS - SIMPLEST
app.use('*', cors());

// Diagnostic Endpoint
app.get('/api/v1/ping', (c) => {
    return c.json({
        status: 'alive',
        time: new Date().toISOString(),
        instance: 'ghi-core (Ready)'
    });
});

// Global Error Handler
app.onError((err, c) => {
    console.error('System Error:', err);
    return c.json({
        error: 'Terminal Error',
        message: err.message,
    }, 500);
});

app.notFound((c) => {
    return c.json({ error: 'Endpoint Not Found' }, 404);
});

const getDB = (hyperdrive: Hyperdrive) => {
    const client = postgres(hyperdrive.connectionString);
    return drizzle(client, { schema });
};

// --- AUTH ---

app.post('/api/v1/auth/login', async (c) => {
    console.log('Login attempt');
    try {
        const body = await c.req.json();
        const { email, password } = body;
        console.log(`Login payload for: ${email}`);

        const db = getDB(c.env.HYPERDRIVE);

        const user = await db.query.users.findFirst({
            where: eq(schema.users.email, email)
        });

        if (!user) {
            console.log(`User not found: ${email}`);
            return c.json({ error: 'Invalid credentials' }, 401);
        }

        if (user.passwordHash !== password) {
            console.log(`Password mismatch for: ${email}`);
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
        console.error('Login Error:', e);
        return c.json({ error: 'Login failed', details: e instanceof Error ? e.message : String(e) }, 500);
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
            passwordHash: body.password || 'password123',
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

app.post('/api/v1/signals/:id/accept', async (c) => {
    const id = c.req.param('id');
    const db = getDB(c.env.HYPERDRIVE);

    // Update signal status
    await db.update(schema.signals)
        .set({ triageStatus: 'Accepted', currentStatus: 'Under Assessment' })
        .where(eq(schema.signals.id, id));

    // Create linked assessment
    const [newAssessment] = await db.insert(schema.assessments).values({
        signalId: id,
        assessmentType: 'IHR/RRA',
        assignedTo: '00000000-0000-0000-0000-000000000000', // Default placeholder or current user
        status: 'Draft'
    }).returning();

    return c.json({ success: true, assessmentId: newAssessment.id });
});

app.post('/api/v1/signals/:id/reject', async (c) => {
    const id = c.req.param('id');
    const db = getDB(c.env.HYPERDRIVE);
    await db.update(schema.signals)
        .set({ triageStatus: 'Rejected', currentStatus: 'Archived' })
        .where(eq(schema.signals.id, id));
    return c.json({ success: true });
});

app.get('/api/v1/assessments', async (c) => {
    const db = getDB(c.env.HYPERDRIVE);
    const result = await db.query.assessments.findMany({
        with: { signal: true }
    });
    return c.json(result);
});

app.put('/api/v1/assessments/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const db = getDB(c.env.HYPERDRIVE);

    await db.update(schema.assessments)
        .set({
            ihrQuestion1: body.q1,
            ihrQuestion2: body.q2,
            ihrQuestion3: body.q3,
            ihrQuestion4: body.q4,
            rraOverallRisk: body.riskLevel,
            rraHazardAssessment: body.hazard,
            rraExposureAssessment: body.exposure,
            rraContext_assessment: body.context,
            updatedAt: new Date()
        })
        .where(eq(schema.assessments.id, id));

    return c.json({ success: true });
});

app.post('/api/v1/assessments/:id/escalate', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const db = getDB(c.env.HYPERDRIVE);

    const assessment = await db.query.assessments.findFirst({
        where: eq(schema.assessments.id, id)
    });

    if (!assessment) return c.json({ error: 'Assessment not found' }, 404);

    await db.insert(schema.escalations).values({
        signalId: assessment.signalId,
        assessmentId: id,
        priority: body.priority || 'High',
        escalationReason: body.reason || 'Criteria met for PH Emergency',
        escalatedBy: body.userId || '00000000-0000-0000-0000-000000000000'
    });

    await db.update(schema.assessments)
        .set({ status: 'Escalated' })
        .where(eq(schema.assessments.id, id));

    return c.json({ success: true });
});

app.put('/api/v1/users/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const db = getDB(c.env.HYPERDRIVE);

    const updateData: any = {
        fullName: body.fullName,
        email: body.email,
        role: body.role,
        permissions: body.permissions,
        updatedAt: new Date()
    };

    if (body.password) {
        updateData.passwordHash = body.password;
    }

    await db.update(schema.users)
        .set(updateData)
        .where(eq(schema.users.id, id));

    return c.json({ success: true });
});

app.get('/api/v1/escalations', async (c) => {
    const db = getDB(c.env.HYPERDRIVE);
    const result = await db.query.escalations.findMany({
        with: { signal: true, assessment: true }
    });
    return c.json(result);
});

// --- SOCIAL LISTENER ---

app.get('/api/v1/social-signals', async (c) => {
    const db = getDB(c.env.HYPERDRIVE);
    const result = await db.query.socialSignals.findMany({
        orderBy: [desc(schema.socialSignals.postedAt)],
        where: eq(schema.socialSignals.isDismissed, false)
    });
    return c.json(result);
});

app.get('/api/v1/social-signals/:id', async (c) => {
    const id = c.req.param('id');
    const db = getDB(c.env.HYPERDRIVE);
    const result = await db.query.socialSignals.findFirst({
        where: eq(schema.socialSignals.id, id)
    });
    if (!result) return c.json({ error: 'Social signal not found' }, 404);
    return c.json(result);
});

app.post('/api/v1/social-signals/:id/promote', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const db = getDB(c.env.HYPERDRIVE);

    // Get the social signal
    const socialSignal = await db.query.socialSignals.findFirst({
        where: eq(schema.socialSignals.id, id)
    });

    if (!socialSignal) return c.json({ error: 'Social signal not found' }, 404);

    // Create a new signal from the social signal
    const [newSignal] = await db.insert(schema.signals).values({
        sourceUrl: socialSignal.urls && Array.isArray(socialSignal.urls) && socialSignal.urls.length > 0
            ? socialSignal.urls[0]
            : `https://twitter.com/${socialSignal.authorHandle}/status/${socialSignal.postId}`,
        rawData: {
            source: 'social_listener',
            originalPost: socialSignal.content,
            author: socialSignal.author,
            engagement: socialSignal.engagement
        },
        disease: body.disease || 'Unknown',
        country: body.country || socialSignal.location || 'Unknown',
        location: socialSignal.location,
        dateReported: new Date().toISOString().split('T')[0],
        description: socialSignal.content,
        priorityScore: socialSignal.relevanceScore,
        triageStatus: 'Pending Triage',
        currentStatus: 'New'
    }).returning();

    // Update social signal to mark as promoted
    await db.update(schema.socialSignals)
        .set({
            relatedSignalId: newSignal.id,
            promotedAt: new Date(),
            promotedBy: body.userId || null,
            verificationStatus: 'Promoted',
            updatedAt: new Date()
        })
        .where(eq(schema.socialSignals.id, id));

    return c.json({ success: true, signalId: newSignal.id });
});

app.post('/api/v1/social-signals/:id/dismiss', async (c) => {
    const id = c.req.param('id');
    const db = getDB(c.env.HYPERDRIVE);

    await db.update(schema.socialSignals)
        .set({ isDismissed: true, updatedAt: new Date() })
        .where(eq(schema.socialSignals.id, id));

    return c.json({ success: true });
});

app.get('/api/v1/monitored-accounts', async (c) => {
    const db = getDB(c.env.HYPERDRIVE);
    const result = await db.query.monitoredAccounts.findMany({
        where: eq(schema.monitoredAccounts.isActive, true),
        orderBy: [schema.monitoredAccounts.priority]
    });
    return c.json(result);
});

app.get('/api/v1/listener-keywords', async (c) => {
    const db = getDB(c.env.HYPERDRIVE);
    const result = await db.query.listenerKeywords.findMany({
        where: eq(schema.listenerKeywords.isActive, true)
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
