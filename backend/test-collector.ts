import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './src/db/schema';
import { BeaconCollector } from './src/services/beacon-collector';
import * as dotenv from 'dotenv';
dotenv.config();

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    console.error("DATABASE_URL not found in .env");
    process.exit(1);
}

async function test() {
    console.log("Initializing test collector...");
    const client = postgres(connectionString!);
    const db = drizzle(client, { schema });

    const collector = new BeaconCollector(db);

    console.log("Running collection...");
    await collector.collect();

    console.log("Test finished. Checking DB for signals...");
    const signals = await db.query.signals.findMany();
    console.log(`Total signals in DB: ${signals.length}`);

    process.exit(0);
}

test().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
