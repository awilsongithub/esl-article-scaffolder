// The "Article" section of the upload form: upload a file or paste the
// text, then the title and who uploaded it.
// REACT: becomes <ArticleSection />.
import { createElement } from "./dom.js";
import { buildFieldLabel, buildLabelNote } from "./form-controls.js";
import { countWords } from "./format.js";
import { createIcon } from "./icons.js";
import { appState } from "./state.js";

/**
 * Builds the Article section, saving what the teacher enters into
 * `formState` (mode, file, text, title, uploadedBy).
 */
export function buildArticleSection(formState) {
    const dropZone = buildFileDropZone(formState);
    const pasteField = buildPasteField(formState);
    const modeToggle = buildModeToggle(formState.mode, (mode) => {
        formState.mode = mode;
        dropZone.hidden = mode === "paste";
        pasteField.hidden = mode !== "paste";
    });
    const header = createElement(
        "div",
        { class: "section-header" },
        createElement("h2", { id: "article-heading" }, "Article"),
        modeToggle,
    );
    return createElement(
        "section",
        { class: "form-section", "aria-labelledby": "article-heading" },
        header,
        dropZone,
        pasteField,
        buildTitleAndUploaderFields(formState),
    );
}

/**
 * The Upload file / Paste text segmented control: radio buttons styled
 * as one pill. Calls `onChange(mode)` with "file" or "paste".
 */
function buildModeToggle(selectedMode, onChange) {
    const choices = [
        { mode: "file", label: "Upload file" },
        { mode: "paste", label: "Paste text" },
    ].map(({ mode, label }) => {
        const radio = createElement("input", {
            type: "radio",
            name: "mode",
            value: mode,
            checked: mode === selectedMode,
            onchange: () => onChange(mode),
        });
        return createElement("label", {}, radio, label);
    });
    return createElement(
        "div",
        {
            class: "mode-toggle",
            role: "radiogroup",
            "aria-label": "Article source",
        },
        choices,
    );
}

/**
 * The dashed drop zone for the article file, with a button that opens
 * the file chooser. Shows the chosen file's name.
 * The file's type and size are checked on submit.
 */
function buildFileDropZone(formState) {
    const { allowedExtensions, maxWords } = appState.config.limits;
    const fileInput = createElement("input", {
        type: "file",
        accept: allowedExtensions.join(","),
        hidden: true,
        onchange: () => chooseFile(fileInput.files[0]),
    });
    const title = createElement(
        "span",
        { class: "drop-zone-title", "aria-live": "polite" },
        "Drop a file here",
    );
    const chooseButton = createElement(
        "button",
        { type: "button", onclick: () => fileInput.click() },
        "Choose file",
    );
    const text = createElement(
        "div",
        { class: "drop-zone-text" },
        title,
        createElement(
            "span",
            { class: "muted" },
            `PDF, Word, .txt or .md · up to ${maxWords.toLocaleString()} words`,
        ),
    );
    const dropZone = createElement(
        "div",
        {
            class: "drop-zone",
            hidden: formState.mode === "paste",
            ondragover: (event) => {
                event.preventDefault();
                dropZone.classList.add("is-dragging");
            },
            ondragleave: (event) => {
                if (!dropZone.contains(event.relatedTarget))
                    dropZone.classList.remove("is-dragging");
            },
            ondrop: (event) => {
                event.preventDefault();
                dropZone.classList.remove("is-dragging");
                chooseFile(event.dataTransfer.files[0]);
            },
        },
        createElement("div", { class: "drop-zone-icon" }, createIcon("upload")),
        text,
        chooseButton,
        fileInput,
    );

    /** Keeps `file` as the article and shows its name. */
    function chooseFile(file) {
        if (!file) return;
        formState.file = file;
        title.textContent = file.name;
        chooseButton.textContent = "Choose another file";
        dropZone.classList.add("has-file");
    }

    return dropZone;
}

/**
 * The textarea for pasted text, with a live "N / 20,000 words" count
 * that turns red over the limit.
 */
function buildPasteField(formState) {
    const { maxWords, maxPastedChars } = appState.config.limits;
    const wordCount = buildLabelNote("");
    const textarea = createElement("textarea", {
        id: "article-text",
        rows: 10,
        maxlength: maxPastedChars,
        placeholder: "Paste the article here…",
        oninput: () => {
            formState.text = textarea.value;
            showWordCount();
        },
    });

    /** Updates the word count under the limit, or in red over it. */
    function showWordCount() {
        const words = countWords(formState.text);
        wordCount.textContent = `${words.toLocaleString()} / ${maxWords.toLocaleString()} words`;
        wordCount.classList.toggle("is-over-limit", words > maxWords);
    }

    showWordCount();
    return createElement(
        "div",
        { class: "field", hidden: formState.mode !== "paste" },
        buildFieldLabel({
            forId: "article-text",
            children: ["Article text ", wordCount],
        }),
        textarea,
    );
}

/**
 * The required title (one for all versions) and "Uploaded by" fields.
 * "Uploaded by" starts with the name remembered from the last upload.
 */
function buildTitleAndUploaderFields(formState) {
    const { maxTitleChars, maxUploaderChars } = appState.config.limits;
    const titleInput = createElement("input", {
        type: "text",
        id: "article-title",
        required: true,
        maxlength: maxTitleChars,
        placeholder: "Example: Fox Feeding Habits Grades 1, 3 and 6",
        "aria-describedby": "article-title-info",
        oninput: () => {
            formState.title = titleInput.value;
        },
    });
    const uploaderInput = createElement("input", {
        type: "text",
        id: "uploaded-by",
        required: true,
        maxlength: maxUploaderChars,
        autocomplete: "name",
        value: formState.uploadedBy,
        oninput: () => {
            formState.uploadedBy = uploaderInput.value;
        },
    });
    const titleLabel = buildFieldLabel({
        forId: "article-title",
        children: ["Title"],
        info: {
            tooltipId: "article-title-info",
            buttonLabel: "About the title",
            text: "One title covers every version, so name the topic and the grades.",
        },
    });
    const uploaderLabel = buildFieldLabel({
        forId: "uploaded-by",
        children: ["Uploaded by"],
    });
    return createElement(
        "div",
        { class: "article-fields" },
        createElement(
            "div",
            { class: "field field-title" },
            titleLabel,
            titleInput,
        ),
        createElement(
            "div",
            { class: "field field-uploader" },
            uploaderLabel,
            uploaderInput,
        ),
    );
}
