import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './src/db/schema';
import * as dotenv from 'dotenv';

dotenv.config();

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });

async function seed() {
    console.log('Seeding initial PHA Admin...');

    await db.insert(schema.users).values({
        username: 'admin',
        email: 'admin@pha.gov.sa',
        fullName: 'System Admin',
        role: 'Admin',
        passwordHash: 'admin123', // In production, hash this!
        permissions: {
            dashboard: 'edit',
            triage: 'edit',
            assessment: 'edit',
            escalation: 'edit'
        }
    }).onConflictDoUpdate({
        target: schema.users.username,
        set: {
            email: 'admin@pha.gov.sa',
            role: 'Admin',
            permissions: {
                dashboard: 'edit',
                triage: 'edit',
                assessment: 'edit',
                escalation: 'edit'
            }
        }
    });

    console.log('Seed complete. Admin account: admin / admin123');
    process.exit(0);
}

seed().catch(console.error);
