/**
 * Converts a path array to a JSON Pointer string (RFC 6901).
 *
 * Each segment is ~-escaped (~ -> ~0, / -> ~1), then any literal "%" is escaped
 * to "%25". That last step is required because pathFromPtr percent-decodes the
 * fragment: without it, a segment like "Foo%20Bar" would round-trip as
 * "Foo Bar", colliding with a distinct segment of that name. Only "%" needs
 * escaping here — it's the only character decodeURIComponent treats specially
 * when it isn't already part of one of our own escapes — so other characters
 * (e.g. the "{"/"}" in a path template segment like "{petId}") are left as-is.
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
            .map((s) =>
                String(s)
                    .replace(/~/g, "~0")
                    .replace(/\//g, "~1")
                    .replace(/%/g, "%25"),
            )
            .join("/")
    );
}

/**
 * Converts a JSON Pointer string to a path array.
 *
 * Per RFC 6901 section 6, percent-encoding only applies to the URI fragment
 * representation of a pointer (the "#"-prefixed form) — a bare JSON Pointer is
 * never percent-encoded. Decoding is done on the whole fragment *before*
 * splitting into reference tokens, since a percent-encoded "/" (%2F) denotes
 * the pointer's structural separator, not literal token content (that's what
 * ~1 is for); decoding per-token after an already-wrong split would leave the
 * segments merged incorrectly. The ~1/~0 escapes are then undone per token,
 * after decoding, so a percent-encoded tilde (e.g. "%7E1") decodes to "~1"
 * before being interpreted as the "/" escape.
 *
 * A malformed percent-escape in the fragment form is a malformed URI fragment,
 * not literal text, so `decodeURIComponent` is left to throw rather than
 * caught here: this is only ever called on a raw `$ref` URI from
 * `collectAndSanitizeRefs` (already wrapped in a try/catch that reports it as
 * an unresolvable reference) or on a pointer this module itself built via
 * `pathToPtr` (which always produces validly percent-encoded fragments, so it
 * can never trigger this).
 *
 * @param {string} ptr - JSON Pointer string (e.g. "#/paths/~1pet")
 * @returns {string[]} Path segments array
 * @throws {Error} If the pointer format is invalid or, for the fragment form,
 * contains a malformed percent-escape
 */
function pathFromPtr(ptr) {
    if (!ptr || ptr === "#") {
        return [];
    }
    if (!ptr.startsWith("#/") && !ptr.startsWith("/")) {
        throw new Error("ptr must start with a / or #/");
    }
    const isFragment = ptr.startsWith("#");
    let pointer = isFragment ? ptr.slice(1) : ptr;

    if (isFragment) {
        pointer = decodeURIComponent(pointer);
    }

    // "#/" (or a bare "/") is the pointer "/" — a single reference token with
    // an empty key — not the document root, so it must not be short-circuited
    // to []; split() naturally produces [""] for it once the leading "/" (the
    // structural separator before the first token) is shifted off.
    const segments = pointer.split("/");
    segments.shift();
    return segments.map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/**
 * Resolves a JSON Pointer path against a document.
 *
 * Only own members are traversed — plain `obj[key]` access would fall through
 * to `Object.prototype`, so a missing reference like "toString" or
 * "constructor" would resolve to an inherited function instead of being
 * reported as missing.
 *
 * @param {object} doc
 * @param {string[]} refPath
 * @returns {*} The value at the path, or undefined if not found
 */
function getAtPath(doc, refPath) {
    return refPath.reduce(
        (obj, key) =>
            obj != null && Object.prototype.hasOwnProperty.call(obj, key)
                ? obj[key]
                : undefined,
        doc,
    );
}

/**
 * Walks a document in two passes, collecting ref metadata and sanitizing it.
 * The document is mutated in place — caller must pass a clone if the original is needed.
 *
 * Invalid/missing $ref nodes are replaced with {} so json-schema-ref-parser won't throw.
 * Extra properties on valid $ref nodes are stripped (the parser merges them into the
 * dereferenced result, which breaks Swagger JSON schema validation).
 *
 * Structural sanitization (stripping a $ref node's own extra properties, blanking
 * non-local/malformed refs) only ever depends on that node itself, so it happens
 * during the single walk. Whether a *local* ref's target actually exists, though,
 * depends on the rest of the document — including parts sanitization hasn't
 * reached yet. Checking it during the walk would make the result depend on
 * traversal order: e.g. a ref to "#/definitions/A/description" would see A's
 * "description" sibling as present if checked before A (a $ref object itself) is
 * walked and has that sibling stripped, but as missing if checked after. Local
 * ref targets are therefore only checked in a second pass, once the whole
 * document has already been fully sanitized.
 *
 * @param {object} doc - The document to walk and sanitize (mutated in place)
 * @returns {object} Map of JSON Pointer -> { uri, canonicalUri?, type, missing?, error?, warning? }
 */
function collectAndSanitizeRefs(doc) {
    const refs = {};
    const nodePath = [];
    // Local refs whose target existence can only be checked once the whole
    // document has been sanitized (see function doc comment above).
    const pendingTargetChecks = [];

    // Give the root node a synthetic parent so a top-level $ref can be
    // sanitized via the same `parent[parentKey] = ...` writes used everywhere
    // else; sync any replacement back into `doc` so the caller's reference
    // (which walk/pass 2 never touch directly) reflects it.
    const rootWrapper = { __root: doc };

    function syncRoot() {
        if (rootWrapper.__root !== doc) {
            for (const k of Object.keys(doc)) {
                delete doc[k];
            }
            Object.assign(doc, rootWrapper.__root);
            rootWrapper.__root = doc;
        }
    }

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
                let type, missing, error, warning, canonicalUri, refPath;

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
                            // Reference bookkeeping (used to match this ref against the
                            // pathToPtr-built pointers of definitions/ancestors elsewhere)
                            // needs a canonical pointer, not the raw, possibly
                            // percent-encoded URI — e.g. "#/definitions/Foo%20Bar" must
                            // line up with the "#/definitions/Foo Bar" pointer that
                            // identifies the definition itself.
                            refPath = pathFromPtr(refUri);
                            canonicalUri = pathToPtr(refPath);
                            if (extraKeys.length > 0) {
                                parent[parentKey] = { $ref: refUri };
                            }
                        } catch (e) {
                            missing = true;
                            error = e.message;
                            parent[parentKey] = {};
                        }
                    } else {
                        canonicalUri = "#";
                        if (extraKeys.length > 0) {
                            parent[parentKey] = { $ref: refUri };
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
                if (canonicalUri !== undefined)
                    metadata.canonicalUri = canonicalUri;
                if (missing) metadata.missing = true;
                if (error) metadata.error = error;
                if (warning) metadata.warning = warning;

                refs[ptr] = metadata;

                // A well-formed local "#/..." ref: its target can only be resolved
                // against the fully-sanitized document, so defer that check.
                if (refPath !== undefined) {
                    pendingTargetChecks.push({
                        metadata,
                        refUri,
                        refPath,
                        parent,
                        parentKey,
                    });
                }

                return; // do not recurse into $ref nodes per JSON Reference spec
            }

            for (const k of Object.keys(node)) {
                nodePath.push(k);
                walk(node[k], node, k);
                nodePath.pop();
            }
        }
    }

    walk(doc, rootWrapper, "__root");
    syncRoot();

    // Second pass: the document is now fully sanitized, so every deferred local
    // ref's target can be checked against its final, order-independent shape.
    for (const {
        metadata,
        refUri,
        refPath,
        parent,
        parentKey,
    } of pendingTargetChecks) {
        if (getAtPath(doc, refPath) === undefined) {
            metadata.missing = true;
            metadata.error =
                "JSON Pointer points to missing location: " + refUri;
            parent[parentKey] = {};
        }
    }
    syncRoot();

    return refs;
}

module.exports = {
    pathToPtr,
    pathFromPtr,
    collectAndSanitizeRefs,
};
