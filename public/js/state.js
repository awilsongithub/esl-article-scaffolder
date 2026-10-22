// Shared app state.
// Modules can't reassign each other's `let` exports,
// so state lives on one object.
// REACT: this would move into component state / a data hook
// (e.g. React Query).

export const appState = {
    /**
     * Levels, languages and limits from GET /api/config,
     * loaded once at startup.
     */
    config: null,
    /** Level id whose preview is open in the detail view, or null. */
    openPreviewLevel: null,
    /**
     * Inline error from the last Try Again / Regenerate,
     * keyed by level id or 'all'.
     */
    actionErrors: {},
};
