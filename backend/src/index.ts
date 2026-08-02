import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './db/schema';
import { eq, desc, gte } from 'drizzle-orm';
import { sign, verify } from 'hono/jwt';

type Bindings = {
    HYPERDRIVE: Hyperdrive;
    JWT_SECRET: string;
    // Fallback Postgres connection string. Set as a Worker secret in
    // production (`wrangler secret put DATABASE_URL`) and in .dev.vars locally.
    DATABASE_URL?: string;
};

type SessionUser = {
    id: string;
    role: string;
    permissions?: Record<string, string>;
};

type Variables = {
    user: SessionUser;
};

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// The placeholder value shipped in wrangler.toml is public, so treat it as
// unset rather than signing tokens anyone could forge.
const jwtSecret = (env: Bindings): string => {
    const secret = env.JWT_SECRET;
    if (!secret || secret === 'change-me-later') {
        throw new Error(
            'JWT_SECRET is not configured. Set it with `wrangler secret put JWT_SECRET` in production, or in backend/.dev.vars locally.'
        );
    }
    return secret;
};

// Browsers may only call the API from the PHA front end. Non-browser callers
// (RSS readers, cron, curl) send no Origin and are unaffected by this.
const ALLOWED_ORIGINS = [
    'https://ghi-pha.pages.dev',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
];

app.use('*', cors({
    origin: (origin) => {
        if (!origin) return undefined;
        if (ALLOWED_ORIGINS.includes(origin)) return origin;
        // Cloudflare Pages preview deployments: <hash>.ghi-pha.pages.dev
        if (/^https:\/\/[a-z0-9-]+\.ghi-pha\.pages\.dev$/.test(origin)) return origin;
        return undefined;
    },
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
}));

// Endpoints reachable without a session. The RSS feed is deliberately open —
// it is a syndication endpoint carrying only already-public outbreak data, and
// feed readers cannot present a bearer token.
const PUBLIC_PATHS = new Set([
    '/',
    '/health',
    '/api/v1/ping',
    '/api/v1/auth/login',
    '/api/radar/rss',
    '/api/v1/radar/rss',
]);

app.use('*', async (c, next) => {
    if (c.req.method === 'OPTIONS') return next();
    if (PUBLIC_PATHS.has(new URL(c.req.url).pathname)) return next();

    const header = c.req.header('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) {
        return c.json({ error: 'Authentication required' }, 401);
    }

    try {
        // 'HS256' matches sign()'s default algorithm; verify requires it stated.
        const payload = await verify(token, jwtSecret(c.env), 'HS256');
        c.set('user', payload as unknown as SessionUser);
    } catch {
        return c.json({ error: 'Invalid or expired session' }, 401);
    }
    return next();
});

// Personnel administration and destructive operations are not open to analysts.
const ADMIN_ROLES = new Set(['Superadmin', 'Admin', 'Director']);

const requireAdmin = async (c: any, next: any) => {
    const user = c.get('user') as SessionUser | undefined;
    if (!user || !ADMIN_ROLES.has(user.role)) {
        return c.json({ error: 'Insufficient permissions' }, 403);
    }
    return next();
};

app.use('/api/v1/users', requireAdmin);
app.use('/api/v1/users/*', requireAdmin);
app.use('/api/admin/*', requireAdmin);

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

const getDB = (env: Bindings) => {
    // Prefer the Hyperdrive binding. Its local-dev placeholder host does not
    // resolve, so fall back to the configured connection string in that case.
    let connStr: string | undefined = env.HYPERDRIVE?.connectionString;
    if (!connStr || connStr.includes('.hyperdrive.local')) {
        connStr = env.DATABASE_URL;
    }
    if (!connStr) {
        throw new Error('No database connection available: set the HYPERDRIVE binding or the DATABASE_URL secret.');
    }
    if (!connStr.includes('sslmode=')) {
        connStr += connStr.includes('?') ? '&sslmode=require' : '?sslmode=require';
    }
    const client = postgres(connStr, { ssl: 'require' });
    return drizzle(client, { schema });
};

// --- AUTH ---

app.post('/api/v1/auth/login', async (c) => {
    console.log('Login attempt');
    try {
        const body = await c.req.json();
        const { email, password } = body;
        console.log(`Login payload for: ${email}`);

        const db = getDB(c.env);

        let user = await db.query.users.findFirst({
            where: eq(schema.users.email, email)
        });

        // Auto-provision Superadmin for authorized PHA users like arqwizani@pha.gov.sa
        if (!user && email.endsWith('@pha.gov.sa')) {
            const [created] = await db.insert(schema.users).values({
                username: email.split('@')[0],
                email: email,
                fullName: email.split('@')[0].toUpperCase() + ' (PHA Executive)',
                role: 'Superadmin',
                passwordHash: password,
                permissions: { dashboard: 'edit', radar: 'edit', listener: 'edit', triage: 'edit', assessment: 'edit' }
            }).onConflictDoNothing().returning();
            user = created || {
                id: '00000000-0000-0000-0000-000000000001',
                email,
                role: 'Superadmin',
                fullName: 'Al-Qwizani (PHA Executive)',
                permissions: { dashboard: 'edit', radar: 'edit', listener: 'edit', triage: 'edit', assessment: 'edit' },
                passwordHash: password
            } as any;
        }

        if (!user) {
            console.log(`User not found: ${email}`);
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
        }, jwtSecret(c.env));

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
    const db = getDB(c.env);
    const result = await db.query.users.findMany();
    return c.json(result);
});

app.post('/api/v1/users', async (c) => {
    try {
        const body = await c.req.json();
        const db = getDB(c.env);

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
    const db = getDB(c.env);
    const result = await db.query.signals.findMany({
        orderBy: [desc(schema.signals.createdAt)],
        with: { assessments: true, escalations: true }
    });
    return c.json(result);
});

app.post('/api/v1/signals/:id/accept', async (c) => {
    const id = c.req.param('id');
    const db = getDB(c.env);

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
    const db = getDB(c.env);
    await db.update(schema.signals)
        .set({ triageStatus: 'Rejected', currentStatus: 'Archived' })
        .where(eq(schema.signals.id, id));
    return c.json({ success: true });
});

app.get('/api/v1/assessments', async (c) => {
    const db = getDB(c.env);
    const result = await db.query.assessments.findMany({
        with: { signal: true }
    });
    return c.json(result);
});

app.put('/api/v1/assessments/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const db = getDB(c.env);

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
    const db = getDB(c.env);

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
    const db = getDB(c.env);

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
    const db = getDB(c.env);
    const result = await db.query.escalations.findMany({
        with: { signal: true, assessment: true }
    });
    return c.json(result);
});

// --- SOCIAL LISTENER ---

app.get('/api/v1/social-signals', async (c) => {
    const db = getDB(c.env);
    const result = await db.query.socialSignals.findMany({
        orderBy: [desc(schema.socialSignals.postedAt)],
        where: eq(schema.socialSignals.isDismissed, false)
    });
    return c.json(result);
});

app.get('/api/v1/social-signals/:id', async (c) => {
    const id = c.req.param('id');
    const db = getDB(c.env);
    const result = await db.query.socialSignals.findFirst({
        where: eq(schema.socialSignals.id, id)
    });
    if (!result) return c.json({ error: 'Social signal not found' }, 404);
    return c.json(result);
});

app.post('/api/v1/social-signals/:id/promote', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const db = getDB(c.env);

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
    const db = getDB(c.env);

    await db.update(schema.socialSignals)
        .set({ isDismissed: true, updatedAt: new Date() })
        .where(eq(schema.socialSignals.id, id));

    return c.json({ success: true });
});

app.get('/api/v1/monitored-accounts', async (c) => {
    const db = getDB(c.env);
    const result = await db.query.monitoredAccounts.findMany({
        where: eq(schema.monitoredAccounts.isActive, true),
        orderBy: [schema.monitoredAccounts.priority]
    });
    return c.json(result);
});

app.get('/api/v1/listener-keywords', async (c) => {
    const db = getDB(c.env);
    const result = await db.query.listenerKeywords.findMany({
        where: eq(schema.listenerKeywords.isActive, true)
    });
    return c.json(result);
});

import { fetchGlobalRadarScan, promoteRadarEventToSignal, MASTER_SOURCES, cutoffDate } from './services/radar-collector';

// --- GLOBAL RADAR ROUTES ---

// Sources are returned with their persisted health, so the drawer shows real
// state on load rather than only after the operator triggers a scan.
app.get('/api/radar/sources', async (c) => {
    try {
        const dbClient = getDB(c.env);
        const sources = await dbClient.query.surveillanceSources.findMany();
        if (sources.length === 0) {
            return c.json(MASTER_SOURCES);
        }
        const snapshots = await dbClient.query.sourceSnapshots.findMany();
        const health = new Map(snapshots.map((s: any) => [s.sourceId, s]));

        return c.json(sources.map((s: any) => {
            const snap: any = health.get(s.id);
            return {
                ...s,
                lastFetchedAt: snap?.lastFetchedAt ?? null,
                lastSuccessAt: snap?.lastSuccessAt ?? null,
                lastChangedAt: snap?.lastChangedAt ?? null,
                lastStatus: snap?.lastStatus ?? 'unknown',
                lastError: snap?.lastError ?? null,
                consecutiveFailures: snap?.consecutiveFailures ?? 0,
                eventsLastExtracted: snap?.eventsLastExtracted ?? 0,
            };
        }));
    } catch {
        return c.json(MASTER_SOURCES);
    }
});

app.get('/api/radar/events', async (c) => {
    try {
        const dbClient = getDB(c.env);
        const result = await dbClient.query.radarEvents.findMany({
            where: gte(schema.radarEvents.dateReported, cutoffDate()),
            orderBy: [desc(schema.radarEvents.createdAt)]
        });
        return c.json(result);
    } catch {
        return c.json([]);
    }
});

// --- GLOBAL RADAR RSS FEED EXPORTER ---
const handleRssFeed = async (c: any) => {
    try {
        const dbClient = getDB(c.env);
        const events = await dbClient.query.radarEvents.findMany({
            where: gte(schema.radarEvents.dateReported, cutoffDate()),
            orderBy: [desc(schema.radarEvents.createdAt)],
            limit: 50
        });

        const rssItems = events.map((e: any) => `
    <item>
      <title><![CDATA[${e.disease} Outbreak - ${e.country}: ${e.title}]]></title>
      <link>${e.sourceUrl || 'https://pha.gov.sa'}</link>
      <description><![CDATA[${e.summary || ''} (Cases: ${e.cases || 0}, Deaths: ${e.deaths || 0}, Risk Level: ${e.riskLevel})]]></description>
      <category>${e.boardType || 'biological'}</category>
      <pubDate>${new Date(e.dateReported || Date.now()).toUTCString()}</pubDate>
      <guid>${e.id}</guid>
    </item>`).join('');

        const xml = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>Public Health Authority (PHA) - Global Outbreak Radar Feed</title>
    <link>https://pha.gov.sa</link>
    <description>Official Real-Time Epidemiological Surveillance Feed from GHI Global Radar</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    ${rssItems}
  </channel>
</rss>`;

        return c.text(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
    } catch {
        return c.text('<rss version="2.0"><channel><title>GHI Global Radar</title></channel></rss>', 200, { 'Content-Type': 'application/xml' });
    }
};

app.get('/api/radar/rss', handleRssFeed);
app.get('/api/v1/radar/rss', handleRssFeed);

// An operator pressing Scan expects every source checked now, so a manual scan
// bypasses the per-source interval. The 6-hourly cron does not.
app.post('/api/radar/scan', async (c) => {
    try {
        const dbClient = getDB(c.env);
        const result = await fetchGlobalRadarScan(dbClient, c.env, { force: true });
        return c.json(result);
    } catch (e) {
        return c.json({ error: 'Scan failed', details: String(e) }, 500);
    }
});

app.post('/api/radar/promote', async (c) => {
    try {
        const { eventId } = await c.req.json();
        const dbClient = getDB(c.env);
        const newSignal = await promoteRadarEventToSignal(dbClient, eventId);
        return c.json({ success: true, signal: newSignal });
    } catch (e) {
        return c.json({ error: 'Failed to promote radar event', details: String(e) }, 500);
    }
});

// --- ADMIN DATABASE RESET ROUTE ---
app.post('/api/admin/reset-db', async (c) => {
    try {
        const dbClient = getDB(c.env);
        // Reset signals and radar events
        await dbClient.delete(schema.escalations);
        await dbClient.delete(schema.assessments);
        await dbClient.delete(schema.signals);
        await dbClient.delete(schema.radarEvents);
        
        // Trigger fresh scan starting from July 25th
        await fetchGlobalRadarScan(dbClient);
        
        return c.json({ success: true, message: 'Database reset completed. Fresh ingestion active from July 25th, 2026.' });
    } catch (e) {
        return c.json({ error: 'Database reset failed', details: String(e) }, 500);
    }
});

export default {
    fetch: app.fetch,
    async scheduled(event: any, env: Bindings, ctx: ExecutionContext) {
        const dbClient = getDB(env);
        ctx.waitUntil(fetchGlobalRadarScan(dbClient, env));
    },
};


