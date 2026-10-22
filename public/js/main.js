// Entry point: loads settings, wires up the page,
// and switches views based on the URL hash.
// Each render*/build* function maps to a future React component
// (see the REACT: notes in each file).
import { requestApi } from "./api.js";
import { renderArticleDetail } from "./article-detail.js";
import { renderArticleList } from "./article-list.js";
import { createErrorMessage, findElement } from "./dom.js";
import { cancelPolling, refreshUsageFooter } from "./polling.js";
import { appState } from "./state.js";
import { setupUploadForm } from "./upload-form.js";

const SEARCH_DELAY_MS = 250;
let searchTimer;

/**
 * Shows the view for the current hash:
 * "#/articles/<id>" opens that article, anything else the home view.
 * REACT: replaced by React Router.
 */
function showViewForCurrentHash() {
    cancelPolling();
    const articleMatch = location.hash.match(/^#\/articles\/(\d+)/);
    findElement("#view-home").hidden = Boolean(articleMatch);
    findElement("#view-detail").hidden = !articleMatch;
    if (articleMatch) {
        appState.openPreviewLevel = null;
        appState.actionErrors = {};
        renderArticleDetail(Number(articleMatch[1]));
    } else {
        renderArticleList();
    }
    window.scrollTo(0, 0);
}

/** Re-runs the article search a moment after the user stops typing. */
function searchArticlesAfterTypingPause() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderArticleList, SEARCH_DELAY_MS);
}

/**
 * Loads /api/config, sets up the form and listeners,
 * and shows the first view.
 */
async function startApp() {
    appState.config = await requestApi("/config");
    setupUploadForm();
    findElement("#search").addEventListener(
        "input",
        searchArticlesAfterTypingPause,
    );
    window.addEventListener("hashchange", showViewForCurrentHash);
    showViewForCurrentHash();
    refreshUsageFooter();
}

startApp().catch((err) => {
    findElement("#app").replaceChildren(
        createErrorMessage(`Could not load the app: ${err.message}`),
    );
});
