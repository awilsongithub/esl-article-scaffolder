// REST API. Everything returns JSON (except file downloads), so a React frontend can reuse it as-is.
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

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: LIMITS.maxFileBytes,
    files: 1,
    fieldSize: LIMITS.maxPastedChars * 4,
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (LIMITS.allowedExtensions.includes(ext)) return cb(null, true);
    cb(
      new ValidationError(
        `Unsupported file type. Please upload ${LIMITS.allowedExtensions.join(", ")}.`,
      ),
    );
  },
});

function articleId(req) {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id < 1)
    throw Object.assign(new Error("Article not found."), { status: 404 });
  return id;
}

function levelParam(req) {
  if (!LEVEL_IDS.includes(req.params.level))
    throw Object.assign(new Error("Unknown level."), { status: 404 });
  return req.params.level;
}

router.get("/articles", async (req, res) => {
  const q =
    typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  res.json(await repo.listArticles(q));
});

router.post("/articles", upload.single("file"), async (req, res) => {
  const body = req.body ?? {};
  // LOGIN: uploaded_by becomes the signed-in user's id from the session instead of a form field.
  const uploadedBy = cleanText(body.uploaded_by, {
    field: "Uploaded by",
    maxChars: LIMITS.maxUploaderChars,
  });
  let title = cleanText(body.title, {
    field: "Title",
    maxChars: LIMITS.maxTitleChars,
  });
  const options = parseOptions(body);

  let text;
  let sourceType;
  let originalFilename = null;
  if (body.mode === "paste") {
    sourceType = "paste";
    const pasted = typeof body.text === "string" ? body.text : "";
    if (pasted.length > LIMITS.maxPastedChars) {
      throw new ValidationError(
        `Pasted text must be ${LIMITS.maxPastedChars.toLocaleString()} characters or fewer.`,
      );
    }
    text = normalize(pasted);
    if (!text) throw new ValidationError("Please paste the article text.");
  } else {
    // DRIVE: a 'gdrive' mode would fetch the file from a Drive link here.
    sourceType = "file";
    if (!req.file) throw new ValidationError("Please choose a file to upload.");
    originalFilename = req.file.originalname;
    text = await extractText(req.file.buffer, originalFilename);
  }

  const wordCount = countWords(text);
  if (wordCount > LIMITS.maxWords) {
    throw new ValidationError(
      `This article has ${wordCount.toLocaleString()} words. The limit is ${LIMITS.maxWords.toLocaleString()} words. Please shorten it and try again.`,
    );
  }
  if (!title) {
    // Derived titles come from the article itself, which isn't profanity-checked, so trim only.
    title = deriveTitle(text, originalFilename).slice(0, LIMITS.maxTitleChars);
  }

  const perCall = await budget.reserve(text, LEVEL_IDS.length);
  let id;
  try {
    id = await repo.createArticle({
      title,
      uploadedBy,
      sourceType,
      originalFilename,
      extractedText: text,
      wordCount,
      options,
    });
    if (req.file)
      await repo.setOriginalPath(
        id,
        await storage.saveOriginal(id, req.file.buffer, originalFilename),
      );
  } catch (err) {
    budget.release(perCall * LEVEL_IDS.length);
    throw err;
  }
  for (const level of LEVEL_IDS) jobs.startLevel(id, level, perCall);
  res.status(201).json({ id });
});

router.get("/articles/:id", async (req, res) => {
  const article = await repo.getArticle(articleId(req));
  if (!article) return res.status(404).json({ error: "Article not found." });
  res.json(article);
});

function levelJson(row) {
  return {
    level: row.level,
    label: getLevel(row.level).label,
    status: row.status,
    error: row.error,
    content: row.content_json ? JSON.parse(row.content_json) : null,
  };
}

const ALREADY_RUNNING = "This level is already being generated.";

// Reserves budget, claims the levels with one atomic UPDATE, and starts a job for each level
// claimed. Returns the claimed levels; [] means another request got there first (or nothing
// was in a claimable status). Uses the stored text, so nothing is re-uploaded or re-extracted.
async function claimAndStart(id, levels, fromStatuses) {
  const article = await repo.getArticleInternal(id);
  if (!article)
    throw Object.assign(new Error("Article not found."), { status: 404 });

  let perCall;
  try {
    perCall = await budget.reserve(article.extracted_text, levels.length);
  } catch (err) {
    // Out of budget only matters if there is something to start.
    if (err instanceof budget.BudgetError) {
      const rows = await Promise.all(levels.map((l) => repo.getLevelOutput(id, l)));
      if (!rows.some((r) => fromStatuses.includes(r?.status))) return [];
    }
    throw err;
  }
  let claimed = [];
  try {
    claimed = await repo.claimLevels(id, levels, fromStatuses);
  } finally {
    budget.release(perCall * (levels.length - claimed.length));
  }
  for (const level of claimed) jobs.startLevel(id, level, perCall);
  return claimed;
}

router.get("/articles/:id/levels/:level", async (req, res) => {
  const row = await repo.getLevelOutput(articleId(req), levelParam(req));
  if (!row) return res.status(404).json({ error: "Article not found." });
  res.json(levelJson(row));
});

// Try Again for one failed level. 202 = started; 409 = already running; 200 = already done.
router.post("/articles/:id/levels/:level/retry", async (req, res) => {
  const id = articleId(req);
  const level = levelParam(req);
  const claimed = await claimAndStart(id, [level], ["failed"]);
  if (claimed.length)
    return res.status(202).json({ articleId: id, level, status: "pending" });
  const row = await repo.getLevelOutput(id, level);
  if (row?.status === "ready") return res.status(200).json(levelJson(row));
  res.status(409).json({ error: ALREADY_RUNNING });
});

// Try Again for every failed level of an article, claimed in one UPDATE.
router.post("/articles/:id/retry", async (req, res) => {
  const id = articleId(req);
  const claimed = await claimAndStart(id, LEVEL_IDS, ["failed"]);
  if (claimed.length) return res.status(202).json({ articleId: id, claimed });
  const article = await repo.getArticle(id);
  if (article.levels.some((l) => l.status === "pending" || l.status === "processing"))
    return res.status(409).json({ error: "This article is already being generated." });
  res.status(200).json(article);
});

// Run a level again on purpose, even if it is ready.
router.post("/articles/:id/levels/:level/regenerate", async (req, res) => {
  const id = articleId(req);
  const level = levelParam(req);
  const claimed = await claimAndStart(id, [level], ["failed", "ready"]);
  if (!claimed.length) return res.status(409).json({ error: ALREADY_RUNNING });
  res.status(202).json({ articleId: id, level, status: "pending" });
});

router.get("/articles/:id/original", async (req, res) => {
  const article = await repo.getArticleInternal(articleId(req));
  if (!article?.original_path)
    return res
      .status(404)
      .json({ error: "No original file for this article." });
  res.download(
    article.original_path,
    storage.downloadName(
      article.title,
      "original",
      path.extname(article.original_path),
    ),
  );
});

router.get("/articles/:id/levels/:level/download", async (req, res) => {
  const id = articleId(req);
  const level = levelParam(req);
  const [article, row] = await Promise.all([
    repo.getArticleInternal(id),
    repo.getLevelOutput(id, level),
  ]);
  if (!article || row?.status !== "ready" || !row.docx_path) {
    return res.status(404).json({ error: "This file is not ready yet." });
  }
  const suffix = getLevel(level).label.toLowerCase().replace(/\s+/g, "-");
  res.download(
    row.docx_path,
    storage.downloadName(article.title, suffix, ".docx"),
  );
});

router.delete("/articles/:id", async (req, res) => {
  const id = articleId(req);
  if (!(await repo.deleteArticle(id)))
    return res.status(404).json({ error: "Article not found." });
  await storage.deleteArticleFiles(id);
  res.status(204).end();
});

router.get("/usage/today", async (req, res) => {
  res.json(await budget.todaySummary());
});

export default router;
