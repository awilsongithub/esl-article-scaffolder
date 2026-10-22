// One article's page: header, original file, a card per level,
// and the open preview.
// REACT: becomes <ArticleDetail id={…} /> with <LevelCard /> children.
import { requestApi } from "./api.js";
import { createElement, createErrorMessage, findElement } from "./dom.js";
import {
    createStatusBadge,
    formatSqliteDate,
    getLevelLabel,
} from "./format.js";
import { renderLevelPreview } from "./level-preview.js";
import { refreshUsageFooter, schedulePolling } from "./polling.js";
import { appState } from "./state.js";

/**
 * Loads an article and renders its detail page.
 * Keeps polling while any level is still processing.
 */
export async function renderArticleDetail(articleId) {
    const detail = findElement("#detail");
    let article;
    try {
        article = await requestApi(`/articles/${articleId}`);
    } catch (err) {
        detail.replaceChildren(createErrorMessage(err.message));
        return;
    }

    const header = buildDetailHeader(article);
    const originalFileRow = buildOriginalFileRow(article);
    const retryAllFailed = buildRetryAllFailedLevels(article);
    const levelCards = article.levels.map((level) =>
        buildLevelCard(article, level),
    );
    const levelGrid = createElement("div", { class: "levels" }, levelCards);
    const previewContainer = createElement("div", { id: "preview" });

    const card = createElement(
        "section",
        { class: "card" },
        header,
        originalFileRow,
        retryAllFailed,
        levelGrid,
        previewContainer,
    );
    detail.replaceChildren(card);

    const openLevel = article.levels.find(
        (level) => level.level === appState.openPreviewLevel,
    );
    if (openLevel?.status === "ready") {
        renderLevelPreview(
            article.id,
            openLevel.level,
            article.options.translationLanguage,
            previewContainer,
        );
    }

    const stillOnThisPage = location.hash === `#/articles/${articleId}`;
    if (stillOnThisPage && article.status === "processing") {
        schedulePolling(() => renderArticleDetail(articleId));
    }
}

/**
 * Builds the title, the "uploaded by · date · words · translation" line,
 * and the Delete button.
 */
function buildDetailHeader(article) {
    const { translationLanguage } = article.options;
    const metaText = [
        article.uploadedBy ? `Uploaded by ${article.uploadedBy}` : null,
        formatSqliteDate(article.createdAt),
        `${article.wordCount.toLocaleString()} words`,
        translationLanguage
            ? `Glossary translation: ${translationLanguage}`
            : null,
    ]
        .filter(Boolean)
        .join(" · ");

    const title = createElement("h2", {}, article.title);
    const meta = createElement("p", { class: "muted" }, metaText);
    const titleBlock = createElement("div", {}, title, meta);
    const deleteButton = createElement(
        "button",
        { class: "danger", onclick: () => deleteArticleAfterConfirm(article) },
        "Delete article",
    );
    return createElement(
        "div",
        { class: "detail-head" },
        titleBlock,
        deleteButton,
    );
}

/**
 * Builds the "Original:" row:
 * a download link for uploaded files, or a note for pasted text.
 */
function buildOriginalFileRow(article) {
    const label = createElement("strong", {}, "Original:");
    const value = article.hasOriginalFile
        ? createElement(
              "a",
              { class: "button", href: `/api/articles/${article.id}/original` },
              `Download ${article.originalFilename}`,
          )
        : createElement("span", { class: "muted" }, "Pasted text (no file)");
    return createElement("div", { class: "original" }, label, value);
}

/**
 * Builds the "Try again for all N failed levels" button.
 * Only shown when more than one level failed.
 */
function buildRetryAllFailedLevels(article) {
    const failedCount = article.levels.filter(
        (level) => level.status === "failed",
    ).length;
    if (failedCount < 2) return null;

    const button = createElement(
        "button",
        {
            class: "primary",
            onclick: (event) =>
                sendRetryOrRegenerate(
                    event,
                    "all",
                    article.id,
                    `/articles/${article.id}/retry`,
                ),
        },
        `Try again for all ${failedCount} failed levels`,
    );
    const error = appState.actionErrors.all
        ? createErrorMessage(appState.actionErrors.all)
        : null;
    return createElement("div", { class: "retry-all" }, button, error);
}

/**
 * Builds one level's card:
 * heading with status, counts, loader or errors, and the action buttons.
 */
function buildLevelCard(article, level) {
    const isBusy = level.status === "pending" || level.status === "processing";
    const counts = article.options.counts[level.level];

    const heading = createElement(
        "h3",
        {},
        getLevelLabel(level.level),
        createStatusBadge(level.status),
    );
    const countsText = createElement(
        "div",
        { class: "muted" },
        `${counts.terms} glossary terms · ${counts.questions} questions`,
    );
    const loader = isBusy ? buildProcessingLoader() : null;
    const failureReason =
        level.status === "failed" && level.error
            ? createErrorMessage(level.error)
            : null;
    const actionError = appState.actionErrors[level.level]
        ? createErrorMessage(appState.actionErrors[level.level])
        : null;
    const actions = buildLevelCardActions(article, level, isBusy);

    return createElement(
        "div",
        { class: "level-card" },
        heading,
        countsText,
        loader,
        failureReason,
        actionError,
        actions,
    );
}

/**
 * Builds the spinning "Processing…" line,
 * shown while a level is being generated.
 */
function buildProcessingLoader() {
    const spinner = createElement("span", {
        class: "spinner",
        "aria-hidden": "true",
    });
    return createElement(
        "p",
        { class: "processing", role: "status" },
        spinner,
        "Processing…",
    );
}

/**
 * Builds a level card's buttons:
 * Preview, Download .docx, and Try Again (failed) or Regenerate.
 */
function buildLevelCardActions(article, level, isBusy) {
    const isReady = level.status === "ready";
    const isPreviewOpen = appState.openPreviewLevel === level.level;
    const levelPath = `/articles/${article.id}/levels/${level.level}`;

    const previewButton = createElement(
        "button",
        {
            disabled: !isReady,
            onclick: () => togglePreview(article.id, level.level),
        },
        isPreviewOpen ? "Hide preview" : "Preview",
    );

    const downloadButton = isReady
        ? createElement(
              "a",
              { class: "button primary", href: `/api${levelPath}/download` },
              "Download .docx",
          )
        : createElement(
              "button",
              { class: "primary", disabled: true },
              "Download .docx",
          );

    const retryOrRegenerateButton = buildRetryOrRegenerateButton(
        article,
        level,
        isBusy,
    );

    return createElement(
        "div",
        { class: "actions" },
        previewButton,
        downloadButton,
        retryOrRegenerateButton,
    );
}

/**
 * "Try Again" for a failed level; otherwise "Regenerate".
 * Regenerate is disabled while the level is busy.
 */
function buildRetryOrRegenerateButton(article, level, isBusy) {
    const levelPath = `/articles/${article.id}/levels/${level.level}`;
    const isFailed = level.status === "failed";
    const action = isFailed ? "retry" : "regenerate";
    const sendAction = (event) =>
        sendRetryOrRegenerate(
            event,
            level.level,
            article.id,
            `${levelPath}/${action}`,
        );

    return createElement(
        "button",
        {
            class: isFailed ? "primary" : null,
            disabled: !isFailed && isBusy,
            onclick: sendAction,
        },
        isFailed ? "Try Again" : "Regenerate",
    );
}

/**
 * Opens the preview for a level, or closes it if it is already open.
 * Then re-renders the page.
 */
function togglePreview(articleId, levelId) {
    appState.openPreviewLevel =
        appState.openPreviewLevel === levelId ? null : levelId;
    renderArticleDetail(articleId);
}

/**
 * Handles Try Again / Regenerate clicks.
 * `errorKey` is the level id, or "all" for the retry-all button.
 * The button is disabled before the request starts,
 * so a double click can't send two requests.
 * The server's atomic claim catches anything that still gets through (409).
 */
async function sendRetryOrRegenerate(event, errorKey, articleId, path) {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Starting…";
    delete appState.actionErrors[errorKey];
    try {
        await requestApi(path, { method: "POST" });
    } catch (err) {
        // 409 means it's already running; the re-render shows that,
        // so no error message is needed.
        if (err.status !== 409) appState.actionErrors[errorKey] = err.message;
    }
    if (errorKey === "all" || appState.openPreviewLevel === errorKey)
        appState.openPreviewLevel = null;
    await renderArticleDetail(articleId);
    refreshUsageFooter();
}

/**
 * Asks for confirmation, deletes the article and its files,
 * then goes back to the list.
 */
async function deleteArticleAfterConfirm(article) {
    if (
        !confirm(
            `Delete "${article.title}" and all of its files? This can't be undone.`,
        )
    )
        return;
    try {
        await requestApi(`/articles/${article.id}`, { method: "DELETE" });
        location.hash = "#/";
    } catch (err) {
        alert(err.message);
    }
}
