// REST API. Everything returns JSON (except file downloads), so a React frontend can reuse it as-is.
// Routes come first, in the order a teacher uses them; the helpers they share are below.
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { LEVEL_IDS, LIMITS, getLevel } from "../config.js";
import * as repo from "../db/repo.js";
import * as budget from "../services/budget.js";
import * as jobs from "../services/jobs.js";
import * as storage from "../services/storage.js";
import {
    countWords,
    deriveTitle,
    extractText,
    normalize,
} from "../services/extract.js";
import {
    cleanText,
    parseOptions,
    ValidationError,
} from "../services/validate.js";

const MAX_SEARCH_CHARS = 100;
const ALREADY_RUNNING = "This level is already being generated.";

const router = Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: LIMITS.maxFileBytes,
        files: 1,
        fieldSize: LIMITS.maxPastedChars * 4,
    },
    fileFilter: acceptAllowedFileTypes,
});

// --- Articles ---

router.get("/articles", async (req, res) => {
    const query =
        typeof req.query.q === "string"
            ? req.query.q.trim().slice(0, MAX_SEARCH_CHARS)
            : "";
    res.json(await repo.listArticles(query));
});

// Upload: validate and extract the text, save it with status 'pending', then start one job per level.
router.post("/articles", upload.single("file"), async (req, res) => {
    const body = req.body ?? {};
    const fields = readUploadFields(body);
    const source = await readArticleSource(body, req.file);
    const wordCount = assertWithinWordLimit(source.text);
    const title = fields.title ?? deriveTitleFromSource(source);

    const id = await saveArticleAndStartJobs(
        { ...fields, ...source, title, wordCount },
        req.file,
    );
    res.status(201).json({ id });
});

router.get("/articles/:id", async (req, res) => {
    const article = await repo.getArticle(readArticleId(req));
    if (!article) return res.status(404).json({ error: "Article not found." });
    res.json(article);
});

router.get("/articles/:id/original", async (req, res) => {
    const article = await repo.getArticleInternal(readArticleId(req));
    if (!article?.original_path) {
        return res
            .status(404)
            .json({ error: "No original file for this article." });
    }
    const extension = path.extname(article.original_path);
    res.download(
        article.original_path,
        storage.downloadName(article.title, "original", extension),
    );
});

router.delete("/articles/:id", async (req, res) => {
    const id = readArticleId(req);
    if (!(await repo.deleteArticle(id)))
        return res.status(404).json({ error: "Article not found." });
    await storage.deleteArticleFiles(id);
    res.status(204).end();
});

// --- Levels ---

router.get("/articles/:id/levels/:level", async (req, res) => {
    const row = await repo.getLevelOutput(readArticleId(req), readLevelId(req));
    if (!row) return res.status(404).json({ error: "Article not found." });
    res.json(toLevelJson(row));
});

router.get("/articles/:id/levels/:level/download", async (req, res) => {
    const id = readArticleId(req);
    const level = readLevelId(req);
    const [article, row] = await Promise.all([
        repo.getArticleInternal(id),
        repo.getLevelOutput(id, level),
    ]);
    if (!article || row?.status !== "ready" || !row.docx_path) {
        return res.status(404).json({ error: "This file is not ready yet." });
    }
    const levelSlug = getLevel(level).label.toLowerCase().replace(/\s+/g, "-");
    res.download(
        row.docx_path,
        storage.downloadName(article.title, levelSlug, ".docx"),
    );
});

// Try Again for one failed level. 202 = started; 409 = already running; 200 = already done.
router.post("/articles/:id/levels/:level/retry", async (req, res) => {
    const id = readArticleId(req);
    const level = readLevelId(req);
    const claimed = await claimAndStartLevels(id, [level], ["failed"]);
    if (claimed.length)
        return res
            .status(202)
            .json({ articleId: id, level, status: "pending" });

    const row = await repo.getLevelOutput(id, level);
    if (row?.status === "ready") return res.status(200).json(toLevelJson(row));
    res.status(409).json({ error: ALREADY_RUNNING });
});

// Try Again for every failed level of an article, claimed in one UPDATE.
router.post("/articles/:id/retry", async (req, res) => {
    const id = readArticleId(req);
    const claimed = await claimAndStartLevels(id, LEVEL_IDS, ["failed"]);
    if (claimed.length) return res.status(202).json({ articleId: id, claimed });

    const article = await repo.getArticle(id);
    const isRunning = article.levels.some(
        (l) => l.status === "pending" || l.status === "processing",
    );
    if (isRunning)
        return res
            .status(409)
            .json({ error: "This article is already being generated." });
    res.status(200).json(article);
});

// Run a level again on purpose, even if it is ready.
router.post("/articles/:id/levels/:level/regenerate", async (req, res) => {
    const id = readArticleId(req);
    const level = readLevelId(req);
    const claimed = await claimAndStartLevels(id, [level], ["failed", "ready"]);
    if (!claimed.length)
        return res.status(409).json({ error: ALREADY_RUNNING });
    res.status(202).json({ articleId: id, level, status: "pending" });
});

// --- Usage ---

router.get("/usage/today", async (req, res) => {
    res.json(await budget.todaySummary());
});

export default router;

// --- Upload helpers ---

/** Rejects uploads whose extension isn't allowed, before the file is read into memory. */
function acceptAllowedFileTypes(req, file, callback) {
    const extension = path.extname(file.originalname).toLowerCase();
    if (LIMITS.allowedExtensions.includes(extension))
        return callback(null, true);
    callback(
        new ValidationError(
            `Unsupported file type. Please upload ${LIMITS.allowedExtensions.join(", ")}.`,
        ),
    );
}

/** Validates the text fields and options. A blank title comes back as null. */
function readUploadFields(body) {
    return {
        // LOGIN: uploaded_by becomes the signed-in user's id from the session instead of a form field.
        uploadedBy: cleanText(body.uploaded_by, {
            field: "Uploaded by",
            maxChars: LIMITS.maxUploaderChars,
        }),
        title: cleanText(body.title, {
            field: "Title",
            maxChars: LIMITS.maxTitleChars,
        }),
        options: parseOptions(body),
    };
}

/** Returns { text, sourceType, originalFilename } from pasted text or the uploaded file. */
function readArticleSource(body, file) {
    // DRIVE: a 'gdrive' mode would fetch the file from a Drive link here.
    return body.mode === "paste"
        ? readPastedText(body.text)
        : readUploadedFile(file);
}

function readPastedText(pasted = "") {
    const raw = typeof pasted === "string" ? pasted : "";
    if (raw.length > LIMITS.maxPastedChars) {
        throw new ValidationError(
            `Pasted text must be ${LIMITS.maxPastedChars.toLocaleString()} characters or fewer.`,
        );
    }
    const text = normalize(raw);
    if (!text) throw new ValidationError("Please paste the article text.");
    return { text, sourceType: "paste", originalFilename: null };
}

async function readUploadedFile(file) {
    if (!file) throw new ValidationError("Please choose a file to upload.");
    const text = await extractText(file.buffer, file.originalname);
    return { text, sourceType: "file", originalFilename: file.originalname };
}

/** Returns the word count, or throws if the article is over the limit. */
function assertWithinWordLimit(text) {
    const wordCount = countWords(text);
    if (wordCount > LIMITS.maxWords) {
        throw new ValidationError(
            `This article has ${wordCount.toLocaleString()} words. The limit is ${LIMITS.maxWords.toLocaleString()} words. Please shorten it and try again.`,
        );
    }
    return wordCount;
}

/** Title from the article's heading or filename. It comes from the article, which isn't profanity-checked, so it's only trimmed. */
function deriveTitleFromSource({ text, originalFilename }) {
    return deriveTitle(text, originalFilename).slice(0, LIMITS.maxTitleChars);
}

/**
 * Reserves budget for every level, saves the article (and the original file) with each level
 * 'pending', then starts the jobs. Releases the budget if saving fails. Returns the new id.
 */
async function saveArticleAndStartJobs(article, file) {
    const perCall = await budget.reserve(article.text, LEVEL_IDS.length);
    let id;
    try {
        id = await repo.createArticle({
            title: article.title,
            uploadedBy: article.uploadedBy,
            sourceType: article.sourceType,
            originalFilename: article.originalFilename,
            extractedText: article.text,
            wordCount: article.wordCount,
            options: article.options,
        });
        if (file)
            await repo.setOriginalPath(
                id,
                await storage.saveOriginal(id, file.buffer, file.originalname),
            );
    } catch (err) {
        budget.release(perCall * LEVEL_IDS.length);
        throw err;
    }
    for (const level of LEVEL_IDS) jobs.startLevel(id, level, perCall);
    return id;
}

// --- Level helpers ---

/**
 * Reserves budget, claims the levels with one atomic UPDATE, and starts a job for each level
 * claimed. Returns the claimed levels; [] means another request got there first (or nothing
 * was in a claimable status). Uses the stored text, so nothing is re-uploaded or re-extracted.
 */
async function claimAndStartLevels(articleId, levels, fromStatuses) {
    const article = await repo.getArticleInternal(articleId);
    if (!article) throw notFound("Article not found.");

    const perCall = await reserveIfAnythingToStart(
        article,
        levels,
        fromStatuses,
    );
    if (perCall === null) return [];

    let claimed = [];
    try {
        claimed = await repo.claimLevels(articleId, levels, fromStatuses);
    } finally {
        budget.release(perCall * (levels.length - claimed.length));
    }
    for (const level of claimed) jobs.startLevel(articleId, level, perCall);
    return claimed;
}

/**
 * Reserves budget for `levels`. When the daily limit is reached but none of the levels could be
 * started anyway (already running or done), returns null instead of a 429, so the caller can say why.
 */
async function reserveIfAnythingToStart(article, levels, fromStatuses) {
    try {
        return await budget.reserve(article.extracted_text, levels.length);
    } catch (err) {
        if (!(err instanceof budget.BudgetError)) throw err;
        const rows = await Promise.all(
            levels.map((level) => repo.getLevelOutput(article.id, level)),
        );
        if (rows.some((row) => fromStatuses.includes(row?.status))) throw err;
        return null;
    }
}

/** The API shape of one level: status, error and parsed content. */
function toLevelJson(row) {
    return {
        level: row.level,
        label: getLevel(row.level).label,
        status: row.status,
        error: row.error,
        content: row.content_json ? JSON.parse(row.content_json) : null,
    };
}

// --- Request parameters ---

function readArticleId(req) {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) throw notFound("Article not found.");
    return id;
}

function readLevelId(req) {
    if (!LEVEL_IDS.includes(req.params.level)) throw notFound("Unknown level.");
    return req.params.level;
}

/** An error the error handler in app.js turns into a 404 JSON response. */
function notFound(message) {
    return Object.assign(new Error(message), { status: 404 });
}
