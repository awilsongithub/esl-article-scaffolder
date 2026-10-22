import assert from "node:assert/strict";
import { after, test } from "node:test";
import {
    ARTICLE_TEXT,
    budget,
    close,
    getDb,
    prompt,
    repo,
    seedArticle,
} from "./helpers.js";
import { buildDocx } from "../server/services/docx.js";
import {
    ExtractError,
    deriveTitle,
    extractText,
} from "../server/services/extract.js";

after(close);

test("extractText reads .docx, rejects unknown types and empty files", async () => {
    const content = {
        title: "Water",
        paragraphs: ["Water moves."],
        glossary: [],
        multipleChoice: [],
        shortAnswer: [],
    };
    const docx = await buildDocx({
        content,
        levelId: "g5",
        originalTitle: "Water",
        translationLanguage: null,
    });
    assert.match(await extractText(docx, "lesson.DOCX"), /Water moves\./);
    await assert.rejects(
        extractText(Buffer.from("x"), "notes.rtf"),
        ExtractError,
    );
    await assert.rejects(
        extractText(Buffer.from(" \n "), "empty.txt"),
        /No text found in this file/,
    );
});

test("deriveTitle: heading, then short first line, then filename", () => {
    assert.equal(
        deriveTitle("Intro\n# Real Title\nBody", "a.txt"),
        "Real Title",
    );
    assert.equal(deriveTitle("Short line\nBody", "a.txt"), "Short line");
    assert.equal(
        deriveTitle(`${"word ".repeat(20)}\nBody`, "notes.txt"),
        "notes",
    );
});

test("claimLevels: parallel claims of one failed row → exactly one winner", async () => {
    const id = await seedArticle();
    const results = await Promise.all(
        Array.from({ length: 5 }, () =>
            repo.claimLevels(id, ["g5"], ["failed"]),
        ),
    );
    assert.deepEqual(results.flat(), ["g5"]);
    assert.equal((await repo.getLevelOutput(id, "g5")).status, "pending");
});

test("updateLevelOutput with expectStatus only writes when the status matches", async () => {
    const id = await seedArticle({ g5: "ready" });
    assert.equal(
        await repo.updateLevelOutput(id, "g5", {
            status: "failed",
            expectStatus: "processing",
        }),
        false,
    );
    assert.equal((await repo.getLevelOutput(id, "g5")).status, "ready");
});

test("budget.reserve: two parallel reservations that only fit once → one wins", async () => {
    const per = budget.estimateCallUsd(ARTICLE_TEXT);
    await repo.addUsage({
        day: budget.today(),
        articleId: null,
        level: null,
        model: "x",
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 1 - per * 1.5,
    });
    try {
        const results = await Promise.allSettled([
            budget.reserve(ARTICLE_TEXT, 1),
            budget.reserve(ARTICLE_TEXT, 1),
        ]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        assert.ok(
            results.find((r) => r.status === "rejected").reason instanceof
                budget.BudgetError,
        );
        budget.release(per);
        assert.equal(budget.reservedTotal(), 0);
    } finally {
        await getDb().run("DELETE FROM usage WHERE article_id IS NULL");
    }
});

test("buildPrompt: level guidance, article wrapper, schema follows translation", () => {
    const counts = { terms: 5, questions: 5 };
    const k = prompt.buildPrompt({
        text: "Hello.",
        levelId: "k",
        counts,
        translationLanguage: null,
    });
    assert.match(k.system, /Reading level: Kindergarten/);
    assert.match(k.messages[0].content, /<article>\nHello\.\n<\/article>/);
    assert.match(
        k.messages[0].content,
        /"short_answer": return an empty array/,
    );
    assert.equal(
        k.outputFormat.schema.properties.glossary.items.properties
            .translated_term,
        undefined,
    );

    const g10 = prompt.buildPrompt({
        text: "Hello.",
        levelId: "g10",
        counts,
        translationLanguage: "Spanish",
    });
    // 5 questions → 3 MC + 2 short answer
    assert.match(g10.messages[0].content, /exactly 3 questions/);
    assert.match(g10.messages[0].content, /in Spanish/);
    assert.ok(
        g10.outputFormat.schema.properties.glossary.items.properties
            .translated_term,
    );
});
