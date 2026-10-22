// Local-disk file storage under data/.
// POSTGRES/hosting: when the app moves off a single machine, swap these
// functions for S3 / Google Cloud Storage calls,
// and store object keys instead of local paths.
import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";

/**
 * Saves the uploaded file as uploads/<id>/original.<ext>.
 * Returns its path.
 */
export async function saveOriginal(articleId, buffer, filename) {
    const dir = path.join(config.uploadsDir, String(articleId));
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(
        dir,
        `original${path.extname(filename).toLowerCase()}`,
    );
    await fs.writeFile(filePath, buffer);
    return filePath;
}

/**
 * Saves a level's worksheet as outputs/<id>/<level>.docx.
 * Returns its path.
 */
export async function saveOutput(articleId, level, buffer) {
    const dir = path.join(config.outputsDir, String(articleId));
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${level}.docx`);
    await fs.writeFile(filePath, buffer);
    return filePath;
}

/** Removes an article's upload and output folders, if they exist. */
export async function deleteArticleFiles(articleId) {
    await fs.rm(path.join(config.uploadsDir, String(articleId)), {
        recursive: true,
        force: true,
    });
    await fs.rm(path.join(config.outputsDir, String(articleId)), {
        recursive: true,
        force: true,
    });
}

/** Download names like "the-water-cycle-grade-5.docx". */
export function downloadName(title, suffix, ext) {
    const slug =
        title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 60) || "article";
    return `${slug}-${suffix}${ext}`;
}
