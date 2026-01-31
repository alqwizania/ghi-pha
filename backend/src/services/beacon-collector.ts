import { parseHTML } from 'linkedom';
import * as schema from '../db/schema';
import { eq } from 'drizzle-orm';

export interface BeaconEvent {
    disease: string;
    country: string;
    location: string;
    cases: number;
    deaths: number;
    cfr: string;
    description: string;
    sourceUrl: string;
    beaconEventId: string;
}

export class BeaconCollector {
    private baseUrl = "https://beaconbio.org";

    constructor(private db: any) { }

    async collect() {
        console.log("Starting Beacon collection via Jina AI Proxy...");
        try {
            // Using Jina AI Reader to render Next.js content and bypass 403 blocks
            const proxyUrl = `https://r.jina.ai/${this.baseUrl}/en/`;
            const response = await fetch(proxyUrl);
            const markdown = await response.text();

            // Parsing logic for Jina's Markdown output
            // Events are typically separated by horizontal rules '* * *'
            const blocks = markdown.split(/\n\* \* \*\n/);
            const newEvents: BeaconEvent[] = [];

            for (const block of blocks) {
                // Match pattern: [Disease, Country](URL)
                const titleMatch = block.match(/\[(.*?), (.*?)\]\((.*?)\)/);
                if (!titleMatch) continue;

                const [_, disease, country, link] = titleMatch;
                const sourceUrl = link.startsWith('http') ? link : `${this.baseUrl}${link}`;

                const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);

                let description = "";
                let dateReported = new Date(); // Fallback to now

                for (let i = 2; i < lines.length; i++) {
                    const line = lines[i];

                    // Match date format: DayName DD Mon YYYY (e.g., Fri 30 Jan 2026)
                    const dateMatch = line.match(/^[A-Z][a-z]{2}\s+\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}$/);
                    if (dateMatch) {
                        const parsedDate = new Date(line);
                        if (!isNaN(parsedDate.getTime())) {
                            dateReported = parsedDate;
                        }
                        continue;
                    }

                    if (line.startsWith('![')) continue; // Skip images
                    if (line.match(/^\d+ reports?$/i)) continue; // Skip report count

                    // If it's not a special line, it's part of the description
                    description += line + " ";
                }

                // Extract cases/deaths from description
                const casesMatch = description.match(/(\d+)\s+cases/i);
                const deathsMatch = description.match(/(\d+)\s+deaths/i);
                const cases = casesMatch ? parseInt(casesMatch[1]) : 0;
                const deaths = deathsMatch ? parseInt(deathsMatch[1]) : 0;

                const beaconEventId = new URL(sourceUrl).searchParams.get('eventid') || sourceUrl.split('eventid=').pop()?.split('&')[0] || sourceUrl;

                newEvents.push({
                    disease: disease.trim(),
                    country: country.trim(),
                    location: country.trim(),
                    cases,
                    deaths,
                    cfr: "0%",
                    description: description.trim(),
                    sourceUrl,
                    beaconEventId,
                    // @ts-ignore - explicitly adding for DB insert
                    dateReported: dateReported.toISOString().split('T')[0]
                });
            }

            console.log(`Found ${newEvents.length} potential events via Jina AI.`);

            for (const event of newEvents) {
                const existing = await this.db.query.signals.findFirst({
                    where: eq(schema.signals.beaconEventId, event.beaconEventId)
                });

                if (!existing) {
                    await this.db.insert(schema.signals).values({
                        beaconEventId: event.beaconEventId,
                        sourceUrl: event.sourceUrl,
                        disease: event.disease,
                        country: event.country,
                        location: event.location,
                        // @ts-ignore
                        dateReported: event.dateReported,
                        cases: event.cases,
                        deaths: event.deaths,
                        caseFatalityRate: event.cfr.replace('%', ''),
                        description: event.description,
                        rawData: event,
                        priorityScore: this.calculatePriority(event),
                    });
                    console.log(`Inserted new signal: ${event.disease} in ${event.country}`);
                }
            }

        } catch (error) {
            console.error("Error during Beacon collection:", error);
        }
    }

    private calculatePriority(event: BeaconEvent): string {
        let score = 50;
        if (event.disease.toLowerCase().includes('ebola')) score += 30;
        if (event.disease.toLowerCase().includes('mers')) score += 40;
        if (event.country.toLowerCase().includes('saudi') || event.country.toLowerCase().includes('yemen')) score += 20;
        if (event.cases > 50) score += 10;
        return Math.min(score, 100).toString();
    }
}
