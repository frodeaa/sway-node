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

var helpers = require("../helpers");
var { pathToPtr, pathFromPtr } = require("../json-ref-utils");
var supportedHttpMethods = require("../swagger-methods");
var swaggerSchema = require("swagger-schema-official/schema");

// Splits a parameters/responses/etc. collection into [name, value] pairs, since these
// collections are sometimes arrays (path/operation-level parameters) and sometimes maps
// (global parameters, responses, definitions) depending on where they appear in the
// Swagger document.
function toEntries(collection) {
    if (Array.isArray(collection)) {
        return collection.map((value, index) => [index.toString(), value]);
    }

    return Object.keys(collection || {}).map((key) => [key, collection[key]]);
}

function getSchemaProperties(schema) {
    var properties = Object.keys(schema.properties || {}); // Start with the defined properties

    // Add properties defined in the parent
    (schema.allOf || []).forEach((parent) => {
        getSchemaProperties(parent).forEach((property) => {
            if (properties.indexOf(property) === -1) {
                properties.push(property);
            }
        });
    });

    return properties;
}

function walkSchema(api, blacklist, schema, path, handlers, response) {
    var type = schema.type || "object";

    function shouldSkip(cPath) {
        return blacklist.indexOf(pathToPtr(cPath)) > -1;
    }

    // Do not process items in the blacklist as they've been processed already
    if (shouldSkip(path)) {
        return;
    }

    function walker(pSchema, pPath) {
        // Do not process items in the blacklist as they've been processed already
        if (shouldSkip(pPath)) {
            return;
        }

        toEntries(pSchema).forEach(([name, item]) => {
            walkSchema(
                api,
                blacklist,
                item,
                pPath.concat(name),
                handlers,
                response,
            );
        });
    }

    if (schema.schema !== undefined) {
        walkSchema(
            api,
            blacklist,
            schema.schema,
            path.concat("schema"),
            handlers,
            response,
        );
    } else if (type === "array" && schema.items !== undefined) {
        if (Array.isArray(schema.items)) {
            walker(schema.items, path.concat("items"));
        } else {
            walkSchema(
                api,
                blacklist,
                schema.items,
                path.concat("items"),
                handlers,
                response,
            );
        }
    } else if (type === "object") {
        if (schema.additionalProperties !== undefined) {
            walkSchema(
                api,
                blacklist,
                schema.additionalProperties,
                path.concat("additionalProperties"),
                handlers,
                response,
            );
        }

        ["allOf", "properties"].forEach((propName) => {
            if (schema[propName] !== undefined) {
                walker(schema[propName], path.concat(propName));
            }
        });
    }

    handlers.forEach((handler) => {
        handler(api, response, schema, path);
    });
}

/**
 * Validates the resolved Swagger document against the Swagger 2.0 JSON Schema.
 *
 * @param {SwaggerApi} api - The SwaggerApi object
 *
 * @returns {object} Object containing the errors and warnings of the validation
 */
function validateStructure(api) {
    var results = helpers.validateAgainstSchema(
        helpers.getJSONSchemaValidator(),
        swaggerSchema,
        api.definitionFullyResolved,
    );

    // Make complex JSON Schema validation errors easier to understand (Issue 15)
    results.errors = results.errors.map((error) => {
        var defType =
            ["additionalProperties", "items"].indexOf(
                error.path[error.path.length - 1],
            ) > -1
                ? "schema"
                : error.path[error.path.length - 2];

        if (["ANY_OF_MISSING", "ONE_OF_MISSING"].indexOf(error.code) > -1) {
            switch (defType) {
                case "parameters":
                    defType = "parameter";
                    break;

                case "responses":
                    defType = "response";
                    break;

                case "schema":
                    defType += ` ${error.path[error.path.length - 1]}`;

                // no default
            }

            error.message = `Not a valid ${defType} definition`;
        }

        return error;
    });

    // Treat invalid/missing references as structural errors
    Object.keys(api.references || {}).forEach((refPtr) => {
        var refDetails = api.references[refPtr];
        var refPath = pathFromPtr(refPtr);
        var err;

        if (refDetails.missing) {
            err = {
                code: "UNRESOLVABLE_REFERENCE",
                message: `Reference could not be resolved: ${refDetails.uri}`,
                path: refPath.concat("$ref"),
            };

            // Object.hasOwn is ES2022; hasOwnProperty.call keeps this ES2021-compatible.
            // biome-ignore lint/suspicious/noPrototypeBuiltins: see above
            if (Object.prototype.hasOwnProperty.call(refDetails, "error")) {
                err.error = refDetails.error;
            }

            results.errors.push(err);
        } else if (refDetails.type === "invalid") {
            results.errors.push({
                code: "INVALID_REFERENCE",
                message: refDetails.error || "Invalid JSON Reference",
                path: refPath.concat("$ref"),
            });
        } else if (
            // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn is ES2022; this file targets ES2021
            Object.prototype.hasOwnProperty.call(refDetails, "warning")
        ) {
            // warnings are created for JSON References with superfluous properties which will be ignored
            results.warnings.push({
                code: "EXTRA_REFERENCE_PROPERTIES",
                message: refDetails.warning,
                path: refPath,
            });
        }
    });

    return results;
}

/* Schema Object Validators */

function validateArrayTypeItemsExistence(_api, response, schema, path) {
    if (schema.type === "array" && schema.items === undefined) {
        response.errors.push({
            code: "OBJECT_MISSING_REQUIRED_PROPERTY",
            message: "Missing required property: items",
            path: path,
        });
    }
}

function validateDefaultValue(_api, response, schema, path) {
    var result;

    if (schema.default !== undefined) {
        result = helpers.validateAgainstSchema(
            helpers.getJSONSchemaValidator(),
            schema,
            schema.default,
        );

        result.errors.forEach((error) => {
            error.path = path.concat(error.path.concat("default"));

            response.errors.push(error);
        });

        result.warnings.forEach((warning) => {
            warning.path = path.concat(warning.path.push("default"));

            response.warnings.push(warning);
        });
    }
}

function validateSchemaProperties(_api, response, schema, path) {
    var required = Array.isArray(schema.required) ? schema.required : [];
    var properties = getSchemaProperties(schema);

    required
        .filter((name) => properties.indexOf(name) === -1)
        .forEach((name) => {
            response.errors.push({
                code: "OBJECT_MISSING_REQUIRED_PROPERTY_DEFINITION",
                message: `Missing required property definition: ${name}`,
                path: path,
            });
        });
}

/**
 * Validates all references.
 *
 * * Identifies circular inheritance references
 * * Identifies unreferenced referenceable definitions
 * * Identifies unresolvable references
 *
 * @param {SwaggerApi} api - The SwaggerApi object
 *
 * @returns {object} Object containing the errors and warnings of the validation
 */
function validateReferences(api) {
    var inheritanceDetails = {};
    var referenceable = [];
    var references = {};
    var response = {
        errors: [],
        warnings: [],
    };

    function addAncestor(dsc, anc) {
        // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn is ES2022; this file targets ES2021
        if (!Object.prototype.hasOwnProperty.call(inheritanceDetails, dsc)) {
            inheritanceDetails[dsc] = {
                lineage: [],
                parents: [anc],
            };
        } else {
            inheritanceDetails[dsc].parents.push(anc);
        }
    }

    function addReference(ref, ptr) {
        if (references[ref] === undefined) {
            references[ref] = [];
        }

        // Add references to ancestors
        if (ref.indexOf("allOf") > -1) {
            addReference(ref.substring(0, ref.lastIndexOf("/allOf")));
        }

        references[ref].push(ptr);
    }

    function createSecurityProcessor(path) {
        return (security, index) => {
            Object.keys(security).forEach((name) => {
                var scopes = security[name];
                var sdPath = ["securityDefinitions", name];
                var sdPtr = pathToPtr(sdPath);
                var srPath = path.concat([index.toString(), name]);

                // Identify missing reference to the security definition
                if (referenceable.indexOf(sdPtr) === -1) {
                    response.errors.push({
                        code: "UNRESOLVABLE_REFERENCE",
                        message:
                            "Security definition could not be resolved: " +
                            name,
                        path: srPath,
                    });
                } else {
                    addReference(sdPtr, pathToPtr(srPath));

                    scopes.forEach((scope, sIndex) => {
                        var ssrPath = srPath.concat(sIndex.toString());
                        var ssrPtr = pathToPtr(
                            sdPath.concat(["scopes", scope]),
                        );

                        if (referenceable.indexOf(ssrPtr) === -1) {
                            response.errors.push({
                                code: "UNRESOLVABLE_REFERENCE",
                                message:
                                    "Security scope definition could not be resolved: " +
                                    scope,
                                path: ssrPath,
                            });
                        } else {
                            addReference(
                                pathToPtr(sdPath.concat(["scopes", scope])),
                                ssrPtr,
                            );
                        }
                    });
                }
            });
        };
    }

    function walkLineage(root, id, lineage) {
        var details = inheritanceDetails[id || root];

        if (details) {
            details.parents.forEach((parent) => {
                lineage.push(parent);

                if (root !== parent) {
                    walkLineage(root, parent, lineage);
                }
            });
        }
    }

    // Identify referenceable definitions
    Object.keys(api.definitionFullyResolved.definitions || {}).forEach(
        (name) => {
            referenceable.push(pathToPtr(["definitions", name]));
        },
    );

    Object.keys(api.definitionFullyResolved.parameters || {}).forEach(
        (name) => {
            referenceable.push(pathToPtr(["parameters", name]));
        },
    );

    Object.keys(api.definitionFullyResolved.responses || {}).forEach((name) => {
        referenceable.push(pathToPtr(["responses", name]));
    });

    Object.keys(api.definitionFullyResolved.securityDefinitions || {}).forEach(
        (name) => {
            var def = api.definitionFullyResolved.securityDefinitions[name];
            var sPath = ["securityDefinitions", name];

            referenceable.push(pathToPtr(sPath));

            Object.keys(def.scopes || {}).forEach((scope) => {
                var ptr = pathToPtr(sPath.concat(["scopes", scope]));

                if (referenceable.indexOf(ptr) === -1) {
                    referenceable.push(ptr);
                }
            });
        },
    );

    // Identify references and build inheritance model
    Object.keys(api.references || {}).forEach((ptr) => {
        var metadata = api.references[ptr];
        var ptrPath = pathFromPtr(ptr);

        if (
            // biome-ignore lint/suspicious/noPrototypeBuiltins: Object.hasOwn is ES2022; this file targets ES2021
            !Object.prototype.hasOwnProperty.call(metadata, "missing") &&
            metadata.type !== "invalid"
        ) {
            // Bookkeeping (matching against referenceable/ancestor pointers, which are
            // always built via pathToPtr) must use the canonical pointer rather than the
            // raw, possibly percent-encoded $ref URI, or e.g. "#/definitions/Foo%20Bar"
            // won't line up with the "#/definitions/Foo Bar" it actually resolves to.
            const canonicalUri = metadata.canonicalUri || metadata.uri;

            addReference(canonicalUri, ptr);

            if (ptrPath[ptrPath.length - 2] === "allOf") {
                addAncestor(
                    pathToPtr(ptrPath.slice(0, ptrPath.length - 2)),
                    canonicalUri,
                );
            }
        }
    });

    // Identify circular inheritance
    Object.keys(inheritanceDetails).forEach((ptr) => {
        var details = inheritanceDetails[ptr];

        walkLineage(ptr, undefined, details.lineage);

        if (
            (details.lineage.length > 1 &&
                details.lineage[details.lineage.length - 1] === ptr) ||
            details.parents[0] === ptr
        ) {
            response.errors.push({
                code: "CIRCULAR_INHERITANCE",
                lineage: [ptr].concat(details.lineage),
                message: `Schema object inherits from itself: ${ptr}`,
                path: pathFromPtr(ptr),
            });
        }
    });

    // Identify references and validate missing references for non-JSON References (security)
    (api.definitionFullyResolved.security || []).forEach(
        createSecurityProcessor(["security"]),
    );

    Object.keys(api.definitionFullyResolved.paths || {}).forEach((name) => {
        var pathDef = api.definitionFullyResolved.paths[name];
        var pPath = ["paths", name];

        (pathDef.security || []).forEach(
            createSecurityProcessor(pPath.concat("security")),
        );

        Object.keys(pathDef).forEach((method) => {
            var operationDef = pathDef[method];

            // Do not process non-operations
            if (supportedHttpMethods.indexOf(method) === -1) {
                return;
            }

            (operationDef.security || []).forEach(
                createSecurityProcessor(pPath.concat([method, "security"])),
            );
        });
    });

    // Identify unused references (missing references are already handled above)
    var usedReferences = Object.keys(references);

    referenceable
        .filter((ptr) => usedReferences.indexOf(ptr) === -1)
        .forEach((ptr) => {
            response.warnings.push({
                code: "UNUSED_DEFINITION",
                message: `Definition is not used: ${ptr}`,
                path: pathFromPtr(ptr),
            });
        });

    return response;
}

/**
 * Validates all schema objects and schema-like objects (non-body path parameters).
 *
 * * Validates circular references related to composition/inheritance
 * * Validates that all array types have their required items property
 *     (@see {@link https://github.com/swagger-api/swagger-spec/issues/174})
 * * Validates that all default values are valid based on its respective schema
 *
 * @param {SwaggerApi} api - The SwaggerApi object
 *
 * @returns {object} Object containing the errors and warnings of the validation
 */
function validateSchemaObjects(api) {
    // Build a blacklist to avoid cascading errors/warnings
    var blacklist = Object.keys(api.references || {}).reduce((list, ptr) => {
        var refPath = pathFromPtr(ptr);

        list.push(pathToPtr(refPath));

        return list;
    }, []);
    var response = {
        errors: [],
        warnings: [],
    };
    var validators = [
        validateArrayTypeItemsExistence,
        validateDefaultValue,
        validateSchemaProperties,
    ];

    function validateParameters(parameters, path) {
        toEntries(parameters).forEach(([name, parameterDef]) => {
            var pPath = path.concat(name);

            // Create JSON Schema for non-body parameters
            if (parameterDef.in !== "body") {
                parameterDef = helpers.computeParameterSchema(parameterDef);
            }

            walkSchema(
                api,
                blacklist,
                parameterDef,
                pPath,
                validators,
                response,
            );
        });
    }

    function validateResponses(responses, path) {
        Object.keys(responses || {}).forEach((name) => {
            var responseDef = responses[name];
            var rPath = path.concat(name);

            Object.keys(responseDef.headers || {}).forEach((hName) => {
                var header = responseDef.headers[hName];

                walkSchema(
                    api,
                    blacklist,
                    header,
                    rPath.concat(["headers", hName]),
                    validators,
                    response,
                );
            });

            if (responseDef.schema !== undefined) {
                walkSchema(
                    api,
                    blacklist,
                    responseDef.schema,
                    rPath.concat("schema"),
                    validators,
                    response,
                );
            }
        });
    }

    // Validate definitions
    Object.keys(api.definitionFullyResolved.definitions || {}).forEach(
        (name) => {
            walkSchema(
                api,
                blacklist,
                api.definitionFullyResolved.definitions[name],
                ["definitions", name],
                validators,
                response,
            );
        },
    );

    // Validate global parameter definitions
    validateParameters(api.definitionFullyResolved.parameters, ["parameters"]);

    // Validate global response definitions
    validateResponses(api.definitionFullyResolved.responses, ["responses"]);

    // Validate paths and operations
    Object.keys(api.definitionFullyResolved.paths || {}).forEach((path) => {
        var pathDef = api.definitionFullyResolved.paths[path];
        var pPath = ["paths", path];

        // Validate path-level parameter definitions
        validateParameters(pathDef.parameters, pPath.concat("parameters"));

        Object.keys(pathDef).forEach((method) => {
            var operationDef = pathDef[method];
            var oPath = pPath.concat(method);

            // Do not process non-operations
            if (supportedHttpMethods.indexOf(method) === -1) {
                return;
            }

            // Validate operation parameter definitions
            validateParameters(
                operationDef.parameters,
                oPath.concat("parameters"),
            );

            // Validate operation response definitions
            validateResponses(
                operationDef.responses,
                oPath.concat("responses"),
            );
        });
    });

    return response;
}

/**
 * Validates paths and operations (Written as one validator to avoid multiple passes)
 *
 * * Ensure that path parameters are defined for each path parameter declaration
 * * Ensure that defined path parameters match a declared path parameter
 * * Ensure that paths are functionally different
 * * Ensure that an operation only has one body parameter
 * * Ensure that an operation has only a body or formData parameter but not both
 * * Ensure that all operation parameters are unique (in + name)
 * * Ensure that all operation ids are unique
 * * Ensure that path parameters have a name
 *
 * @param {SwaggerApi} api - The SwaggerApi object
 *
 * @returns {object} Object containing the errors and warnings of the validation
 */
function validatePathsAndOperations(api) {
    var response = {
        errors: [],
        warnings: [],
    };

    function validateDuplicateParameter(seenParameters, parameter, path) {
        var pName = `${parameter.in}:${parameter.name}`;

        // Identify duplicate parameter names
        if (seenParameters.indexOf(pName) > -1) {
            response.errors.push({
                code: "DUPLICATE_PARAMETER",
                message:
                    "Operation cannot have duplicate parameters: " +
                    pathToPtr(path),
                path: path,
            });
        } else {
            seenParameters.push(pName);
        }

        return seenParameters;
    }

    Object.keys(api.definitionFullyResolved.paths || {}).reduce(
        (metadata, path) => {
            var pathDef = api.definitionFullyResolved.paths[path];
            var declaredPathParameters = [];
            var normalizedPath = path;
            var pPath = ["paths", path];

            (path.match(/\{(.*?)\}/g) || []).forEach((arg, index) => {
                // Record the path parameter name
                declaredPathParameters.push(arg.replace(/[{}]/g, ""));

                // Update the normalized path
                normalizedPath = normalizedPath.replace(arg, `arg${index}`);
            });

            // Identify paths with empty parameter declarations
            if (declaredPathParameters.indexOf("") > -1) {
                response.errors.push({
                    code: "EMPTY_PATH_PARAMETER_DECLARATION",
                    message: `Path parameter declaration cannot be empty: ${path}`,
                    path: ["paths", path],
                });
            }

            // Idenfity paths that are functionally the same
            if (metadata.paths.indexOf(normalizedPath) > -1) {
                response.errors.push({
                    code: "EQUIVALENT_PATH",
                    message: `Equivalent path already exists: ${path}`,
                    path: pPath,
                });
            } else {
                metadata.paths.push(normalizedPath);
            }

            // Identify duplicate path-level parameters (We do this manually since SwaggerApi#getOperation consolidates them)
            (pathDef.parameters || []).reduce(
                (seenParameters, parameter, index) =>
                    validateDuplicateParameter(
                        seenParameters,
                        parameter,
                        pPath.concat(["parameters", index.toString()]),
                    ),
                [],
            );

            Object.keys(pathDef).forEach((method) => {
                var operationDef = pathDef[method];
                var definedPathParameters = {};
                var oPath = pPath.concat(method);
                var operationId = operationDef.operationId;
                var pathMetadata;
                var parameters;

                // Do not process non-operations
                if (supportedHttpMethods.indexOf(method) === -1) {
                    return;
                }

                // Identify duplicate operationIds
                if (operationId !== undefined) {
                    if (metadata.operationIds.indexOf(operationId) !== -1) {
                        response.errors.push({
                            code: "DUPLICATE_OPERATIONID",
                            message:
                                "Cannot have multiple operations with the same operationId: " +
                                operationId,
                            path: oPath.concat(["operationId"]),
                        });
                    } else {
                        metadata.operationIds.push(operationId);
                    }
                }

                // Identify duplicate operation-level parameters (We do this manually for the same reasons above)
                (operationDef.parameters || []).reduce(
                    (seenParameters, parameter, index) =>
                        validateDuplicateParameter(
                            seenParameters,
                            parameter,
                            oPath.concat(["parameters", index.toString()]),
                        ),
                    [],
                );

                // Use SwaggerApi#getOperation to avoid having to consolidate parameters
                parameters = api.getOperation(path, method).getParameters();

                pathMetadata = parameters.reduce(
                    (pMetadata, parameter) => {
                        // Record path parameters
                        if (parameter.in === "path") {
                            definedPathParameters[parameter.name] =
                                parameter.ptr;
                        } else if (parameter.in === "body") {
                            pMetadata.bodyParameteters += 1;
                        } else if (parameter.in === "formData") {
                            pMetadata.formParameters += 1;
                        }

                        return pMetadata;
                    },
                    { bodyParameteters: 0, formParameters: 0 },
                );

                // Identify multiple body parameters
                if (pathMetadata.bodyParameteters > 1) {
                    response.errors.push({
                        code: "MULTIPLE_BODY_PARAMETERS",
                        message:
                            "Operation cannot have multiple body parameters",
                        path: oPath,
                    });
                }

                // Identify having both a body and a form parameter
                if (
                    pathMetadata.bodyParameteters > 0 &&
                    pathMetadata.formParameters > 0
                ) {
                    response.errors.push({
                        code: "INVALID_PARAMETER_COMBINATION",
                        message:
                            "Operation cannot have a body parameter and a formData parameter",
                        path: oPath,
                    });
                }

                // Identify undefined path parameters
                var definedPathParameterNames = Object.keys(
                    definedPathParameters,
                );

                declaredPathParameters
                    .filter(
                        (name) =>
                            definedPathParameterNames.indexOf(name) === -1,
                    )
                    .forEach((name) => {
                        response.errors.push({
                            code: "MISSING_PATH_PARAMETER_DEFINITION",
                            message:
                                "Path parameter is declared but is not defined: " +
                                name,
                            path: oPath,
                        });
                    });

                // Identify undeclared path parameters
                definedPathParameterNames
                    .filter(
                        (name) => declaredPathParameters.indexOf(name) === -1,
                    )
                    .forEach((name) => {
                        response.errors.push({
                            code: "MISSING_PATH_PARAMETER_DECLARATION",
                            message:
                                "Path parameter is defined but is not declared: " +
                                name,
                            path: pathFromPtr(definedPathParameters[name]),
                        });
                    });
            });

            return metadata;
        },
        { paths: [], operationIds: [] },
    );

    return response;
}

module.exports = {
    jsonSchemaValidator: validateStructure,
    semanticValidators: [
        validateReferences,
        validateSchemaObjects,
        validatePathsAndOperations,
    ],
};
