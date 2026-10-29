// One version card on the upload form: a header that stays visible when
// the card is collapsed, and that version's options.
// REACT: becomes <VersionCard />.
import { createElement } from "./dom.js";
import {
    buildFieldLabel,
    buildLabelNote,
    buildSelect,
    buildStepper,
    buildSwitch,
    setSwitchOn,
} from "./form-controls.js";
import { createIcon } from "./icons.js";
import { buildImagePicker } from "./image-picker.js";
import { appState } from "./state.js";

/**
 * A new version card's state: the configured default options,
 * no image, expanded.
 */
export function createVersionState() {
    return {
        ...appState.config.versionDefaults,
        image: null,
        imagePreviewUrl: null,
        isCollapsed: false,
    };
}

/**
 * Builds the card for `version`, and keeps `version` up to date as the
 * teacher changes its options.
 * `number` is the card's place in the list, 1 to 3.
 * `onRemove` is null when the card can't be removed (it's the only one).
 */
export function buildVersionCard({ version, number, onRemove }) {
    const idPrefix = `version-${number}`;
    const optionsId = `${idPrefix}-options`;
    const clozeNoteId = `${idPrefix}-cloze-note`;

    const gradeChip = createElement("span", { class: "chip" });
    const optionsSummary = createElement("span", { class: "version-summary" });
    const clozeSwitch = buildSwitch({
        id: `${idPrefix}-cloze`,
        isOn: version.cloze,
        onChange: (isOn) => updateVersion({ cloze: isOn }),
    });
    const clozeNote = createElement(
        "p",
        { class: "toggle-note", id: clozeNoteId },
        "The cloze passage needs at least 1 glossary term.",
    );
    const collapseButton = createElement(
        "button",
        {
            type: "button",
            class: "icon-button collapse-button",
            "aria-label": `Version ${number} options`,
            "aria-expanded": String(!version.isCollapsed),
            "aria-controls": optionsId,
            onclick: toggleCollapsed,
        },
        createIcon("collapseChevron"),
    );
    const removeButton =
        onRemove &&
        createElement(
            "button",
            {
                type: "button",
                class: "icon-button",
                "aria-label": `Remove version ${number}`,
                onclick: onRemove,
            },
            createIcon("trash"),
        );

    const heading = createElement(
        "div",
        { class: "version-heading" },
        createElement("h3", { class: "version-title" }, `Version ${number}`),
        gradeChip,
        optionsSummary,
    );
    const header = createElement(
        "div",
        { class: "version-header" },
        heading,
        removeButton,
        collapseButton,
    );
    const options = createElement(
        "div",
        { class: "version-options", id: optionsId },
        buildOptionFields(version, idPrefix, updateVersion),
        buildToggleRows({
            version,
            idPrefix,
            updateVersion,
            clozeSwitch,
            clozeNote,
        }),
    );
    const card = createElement(
        "div",
        { class: "version-card" },
        header,
        options,
    );

    /**
     * Saves changed options into `version`, then refreshes what depends
     * on them. With 0 glossary terms there can be no cloze passage.
     */
    function updateVersion(changes) {
        Object.assign(version, changes);
        if (version.terms === 0) version.cloze = false;
        showOptionsInHeader();
        showClozeAvailability();
    }

    /** Puts the grade and the options summary into the header. */
    function showOptionsInHeader() {
        gradeChip.textContent = findGradeLabel(version.grade);
        optionsSummary.textContent = describeVersionOptions(version);
    }

    /** Turns the cloze switch off and explains why while terms are 0. */
    function showClozeAvailability() {
        const hasTerms = version.terms > 0;
        setSwitchOn(clozeSwitch, version.cloze);
        clozeSwitch.disabled = !hasTerms;
        clozeNote.hidden = hasTerms;
        const describedBy = [
            `${idPrefix}-cloze-info`,
            !hasTerms && clozeNoteId,
        ];
        clozeSwitch.setAttribute(
            "aria-describedby",
            describedBy.filter(Boolean).join(" "),
        );
    }

    /** Collapses or expands the card's options. */
    function toggleCollapsed() {
        version.isCollapsed = !version.isCollapsed;
        card.classList.toggle("is-collapsed", version.isCollapsed);
        collapseButton.setAttribute(
            "aria-expanded",
            String(!version.isCollapsed),
        );
    }

    card.classList.toggle("is-collapsed", version.isCollapsed);
    showOptionsInHeader();
    showClozeAvailability();
    return card;
}

/** The display label for a grade id, e.g. "g3" → "Grade 3". */
function findGradeLabel(gradeId) {
    return appState.config.grades.find((grade) => grade.id === gradeId)?.label;
}

/**
 * The one-line summary on a collapsed card,
 * e.g. "8 questions · 8 terms · Spanish · Sections".
 */
function describeVersionOptions(version) {
    return [
        formatCount(version.questions, "question"),
        formatCount(version.terms, "term"),
        version.translationLanguage,
        version.summary && "Summary",
        version.sections && "Sections",
        version.cloze && "Cloze",
        version.image && "Image",
    ]
        .filter(Boolean)
        .join(" · ");
}

/** "1 question", "8 questions". */
function formatCount(count, unit) {
    return `${count} ${count === 1 ? unit : `${unit}s`}`;
}

/**
 * The grid of fields: grade, question and term counts, glossary
 * translation and image. Each change goes to `updateVersion`.
 */
function buildOptionFields(version, idPrefix, updateVersion) {
    const { grades, languages, maxQuestions, maxTerms } = appState.config;
    return createElement(
        "div",
        { class: "version-fields" },
        buildField({
            area: "grade",
            label: buildFieldLabel({
                forId: `${idPrefix}-grade`,
                children: ["Grade level"],
                info: {
                    tooltipId: `${idPrefix}-grade-info`,
                    buttonLabel: "About grade level",
                    text: "Rewrites the article, glossary and questions at this reading level. Same ideas, adjusted complexity.",
                },
            }),
            control: buildSelect({
                id: `${idPrefix}-grade`,
                options: grades.map(({ id, label }) => ({ value: id, label })),
                selectedValue: version.grade,
                describedBy: `${idPrefix}-grade-info`,
                onChange: (grade) => updateVersion({ grade }),
            }),
        }),
        buildField({
            area: "questions",
            label: buildFieldLabel({
                forId: `${idPrefix}-questions`,
                children: [
                    "Questions",
                    buildLabelNote(`0–${maxQuestions}`, "hide-on-phone"),
                ],
                info: {
                    tooltipId: `${idPrefix}-questions-info`,
                    buttonLabel: "About questions",
                    text: `Mostly evidence and inference questions, so students go back into the text to answer. Answer key included. Multiple choice only below Grade 3. Choose 0–${maxQuestions}.`,
                },
            }),
            control: buildStepper({
                id: `${idPrefix}-questions`,
                value: version.questions,
                min: 0,
                max: maxQuestions,
                unitName: "questions",
                describedBy: `${idPrefix}-questions-info`,
                onChange: (questions) => updateVersion({ questions }),
            }),
        }),
        buildField({
            area: "terms",
            label: buildFieldLabel({
                forId: `${idPrefix}-terms`,
                children: [
                    "Glossary",
                    createElement("span", { class: "hide-on-phone" }, " terms"),
                    buildLabelNote(`0–${maxTerms}`, "hide-on-phone"),
                ],
                info: {
                    tooltipId: `${idPrefix}-terms-info`,
                    buttonLabel: "About glossary terms",
                    text: `Picks the words that carry the article’s meaning and show up across subjects — not just every hard word. Choose 0–${maxTerms}.`,
                    isEndAligned: true,
                },
            }),
            control: buildStepper({
                id: `${idPrefix}-terms`,
                value: version.terms,
                min: 0,
                max: maxTerms,
                unitName: "terms",
                describedBy: `${idPrefix}-terms-info`,
                onChange: (terms) => updateVersion({ terms }),
            }),
        }),
        buildField({
            area: "translation",
            label: buildFieldLabel({
                forId: `${idPrefix}-translation`,
                children: ["Glossary translation"],
                info: {
                    tooltipId: `${idPrefix}-translation-info`,
                    buttonLabel: "About glossary translation",
                    text: "Adds each definition in the student’s home language next to the English, linking new words to ones they already know.",
                },
            }),
            control: buildSelect({
                id: `${idPrefix}-translation`,
                options: [
                    { value: "", label: "No translation" },
                    ...languages.map((language) => ({
                        value: language,
                        label: language,
                    })),
                ],
                selectedValue: version.translationLanguage ?? "",
                describedBy: `${idPrefix}-translation-info`,
                onChange: (language) =>
                    updateVersion({ translationLanguage: language || null }),
            }),
        }),
        buildField({
            area: "image",
            label: buildFieldLabel({
                children: ["Image", buildLabelNote("optional")],
                info: {
                    tooltipId: `${idPrefix}-image-info`,
                    buttonLabel: "About the image",
                    text: "One picture placed with this version. A visual gives learners a second way into the meaning.",
                    isEndAligned: true,
                },
            }),
            control: buildImagePicker({
                version,
                describedBy: `${idPrefix}-image-info`,
                // The picker has already saved the image into `version`.
                onChange: () => updateVersion({}),
            }),
        }),
    );
}

/**
 * One cell of the fields grid: its label row and control.
 * `area` places it in the grid, which the stylesheet lays out
 * differently on phones, tablets and desktops.
 */
function buildField({ area, label, control }) {
    return createElement(
        "div",
        { class: `field field-${area}` },
        label,
        control,
    );
}

/**
 * The on/off options below the fields: short summary, sections and
 * cloze passage. The cloze switch and its note are built by the card,
 * which turns them on and off with the glossary-term count.
 */
function buildToggleRows({
    version,
    idPrefix,
    updateVersion,
    clozeSwitch,
    clozeNote,
}) {
    return createElement(
        "div",
        { class: "version-toggles" },
        buildToggleRow({
            label: "Short summary",
            info: {
                tooltipId: `${idPrefix}-summary-info`,
                buttonLabel: "About the summary",
                text: "A few sentences before the article. Previewing the big idea gives students a frame to hang details on.",
            },
            switchButton: buildSwitch({
                id: `${idPrefix}-summary`,
                isOn: version.summary,
                describedBy: `${idPrefix}-summary-info`,
                onChange: (summary) => updateVersion({ summary }),
            }),
        }),
        buildToggleRow({
            label: "Break into sections",
            info: {
                tooltipId: `${idPrefix}-sections-info`,
                buttonLabel: "About sections",
                text: "Splits the article into short sections, each followed by its own questions. Checking understanding in small steps catches confusion early. The glossary stays whole.",
            },
            switchButton: buildSwitch({
                id: `${idPrefix}-sections`,
                isOn: version.sections,
                describedBy: `${idPrefix}-sections-info`,
                onChange: (sections) => updateVersion({ sections }),
            }),
        }),
        buildToggleRow({
            label: "Cloze passage",
            info: {
                tooltipId: `${idPrefix}-cloze-info`,
                buttonLabel: "About the cloze passage",
                text: "A summary with glossary words left blank. Pulling words from memory makes them stick better than rereading. Needs at least one glossary term.",
            },
            switchButton: clozeSwitch,
            note: clozeNote,
        }),
    );
}

/**
 * One on/off row: the <label> for the switch and its info tooltip on the
 * left, the switch on the right, and an optional note underneath.
 */
function buildToggleRow({ label, info, switchButton, note }) {
    const labelRow = buildFieldLabel({
        forId: switchButton.id,
        children: [label],
        info,
    });
    return createElement(
        "div",
        { class: "toggle-row" },
        labelRow,
        switchButton,
        note,
    );
}
