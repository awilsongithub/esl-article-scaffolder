// Shared setup: a throwaway data folder, a fake Claude client and a running app.
// Env vars must be set before any server module is imported, so modules are loaded dynamically.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "leveler-test-"));
process.env.ANTHROPIC_API_KEY = "test-key";
process.env.DAILY_BUDGET_USD = "1";

export const { default: Anthropic } = await import("@anthropic-ai/sdk");
export const { initDb, getDb } = await import("../server/db/index.js");
export const repo = await import("../server/db/repo.js");
export const budget = await import("../server/services/budget.js");
export const jobs = await import("../server/services/jobs.js");
export const leveler = await import("../server/services/leveler.js");
export const prompt = await import("../server/services/prompt.js");
const { createApp } = await import("../server/app.js");
const { parseOptions } = await import("../server/services/validate.js");

export const ARTICLE_TEXT =
  "The water cycle moves water around the Earth. Water evaporates, forms clouds and falls as rain.";

export const fake = {
  calls: 0,
  handler: async () => validResponse(),
  beta: {
    messages: {
      stream: (params) => ({
        finalMessage: () => {
          fake.calls++;
          return fake.handler(params);
        },
      }),
    },
  },
  reset(handler = async () => validResponse()) {
    this.calls = 0;
    this.handler = handler;
  },
};
leveler.setClientForTests(fake);

export function validResponse() {
  return response(
    JSON.stringify({
      title: "Water",
      paragraphs: ["Water moves.", "Rain falls."],
      glossary: [
        {
          term: "cloud",
          definition: "water in the sky",
          example: "I see a cloud.",
        },
      ],
      multiple_choice: [
        {
          question: "What falls?",
          options: ["Rain", "Rocks", "Cats", "Cars"],
          correct_option: "A",
        },
      ],
      short_answer: [],
    }),
  );
}

export function response(text, stopReason = "end_turn") {
  return {
    model: "claude-sonnet-5-5",
    stop_reason: stopReason,
    usage: { input_tokens: 100, output_tokens: 50 },
    content: [{ type: "text", text }],
  };
}

export function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

await initDb();
const server = createApp().listen(0);
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}/api`;

export async function post(p) {
  const res = await fetch(`${base}${p}`, { method: "POST" });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export async function postForm(p, formData) {
  const res = await fetch(`${base}${p}`, { method: "POST", body: formData });
  return { status: res.status, body: await res.json().catch(() => null) };
}

export async function close() {
  await jobs.whenIdle();
  await new Promise((r) => server.close(r));
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
}

// Inserts an article and puts each level straight into the given status, without calling the model.
export async function seedArticle(
  statuses = { k: "failed", g5: "failed", g10: "failed" },
) {
  const id = await repo.createArticle({
    title: "Water",
    uploadedBy: null,
    sourceType: "paste",
    originalFilename: null,
    extractedText: ARTICLE_TEXT,
    wordCount: 17,
    options: parseOptions({}),
  });
  for (const [level, status] of Object.entries(statuses)) {
    await repo.updateLevelOutput(id, level, {
      status,
      error: status === "failed" ? "boom" : null,
      contentJson:
        status === "ready"
          ? JSON.stringify({ title: "Saved", paragraphs: ["Old."] })
          : null,
    });
  }
  return id;
}

export const levelStatus = async (id, level) =>
  (await repo.getLevelOutput(id, level)).status;
export const usageRows = (id) =>
  getDb().all("SELECT * FROM usage WHERE article_id = ? ORDER BY id", id);
