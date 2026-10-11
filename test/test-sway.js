/* eslint-env browser, mocha */

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

const { describe, it } = require("node:test");
var assert = require("node:assert");
var helpers = require("./helpers");
var libHelpers = require("../lib/helpers");
var Sway = helpers.getSway();

var invalidCreateScenarios = [
    [[], "options is required"],
    [["wrongType"], "options must be an object"],
    [[{}], "options.definition is required"],
    [
        [{ definition: false }],
        "options.definition must be either an object or a string",
    ],
    [
        [{ definition: {}, jsonRefs: "wrongType" }],
        "options.jsonRefs must be an object",
    ],
    [
        [{ definition: {}, jsonRefs: { location: "foo" } }],
        "options.jsonRefs only supports the 'resolveCirculars' option: location",
    ],
    [
        [{ definition: {}, jsonRefs: { resolveCirculars: "wrongType" } }],
        "options.jsonRefs.resolveCirculars must be a boolean",
    ],
    [
        [{ definition: {}, customFormats: "wrongType" }],
        "options.customFormats must be an array",
    ],
    [
        [{ definition: {}, customFormats: ["wrongType"] }],
        "options.customFormats at index 0 must be a function",
    ],
    [
        [{ definition: {}, customValidators: "wrongType" }],
        "options.customValidators must be an array",
    ],
    [
        [{ definition: {}, customValidators: ["wrongType"] }],
        "options.customValidators at index 0 must be a function",
    ],
];

describe("sway", () => {
    describe("sway#create", () => {
        function validateCreateSwaggerApi(options) {
            return (theApi) => {
                assert.deepEqual(theApi.definition, helpers.swaggerDoc);
                assert.equal(
                    theApi.documentationUrl,
                    "https://github.com/swagger-api/swagger-spec/blob/master/versions/2.0.md",
                );
                assert.deepEqual(theApi.options, options);
                assert.equal(theApi.version, "2.0");

                // Make sure all references were found
                Object.values(theApi.references).forEach((details) => {
                    assert.ok(!Object.hasOwn(details, "missing"));
                });

                // Validate the merging of the Swagger definition properties and the SwaggerApi properties
                Object.keys(helpers.swaggerDoc).forEach((key) => {
                    assert.deepEqual(theApi[key], helpers.swaggerDoc[key]);
                });

                // Validate the operations (Simple tests for now, deeper testing is below)
                assert.ok(Array.isArray(theApi.pathObjects));
                assert.ok(theApi.pathObjects.length > 0);

                // Validate the registration of customValidator on SwaggerApi
                assert.deepEqual(
                    theApi.customValidators,
                    options.customValidators || [],
                );
            };
        }

        it("should always return a promise", () => {
            assert.ok(
                Sway.create({
                    definition: helpers.swaggerDoc,
                }) instanceof Promise,
            );
            assert.ok(
                Sway.create(
                    {
                        definition: helpers.swaggerDoc,
                    },
                    () => {},
                ) instanceof Promise,
            );
        });

        it("should return proper error", (done) => {
            var allTests = Promise.resolve();

            invalidCreateScenarios.forEach((scenario, index) => {
                allTests = allTests.then(
                    () =>
                        new Promise((resolve, reject) => {
                            Sway.create.apply(Sway, scenario[0]).then(
                                () => {
                                    reject(
                                        new Error(
                                            "Sway#create should had failed (Test #" +
                                                index +
                                                ")",
                                        ),
                                    );
                                },
                                (err) => {
                                    try {
                                        assert.ok(err instanceof TypeError);
                                        assert.equal(err.message, scenario[1]);

                                        resolve();
                                    } catch (err2) {
                                        reject(err2);
                                    }
                                },
                            );
                        }),
                );
            });

            allTests.then(done, done);
        });

        it("should handle definition object", (done) => {
            var options = {
                definition: helpers.swaggerDoc,
            };

            Sway.create(options)
                .then(validateCreateSwaggerApi(options))
                .then(done, done);
        });

        it("should handle definition file location", (done) => {
            var options = {
                definition: helpers.swaggerDocPath,
            };

            Sway.create(options)
                .then(validateCreateSwaggerApi(options))
                .then(done, done);
        });

        it("should register customValidators", (done) => {
            var options = {
                definition: helpers.swaggerDoc,
                customValidators: [
                    function validator1() {
                        return {
                            errors: [],
                            warnings: [],
                        };
                    },
                ],
            };

            Sway.create(options)
                .then(validateCreateSwaggerApi(options))
                .then(done, done);
        });

        // TODO: Add test for definition file URL (remote)

        describe("patterns rejected by the JSON Schema validator", () => {
            function definitionWithPatterns(parameterPattern, propertyPattern) {
                return {
                    swagger: "2.0",
                    info: { title: "Patterns", version: "1.0.0" },
                    paths: {
                        "/items/{id}": {
                            get: {
                                parameters: [
                                    {
                                        name: "id",
                                        in: "path",
                                        required: true,
                                        type: "string",
                                        pattern: parameterPattern,
                                    },
                                ],
                                responses: {
                                    200: {
                                        description: "OK",
                                        schema: { $ref: "#/definitions/Item" },
                                    },
                                },
                            },
                        },
                    },
                    definitions: {
                        Item: {
                            type: "object",
                            "x-note": { pattern: "^(a+)+$" },
                            example: { pattern: "^(a+)+$" },
                            properties: {
                                pattern: { type: "string" },
                                code: {
                                    type: "string",
                                    pattern: propertyPattern,
                                },
                            },
                        },
                    },
                };
            }

            it("should reject a definition with unsafe or invalid patterns", async () => {
                await assert.rejects(
                    Sway.create({
                        definition: definitionWithPatterns(
                            "^[a-z]+(?:-\\d+)?$",
                            "^[a-z",
                        ),
                    }),
                    (err) => {
                        assert.equal(err.code, "INVALID_PATTERN");
                        assert.deepEqual(
                            err.errors.map((error) => [error.code, error.path]),
                            [
                                [
                                    "KEYWORD_PATTERN",
                                    [
                                        "paths",
                                        "/items/{id}",
                                        "get",
                                        "parameters",
                                        "0",
                                        "pattern",
                                    ],
                                ],
                                [
                                    "KEYWORD_PATTERN",
                                    [
                                        "definitions",
                                        "Item",
                                        "properties",
                                        "code",
                                        "pattern",
                                    ],
                                ],
                            ],
                        );
                        assert.match(
                            err.message,
                            /#\/paths\/~1items~1\{id\}\/get\/parameters\/0\/pattern, #\/definitions\/Item\/properties\/code\/pattern$/,
                        );

                        return true;
                    },
                );
            });

            it("should accept rewritten patterns and ignore pattern values in extensions and examples", async () => {
                var api = await Sway.create({
                    definition: definitionWithPatterns(
                        "^[a-z]+$|^[a-z]+-\\d+$",
                        "^[A-Z]{2}\\d+$",
                    ),
                });
                var results = api
                    .getOperation("/items/{id}", "get")
                    .validateRequest({ url: "/items/abc-12", method: "get" });

                assert.deepEqual(results.errors, []);
            });

            it("should tell member names apart from keywords with the same name", () => {
                var unsafe = "^(a+)+$";
                var definition = {
                    securityDefinitions: {
                        oauth: {
                            type: "oauth2",
                            flow: "implicit",
                            authorizationUrl: "https://example.com/oauth",
                            scopes: { pattern: "[" },
                        },
                        properties: {
                            type: "oauth2",
                            flow: "implicit",
                            authorizationUrl: "https://example.com/oauth",
                            scopes: { pattern: unsafe },
                        },
                    },
                    parameters: {
                        properties: {
                            in: "query",
                            type: "string",
                            pattern: unsafe,
                        },
                    },
                    paths: {
                        "/items": {
                            get: {
                                responses: {
                                    default: {
                                        description: "Error",
                                        schema: {
                                            type: "string",
                                            pattern: unsafe,
                                        },
                                        headers: {
                                            pattern: {
                                                type: "string",
                                                pattern: unsafe,
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    definitions: {
                        properties: { type: "string", pattern: unsafe },
                        example: { type: "string", pattern: unsafe },
                        Item: {
                            type: "object",
                            enum: [{ pattern: unsafe }],
                            const: { pattern: unsafe },
                            properties: {
                                properties: { type: "string", pattern: unsafe },
                                pattern: { type: "string", pattern: unsafe },
                                "x-name": { type: "string", pattern: unsafe },
                                const: { type: "string", pattern: unsafe },
                                name: {
                                    $ref: "#/definitions/properties",
                                    pattern: unsafe,
                                },
                                tags: {
                                    type: "array",
                                    items: {
                                        $ref: "#/definitions/properties",
                                        items: { pattern: unsafe },
                                    },
                                },
                            },
                        },
                    },
                };

                assert.deepEqual(
                    libHelpers
                        .findRejectedPatterns(definition)
                        .map((rejected) => rejected.path.join("/")),
                    [
                        "parameters/properties/pattern",
                        "paths//items/get/responses/default/schema/pattern",
                        "paths//items/get/responses/default/headers/pattern/pattern",
                        "definitions/properties/pattern",
                        "definitions/example/pattern",
                        "definitions/Item/properties/properties/pattern",
                        "definitions/Item/properties/pattern/pattern",
                        "definitions/Item/properties/x-name/pattern",
                        "definitions/Item/properties/const/pattern",
                    ],
                );
            });
        });
    });
});
