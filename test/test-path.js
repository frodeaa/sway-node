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

const { before, describe, it } = require("node:test");
var _ = require("lodash");
var assert = require("node:assert");
var tHelpers = require("./helpers");
var JsonRefs = require("json-refs");
var Sway = tHelpers.getSway();

function runTests(mode) {
    var label = mode === "with-refs" ? "with" : "without";
    var swaggerApi;

    before(async () => {
        await new Promise((done) => {
            function callback(api) {
                swaggerApi = api;

                done();
            }

            if (mode === "with-refs") {
                tHelpers.getSwaggerApiRelativeRefs(callback);
            } else {
                tHelpers.getSwaggerApi(callback);
            }
        });
    });

    describe(`should handle Swagger document ${label} relative references`, () => {
        it("should have proper structure", () => {
            var path = "/pet/{petId}";
            var pathObject = swaggerApi.getOperation(path, "get").pathObject;

            assert.deepEqual(pathObject.api, swaggerApi);
            assert.equal(pathObject.path, path);
            assert.equal(pathObject.ptr, JsonRefs.pathToPtr(["paths", path]));
            assert.deepEqual(
                pathObject.definition,
                swaggerApi.definitionRemotesResolved.paths[path],
            );
            assert.deepEqual(
                pathObject.definitionFullyResolved,
                swaggerApi.definitionFullyResolved.paths[path],
            );

            // Make sure they are of the proper type
            assert.ok(pathObject.regexp instanceof RegExp);

            // Make sure they have the proper keys
            assert.equal(1, pathObject.regexp.keys.length);
            assert.equal("petId", pathObject.regexp.keys[0].name);

            // Make sure they match the expected URLs
            assert.ok(
                _.isArray(
                    pathObject.regexp.exec(
                        `${swaggerApi.definitionFullyResolved.basePath}/pet/1`,
                    ),
                ),
            );
            assert.ok(
                !_.isArray(
                    pathObject.regexp.exec(
                        `${swaggerApi.definitionFullyResolved.basePath}/pets/1`,
                    ),
                ),
            );
            assert.ok(
                !_.isArray(
                    pathObject.regexp.exec(
                        `${swaggerApi.definitionFullyResolved.basePath}/Pet/1`,
                    ),
                ),
            );
        });

        describe("#getOperation", () => {
            it("should return the expected operation", () => {
                // By method
                tHelpers.checkType(
                    swaggerApi.getPath("/pet/{petId}").getOperation("get"),
                    "Operation",
                );
                // By operationId
                tHelpers.checkType(
                    swaggerApi.getPath("/pet").getOperation("addPet"),
                    "Operation",
                );
            });

            it("should return no operation for the missing method", () => {
                assert.ok(
                    _.isUndefined(
                        swaggerApi.getPath("/pet/{petId}").getOperation("head"),
                    ),
                );
            });
        });

        describe("#getOperations", () => {
            it("should return the expected operations", () => {
                assert.equal(
                    swaggerApi.getPath("/pet/{petId}").getOperations().length,
                    3,
                );
            });

            it("should return no operations", (done) => {
                var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);
                var path = "/petz";

                cSwagger.paths[path] = {};

                Sway.create({
                    definition: cSwagger,
                })
                    .then((api) => {
                        assert.equal(
                            api.getPath(path).getOperations().length,
                            0,
                        );
                    })
                    .then(done, done);
            });
        });

        describe("#getOperationsByTag", () => {
            it("should return the expected operations", () => {
                assert.equal(
                    swaggerApi.getPath("/pet/{petId}").getOperationsByTag("pet")
                        .length,
                    3,
                );
            });

            it("should return no operations", () => {
                assert.equal(
                    swaggerApi
                        .getPath("/pet/{petId}")
                        .getOperationsByTag("petz").length,
                    0,
                );
            });
        });

        describe("#getParameters", () => {
            it("should return the expected parameters", () => {
                var parameters = swaggerApi
                    .getPath("/pet/{petId}")
                    .getParameters();

                assert.equal(parameters.length, 1);
            });

            it("should return no parameters", () => {
                assert.equal(
                    swaggerApi.getPath("/pet").getParameters().length,
                    0,
                );
            });
        });
    });
}

describe("Path", () => {
    // Swagger document without references
    runTests("no-refs");
    // Swagger document with references
    runTests("with-refs");
});
