// The "New article" form: the article and its title, 1 to 3 version
// cards, and submit.
// REACT: becomes <UploadForm />, with <ArticleSection /> and
// <VersionCard /> children.
import { requestApi } from "./api.js";
import { buildArticleSection } from "./article-source.js";
import { createElement, findElement } from "./dom.js";
import { listenForTooltipDismissal } from "./form-controls.js";
import { browserStorage, countWords } from "./format.js";
import { createIcon } from "./icons.js";
import { releaseImagePreview } from "./image-picker.js";
import { refreshUsageFooter } from "./polling.js";
import { appState } from "./state.js";
import { buildUploadRequest, toFormData } from "./upload-request.js";
import { buildVersionCard, createVersionState } from "./version-card.js";

/**
 * Shows an empty upload form once /api/config has loaded, and starts
 * the page-wide listeners that close tooltips.
 */
export function setupUploadForm() {
    listenForTooltipDismissal();
    showEmptyUploadForm();
}

/**
 * Replaces the upload form with an empty one, keeping the remembered
 * "Uploaded by" name.
 */
function showEmptyUploadForm() {
    findElement("#upload-form-container").replaceChildren(
        buildUploadForm(createFormState()),
    );
}

/**
 * Everything the teacher enters, which buildUploadRequest turns into
 * the upload. Starts with one version card.
 */
function createFormState() {
    return {
        mode: "file",
        file: null,
        text: "",
        title: "",
        uploadedBy: browserStorage.get("uploadedBy") ?? "",
        versions: [createVersionState()],
    };
}

/** Builds the form: header, Article and Versions sections, footer. */
function buildUploadForm(formState) {
    const errorMessage = createElement("p", {
        class: "error form-error",
        role: "alert",
        hidden: true,
    });
    const submitButton = createElement("button", {
        type: "submit",
        class: "primary",
    });
    const showSubmitLabel = () => {
        submitButton.textContent = formatSubmitLabel(formState.versions.length);
    };

    const footer = createElement(
        "div",
        { class: "form-footer" },
        errorMessage,
        submitButton,
        createElement(
            "span",
            { class: "muted footer-note" },
            "Answer keys are included with every version.",
        ),
    );
    return createElement(
        "form",
        {
            class: "upload-form",
            novalidate: true,
            "aria-labelledby": "upload-form-title",
            onsubmit: (event) => {
                event.preventDefault();
                submitUpload(formState, { errorMessage, submitButton });
            },
        },
        buildFormHeader(),
        buildArticleSection(formState),
        buildVersionsSection(formState, showSubmitLabel),
        footer,
    );
}

/** "Create 1 version", "Create 3 versions". */
function formatSubmitLabel(versionCount) {
    return `Create ${versionCount} ${versionCount === 1 ? "version" : "versions"}`;
}

/** The form's title and one-line explanation. */
function buildFormHeader() {
    const { maxVersions } = appState.config;
    return createElement(
        "header",
        { class: "form-header" },
        createElement("h1", { id: "upload-form-title" }, "New article"),
        createElement(
            "p",
            { class: "form-subtitle" },
            `Create up to ${maxVersions} leveled versions from one article.`,
        ),
    );
}

/**
 * The Versions section: a card per version, then "Add version", or a
 * note once the maximum is reached.
 * Calls `onCountChange()` whenever a version is added or removed.
 */
function buildVersionsSection(formState, onCountChange) {
    const { maxVersions } = appState.config;
    const versionCount = createElement("span", { class: "muted" });
    const cardList = createElement("div", { class: "version-list" });
    const addButton = createElement(
        "button",
        { type: "button", class: "add-version", onclick: addVersion },
        createIcon("addVersion"),
        "Add version",
    );
    const maximumNote = createElement(
        "p",
        { class: "muted maximum-note" },
        `You’ve reached the maximum of ${maxVersions} versions.`,
    );

    /** Rebuilds the cards from `formState.versions`, numbered in order. */
    function showVersions() {
        const { versions } = formState;
        const canRemove = versions.length > 1;
        cardList.replaceChildren(
            ...versions.map((version, index) =>
                buildVersionCard({
                    version,
                    number: index + 1,
                    onRemove: canRemove ? () => removeVersion(version) : null,
                }),
            ),
        );
        const isFull = versions.length >= maxVersions;
        addButton.hidden = isFull;
        maximumNote.hidden = !isFull;
        versionCount.textContent = `${versions.length} of ${maxVersions}`;
        onCountChange();
    }

    /**
     * Adds a card with the default options and opens it, collapsing the
     * others so the form stays short. Focuses its first field.
     */
    function addVersion() {
        for (const version of formState.versions) version.isCollapsed = true;
        formState.versions = [...formState.versions, createVersionState()];
        showVersions();
        cardList.lastElementChild.querySelector("select").focus();
    }

    /**
     * Removes a card. Later cards move up a number.
     * Focus goes to "Add version", which is always shown afterwards.
     */
    function removeVersion(versionToRemove) {
        releaseImagePreview(versionToRemove);
        formState.versions = formState.versions.filter(
            (version) => version !== versionToRemove,
        );
        showVersions();
        addButton.focus();
    }

    showVersions();
    const header = createElement(
        "div",
        { class: "section-header" },
        createElement("h2", { id: "versions-heading" }, "Versions"),
        versionCount,
    );
    return createElement(
        "section",
        { class: "form-section", "aria-labelledby": "versions-heading" },
        header,
        cardList,
        addButton,
        maximumNote,
    );
}

/**
 * Checks the form, uploads the article, then opens its detail page.
 * Shows the first problem, or the server's error, above the submit
 * button.
 */
async function submitUpload(formState, { errorMessage, submitButton }) {
    const problem = findFormProblem(formState);
    showFormError(errorMessage, problem);
    if (problem) return;

    const idleLabel = submitButton.textContent;
    submitButton.disabled = true;
    submitButton.textContent = "Uploading…";
    try {
        const { id } = await requestApi("/articles", {
            method: "POST",
            body: toFormData(buildUploadRequest(formState)),
        });
        finishSuccessfulUpload(formState, id);
    } catch (err) {
        showFormError(errorMessage, err.message);
        submitButton.disabled = false;
        submitButton.textContent = idleLabel;
    } finally {
        refreshUsageFooter();
    }
}

/**
 * Shows `message` in the form's error box.
 * Hides the box when `message` is null.
 */
function showFormError(errorMessage, message) {
    errorMessage.textContent = message ?? "";
    errorMessage.hidden = !message;
}

/**
 * Checks the form before uploading, so obvious mistakes don't cost a
 * round trip. Image types and sizes are checked when they're chosen.
 * Returns an error message, or null when the form looks valid.
 * The server checks everything again.
 */
function findFormProblem(formState) {
    const sourceProblem =
        formState.mode === "paste"
            ? findPastedTextProblem(formState.text.trim())
            : findArticleFileProblem(formState.file);
    if (sourceProblem) return sourceProblem;
    if (!formState.title.trim()) return "Title is required.";
    if (!formState.uploadedBy.trim()) return "Uploaded by is required.";
    return null;
}

/**
 * Returns an error message if the pasted text is empty or over the word
 * limit, else null.
 */
function findPastedTextProblem(text) {
    const { maxWords } = appState.config.limits;
    if (!text) return "Please paste the article text.";
    const words = countWords(text);
    if (words > maxWords)
        return `This article has ${words.toLocaleString()} words. The limit is ${maxWords.toLocaleString()} words.`;
    return null;
}

/**
 * Returns an error message if no file is chosen, or its type or size
 * isn't allowed, else null.
 */
function findArticleFileProblem(file) {
    const { allowedExtensions, maxFileBytes } = appState.config.limits;
    if (!file) return "Please choose a file to upload.";
    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!allowedExtensions.includes(extension))
        return `Unsupported file type. Please upload ${allowedExtensions.join(", ")}.`;
    if (file.size > maxFileBytes)
        return `File is too large. The limit is ${maxFileBytes / 1024 / 1024} MB.`;
    return null;
}

/**
 * Remembers the uploader's name, empties the form,
 * and opens the new article's page.
 */
function finishSuccessfulUpload(formState, articleId) {
    browserStorage.set("uploadedBy", formState.uploadedBy.trim());
    for (const version of formState.versions) releaseImagePreview(version);
    showEmptyUploadForm();
    location.hash = `#/articles/${articleId}`;
}
