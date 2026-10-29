// The optional picture for one version card: an "Add image" button, or
// once one is chosen, a thumbnail, its file name and a remove button.
// REACT: becomes <ImagePicker />.
import { createElement } from "./dom.js";
import { createIcon } from "./icons.js";
import { appState } from "./state.js";

/**
 * Builds the picker for `version`, keeping its `image` and
 * `imagePreviewUrl` up to date.
 * Checks the image's type and size before accepting it.
 * `describedBy` is the id of the tooltip that explains it.
 * Calls `onChange()` after an image is added or removed.
 */
export function buildImagePicker({ version, describedBy, onChange }) {
    const { types, extensions } = appState.config.image;
    const fileInput = createElement("input", {
        type: "file",
        accept: [...types, ...extensions].join(","),
        hidden: true,
        onchange: () => {
            acceptImage(fileInput.files[0]);
            // Lets the same file be chosen again after it's removed.
            fileInput.value = "";
        },
    });
    const errorMessage = createElement("p", {
        class: "field-error",
        role: "alert",
        hidden: true,
    });
    const picker = createElement("div", { class: "image-picker" });

    /** Shows the add button, or the preview once there's an image. */
    function showImageOrAddButton() {
        picker.replaceChildren(
            version.image ? buildImagePreview() : buildAddImageButton(),
        );
    }

    /** The dashed "Add image" button, which opens the file chooser. */
    function buildAddImageButton() {
        return createElement(
            "button",
            {
                type: "button",
                class: "add-image",
                "aria-describedby": describedBy,
                onclick: () => fileInput.click(),
            },
            createIcon("image"),
            "Add image",
        );
    }

    /** The chosen image's thumbnail and name, with a remove button. */
    function buildImagePreview() {
        const thumbnail = createElement("img", {
            class: "image-thumbnail",
            src: version.imagePreviewUrl,
            alt: "",
        });
        const fileName = createElement(
            "span",
            { class: "image-name" },
            version.image.name,
        );
        const removeButton = createElement(
            "button",
            {
                type: "button",
                class: "icon-button image-remove",
                "aria-label": `Remove image ${version.image.name}`,
                onclick: removeImage,
            },
            createIcon("close"),
        );
        return createElement(
            "div",
            { class: "image-preview" },
            thumbnail,
            fileName,
            removeButton,
        );
    }

    /**
     * Keeps `file` as this version's image if it's an allowed type and
     * size, else shows why not.
     */
    function acceptImage(file) {
        if (!file) return;
        const problem = findImageProblem(file);
        errorMessage.textContent = problem ?? "";
        errorMessage.hidden = !problem;
        if (problem) return;
        releaseImagePreview(version);
        version.image = file;
        version.imagePreviewUrl = URL.createObjectURL(file);
        showImageOrAddButton();
        picker.querySelector("button").focus();
        onChange();
    }

    /** Drops the image and puts the add button back, with focus on it. */
    function removeImage() {
        releaseImagePreview(version);
        showImageOrAddButton();
        picker.querySelector("button").focus();
        onChange();
    }

    showImageOrAddButton();
    return createElement(
        "div",
        { class: "image-field" },
        picker,
        fileInput,
        errorMessage,
    );
}

/**
 * Returns why `file` can't be a version's image (wrong type or too big),
 * or null if it can. Same messages as the server's.
 */
function findImageProblem(file) {
    const { types, maxBytes } = appState.config.image;
    if (!types.includes(file.type)) return "The image must be a PNG or JPEG.";
    if (file.size > maxBytes)
        return `The image must be ${maxBytes / 1024 / 1024} MB or smaller.`;
    return null;
}

/**
 * Removes a version's image and frees its preview URL.
 * Call it when the image or its version card goes away.
 */
export function releaseImagePreview(version) {
    if (version.imagePreviewUrl) URL.revokeObjectURL(version.imagePreviewUrl);
    version.image = null;
    version.imagePreviewUrl = null;
}
