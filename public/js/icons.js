// Line icons from the article-form mockups, built as inline SVG.
// They draw with currentColor, so they take the text color
// set in the stylesheet.

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * Each icon's square size in px and the shapes it draws,
 * as [tag, attributes].
 */
const ICONS = {
    upload: {
        size: 20,
        shapes: [
            [
                "path",
                {
                    d: "M10 13V3.5M6 7.5l4-4 4 4M3.5 13v2.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V13",
                    "stroke-width": 1.6,
                },
            ],
        ],
    },
    info: {
        size: 16,
        shapes: [
            ["circle", { cx: 8, cy: 8, r: 6.5, "stroke-width": 1.3 }],
            ["path", { d: "M8 7.3v3.7M8 5.1v.1", "stroke-width": 1.6 }],
        ],
    },
    selectChevron: {
        size: 14,
        shapes: [["path", { d: "M3.5 5.5L7 9l3.5-3.5", "stroke-width": 1.6 }]],
    },
    collapseChevron: {
        size: 18,
        shapes: [["path", { d: "M4.5 11.5L9 7l4.5 4.5", "stroke-width": 1.6 }]],
    },
    trash: {
        size: 18,
        shapes: [
            [
                "path",
                {
                    d: "M3.5 5h11M7 5V3.5h4V5M5 5l.7 9.5a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L13 5",
                    "stroke-width": 1.4,
                },
            ],
        ],
    },
    minus: {
        size: 14,
        shapes: [["path", { d: "M3 7h8", "stroke-width": 1.6 }]],
    },
    plus: {
        size: 14,
        shapes: [["path", { d: "M3 7h8M7 3v8", "stroke-width": 1.6 }]],
    },
    addVersion: {
        size: 16,
        shapes: [["path", { d: "M3 8h10M8 3v10", "stroke-width": 1.6 }]],
    },
    image: {
        size: 18,
        shapes: [
            [
                "rect",
                {
                    x: 2.5,
                    y: 3.5,
                    width: 13,
                    height: 11,
                    rx: 1.5,
                    "stroke-width": 1.4,
                },
            ],
            ["circle", { cx: 6.5, cy: 7.5, r: 1.3, "stroke-width": 1.2 }],
            [
                "path",
                { d: "M2.5 12.5l4-3.5 3 2.5 2-1.5 4 3", "stroke-width": 1.4 },
            ],
        ],
    },
    close: {
        size: 14,
        shapes: [
            ["path", { d: "M3.5 3.5l7 7M10.5 3.5l-7 7", "stroke-width": 1.6 }],
        ],
    },
};

/**
 * Creates the named icon as a decorative <svg>, hidden from screen
 * readers. The button or text next to it carries the meaning.
 */
export function createIcon(name) {
    const { size, shapes } = ICONS[name];
    const svg = createSvgElement("svg", {
        width: size,
        height: size,
        viewBox: `0 0 ${size} ${size}`,
        fill: "none",
        stroke: "currentColor",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "aria-hidden": "true",
        focusable: "false",
    });
    svg.append(
        ...shapes.map(([tag, attributes]) => createSvgElement(tag, attributes)),
    );
    return svg;
}

/** Creates an SVG element with attributes. */
function createSvgElement(tag, attributes) {
    const element = document.createElementNS(SVG_NAMESPACE, tag);
    for (const [key, value] of Object.entries(attributes))
        element.setAttribute(key, value);
    return element;
}
