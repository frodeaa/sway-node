/**
 * Converts a path array to a JSON Pointer string (RFC 6901).
 *
 * @param {string[]} segments - Array of path segments
 * @returns {string} JSON Pointer string (e.g. "#/paths/~1pet")
 */
function pathToPtr(segments) {
    if (!segments || segments.length === 0) {
        return "#";
    }
    return (
        "#/" +
        segments
            .map((s) => String(s).replace(/~/g, "~0").replace(/\//g, "~1"))
            .join("/")
    );
}

/**
 * Converts a JSON Pointer string to a path array.
 *
 * @param {string} ptr - JSON Pointer string (e.g. "#/paths/~1pet")
 * @returns {string[]} Path segments array
 * @throws {Error} If the pointer format is invalid
 */
function pathFromPtr(ptr) {
    if (!ptr || ptr === "#" || ptr === "#/") {
        return [];
    }
    if (!ptr.startsWith("#/") && !ptr.startsWith("/")) {
        throw new Error("ptr must start with a / or #/");
    }
    const s = ptr.startsWith("#/") ? ptr.slice(2) : ptr.slice(1);
    if (!s) return [];
    return s
        .split("/")
        .map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/**
 * Resolves a JSON Pointer path against a document.
 *
 * @param {object} doc
 * @param {string[]} refPath
 * @returns {*} The value at the path, or undefined if not found
 */
function getAtPath(doc, refPath) {
    return refPath.reduce(
        (obj, key) => (obj != null ? obj[key] : undefined),
        doc,
    );
}

/**
 * Walks a document, collecting ref metadata and sanitizing in a single pass.
 * The document is mutated in place — caller must pass a clone if the original is needed.
 *
 * Invalid/missing $ref nodes are replaced with {} so json-schema-ref-parser won't throw.
 * Extra properties on valid $ref nodes are stripped (the parser merges them into the
 * dereferenced result, which breaks Swagger JSON schema validation).
 *
 * @param {object} doc - The document to walk and sanitize (mutated in place)
 * @returns {object} Map of JSON Pointer -> { uri, type, missing?, error?, warning? }
 */
function collectAndSanitizeRefs(doc) {
    const refs = {};
    const nodePath = [];

    function walk(node, parent, parentKey) {
        if (Array.isArray(node)) {
            for (let i = 0; i < node.length; i++) {
                nodePath.push(String(i));
                walk(node[i], node, i);
                nodePath.pop();
            }
        } else if (node !== null && typeof node === "object") {
            if ("$ref" in node) {
                const refUri = node.$ref;
                const ptr = pathToPtr(nodePath);
                const extraKeys = Object.keys(node).filter((k) => k !== "$ref");
                let type, missing, error, warning;
                missing = false;

                if (extraKeys.length > 0) {
                    warning =
                        "Extra JSON Reference properties will be ignored: " +
                        extraKeys.join(", ");
                }

                if (typeof refUri !== "string") {
                    type = "invalid";
                    error = "JSON Reference must be a string";
                    parent[parentKey] = {};
                } else if (
                    refUri === "" ||
                    refUri === "#" ||
                    refUri.startsWith("#/")
                ) {
                    type = "local";
                    if (refUri !== "" && refUri !== "#") {
                        try {
                            const target = getAtPath(doc, pathFromPtr(refUri));
                            if (target === undefined) {
                                missing = true;
                                error =
                                    "JSON Pointer points to missing location: " +
                                    refUri;
                                parent[parentKey] = {};
                            } else if (extraKeys.length > 0) {
                                parent[parentKey] = { $ref: refUri };
                            }
                        } catch (e) {
                            missing = true;
                            error = e.message;
                            parent[parentKey] = {};
                        }
                    }
                } else {
                    type = "invalid";
                    error =
                        "Only local JSON pointer references (#/...) are supported: " +
                        refUri;
                    parent[parentKey] = {};
                }

                const metadata = { uri: refUri, type };
                if (missing) metadata.missing = true;
                if (error) metadata.error = error;
                if (warning) metadata.warning = warning;

                refs[ptr] = metadata;
                return; // do not recurse into $ref nodes per JSON Reference spec
            }

            for (const k of Object.keys(node)) {
                nodePath.push(k);
                walk(node[k], node, k);
                nodePath.pop();
            }
        }
    }

    walk(doc, null, null);
    return refs;
}

module.exports = {
    pathToPtr,
    pathFromPtr,
    collectAndSanitizeRefs,
};
