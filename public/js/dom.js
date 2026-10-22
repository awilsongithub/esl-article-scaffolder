// Small DOM helpers shared by every view.

/**
 * Returns the first element matching a CSS selector.
 * Shorthand for document.querySelector.
 */
export function findElement(selector) {
    return document.querySelector(selector);
}

/**
 * Creates an element with attributes and children.
 * - Attributes starting with "on" become event listeners (onclick → "click").
 * - null / undefined / false attributes and children are skipped,
 *   so conditionals can be inlined.
 * - Children that aren't Nodes are added as text,
 *   so article content can never inject HTML.
 */
export function createElement(tag, attributes = {}, ...children) {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) {
        if (value === undefined || value === null || value === false) continue;
        if (key.startsWith("on")) element.addEventListener(key.slice(2), value);
        else if (key === "class") element.className = value;
        else element.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children.flat()) {
        if (child === null || child === undefined || child === false) continue;
        element.append(
            child instanceof Node
                ? child
                : document.createTextNode(String(child)),
        );
    }
    return element;
}

/** Creates a red error paragraph. */
export function createErrorMessage(message) {
    return createElement("p", { class: "error" }, message);
}
