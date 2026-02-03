import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './src/db/schema';
import { TwitterListener } from './src/services/twitter-listener';
import * as dotenv from 'dotenv';
dotenv.config();

const connectionString = process.argv[2] || process.env.DATABASE_URL;

if (!connectionString) {
    console.error("Please provide the connection string: npx tsx seed.ts <connection-string> or set DATABASE_URL in .env");
    process.exit(1);
}

async function seed() {
    const client = postgres(connectionString);
    const db = drizzle(client, { schema });

    console.log("Seeding admin user...");

    await db.insert(schema.users).values({
        username: 'admin',
        email: 'admin@pha.gov.sa',
        fullName: 'System Administrator',
        role: 'Admin',
        passwordHash: 'admin123',
        isActive: true
    }).onConflictDoNothing();

    console.log("Seeding monitored accounts...");

    const accounts = [
        { handle: '@WHO', name: 'World Health Organization', type: 'official', region: 'Global', priority: 1 },
        { handle: '@WHOEMRO', name: 'WHO EMRO', type: 'official', region: 'EMRO', priority: 1 },
        { handle: '@SaudiMOH', name: 'Saudi Ministry of Health', type: 'official', region: 'Saudi Arabia', priority: 1 },
        { handle: '@KSACDC', name: 'Saudi CDC', type: 'official', region: 'Saudi Arabia', priority: 1 },
        { handle: '@CDCgov', name: 'US CDC', type: 'official', region: 'Global', priority: 1 },
        { handle: '@ProMED_mail', name: 'ProMED', type: 'official', region: 'Global', priority: 1 },
        { handle: '@MOHCDUBAI', name: 'UAE Ministry of Health', type: 'official', region: 'UAE', priority: 1 },
        { handle: '@MOHQatar', name: 'Qatar Ministry of Health', type: 'official', region: 'Qatar', priority: 1 },
        { handle: '@BogochIsaac', name: 'Isaac Bogoch', type: 'expert', region: 'Global', priority: 2 },
        { handle: '@SaudiNews50', name: 'Saudi News 50', type: 'influencer', region: 'Saudi Arabia', priority: 2 },
        { handle: '@Eyaaaad', name: 'Eyad Qurabi', type: 'influencer', region: 'Saudi Arabia', priority: 2 },
        { handle: '@CollinRugg', name: 'Collin Rugg', type: 'influencer', region: 'US', priority: 2 },
    ];

    for (const acc of accounts) {
        await db.insert(schema.monitoredAccounts).values({
            accountHandle: acc.handle,
            accountName: acc.name,
            accountType: acc.type,
            region: acc.region,
            priority: acc.priority,
            isActive: true,
        }).onConflictDoNothing();
    }

    console.log("Seeding listener keywords...");

    const keywords = [
        // Diseases (English)
        { keyword: 'outbreak', category: 'disease', language: 'en', priority: 1 },
        { keyword: 'H5N1', category: 'disease', language: 'en', priority: 1 },
        { keyword: 'MERS', category: 'disease', language: 'en', priority: 1 },
        { keyword: 'cholera', category: 'disease', language: 'en', priority: 1 },
        { keyword: 'dengue', category: 'disease', language: 'en', priority: 2 },
        { keyword: 'measles', category: 'disease', language: 'en', priority: 2 },
        // Severity
        { keyword: 'emergency', category: 'severity', language: 'en', priority: 1 },
        { keyword: 'deaths', category: 'severity', language: 'en', priority: 1 },
        { keyword: 'alert', category: 'severity', language: 'en', priority: 1 },
        // Locations
        { keyword: 'Saudi Arabia', category: 'location', language: 'en', priority: 1 },
        { keyword: 'GCC', category: 'location', language: 'en', priority: 1 },
        { keyword: 'Yemen', category: 'location', language: 'en', priority: 2 },
        // Arabic
        { keyword: 'تفشي', category: 'disease', language: 'ar', priority: 1 },
        { keyword: 'وباء', category: 'disease', language: 'ar', priority: 1 },
        { keyword: 'وفيات', category: 'severity', language: 'ar', priority: 1 },
        { keyword: 'السعودية', category: 'location', language: 'ar', priority: 1 },
    ];

    for (const kw of keywords) {
        await db.insert(schema.listenerKeywords).values(kw).onConflictDoNothing();
    }

    console.log("Seeding mock social signals...");

    const mockSignals = TwitterListener.generateMockSignals();

    for (const signal of mockSignals) {
        const keywords = TwitterListener.detectKeywords(signal.content);
        const priority = TwitterListener.getAccountPriority(signal.authorHandle);
        const relevanceScore = TwitterListener.calculateRelevanceScore(signal, priority, keywords);

        await db.insert(schema.socialSignals).values({
            platform: 'twitter',
            postId: signal.postId,
            author: signal.author,
            authorHandle: signal.authorHandle,
            content: signal.content,
            language: signal.language,
            location: signal.location,
            hashtags: signal.hashtags,
            mentions: signal.mentions,
            urls: signal.urls,
            engagement: signal.engagement,
            detectedKeywords: keywords,
            relevanceScore: relevanceScore.toString(),
            postedAt: signal.postedAt,
        }).onConflictDoNothing();
    }

    console.log("✅ Seed complete!");
    console.log("- Admin user: admin@pha.gov.sa / admin123");
    console.log(`- Monitored accounts: ${accounts.length}`);
    console.log(`- Keywords: ${keywords.length}`);
    console.log(`- Mock social signals: ${mockSignals.length}`);

    await client.end();
    process.exit(0);
}

seed();
