/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2015 Apigee Corporation
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

var formatValidators = require("./validation/format-validators");
var ZSchema = require("z-schema").default;

// z-schema v12 does not auto-resolve the JSON Schema draft-04 meta-schema
var draft04Schema = require("./validation/draft-04-schema.json");

ZSchema.setRemoteReference(
    "http://json-schema.org/draft-04/schema",
    draft04Schema,
);

// full-date from http://xml2rfc.ietf.org/public/rfc/html/rfc3339.html#anchor14
var dateRegExp = new RegExp(
    "^" +
        "\\d{4}" + // year
        "-" +
        "([0]\\d|1[012])" + // month
        "-" +
        "(0[1-9]|[12]\\d|3[01])" + // day
        "$",
);

// date-time from http://xml2rfc.ietf.org/public/rfc/html/rfc3339.html#anchor14
var dateTimeRegExp = new RegExp(
    "^" +
        "\\d{4}" + // year
        "-" +
        "([0]\\d|1[012])" + // month
        "-" +
        "(0[1-9]|[12]\\d|3[01])" + // day
        "T" +
        "([01]\\d|2[0-3])" + // hour
        ":" +
        "[0-5]\\d" + // minute
        ":" +
        "[0-5]\\d" + // second
        "(\\.\\d+)?" + // fractional seconds
        "(Z|(\\+|-)([01]\\d|2[0-4]):[0-5]\\d)" + // Z or time offset
        "$",
);

var collectionFormats = [undefined, "csv", "multi", "pipes", "ssv", "tsv"];
var jsonSchemaValidator = createJSONValidator();
// https://github.com/swagger-api/swagger-spec/blob/master/versions/2.0.md#parameter-object
var parameterSchemaProperties = [
    "allowEmptyValue",
    "default",
    "description",
    "enum",
    "exclusiveMaximum",
    "exclusiveMinimum",
    "format",
    "items",
    "maxItems",
    "maxLength",
    "maximum",
    "minItems",
    "minLength",
    "minimum",
    "multipleOf",
    "pattern",
    "type",
    "uniqueItems",
];
var types = ["array", "boolean", "integer", "object", "number", "string"];

function isPlainObject(value) {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    var proto = Object.getPrototypeOf(value);

    return proto === Object.prototype || proto === null;
}
module.exports.isPlainObject = isPlainObject;

function isObject(value) {
    return (
        value !== null &&
        (typeof value === "object" || typeof value === "function")
    );
}
module.exports.isObject = isObject;

function defineOwn(target, key, value) {
    Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value: value,
    });
}

function cloneDeepSeen(value, seen) {
    var clone;

    if (Array.isArray(value)) {
        if (seen.has(value)) {
            return seen.get(value);
        }

        clone = [];
        seen.set(value, clone);

        value.forEach((item, index) => {
            clone[index] = cloneDeepSeen(item, seen);
        });

        return clone;
    }

    if (value instanceof Date) {
        return new Date(value.getTime());
    }

    if (isPlainObject(value)) {
        if (seen.has(value)) {
            return seen.get(value);
        }

        clone = Object.create(Object.getPrototypeOf(value));
        seen.set(value, clone);

        Object.keys(value).forEach((key) => {
            defineOwn(clone, key, cloneDeepSeen(value[key], seen));
        });

        return clone;
    }

    return value;
}

function cloneDeep(value) {
    return cloneDeepSeen(value, new WeakMap());
}
module.exports.cloneDeep = cloneDeep;

function assignOwn(target, source) {
    Object.entries(source || {}).forEach(([key, value]) => {
        defineOwn(target, key, value);
    });

    return target;
}
module.exports.assignOwn = assignOwn;

function getIn(obj, path) {
    return path.reduce((acc, key) => acc?.[key], obj);
}
module.exports.getIn = getIn;

function findExtraParameters(expected, actual, location, results) {
    var codeSuffix = location.toUpperCase();

    switch (location) {
        case "formData":
            codeSuffix = "FORM_DATA";
            location = "form data field";
            break;
        case "query":
            location = "query parameter";
            break;

        // no default
    }

    actual.forEach((name) => {
        if (expected.indexOf(name) === -1) {
            results.errors.push({
                code: `REQUEST_ADDITIONAL_${codeSuffix}`,
                message: `Additional ${location} not allowed: ${name}`,
                path: [],
            });
        }
    });
}

function registerFormat(name, validator) {
    ZSchema.registerFormat(name, validator);
}

function unregisterFormat(name) {
    ZSchema.unregisterFormat(name);
}

function createJSONValidator() {
    var validator = ZSchema.create({
        version: "draft-04",
        breakOnFirstError: true,
        ignoreUnknownFormats: true,
        reportPathAsArray: true,
    });

    // Add the custom validators
    Object.keys(formatValidators).forEach((name) => {
        registerFormat(name, formatValidators[name]);
    });

    return validator;
}

function normalizeError(obj) {
    // Remove superfluous error details
    if (obj.schemaId === undefined) {
        delete obj.schemaId;
    }

    if (obj.inner) {
        obj.inner.forEach((nObj) => {
            normalizeError(nObj);
        });
    }
}

// Resolve a $ref string to its schema content. Handles local (#/...) refs and
// http://json-schema.org/draft-04/schema#/... external refs. Follows chains of $refs.
function resolveSchemaRef(ref, rootSchema, depth) {
    var resolved;
    var parts;
    var i;
    var hashIdx;
    var fragment;
    var j;

    depth = depth || 0;
    if (depth > 10 || typeof ref !== "string") {
        return undefined;
    }

    if (ref.charAt(0) === "#") {
        parts = ref.slice(1).split("/").filter(Boolean);
        resolved = rootSchema;
        for (i = 0; i < parts.length && resolved != null; i++) {
            if (typeof resolved !== "object") {
                resolved = undefined;
                break;
            }
            resolved =
                resolved[parts[i].replace(/~1/g, "/").replace(/~0/g, "~")];
        }
    } else {
        hashIdx = ref.indexOf("#");
        if (
            hashIdx >= 0 &&
            ref.slice(0, hashIdx) === "http://json-schema.org/draft-04/schema"
        ) {
            fragment = ref
                .slice(hashIdx + 1)
                .split("/")
                .filter(Boolean);
            resolved = draft04Schema;
            for (j = 0; j < fragment.length && resolved != null; j++) {
                if (typeof resolved !== "object") {
                    resolved = undefined;
                    break;
                }
                resolved =
                    resolved[
                        fragment[j].replace(/~1/g, "/").replace(/~0/g, "~")
                    ];
            }
        }
    }

    // Follow chained $refs
    if (
        resolved != null &&
        typeof resolved === "object" &&
        typeof resolved.$ref === "string"
    ) {
        return resolveSchemaRef(resolved.$ref, rootSchema, depth + 1);
    }
    return resolved;
}

var ZSCHEMA_SKIP_KEYS = new Set(["enum", "const", "default", "examples"]);

function patchSkippedRefs(obj, rootSchema) {
    if (obj == null || typeof obj !== "object" || Array.isArray(obj)) {
        return;
    }

    var key;
    var val;
    var resolved;
    var keys = Object.keys(obj);
    var i;
    for (i = 0; i < keys.length; i++) {
        key = keys[i];
        val = obj[key];

        if (val == null || typeof val !== "object") {
            continue;
        }

        if (ZSCHEMA_SKIP_KEYS.has(key) && !Array.isArray(val)) {
            // z-schema won't collect refs inside this value; inline any $ref now.
            if (typeof val.$ref === "string") {
                resolved = resolveSchemaRef(val.$ref, rootSchema);
                if (resolved != null && typeof resolved === "object") {
                    delete val.$ref;
                    Object.assign(val, cloneDeep(resolved));
                }
            }
            // Do not recurse — mirrors z-schema's own skip behavior.
        } else if (Array.isArray(val)) {
            val.forEach((item) => {
                patchSkippedRefs(item, rootSchema);
            });
        } else {
            patchSkippedRefs(val, rootSchema);
        }
    }
}

// Convert a z-schema v12 error detail to a plain object matching the v6 shape.
// z-schema v12 adds schemaPath/keyword and Symbol properties not present in v6.
function cleanError(err) {
    var clean = {};
    var rawValue;
    var unquotedValue;

    for (var key of Object.keys(err)) {
        clean[key] = err[key];
    }

    delete clean.schemaPath;
    delete clean.keyword;

    if (!clean.schemaId) {
        delete clean.schemaId;
    }

    if (!clean.title) {
        delete clean.title;
    }

    if (
        clean.code === "INVALID_FORMAT" &&
        Array.isArray(clean.params) &&
        clean.params.length >= 2
    ) {
        rawValue = clean.params[1];
        if (
            typeof rawValue === "string" &&
            rawValue.length >= 2 &&
            rawValue.charAt(0) === '"' &&
            rawValue.charAt(rawValue.length - 1) === '"'
        ) {
            try {
                unquotedValue = JSON.parse(rawValue);
                if (typeof unquotedValue === "string") {
                    clean.params = clean.params.slice();
                    clean.params[1] = unquotedValue;
                    clean.message =
                        "Object didn't pass validation for format " +
                        clean.params[0] +
                        ": " +
                        unquotedValue;
                }
            } catch (_e) {}
        }
    }

    normalizeError(clean);

    if (clean.inner) {
        clean.inner = clean.inner.map(cleanError);
    }

    return clean;
}

/**
 * Helper method to take a Swagger parameter definition and compute its schema.
 *
 * For non-body Swagger parameters, the definition itself is not suitable as a JSON Schema so we must compute it.
 *
 * @param {object} paramDef - The parameter definition
 *
 * @returns {object} The computed schema
 */
module.exports.computeParameterSchema = (paramDef) => {
    var schema;

    if (paramDef.schema === undefined) {
        schema = {};

        // Build the schema from the schema-like parameter structure
        parameterSchemaProperties.forEach((name) => {
            if (paramDef[name] !== undefined) {
                schema[name] = paramDef[name];
            }
        });
    } else {
        schema = paramDef.schema;
    }

    return schema;
};

/**
 * Converts a raw JavaScript value to a JSON Schema value based on its schema.
 *
 * @param {object} schema - The schema for the value
 * @param {object} options - The conversion options
 * @param {string} [options.collectionFormat] - The collection format
 * @param {string} [options.encoding] - The encoding if the raw value is a `Buffer`
 * @param {*} value - The value to convert
 *
 * @returns {*} The converted value
 *
 * @throws {TypeError} IF the `collectionFormat` or `type` is invalid for the `schema`, or if conversion fails
 */
var convertValue = (schema, options, value) => {
    var originalValue = value; // Used in error reporting for invalid values
    var type = isPlainObject(schema) ? schema.type : undefined;
    var pValue = value;
    var pType = typeof pValue;
    var err;
    var isDate;
    var isDateTime;

    // If there is an explicit type provided, make sure it's one of the supported ones
    if (
        schema != null &&
        Object.hasOwn(schema, "type") &&
        types.indexOf(type) === -1
    ) {
        throw new TypeError(`Invalid 'type' value: ${type}`);
    }

    // Since JSON Schema allows you to not specify a type and it is treated as a wildcard of sorts, we should not do any
    // coercion for these types of values.
    if (type === undefined) {
        return value;
    }

    // If there is no value, do not convert it
    if (value === undefined) {
        return value;
    }

    // Convert Buffer value to String
    // (We use this type of check to identify Buffer objects.  The browser does not have a Buffer type and to avoid having
    //  import the browserify buffer module, we just do a simple check.  This is brittle but should work.)
    if (typeof value.readUInt8 === "function") {
        value = value.toString(options.encoding);
        pValue = value;
        pType = typeof value;
    }

    // If the value is empty and empty is allowed, use it
    if (schema.allowEmptyValue && value === "") {
        return value;
    }

    // Attempt to parse the string as JSON if the type is array or object
    if (["array", "object"].indexOf(type) > -1 && typeof value === "string") {
        if (
            (type === "array" && value.indexOf("[") === 0) ||
            (type === "object" && value.indexOf("{") === 0)
        ) {
            try {
                value = JSON.parse(value);
                // eslint-disable-next-line  no-unused-vars
            } catch (_err) {
                // Nothing to do here, just fall through
            }
        }
    }

    switch (type) {
        case "array":
            if (typeof value === "string") {
                if (
                    collectionFormats.indexOf(options.collectionFormat) === -1
                ) {
                    throw new TypeError(
                        "Invalid 'collectionFormat' value: " +
                            options.collectionFormat,
                    );
                }

                switch (options.collectionFormat) {
                    case "csv":
                    case undefined:
                        value = value.split(",");
                        break;
                    case "multi":
                        value = [value];
                        break;
                    case "pipes":
                        value = value.split("|");
                        break;
                    case "ssv":
                        value = value.split(" ");
                        break;
                    case "tsv":
                        value = value.split("\t");
                        break;

                    // no default
                }
            }

            if (Array.isArray(value)) {
                value = value.map((item, index) =>
                    convertValue(
                        Array.isArray(schema.items)
                            ? schema.items[index]
                            : schema.items,
                        options,
                        item,
                    ),
                );
            }

            break;
        case "boolean":
            if (typeof value !== "boolean") {
                if (value === "true") {
                    value = true;
                } else if (value === "false") {
                    value = false;
                } else {
                    err = new TypeError(`Not a valid boolean: ${value}`);
                }
            }

            break;
        case "integer":
            if (typeof value !== "number") {
                if (typeof value === "string" && value.trim().length === 0) {
                    value = NaN;
                }

                value = Number(value);

                if (Number.isNaN(value)) {
                    err = new TypeError(
                        `Not a valid integer: ${originalValue}`,
                    );
                }
            }

            break;
        case "number":
            if (typeof value !== "number") {
                if (typeof value === "string" && value.trim().length === 0) {
                    value = NaN;
                }

                value = Number(value);

                if (Number.isNaN(value)) {
                    err = new TypeError(`Not a valid number: ${originalValue}`);
                }
            }
            break;
        case "string":
            if (["date", "date-time"].indexOf(schema.format) > -1) {
                if (typeof value === "string") {
                    isDate = schema.format === "date" && dateRegExp.test(value);
                    isDateTime =
                        schema.format === "date-time" &&
                        dateTimeRegExp.test(value);

                    if (!isDate && !isDateTime) {
                        err = new TypeError(
                            "Not a valid " +
                                schema.format +
                                " string: " +
                                originalValue,
                        );
                        err.code = "INVALID_FORMAT";
                    } else {
                        value = new Date(value);
                    }
                }

                if (
                    !(value instanceof Date) ||
                    value.toString() === "Invalid Date"
                ) {
                    err = new TypeError(
                        "Not a valid " +
                            schema.format +
                            " string: " +
                            originalValue,
                    );

                    err.code = "INVALID_FORMAT";
                }
            } else if (typeof value !== "string") {
                err = new TypeError(`Not a valid string: ${value}`);
            }

            break;

        // no default
    }

    if (err !== undefined) {
        // Convert the error to be more like a JSON Schema validation error
        if (err.code === undefined) {
            err.code = "INVALID_TYPE";
            err.message = `Expected type ${type} but found type ${pType}`;
        } else {
            err.message =
                "Object didn't pass validation for format " +
                schema.format +
                ": " +
                pValue;
        }

        // Format and type errors resemble JSON Schema validation errors
        err.failedValidation = true;
        err.path = [];

        throw err;
    }

    return value;
};
module.exports.convertValue = convertValue;

/**
 * Returns the provided content type or `application/octet-stream` if one is not provided.
 *
 * @see http://www.w3.org/Protocols/rfc2616/rfc2616-sec7.html#sec7.2.1
 *
 * @param {object} headers - The headers to search
 *
 * @returns {string} The content type
 */
module.exports.getContentType = (headers) =>
    getHeaderValue(headers, "content-type") || "application/octet-stream";

/**
 * Returns the header value regardless of the case of the provided/requested header name.
 *
 * @param {object} headers - The headers to search
 * @param {string} headerName - The header name
 *
 * @returns {string} The header value or `undefined` if it is not found
 */
var getHeaderValue = (headers, headerName) => {
    // Default to an empty object
    headers = headers || {};

    var lcHeaderName = headerName.toLowerCase();
    var realHeaderName = Object.keys(headers).find(
        (header) => header.toLowerCase() === lcHeaderName,
    );

    return headers[realHeaderName];
};
module.exports.getHeaderValue = getHeaderValue;

/**
 * Returns the path of a request URL, without query string or fragment. Absolute URLs have their origin removed.
 *
 * @param {object} req - The http client request *(or equivalent)*
 *
 * @returns {string} The request path
 */
module.exports.getRequestPathname = (req) => {
    var url = req.originalUrl || req.url;
    var queryStart = url.search(/[?#]/);
    var path = (queryStart === -1 ? url : url.slice(0, queryStart)).replace(
        /\\/g,
        "/",
    );
    var origin = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(path);

    return origin ? path.slice(origin[0].length) || "/" : path;
};

/**
 * Returns a z-schema validator.
 *
 * @returns {object} The z-schema validator to use
 */
module.exports.getJSONSchemaValidator = () => jsonSchemaValidator;

module.exports.parameterLocations = [
    "body",
    "formData",
    "header",
    "path",
    "query",
];

/**
 * Process validators.
 *
 * @param {object|module:Sway~ServerResponseWrapper} target - The thing being validated
 * @param {module:Sway~SwaggerApi|module:Sway~Operation|module:Sway~Response} caller - The object requesting validation _(can be `undefined`)_
 * @param {module:Sway~DocumentValidationFunction[]|module:Sway~RequestValidationFunction[]|module:Sway~ResposeValidationFunction[]} validators - The validators
 * @param {module:Sway~ValidationResults} results - The cumulative validation results
 */
module.exports.processValidators = (target, caller, validators, results) => {
    (validators || []).forEach((validator) => {
        var vArgs = [target];
        var vResults;

        if (caller !== undefined) {
            vArgs.push(caller);
        }

        vResults = validator.apply(undefined, vArgs);

        if (vResults !== undefined) {
            if (vResults.errors !== undefined && vResults.errors.length > 0) {
                results.errors.push.apply(results.errors, vResults.errors);
            }

            if (
                vResults.warnings !== undefined &&
                vResults.warnings.length > 0
            ) {
                results.warnings.push.apply(
                    results.warnings,
                    vResults.warnings,
                );
            }
        }
    });
};

/**
 * Registers a custom format.
 *
 * @param {string} name - The name of the format
 * @param {function} validator - The format validator *(See [ZSchema Custom Format](https://github.com/zaggino/z-schema#register-a-custom-format))*
 */
module.exports.registerFormat = registerFormat;

/**
 * Replaces the circular references in the provided object with an empty object.
 *
 * @param {object} obj - The JavaScript object
 */
module.exports.removeCirculars = (obj) => {
    walk(obj, (node, path, ancestors) => {
        var target;

        // Replace circulars with {}
        if (ancestors.indexOf(node) > -1) {
            target = path.slice(0, -1).reduce((acc, key) => acc[key], obj);

            if (path.length > 0) {
                target[path[path.length - 1]] = {};
            }
        }
    });
};

/**
 * Unregisters a custom format.
 *
 * @param {string} name - The name of the format
 */
module.exports.unregisterFormat = unregisterFormat;

/**
 * Validates the provided value against the JSON Schema by name or value.
 *
 * @param {object} validator - The JSON Schema validator created via {@link #createJSONValidator}
 * @param {object} schema - The JSON Schema
 * @param {*} value - The value to validate
 *
 * @returns {object} Object containing the errors and warnings of the validation
 */
module.exports.validateAgainstSchema = (validator, schema, value) => {
    schema = cloneDeep(schema); // Clone the schema as z-schema alters the provided document
    patchSkippedRefs(schema, schema);

    var response = {
        errors: [],
        warnings: [],
    };

    var result = validator.validateSafe(value, schema);
    if (!result.valid) {
        if (!result.err.details) {
            throw result.err;
        }
        response.errors = result.err.details.map(cleanError);
    }

    return response;
};

/**
 * Validates the content type.
 *
 * @param {string} contentType - The Content-Type value of the request/response
 * @param {string[]} supportedTypes - The supported (declared) Content-Type values for the request/response
 * @param {object} results - The results object to update in the event of an invalid content type
 */
module.exports.validateContentType = (contentType, supportedTypes, results) => {
    var rawContentType = contentType;

    if (contentType !== undefined) {
        // http://www.w3.org/Protocols/rfc2616/rfc2616-sec14.html#sec14.17
        contentType = contentType.split(";")[0]; // Strip the parameter(s) from the content type
    }

    // Check for exact match or mime-type only match
    if (
        supportedTypes.indexOf(rawContentType) === -1 &&
        supportedTypes.indexOf(contentType) === -1
    ) {
        results.errors.push({
            code: "INVALID_CONTENT_TYPE",
            message:
                "Invalid Content-Type (" +
                contentType +
                ").  These are supported: " +
                supportedTypes.join(", "),
            path: [],
        });
    }
};

/**
 * Walk an object and invoke the provided function for each node.
 *
 * @param {*} obj - The object to walk
 * @param {function} [fn] - The function to invoke
 */
var walk = (obj, fn) => {
    var callFn = typeof fn === "function";

    function doWalk(ancestors, node, path) {
        if (callFn) {
            fn(node, path, ancestors);
        }

        // We do not process circular objects again
        if (ancestors.indexOf(node) === -1) {
            ancestors.push(node);

            if (Array.isArray(node)) {
                node.forEach((member, index) => {
                    doWalk(ancestors, member, path.concat(index.toString()));
                });
            } else if (isPlainObject(node)) {
                Object.keys(node).forEach((key) => {
                    doWalk(ancestors, node[key], path.concat(key));
                });
            }
        }

        ancestors.pop();
    }

    doWalk([], obj, []);
};
module.exports.walk = walk;

var NAMED_MEMBER_CONTAINERS = new Set([
    "definitions",
    "headers",
    "parameters",
    "patternProperties",
    "properties",
    "responses",
]);
var DATA_KEYWORDS = new Set([
    "const",
    "default",
    "enum",
    "example",
    "examples",
]);
var SECTIONS_WITHOUT_SCHEMAS = new Set([
    "externalDocs",
    "info",
    "security",
    "securityDefinitions",
    "tags",
]);

function findMemberNames(path) {
    var isMemberName = [false];

    for (let index = 1; index < path.length; index++) {
        isMemberName.push(
            !isMemberName[index - 1] &&
                NAMED_MEMBER_CONTAINERS.has(path[index - 1]),
        );
    }

    return isMemberName;
}

function isPatternKeyword(path) {
    var last = path.length - 1;

    if (path[last] !== "pattern" || SECTIONS_WITHOUT_SCHEMAS.has(path[0])) {
        return false;
    }

    var isMemberName = findMemberNames(path);

    return (
        !isMemberName[last] &&
        !path.some(
            (key, index) =>
                !isMemberName[index] &&
                (DATA_KEYWORDS.has(key) || key.startsWith("x-")),
        )
    );
}

function findPatternRejection(pattern) {
    var result = jsonSchemaValidator.validateSafe("", { pattern: pattern });

    return result.valid
        ? undefined
        : result.err.details?.find(
              (detail) => detail.code === "KEYWORD_PATTERN",
          );
}

/**
 * Finds the `pattern` values in a Swagger definition that the JSON Schema validator refuses to compile, either
 * because they are invalid or because they are considered unsafe (ReDoS).
 *
 * @param {object} definition - The Swagger definition
 *
 * @returns {object[]} The rejected patterns, each with `code`, `message` and `path`
 */
module.exports.findRejectedPatterns = (definition) => {
    var rejected = [];

    walk(definition, (node, path, ancestors) => {
        var rejection;

        if (
            typeof node !== "string" ||
            !isPatternKeyword(path) ||
            ancestors.some(
                (ancestor) => isPlainObject(ancestor) && "$ref" in ancestor,
            )
        ) {
            return;
        }

        rejection = findPatternRejection(node);

        if (rejection) {
            rejected.push({
                code: rejection.code,
                message: rejection.message,
                path: path,
            });
        }
    });

    return rejected;
};

/**
 * Validates that each item in the array are of type function.
 *
 * @param {array} arr - The array
 * @param {string} paramName - The parameter name
 */
module.exports.validateOptionsAllAreFunctions = (arr, paramName) => {
    (arr || []).forEach((item, index) => {
        if (typeof item !== "function") {
            throw new TypeError(
                "options." +
                    paramName +
                    " at index " +
                    index +
                    " must be a function",
            );
        }
    });
};

/**
 * Validates the request/response strictly based on the provided options.
 *
 * @param {module:Sway~Operation|module:Sway~Response} opOrRes - The Sway operation or response
 * @param {object|module:Sway~ServerResponseWrapper} reqOrRes - The http client request *(or equivalent)* or the
 *                                                              response or *(response like object)*
 * @param {object} strictMode - The options for configuring strict mode
 * @param {boolean} options.formData - Whether or not form data parameters should be validated strictly
 * @param {boolean} options.header - Whether or not header parameters should be validated strictly
 * @param {boolean} options.query - Whether or not query parameters should be validated strictly
 * @param {module:Sway~ValidationResults} results - The validation results
 */
module.exports.validateStrictMode = (
    opOrRes,
    reqOrRes,
    strictMode,
    results,
) => {
    var definedParameters = {
        formData: [],
        header: [],
        query: [],
    };
    var mode = opOrRes.constructor.name === "Operation" ? "req" : "res";
    var strictModeValidation = {
        formData: false,
        header: false,
        query: false,
    };

    if (strictMode !== undefined) {
        if (typeof strictMode !== "boolean" && !isPlainObject(strictMode)) {
            throw new TypeError(
                "options.strictMode must be a boolean or an object",
            );
        } else if (isPlainObject(strictMode)) {
            ["formData", "header", "query"].forEach((location) => {
                if (strictMode[location] !== undefined) {
                    if (typeof strictMode[location] !== "boolean") {
                        throw new TypeError(
                            "options.strictMode." +
                                location +
                                " must be a boolean",
                        );
                    } else {
                        strictModeValidation[location] = strictMode[location];
                    }
                }
            });
        } else if (strictMode === true) {
            strictModeValidation.formData = true;
            strictModeValidation.header = true;
            strictModeValidation.query = true;
        }
    }

    // Only process the parameters if necessary
    if (
        strictModeValidation.formData === true ||
        strictModeValidation.header === true ||
        strictModeValidation.query === true
    ) {
        (mode === "req" ? opOrRes : opOrRes.operationObject)
            .getParameters()
            .forEach((parameter) => {
                if (Array.isArray(definedParameters[parameter.in])) {
                    definedParameters[parameter.in].push(parameter.name);
                }
            });
    }

    // Validating form data only matters for requests
    if (strictModeValidation.formData === true && mode === "req") {
        findExtraParameters(
            definedParameters.formData,
            isPlainObject(reqOrRes.body) ? Object.keys(reqOrRes.body) : [],
            "formData",
            results,
        );
    }

    // Always validate the headers for requests and responses
    if (strictModeValidation.header === true) {
        findExtraParameters(
            definedParameters.header,
            isPlainObject(reqOrRes.headers)
                ? Object.keys(reqOrRes.headers)
                : [],
            "header",
            results,
        );
    }

    // Validating the query string only matters for requests
    if (strictModeValidation.query === true && mode === "req") {
        findExtraParameters(
            definedParameters.query,
            isPlainObject(reqOrRes.query) ? Object.keys(reqOrRes.query) : [],
            "query",
            results,
        );
    }
};
