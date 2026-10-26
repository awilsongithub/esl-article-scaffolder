// The "New article" form: options table, input mode toggle, word counter
// and submit.
// REACT: becomes <UploadForm />.
import { requestApi } from "./api.js";
import { createElement, findElement } from "./dom.js";
import { browserStorage, countWords } from "./format.js";
import { refreshUsageFooter } from "./polling.js";
import { appState } from "./state.js";

const SUBMIT_LABEL = "Create leveled versions";

/**
 * Wires up the upload form once /api/config has loaded:
 * limits, options table, languages and listeners.
 */
export function setupUploadForm() {
    const { limits, languages } = appState.config;
    const form = findElement("#upload-form");

    findElement("#title").maxLength = limits.maxTitleChars;
    findElement("#uploaded_by").maxLength = limits.maxUploaderChars;
    findElement("#text").maxLength = limits.maxPastedChars;
    findElement("#uploaded_by").value = browserStorage.get("uploadedBy") ?? "";

    const countRows = appState.config.levels.map(buildCountsTableRow);
    findElement("#counts-body").replaceChildren(...countRows);

    findElement("#language").replaceChildren(
        ...buildLanguageOptions(languages),
    );
    findElement("#translate").addEventListener("change", toggleLanguagePicker);

    for (const radio of form.querySelectorAll('input[name="mode"]')) {
        radio.addEventListener("change", () =>
            showFieldsForInputMode(form.mode.value),
        );
    }

    findElement("#text").addEventListener("input", updatePastedWordCount);
    updatePastedWordCount();

    form.addEventListener("submit", handleUploadSubmit);
}

/**
 * Builds one row of the options table:
 * level name, glossary-term count and question count.
 */
function buildCountsTableRow(level) {
    const termsSelect = buildCountSelect(
        `terms_${level.id}`,
        `${level.label} glossary terms`,
        level.defaults.terms,
    );
    const questionsSelect = buildCountSelect(
        `questions_${level.id}`,
        `${level.label} questions`,
        level.defaults.questions,
    );

    const labelCell = createElement("td", {}, level.label);
    const termsCell = createElement("td", {}, termsSelect);
    const questionsCell = createElement("td", {}, questionsSelect);
    return createElement("tr", {}, labelCell, termsCell, questionsCell);
}

/** Builds a <select> offering 0 (skip) up to the configured maximum count. */
function buildCountSelect(name, ariaLabel, selectedCount) {
    const { maxCount } = appState.config.limits;
    const options = [];
    for (let count = 0; count <= maxCount; count++) {
        const label = count === 0 ? "0 (skip)" : count;
        options.push(
            createElement(
                "option",
                { value: count, selected: count === selectedCount },
                label,
            ),
        );
    }
    return createElement("select", { name, "aria-label": ariaLabel }, options);
}

/**
 * Builds the translation-language <option>s,
 * starting with an empty "Choose language…" choice.
 */
function buildLanguageOptions(languages) {
    const placeholder = createElement(
        "option",
        { value: "" },
        "Choose language…",
    );
    const languageOptions = languages.map((language) =>
        createElement("option", { value: language }, language),
    );
    return [placeholder, ...languageOptions];
}

/** Shows the language picker only while glossary translation is ticked. */
function toggleLanguagePicker(event) {
    findElement("#language").hidden = !event.target.checked;
}

/**
 * Shows either the file input or the paste textarea,
 * depending on the chosen mode.
 */
function showFieldsForInputMode(mode) {
    const isPaste = mode === "paste";
    findElement("#file-field").hidden = isPaste;
    findElement("#paste-field").hidden = !isPaste;
}

/**
 * Updates the "N / 20,000 words" counter under the textarea.
 * Turns it red over the limit.
 */
function updatePastedWordCount() {
    const { maxWords } = appState.config.limits;
    const words = countWords(findElement("#text").value);
    const counter = findElement("#text-count");
    counter.textContent = `${words.toLocaleString()} / ${maxWords.toLocaleString()} words`;
    counter.classList.toggle("is-over-limit", words > maxWords);
}

/**
 * Checks the form before uploading, so obvious mistakes don't cost a
 * round trip.
 * Returns an error message, or null when the form looks valid.
 * The server checks everything again.
 */
function validateFormBeforeUpload(form) {
    const sourceProblem =
        form.mode.value === "paste"
            ? validatePastedText(form.text.value.trim())
            : validateUploadedFile(form.file.files[0]);
    if (sourceProblem) return sourceProblem;
    if (form.translate.checked && !form.language.value)
        return "Please choose a translation language.";
    return null;
}

/**
 * Returns an error message if the pasted text is empty or over the word
 * limit, else null.
 */
function validatePastedText(text) {
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
function validateUploadedFile(file) {
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
 * Submit handler: validates, uploads the article,
 * then opens its detail page.
 */
async function handleUploadSubmit(event) {
    event.preventDefault();
    const form = event.target;
    showFormError(null);

    const problem = validateFormBeforeUpload(form);
    if (problem) {
        showFormError(problem);
        return;
    }

    setSubmitButtonBusy(true);
    try {
        const { id } = await requestApi("/articles", {
            method: "POST",
            body: buildUploadFormData(form),
        });
        finishSuccessfulUpload(form, id);
    } catch (err) {
        showFormError(err.message);
    } finally {
        setSubmitButtonBusy(false);
        refreshUsageFooter();
    }
}

/**
 * Shows `message` in red above the submit button.
 * Hides the error when `message` is null.
 */
function showFormError(message) {
    const errorMessage = findElement("#form-error");
    errorMessage.textContent = message ?? "";
    errorMessage.hidden = !message;
}

/**
 * Disables the submit button and shows "Uploading…" while busy.
 * Restores it afterwards.
 */
function setSubmitButtonBusy(isBusy) {
    const submitButton = findElement("#submit-btn");
    submitButton.disabled = isBusy;
    submitButton.textContent = isBusy ? "Uploading…" : SUBMIT_LABEL;
}

/**
 * The form's fields, sending only the input for the chosen mode
 * (the pasted text or the file).
 */
function buildUploadFormData(form) {
    const formData = new FormData(form);
    formData.delete(form.mode.value === "paste" ? "file" : "text");
    return formData;
}

/**
 * Remembers the uploader's name, clears the form,
 * and opens the new article's page.
 */
function finishSuccessfulUpload(form, articleId) {
    browserStorage.set("uploadedBy", form.uploaded_by.value.trim());
    resetUploadForm(form);
    location.hash = `#/articles/${articleId}`;
}

/**
 * Clears the form after a successful upload.
 * Keeps the remembered "Uploaded by" name.
 */
function resetUploadForm(form) {
    form.reset();
    findElement("#uploaded_by").value = browserStorage.get("uploadedBy") ?? "";
    showFieldsForInputMode("file");
    findElement("#language").hidden = true;
    updatePastedWordCount();
}
