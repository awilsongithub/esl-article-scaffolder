import path from "node:path";
import express from "express";
import multer from "multer";
import { config, LEVELS, LIMITS, TRANSLATION_LANGUAGES } from "./config.js";
import articlesRouter from "./routes/articles.js";
import { BudgetError } from "./services/budget.js";
import { ExtractError } from "./services/extract.js";
import { ValidationError } from "./services/validate.js";

/**
 * Builds the Express app without calling listen(),
 * so tests can start it on a random port.
 */
export function createApp() {
    const app = express();

    /** Parse JSON bodies then call next() */
    app.use(express.json());

    // express.static() serves files from a folder, like images, CSS, or JS.
    // Express looks for files relative to the specified root directory [0.6.1]:
    // public/index.html → http://localhost:3000/index.html
    // REACT: the React app would be built to a dist/ folder 
    // and served here instead of public/.
    app.use(express.static(path.join(config.rootDir, "public")));

    /**
     * GET /api/config: the settings the frontend needs.
     * Levels and languages stay defined in one place (config.js).
     */
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

    /** Route handlers for API endpoints
     * articlesRouter handles /api/articles(/....) routes
     */
    app.use("/api", articlesRouter);

    /** Unknown /api paths get a JSON 404 instead of Express's HTML page. */
    app.use("/api", (req, res) =>
        res.status(404).json({ error: "Not found." }),
    );

    /**
     * Central Error handler for every route.
     * when express sees 4 parameters, it treats it as an error handler.
     * In normal mode 4 param fns are skipped. but when something calls
     * next(err), express jumps to the next 4 param fn.
     * Express 5 forwards rejected promises from async handlers here.
     * Known errors keep their message, with a 4xx or 503 status.
     * Anything else is logged and returns a generic 500.
     */
    app.use((err, req, res, next) => {
        if (err instanceof ValidationError || err instanceof ExtractError)
            return res.status(400).json({ error: err.message });
        if (err instanceof BudgetError)
            return res.status(429).json({ error: err.message });
        if (err instanceof multer.MulterError) {
            return returnMulterError(err, res);
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

function returnMulterError(err, res) {
    const message = err.code === "LIMIT_FILE_SIZE"
        ? `File is too large. The limit is ${LIMITS.maxFileBytes / 1024 / 1024} MB.`
        : `Upload error: ${err.message}`;
    return res.status(400).json({ error: message });
}

