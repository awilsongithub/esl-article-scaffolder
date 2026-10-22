// The one place the frontend talks to the server.

/**
 * Calls `/api{path}` and returns the parsed JSON (or null for 204 No Content).
 * Throws an Error with the server's message and an HTTP `status` property
 * when the request fails.
 */
export async function requestApi(path, options = {}) {
    const response = await fetch(`/api${path}`, options);
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    // .ok automatically added by fetch if res code is 200-299
    if (!response.ok) {
        throw createRequestError(response.status, data.error);
    }
    return data;
}

/**
 * An Error with the server's message (or a generic one) and the HTTP
 * `status`, so callers can branch on e.g. 409.
 */
function createRequestError(status, serverMessage) {
    const error = new Error(serverMessage || `Request failed (${status}).`);
    error.status = status;
    return error;
}
