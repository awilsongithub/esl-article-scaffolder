import assert from "node:assert/strict";
import fs from "node:fs";
import { after, beforeEach, test } from "node:test";
import {
    budget,
    close,
    fake,
    jobs,
    levelStatus,
    postForm,
    repo,
} from "./helpers.js";

after(close);
beforeEach(() => fake.reset());

test("paste upload → 201, article saved with derived title, 3 levels generated", async () => {
    const form = new FormData();
    form.set("mode", "paste");
    form.set("text", "# The Water Cycle\n\nWater moves around the Earth.");
    form.set("uploaded_by", "Ms Lee");
    form.set("terms_k", "3");

    const res = await postForm("/articles", form);
    assert.equal(res.status, 201);
    await jobs.whenIdle();

    const article = await repo.getArticle(res.body.id);
    assert.equal(article.title, "The Water Cycle");
    assert.equal(article.uploadedBy, "Ms Lee");
    assert.equal(article.sourceType, "paste");
    assert.equal(article.hasOriginalFile, false);
    assert.equal(article.options.counts.k.terms, 3);
    assert.equal(fake.calls, 3);
    for (const level of ["k", "g5", "g10"])
        assert.equal(await levelStatus(res.body.id, level), "ready");
    assert.ok(budget.reservedTotal() < 1e-9, "no budget left reserved");
});

test("file upload → 201, original file kept, title from the form", async () => {
    const form = new FormData();
    form.set("mode", "file");
    form.set("title", "Rain");
    form.set("file", new Blob(["Rain falls from clouds."]), "rain.txt");

    const res = await postForm("/articles", form);
    assert.equal(res.status, 201);
    await jobs.whenIdle();

    const article = await repo.getArticleInternal(res.body.id);
    assert.equal(article.title, "Rain");
    assert.equal(article.original_filename, "rain.txt");
    assert.equal(
        fs.readFileSync(article.original_path, "utf8"),
        "Rain falls from clouds.",
    );
});

test("validation errors → 400 and nothing is saved or reserved", async () => {
    const before = (await repo.listArticles("")).length;
    const cases = [
        [{ mode: "paste", text: "   " }, /paste the article text/],
        [{ mode: "file" }, /choose a file/],
        [{ mode: "paste", text: "word ".repeat(20001) }, /20,001 words/],
        [
            { mode: "paste", text: "Hi.", translate: "on" },
            /translation language/,
        ],
    ];
    for (const [fields, expected] of cases) {
        const form = new FormData();
        for (const [key, value] of Object.entries(fields)) form.set(key, value);
        const res = await postForm("/articles", form);
        assert.equal(res.status, 400);
        assert.match(res.body.error, expected);
    }
    assert.equal((await repo.listArticles("")).length, before);
    assert.equal(fake.calls, 0);
    assert.ok(budget.reservedTotal() < 1e-9, "no budget left reserved");
});
