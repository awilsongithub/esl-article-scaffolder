// Controls shared by the upload form and its version cards: field labels
// with info tooltips, selects, number steppers and switches.
// They set classes and ARIA attributes; the stylesheet draws them.
// REACT: each becomes a small component (<InfoTip />, <Stepper />, …).
import { createElement } from "./dom.js";
import { createIcon } from "./icons.js";

/**
 * The row above a field: the label's `children` (text and notes such as
 * "optional"), then an optional info tooltip.
 * With `forId` the text is a <label> for that control, else a <span>.
 * The info button sits outside the <label>, so clicking the label focuses
 * the field instead of opening the tooltip.
 */
export function buildFieldLabel({ forId, children, info }) {
    const label = forId
        ? createElement("label", { for: forId }, children)
        : createElement("span", {}, children);
    return createElement(
        "div",
        { class: "field-label" },
        label,
        info && buildInfoTip(info),
    );
}

/** A grey note after a label's text, e.g. "optional" or "0–15". */
export function buildLabelNote(text, extraClass = "") {
    return createElement(
        "span",
        { class: `label-note ${extraClass}`.trim() },
        text,
    );
}

/**
 * An info button with a short explanation in a tooltip.
 * Opens on hover, focus and tap. Closes on blur, on mouse leave unless
 * the button has focus, and on Escape or a tap elsewhere
 * (see listenForTooltipDismissal).
 * The control it explains should point at `tooltipId` with
 * aria-describedby. `isEndAligned` lines the tooltip up with the right
 * edge of the field, for fields at the right of a row.
 */
export function buildInfoTip({ tooltipId, buttonLabel, text, isEndAligned }) {
    const tooltip = createElement(
        "span",
        {
            class: isEndAligned ? "tooltip is-end-aligned" : "tooltip",
            role: "tooltip",
            id: tooltipId,
        },
        text,
    );
    const button = createElement(
        "button",
        {
            type: "button",
            class: "info-button",
            "aria-label": buttonLabel,
            "aria-describedby": tooltipId,
            onfocus: () => setTooltipOpen(infoTip, true),
            onblur: () => setTooltipOpen(infoTip, false),
            onclick: () => setTooltipOpen(infoTip, true),
        },
        createIcon("info"),
    );
    const infoTip = createElement(
        "span",
        {
            class: "info-tip",
            onmouseenter: () => setTooltipOpen(infoTip, true),
            onmouseleave: () =>
                setTooltipOpen(infoTip, document.activeElement === button),
        },
        button,
        tooltip,
    );
    return infoTip;
}

/** Shows or hides one info tip's tooltip. */
function setTooltipOpen(infoTip, isOpen) {
    infoTip.classList.toggle("is-open", isOpen);
}

/**
 * Closes open tooltips on Escape, or on a tap or click outside them,
 * which is how a tapped tooltip closes on phones.
 * Call once: it listens on the whole document.
 */
export function listenForTooltipDismissal() {
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeOpenTooltips();
    });
    document.addEventListener("pointerdown", (event) => {
        if (!event.target.closest(".info-tip")) closeOpenTooltips();
    });
}

/** Hides every open tooltip on the page. */
function closeOpenTooltips() {
    for (const infoTip of document.querySelectorAll(".info-tip.is-open"))
        setTooltipOpen(infoTip, false);
}

/**
 * A <select> with the mockups' chevron.
 * `options` are { value, label }.
 * Calls `onChange(value)` when the choice changes.
 */
export function buildSelect({
    id,
    options,
    selectedValue,
    describedBy,
    onChange,
}) {
    const optionElements = options.map(({ value, label }) =>
        createElement(
            "option",
            { value, selected: value === selectedValue },
            label,
        ),
    );
    const select = createElement(
        "select",
        {
            id,
            "aria-describedby": describedBy,
            onchange: (event) => onChange(event.target.value),
        },
        optionElements,
    );
    return createElement(
        "div",
        { class: "select" },
        select,
        createIcon("selectChevron"),
    );
}

/**
 * A whole-number field with − and + buttons, kept from `min` to `max`.
 * `unitName` labels the buttons, e.g. "questions" → "Fewer questions".
 * Calls `onChange(value)` with each new value.
 * At a limit its button is marked aria-disabled rather than disabled,
 * so it keeps keyboard focus.
 */
export function buildStepper({
    id,
    value,
    min,
    max,
    unitName,
    describedBy,
    onChange,
}) {
    let currentValue = value;
    const input = createElement("input", {
        id,
        type: "number",
        inputmode: "numeric",
        min,
        max,
        step: 1,
        value,
        "aria-describedby": describedBy,
        onchange: () => setValue(Number.parseInt(input.value, 10)),
    });
    const fewerButton = createElement(
        "button",
        {
            type: "button",
            "aria-label": `Fewer ${unitName}`,
            "aria-controls": id,
            onclick: () => setValue(currentValue - 1),
        },
        createIcon("minus"),
    );
    const moreButton = createElement(
        "button",
        {
            type: "button",
            "aria-label": `More ${unitName}`,
            "aria-controls": id,
            onclick: () => setValue(currentValue + 1),
        },
        createIcon("plus"),
    );

    /** Clamps and shows `requested`; a non-number keeps the old value. */
    function setValue(requested) {
        const nextValue = Number.isNaN(requested)
            ? currentValue
            : Math.min(max, Math.max(min, requested));
        input.value = nextValue;
        if (nextValue === currentValue) return;
        currentValue = nextValue;
        markLimitButtons();
        onChange(currentValue);
    }

    /** Marks − at the minimum and + at the maximum as unavailable. */
    function markLimitButtons() {
        fewerButton.setAttribute("aria-disabled", currentValue <= min);
        moreButton.setAttribute("aria-disabled", currentValue >= max);
    }

    markLimitButtons();
    return createElement(
        "div",
        { class: "stepper" },
        fewerButton,
        input,
        moreButton,
    );
}

/**
 * An on/off switch: a button with role="switch". The stylesheet draws
 * its knob from aria-checked.
 * Calls `onChange(isOn)` each time it's flipped.
 */
export function buildSwitch({ id, isOn, describedBy, onChange }) {
    const switchButton = createElement(
        "button",
        {
            type: "button",
            class: "switch",
            role: "switch",
            id,
            "aria-checked": String(isOn),
            "aria-describedby": describedBy,
            onclick: () => {
                const wasOn =
                    switchButton.getAttribute("aria-checked") === "true";
                setSwitchOn(switchButton, !wasOn);
                onChange(!wasOn);
            },
        },
        createElement("span", { class: "switch-knob" }),
    );
    return switchButton;
}

/** Turns a switch from buildSwitch on or off, without calling onChange. */
export function setSwitchOn(switchButton, isOn) {
    switchButton.setAttribute("aria-checked", String(isOn));
}
