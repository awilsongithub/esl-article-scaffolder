// The one place the frontend talks to the server.

/**
 * Calls `/api{path}` and returns the parsed JSON (or null for 204 No Content).
 * Throws an Error with the server's message and an HTTP `status` property when the request fails.
 */
export async function requestApi(path, options = {}) {
    const response = await fetch(`/api${path}`, options);
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw Object.assign(
            new Error(data.error || `Request failed (${response.status}).`),
            { status: response.status },
        );
    }
    return data;
}
