import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { config } from "../config.js";

let db;

// POSTGRES: replace with `new pg.Pool({ connectionString: process.env.DATABASE_URL })`
// and run schema.sql through a migration tool instead of on every start.
export async function initDb() {
    await fs.mkdir(path.dirname(config.dbPath), { recursive: true });
    db = await open({ filename: config.dbPath, driver: sqlite3.Database });
    await db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    const schemaPath = path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "schema.sql",
    );
    await db.exec(await fs.readFile(schemaPath, "utf8"));
    // Columns added after the first release; CREATE TABLE IF NOT EXISTS won't add them to old databases.
    const usageCols = await db.all("PRAGMA table_info(usage)");
    if (!usageCols.some((c) => c.name === "duration_ms"))
        await db.exec("ALTER TABLE usage ADD COLUMN duration_ms INTEGER");
    return db;
}

export function getDb() {
    if (!db) throw new Error("Database not initialized");
    return db;
}
