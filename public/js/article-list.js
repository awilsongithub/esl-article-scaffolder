// The searchable list of articles on the home view.
// REACT: becomes <ArticleList query={…} />.
import { requestApi } from "./api.js";
import { createElement, findElement } from "./dom.js";
import { createStatusBadge, formatSqliteDate } from "./format.js";
import { schedulePolling } from "./polling.js";

/** Loads articles (filtered by the search box) and renders the list. Polls while any are processing. */
export async function renderArticleList() {
    const query = findElement("#search").value.trim();
    const list = findElement("#article-list");
    let articles;
    try {
        articles = await requestApi(
            `/articles${query ? `?q=${encodeURIComponent(query)}` : ""}`,
        );
    } catch (err) {
        list.replaceChildren(
            createElement("li", { class: "error" }, err.message),
        );
        return;
    }

    const emptyMessage = findElement("#empty-list");
    emptyMessage.hidden = articles.length > 0;
    emptyMessage.textContent = query
        ? "No articles match your search."
        : "No articles yet.";
    list.replaceChildren(...articles.map(buildArticleListItem));

    const homeIsVisible = !findElement("#view-home").hidden;
    if (
        homeIsVisible &&
        articles.some((article) => article.status === "processing")
    ) {
        schedulePolling(renderArticleList);
    }
}

/** Builds one list row: title, "uploaded by · date · words", and the status badge, linking to the detail view. */
function buildArticleListItem(article) {
    const metaText = [
        `Uploaded by ${article.uploadedBy || "—"}`,
        formatSqliteDate(article.createdAt),
        `${article.wordCount.toLocaleString()} words`,
    ].join(" · ");

    const title = createElement("div", { class: "title" }, article.title);
    const meta = createElement("div", { class: "meta" }, metaText);
    const text = createElement("div", {}, title, meta);
    const link = createElement(
        "a",
        { href: `#/articles/${article.id}` },
        text,
        createStatusBadge(article.status),
    );
    return createElement("li", {}, link);
}
