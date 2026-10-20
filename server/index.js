import { createApp } from "./app.js";
import { config } from "./config.js";
import { initDb } from "./db/index.js";
import * as repo from "./db/repo.js";

await initDb();
const interrupted = await repo.failInterruptedLevels();
if (interrupted)
    console.log(`Marked ${interrupted} interrupted level(s) as failed.`);

createApp().listen(config.port, () => {
    console.log(
        `ESL Article Scaffolder running at http://localhost:${config.port}`,
    );
    if (!config.hasApiCredentials)
        console.warn(
            "WARNING: ANTHROPIC_API_KEY is not set. Uploads will be refused until it is added to .env.",
        );
    console.log(
        `Model: ${config.model} · Daily budget: $${config.dailyBudgetUsd.toFixed(2)}`,
    );
});
