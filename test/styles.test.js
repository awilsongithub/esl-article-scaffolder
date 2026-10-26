// Style rules from the article-form plan (requirement 5):
// raw design values live only in tokens.css,
// and the frontend never sets styles inline.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const PUBLIC_DIR = path.join(import.meta.dirname, "..", "public");
const STYLES_DIR = path.join(PUBLIC_DIR, "assets", "styles");

/** Paths of the files under `dir` whose names end with `extension`. */
function listFiles(dir, extension) {
    return fs
        .readdirSync(dir, { recursive: true })
        .filter((name) => name.endsWith(extension))
        .map((name) => path.join(dir, name));
}

test("index.html loads tokens.css, then styles.css", () => {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, "index.html"), "utf8");

    const stylesheets = [
        ...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g),
    ].map((match) => match[1]);

    assert.deepEqual(stylesheets, [
        "assets/styles/tokens.css",
        "assets/styles/styles.css",
    ]);
    for (const href of stylesheets)
        assert.ok(fs.existsSync(path.join(PUBLIC_DIR, href)), href);
});

test("only tokens.css holds raw colors", () => {
    const cssFiles = listFiles(PUBLIC_DIR, ".css").filter(
        (file) => path.basename(file) !== "tokens.css",
    );

    const filesWithRawColors = cssFiles.filter((file) =>
        /#[0-9a-f]{3,8}\b|\b(rgb|rgba|hsl|hsla)\(/i.test(
            fs.readFileSync(file, "utf8"),
        ),
    );

    assert.ok(cssFiles.length > 0);
    assert.deepEqual(filesWithRawColors, []);
});

test("tokens.css is the only file that defines custom properties", () => {
    const tokens = fs.readFileSync(path.join(STYLES_DIR, "tokens.css"), "utf8");
    const styles = fs.readFileSync(path.join(STYLES_DIR, "styles.css"), "utf8");

    assert.match(tokens, /--black-ish: #141414;/);
    assert.doesNotMatch(styles, /^\s*--[\w-]+\s*:/m);
});

test("no inline styles in the frontend's HTML or JavaScript", () => {
    const htmlWithStyles = listFiles(PUBLIC_DIR, ".html").filter((file) =>
        /<style|\sstyle=/i.test(fs.readFileSync(file, "utf8")),
    );
    const scriptsWithStyles = listFiles(PUBLIC_DIR, ".js").filter((file) =>
        /\.style\b|\bstyle\s*:/.test(fs.readFileSync(file, "utf8")),
    );

    assert.deepEqual(htmlWithStyles, []);
    assert.deepEqual(scriptsWithStyles, []);
});
