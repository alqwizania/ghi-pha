import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './src/db/schema';
import * as dotenv from 'dotenv';

dotenv.config();

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client, { schema });

async function seed() {
    console.log('Seeding PHA Management Personnel...');

    const users = [
        {
            username: 'admin',
            email: 'admin@pha.gov.sa',
            fullName: 'PHA System Administrator',
            role: 'Superadmin',
            passwordHash: 'admin123',
            permissions: { dashboard: 'edit', triage: 'edit', assessment: 'edit', escalation: 'edit' }
        },
        {
            username: 'director',
            email: 'director@pha.gov.sa',
            fullName: 'Executive Director',
            role: 'Director',
            passwordHash: 'director123',
            permissions: { dashboard: 'view', triage: 'edit', assessment: 'edit', escalation: 'edit' }
        }
    ];

    for (const user of users) {
        await db.insert(schema.users).values(user).onConflictDoUpdate({
            target: schema.users.email,
            set: {
                role: user.role,
                fullName: user.fullName,
                permissions: user.permissions,
                passwordHash: user.passwordHash
            }
        });
    }

    console.log('Seed complete.');
    console.log('Superadmin: admin@pha.gov.sa / admin123');
    console.log('Director: director@pha.gov.sa / director123');
    process.exit(0);
}

seed().catch(console.error);
