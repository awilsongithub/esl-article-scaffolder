// Formatting helpers and small shared pieces of UI.
import { createElement } from "./dom.js";
import { appState } from "./state.js";

const STATUS_TEXT = {
  pending: "Waiting",
  processing: "Processing…",
  ready: "Ready",
  failed: "Failed",
};

/** Returns the display label for a level id, e.g. "g5" → "Grade 5". */
export function getLevelLabel(levelId) {
  return (
    appState.config.levels.find((level) => level.id === levelId)?.label ??
    levelId
  );
}

/** Creates the coloured status pill shown on articles and level cards. */
export function createStatusBadge(status) {
  return createElement(
    "span",
    { class: `badge ${status}` },
    STATUS_TEXT[status] ?? status,
  );
}

/** Formats a SQLite datetime('now') value (UTC, no zone marker) in the viewer's local time. */
export function formatSqliteDate(sqliteDate) {
  return new Date(`${sqliteDate.replace(" ", "T")}Z`).toLocaleString(
    undefined,
    { dateStyle: "medium", timeStyle: "short" },
  );
}

/** Counts words the same way the server does: runs of non-whitespace. */
export function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

/** localStorage wrapper for per-viewer conveniences; never throws (private mode, blocked storage). */
export const browserStorage = {
  get: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
};
