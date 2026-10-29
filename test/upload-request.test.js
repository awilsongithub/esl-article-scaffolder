// The frontend's side of the versions contract (ticket 1): the upload
// form's state must turn into the fixture requests in test/contracts/.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { buildUploadRequest, toFormData } from "../public/js/upload-request.js";

const CONTRACTS_DIR = path.join(import.meta.dirname, "contracts");

/** The parsed JSON fixture `name` from test/contracts/. */
function readContract(name) {
    return JSON.parse(fs.readFileSync(path.join(CONTRACTS_DIR, name), "utf8"));
}

/**
 * A version card's state as the form holds it, with the contract's
 * options plus the form-only fields.
 */
function versionState(options, image = null) {
    return {
        ...options,
        image,
        imagePreviewUrl: image && "blob:preview",
        isCollapsed: false,
    };
}

test("pasted text, 3 versions and 2 images build upload-request.json", () => {
    const fixture = readContract("upload-request.json");
    const foxDen = new File([new Uint8Array(245760)], "fox-den.png", {
        type: "image/png",
    });
    const foxHunting = new File([new Uint8Array(1048576)], "fox-hunting.jpg", {
        type: "image/jpeg",
    });
    const formState = {
        mode: "paste",
        file: null,
        text: fixture.fields.text,
        title: "  Fox Feeding Habits Grades 1, 3 and 6 ",
        uploadedBy: "Adam Wilson ",
        versions: [
            versionState(
                {
                    grade: "g1",
                    questions: 3,
                    terms: 3,
                    translationLanguage: "Spanish",
                    summary: true,
                    sections: false,
                    cloze: true,
                },
                foxDen,
            ),
            versionState({
                grade: "g3",
                questions: 4,
                terms: 4,
                translationLanguage: "Spanish",
                summary: false,
                sections: true,
                cloze: false,
            }),
            versionState(
                {
                    grade: "g6",
                    questions: 4,
                    terms: 4,
                    translationLanguage: null,
                    summary: true,
                    sections: true,
                    cloze: true,
                },
                foxHunting,
            ),
        ],
    };

    const { fields, files } = buildUploadRequest(formState);

    assert.deepEqual(fields, fixture.fields);
    assert.deepEqual(Object.keys(files), Object.keys(fixture.files));
    assert.deepEqual(
        {
            filename: files.image_1.name,
            contentType: files.image_1.type,
            sizeBytes: files.image_1.size,
        },
        fixture.files.image_1,
    );
    assert.deepEqual(
        {
            filename: files.image_3.name,
            contentType: files.image_3.type,
            sizeBytes: files.image_3.size,
        },
        fixture.files.image_3,
    );
});

test("an uploaded file and 1 plain version build upload-request-minimal.json", async () => {
    const fixture = readContract("upload-request-minimal.json");
    const articleFile = new File(
        ["Foxes eat mice, berries and insects."],
        "foxes.txt",
        { type: "text/plain" },
    );
    const formState = {
        mode: "file",
        file: articleFile,
        text: "Pasted earlier, then switched to a file",
        title: "Foxes",
        uploadedBy: "Adam Wilson",
        versions: [
            versionState({
                grade: "k",
                questions: 0,
                terms: 0,
                translationLanguage: null,
                summary: false,
                sections: false,
                cloze: false,
            }),
        ],
    };

    const { fields, files } = buildUploadRequest(formState);

    assert.deepEqual(fields, fixture.fields);
    assert.deepEqual(Object.keys(files), ["file"]);
    assert.deepEqual(
        {
            filename: files.file.name,
            contentType: files.file.type,
            text: await files.file.text(),
        },
        fixture.files.file,
    );
});

test("toFormData sends versions as a JSON string and the files as parts", () => {
    const image = new File([new Uint8Array(8)], "fox.png", {
        type: "image/png",
    });
    const request = {
        fields: {
            title: "Foxes",
            uploaded_by: "Adam Wilson",
            mode: "paste",
            text: "Foxes eat mice.",
            versions: [{ number: 1, grade: "k" }],
        },
        files: { image_1: image },
    };

    const formData = toFormData(request);

    assert.equal(formData.get("title"), "Foxes");
    assert.equal(formData.get("text"), "Foxes eat mice.");
    assert.equal(formData.get("versions"), '[{"number":1,"grade":"k"}]');
    assert.equal(formData.get("image_1").name, "fox.png");
    assert.equal(formData.get("file"), null);
});
