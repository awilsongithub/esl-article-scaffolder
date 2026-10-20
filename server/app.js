// Express app without listen(), so tests can start it on a random port.
import path from "node:path";
import express from "express";
import multer from "multer";
import { config, LEVELS, LIMITS, TRANSLATION_LANGUAGES } from "./config.js";
import articlesRouter from "./routes/articles.js";
import { BudgetError } from "./services/budget.js";
import { ExtractError } from "./services/extract.js";
import { ValidationError } from "./services/validate.js";

export function createApp() {
    const app = express();
    app.use(express.json());

    // REACT: the React app would be built to a dist/ folder and served here instead of public/.
    app.use(express.static(path.join(config.rootDir, "public")));

    // Settings the frontend needs, so levels and languages are defined in one place (config.js).
    app.get("/api/config", (req, res) => {
        res.json({
            levels: LEVELS.map(({ id, label, defaults, shortAnswer }) => ({
                id,
                label,
                defaults,
                shortAnswer,
            })),
            languages: TRANSLATION_LANGUAGES,
            limits: LIMITS,
        });
    });

    app.use("/api", articlesRouter);

    app.use("/api", (req, res) =>
        res.status(404).json({ error: "Not found." }),
    );

    // Express 5 forwards rejected promises from async handlers here.
    app.use((err, req, res, next) => {
        if (err instanceof ValidationError || err instanceof ExtractError)
            return res.status(400).json({ error: err.message });
        if (err instanceof BudgetError)
            return res.status(429).json({ error: err.message });
        if (err instanceof multer.MulterError) {
            const message =
                err.code === "LIMIT_FILE_SIZE"
                    ? `File is too large. The limit is ${LIMITS.maxFileBytes / 1024 / 1024} MB.`
                    : `Upload error: ${err.message}`;
            return res.status(400).json({ error: message });
        }
        if (err.status === 503)
            return res.status(503).json({ error: err.message });
        if (err.status && err.status < 500)
            return res.status(err.status).json({ error: err.message });
        console.error(err);
        res.status(500).json({ error: "Something went wrong on the server." });
    });

    return app;
}
