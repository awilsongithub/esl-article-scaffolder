// The "New article" form: options table, input mode toggle, word counter and submit.
// REACT: becomes <UploadForm />.
import { requestApi } from "./api.js";
import { createElement, findElement } from "./dom.js";
import { browserStorage, countWords } from "./format.js";
import { refreshUsageFooter } from "./polling.js";
import { appState } from "./state.js";

const SUBMIT_LABEL = "Create leveled versions";

/** Wires up the upload form once /api/config has loaded: limits, options table, languages and listeners. */
export function setupUploadForm() {
  const { limits, languages } = appState.config;
  const form = findElement("#upload-form");

  findElement("#title").maxLength = limits.maxTitleChars;
  findElement("#uploaded_by").maxLength = limits.maxUploaderChars;
  findElement("#text").maxLength = limits.maxPastedChars;
  findElement("#uploaded_by").value = browserStorage.get("uploadedBy") ?? "";

  const countRows = appState.config.levels.map(buildCountsTableRow);
  findElement("#counts-body").replaceChildren(...countRows);

  findElement("#language").replaceChildren(...buildLanguageOptions(languages));
  findElement("#translate").addEventListener("change", toggleLanguagePicker);

  for (const radio of form.querySelectorAll('input[name="mode"]')) {
    radio.addEventListener("change", () => showFieldsForInputMode(form.mode.value));
  }

  findElement("#text").addEventListener("input", updatePastedWordCount);
  updatePastedWordCount();

  form.addEventListener("submit", handleUploadSubmit);
}

/** Builds one row of the options table: level name, glossary-term count and question count. */
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
      createElement("option", { value: count, selected: count === selectedCount }, label),
    );
  }
  return createElement("select", { name, "aria-label": ariaLabel }, options);
}

/** Builds the translation-language <option>s, starting with an empty "Choose language…" choice. */
function buildLanguageOptions(languages) {
  const placeholder = createElement("option", { value: "" }, "Choose language…");
  const languageOptions = languages.map((language) =>
    createElement("option", { value: language }, language),
  );
  return [placeholder, ...languageOptions];
}

/** Shows the language picker only while "Add glossary translation" is ticked. */
function toggleLanguagePicker(event) {
  findElement("#language").hidden = !event.target.checked;
}

/** Shows either the file input or the paste textarea, depending on the chosen mode. */
function showFieldsForInputMode(mode) {
  const isPaste = mode === "paste";
  findElement("#file-field").hidden = isPaste;
  findElement("#paste-field").hidden = !isPaste;
}

/** Updates the "N / 20,000 words" counter under the textarea, turning it red over the limit. */
function updatePastedWordCount() {
  const { maxWords } = appState.config.limits;
  const words = countWords(findElement("#text").value);
  const counter = findElement("#text-count");
  counter.textContent = `${words.toLocaleString()} / ${maxWords.toLocaleString()} words`;
  counter.style.color = words > maxWords ? "var(--danger)" : "";
}

/**
 * Checks the form before uploading, so obvious mistakes don't cost a round trip.
 * Returns an error message, or null when the form looks valid. The server checks everything again.
 */
function validateFormBeforeUpload(form) {
  const { limits } = appState.config;
  if (form.mode.value === "paste") {
    const text = form.text.value.trim();
    if (!text) return "Please paste the article text.";
    const words = countWords(text);
    if (words > limits.maxWords)
      return `This article has ${words.toLocaleString()} words. The limit is ${limits.maxWords.toLocaleString()} words.`;
  } else {
    const file = form.file.files[0];
    if (!file) return "Please choose a file to upload.";
    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!limits.allowedExtensions.includes(extension))
      return `Unsupported file type. Please upload ${limits.allowedExtensions.join(", ")}.`;
    if (file.size > limits.maxFileBytes)
      return `File is too large. The limit is ${limits.maxFileBytes / 1024 / 1024} MB.`;
  }
  if (form.translate.checked && !form.language.value)
    return "Please choose a translation language.";
  return null;
}

/** Submit handler: validates, uploads the article, then opens its detail page. */
async function handleUploadSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const errorMessage = findElement("#form-error");
  errorMessage.hidden = true;

  const problem = validateFormBeforeUpload(form);
  if (problem) {
    errorMessage.textContent = problem;
    errorMessage.hidden = false;
    return;
  }

  // Send only the input for the chosen mode.
  const formData = new FormData(form);
  if (form.mode.value === "paste") formData.delete("file");
  else formData.delete("text");

  const submitButton = findElement("#submit-btn");
  submitButton.disabled = true;
  submitButton.textContent = "Uploading…";
  try {
    const { id } = await requestApi("/articles", { method: "POST", body: formData });
    browserStorage.set("uploadedBy", form.uploaded_by.value.trim());
    resetUploadForm(form);
    location.hash = `#/articles/${id}`;
  } catch (err) {
    errorMessage.textContent = err.message;
    errorMessage.hidden = false;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = SUBMIT_LABEL;
    refreshUsageFooter();
  }
}

/** Clears the form after a successful upload, keeping the remembered "Uploaded by" name. */
function resetUploadForm(form) {
  form.reset();
  findElement("#uploaded_by").value = browserStorage.get("uploadedBy") ?? "";
  showFieldsForInputMode("file");
  findElement("#language").hidden = true;
  updatePastedWordCount();
}
