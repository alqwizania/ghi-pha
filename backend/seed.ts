import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './src/db/schema';
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
        passwordHash: 'admin123', // In production, use a hashed password!
        isActive: true
    }).onConflictDoNothing();

    console.log("Seed complete. You can now log in with admin/admin123");
    process.exit(0);
}

seed();
