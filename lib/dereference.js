// Local-only port of the dereference algorithm (lib/dereference.js,
// lib/pointer.js) from @apidevtools/json-schema-ref-parser 16.0.5, for
// documents already sanitized by collectAndSanitizeRefs: every remaining $ref
// is a local "#..." reference without sibling keys and with an existing target.

var ROOT_PATH = "/";
var MAX_DEPTH = 500;
var NULL_VALUE = Symbol("null");

function resolveUrl(from, to) {
    var fromUrl = new URL(from, "https://aaa.nonexistanturl.com");
    var resolvedUrl = new URL(to, fromUrl);
    var endSpaces = to.match(/(\s*)$/)?.[1] || "";

    return (
        resolvedUrl.pathname + resolvedUrl.search + resolvedUrl.hash + endSpaces
    );
}

function safeDecodeURIComponent(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        try {
            return decodeURIComponent(
                value.replace(/%(?![\dA-F]{2})/gi, "%25"),
            );
        } catch {
            return value;
        }
    }
}

function getHash(path) {
    if (!path) {
        return "#";
    }
    var hashIndex = path.indexOf("#");
    return hashIndex >= 0 ? path.substring(hashIndex) : "#";
}

function parsePointer(path) {
    var pointer = safeDecodeURIComponent(getHash(path).substring(1));

    if (!pointer) {
        return [];
    }

    var tokens = pointer
        .split("/")
        .map((token) => token.replace(/~1/g, "/").replace(/~0/g, "~"));

    if (tokens[0] !== "") {
        throw new SyntaxError(
            `Invalid $ref pointer "${pointer}". Pointers must begin with "#/"`,
        );
    }

    return tokens.slice(1);
}

function joinPointer(base, tokens) {
    var joined = base.indexOf("#") === -1 ? `${base}#` : base;

    for (const token of Array.isArray(tokens) ? tokens : [tokens]) {
        joined += `/${token
            .replace(/%/g, "%25")
            .replace(/~/g, "~0")
            .replace(/\//g, "~1")}`;
    }

    return joined;
}

function isRef(value) {
    return (
        Boolean(value) &&
        typeof value === "object" &&
        "$ref" in value &&
        typeof value.$ref === "string" &&
        value.$ref.length > 0
    );
}

function isLocalRef(value) {
    return (
        isRef(value) &&
        (value.$ref.substring(0, 2) === "#/" ||
            /^#%2f/i.test(value.$ref) ||
            value.$ref === "#")
    );
}

function isRootPath(pathFromRoot) {
    return (
        typeof pathFromRoot === "string" &&
        parsePointer(pathFromRoot).length === 0
    );
}

function canonicalPath(pathFromRoot) {
    return typeof pathFromRoot === "string"
        ? resolveUrl(ROOT_PATH, pathFromRoot)
        : pathFromRoot;
}

function missingPointer(token, path) {
    return new SyntaxError(
        `Missing $ref pointer "${getHash(path)}". Token "${token}" does not exist.`,
    );
}

function resolveIfRef(root, pointer, pathFromRoot, visitedRefPaths) {
    var pathChanged = false;
    var currentPathFromRoot = pathFromRoot;
    var addedPaths = [];

    try {
        while (isLocalRef(pointer.value)) {
            const parentPath = pointer.path;
            const refPath = resolveUrl(pointer.path, pointer.value.$ref);

            if (refPath === pointer.path && !isRootPath(currentPathFromRoot)) {
                pointer.circular = true;
                pointer.chainCircular = true;
                return pathChanged;
            }

            if (
                refPath === canonicalPath(currentPathFromRoot) &&
                refPath !== pointer.path
            ) {
                pointer.chainCircular = true;
                return pathChanged;
            }

            if (visitedRefPaths.has(refPath)) {
                pointer.chainCircular = true;
                return pathChanged;
            }

            if (visitedRefPaths.size >= MAX_DEPTH) {
                throw new RangeError(
                    `Maximum dereference depth (${MAX_DEPTH}) exceeded at ${pointer.path}.`,
                );
            }

            visitedRefPaths.add(refPath);
            addedPaths.push(refPath);

            const resolved = walkPointer(
                root,
                refPath,
                parentPath,
                visitedRefPaths,
            );

            pointer.chainCircular ||=
                resolved.circular || resolved.chainCircular;
            pointer.path = resolved.path;
            pointer.value = resolved.value;
            pointer.location = resolved.location;
            currentPathFromRoot = parentPath;
            pathChanged = true;
        }

        return pathChanged;
    } finally {
        for (const path of addedPaths) {
            visitedRefPaths.delete(path);
        }
    }
}

function walkPointer(root, path, pathFromRoot, visitedRefPaths) {
    var tokens = parsePointer(path);
    var pointer = {
        path: path,
        location: ROOT_PATH,
        value: root,
        circular: false,
        chainCircular: false,
    };

    for (let i = 0; i < tokens.length; i++) {
        const wasChainCircular = pointer.chainCircular;

        if (resolveIfRef(root, pointer, pathFromRoot, visitedRefPaths)) {
            pointer.path = joinPointer(pointer.path, tokens.slice(i));
        }

        const token = tokens[i];

        if (
            pointer.value === null ||
            (typeof pointer.value !== "object" &&
                typeof pointer.value !== "function")
        ) {
            throw missingPointer(token, path);
        }

        if (
            !Object.hasOwn(pointer.value, token) ||
            pointer.value[token] === undefined ||
            (pointer.value[token] === null && i === tokens.length - 1)
        ) {
            let slashKeyFound = false;

            for (let j = tokens.length - 1; j > i; j--) {
                const joinedToken = tokens.slice(i, j + 1).join("/");
                if (
                    Object.hasOwn(pointer.value, joinedToken) &&
                    pointer.value[joinedToken] !== undefined
                ) {
                    pointer.value = pointer.value[joinedToken];
                    pointer.location = joinPointer(
                        pointer.location,
                        joinedToken,
                    );
                    i = j;
                    slashKeyFound = true;
                    break;
                }
            }

            if (slashKeyFound) {
                pointer.chainCircular = wasChainCircular;
                continue;
            }

            if (
                Object.hasOwn(pointer.value, token) &&
                pointer.value[token] === null
            ) {
                pointer.value = NULL_VALUE;
                pointer.location = joinPointer(pointer.location, token);
                pointer.chainCircular = wasChainCircular;
                continue;
            }

            throw missingPointer(token, path);
        }

        pointer.value = pointer.value[token];
        pointer.location = joinPointer(pointer.location, token);
        pointer.chainCircular = wasChainCircular;
    }

    var finalRefPath = pointer.value?.$ref
        ? resolveUrl(pointer.path, pointer.value.$ref)
        : undefined;

    if (
        isLocalRef(pointer.value) &&
        finalRefPath === canonicalPath(pathFromRoot) &&
        finalRefPath !== pointer.path
    ) {
        pointer.chainCircular = true;
    } else if (!pointer.value || finalRefPath) {
        resolveIfRef(root, pointer, pathFromRoot, visitedRefPaths);
    }

    return pointer;
}

function resolvePointer(root, path, pathFromRoot) {
    var pointer = walkPointer(root, path, pathFromRoot, new Set());

    if (pointer.value === NULL_VALUE) {
        pointer.value = null;
    }

    return pointer;
}

/**
 * Replaces the local JSON References in the document with the values they
 * point to, in place. Circular references stay as `$ref` objects unless
 * `resolveCirculars` is set, in which case they become circular objects.
 *
 * @param {object} doc - The sanitized document (mutated in place)
 * @param {object} options - `{ resolveCirculars: boolean }`
 *
 * @returns {*} The dereferenced document
 */
function dereference(doc, options) {
    var ignoreCirculars = !options?.resolveCirculars;
    var parents = new Set();
    var processedObjects = new Map();
    var dereferencedCache = new Map();

    function dereferenceRef(ref, location, pathFromRoot, depth) {
        var refPath = resolveUrl(location, ref.$ref);
        var cache = dereferencedCache.get(refPath);

        if (cache) {
            if (!cache.circular) {
                return cache;
            }
            if (
                typeof cache.value === "object" &&
                "$ref" in cache.value &&
                "$ref" in ref
            ) {
                if (cache.value.$ref === ref.$ref) {
                    return cache;
                }
            } else {
                return cache;
            }
        }

        var pointer = resolvePointer(doc, refPath, location);
        var directCircular = pointer.circular;
        var circular =
            directCircular ||
            pointer.chainCircular ||
            parents.has(pointer.value);
        var value = pointer.value;

        if (!circular) {
            const dereferenced = crawl(
                value,
                pointer.location,
                pathFromRoot,
                depth + 1,
            );
            circular = dereferenced.circular;
            value = dereferenced.value;
        }

        if (circular && !directCircular && ignoreCirculars) {
            value = ref;
        }

        if (directCircular && value !== ref) {
            value.$ref = pathFromRoot;
        }

        var result = { circular: circular, value: value };

        if (Object.keys(ref).length === 1) {
            dereferencedCache.set(refPath, result);
        }

        return result;
    }

    function crawl(obj, location, pathFromRoot, depth) {
        var result = { value: obj, circular: false };

        if (depth > MAX_DEPTH) {
            throw new RangeError(
                `Maximum dereference depth (${MAX_DEPTH}) exceeded at ${pathFromRoot}.`,
            );
        }

        if (!ignoreCirculars && processedObjects.has(obj)) {
            result.circular = processedObjects.get(obj) || false;
            return result;
        }

        if (!obj || typeof obj !== "object" || ArrayBuffer.isView(obj)) {
            return result;
        }

        parents.add(obj);
        processedObjects.set(obj, false);

        if (isLocalRef(obj)) {
            const dereferenced = dereferenceRef(
                obj,
                location,
                pathFromRoot,
                depth,
            );
            result.circular = dereferenced.circular;
            result.value = dereferenced.value;
        } else {
            for (const key of Object.keys(obj)) {
                const keyPathFromRoot = joinPointer(pathFromRoot, key);
                const childLocation = joinPointer(location, key);
                const value = obj[key];
                let circular;

                if (isLocalRef(value)) {
                    const dereferenced = dereferenceRef(
                        value,
                        childLocation,
                        keyPathFromRoot,
                        depth,
                    );
                    circular = dereferenced.circular;
                    if (obj[key] !== dereferenced.value) {
                        obj[key] = dereferenced.value;
                    }
                } else if (!parents.has(value)) {
                    const dereferenced = crawl(
                        value,
                        childLocation,
                        keyPathFromRoot,
                        depth + 1,
                    );
                    circular = dereferenced.circular;
                    if (obj[key] !== dereferenced.value) {
                        obj[key] = dereferenced.value;
                    }
                } else {
                    circular = true;
                }

                result.circular = result.circular || circular;
            }
        }

        parents.delete(obj);
        processedObjects.set(obj, result.circular);

        return result;
    }

    return crawl(doc, ROOT_PATH, "#", 0).value;
}

module.exports = { dereference };
