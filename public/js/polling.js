// Usage footer and the 3-second refresh while levels are still being generated.
// REACT: polling becomes a data hook with refetchInterval instead of setTimeout.
import { requestApi } from "./api.js";
import { findElement } from "./dom.js";

const POLL_INTERVAL_MS = 3000;
let pollTimer;

/** Loads today's spend and shows it in the page footer. Clears the footer if the request fails. */
export async function refreshUsageFooter() {
  const footer = findElement("#usage");
  try {
    const { spentUsd, capUsd } = await requestApi("/usage/today");
    footer.textContent = `Today's usage: $${spentUsd.toFixed(2)} of $${capUsd.toFixed(2)}`;
  } catch {
    footer.textContent = "";
  }
}

/** Runs `refreshView` (and refreshes the usage footer) once after the poll interval, replacing any pending poll. */
export function schedulePolling(refreshView) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(() => {
    refreshView();
    refreshUsageFooter();
  }, POLL_INTERVAL_MS);
}

/** Cancels the pending poll, e.g. when the user navigates to another view. */
export function cancelPolling() {
  clearTimeout(pollTimer);
}
