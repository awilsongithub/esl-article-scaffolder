// Turns the upload form's state into the POST /api/articles request
// described in docs/api-contract.md.
// No DOM here, so test/upload-request.test.js can check it in Node
// against the contract fixtures.

/**
 * The upload request for the form's state, in the fixtures' shape:
 * text `fields`, and `files` keyed by form field name.
 * Sends only the input for the chosen mode (the pasted text or the file).
 * Versions are numbered 1, 2, 3 in card order, and each image is sent
 * as `image_<number>`.
 */
export function buildUploadRequest(formState) {
    const isPaste = formState.mode === "paste";
    const fields = {
        title: formState.title.trim(),
        uploaded_by: formState.uploadedBy.trim(),
        mode: formState.mode,
        ...(isPaste && { text: formState.text }),
        versions: formState.versions.map(toVersionOptions),
    };
    const articleFile = isPaste ? [] : [["file", formState.file]];
    const imageFiles = formState.versions.flatMap((version, index) =>
        version.image ? [[`image_${index + 1}`, version.image]] : [],
    );
    const files = Object.fromEntries([...articleFile, ...imageFiles]);
    return { fields, files };
}

/**
 * One version's options in the contract shape, numbered by its position.
 * Leaves out what only the form needs, such as the image and whether
 * the card is collapsed.
 */
function toVersionOptions(version, index) {
    return {
        number: index + 1,
        grade: version.grade,
        questions: version.questions,
        terms: version.terms,
        translationLanguage: version.translationLanguage,
        summary: version.summary,
        sections: version.sections,
        cloze: version.cloze,
    };
}

/**
 * The request as multipart form data for fetch.
 * `versions` is sent as a JSON string, per the contract.
 */
export function toFormData({ fields, files }) {
    const formData = new FormData();
    for (const [name, value] of Object.entries(fields)) {
        const isJson = name === "versions";
        formData.append(name, isJson ? JSON.stringify(value) : value);
    }
    for (const [name, file] of Object.entries(files))
        formData.append(name, file);
    return formData;
}
