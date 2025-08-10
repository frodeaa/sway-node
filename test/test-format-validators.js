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
var helpers = require("./helpers");
var Sway = helpers.getSway();

describe("format validators", () => {
    it("always truthy", (done) => {
        var cSwaggerDoc = _.cloneDeep(helpers.swaggerDoc);

        cSwaggerDoc.paths["/pet/findByStatus"].get.parameters.push({
            name: "byte",
            in: "query",
            type: "string",
            format: "byte",
            default: "pretendThisIsABase64EncodedString",
        });

        cSwaggerDoc.paths["/pet/findByStatus"].get.parameters.push({
            name: "double",
            in: "query",
            type: "number",
            format: "double",
            default: 1.1,
        });

        cSwaggerDoc.paths["/pet/findByStatus"].get.parameters.push({
            name: "float",
            in: "query",
            type: "number",
            format: "float",
            default: 1.1,
        });

        cSwaggerDoc.paths["/pet/findByStatus"].get.parameters.push({
            name: "password",
            in: "query",
            type: "string",
            format: "password",
            default: "somepassword",
        });

        Sway.create({ definition: cSwaggerDoc })
            .then((api) => {
                assert.ok(api.validate());
            })
            .then(done, done);
    });

    describe("int32", () => {
        var badParamValue;
        var badParamNumberValue;
        var goodParamValue;
        var goodParamNumberValue;

        before(async () => {
            var cSwaggerDoc = _.cloneDeep(helpers.swaggerDoc);

            cSwaggerDoc.paths["/pet/findByStatus"].get.parameters.push({
                name: "int32",
                in: "query",
                type: "integer",
                format: "int32",
            });

            cSwaggerDoc.paths["/pet/findByStatus"].get.parameters.push({
                name: "int32Number",
                in: "query",
                type: "number",
                format: "int32",
            });

            // Test the format validator using parameter validation
            await new Promise((done) => {
                Sway.create({ definition: cSwaggerDoc })
                    .then((api) => {
                        badParamValue = api
                            .getOperation("/pet/findByStatus", "get")
                            .getParameter("int32")
                            .getValue({
                                query: {
                                    int32: 1.1,
                                },
                            });
                        badParamNumberValue = api
                            .getOperation("/pet/findByStatus", "get")
                            .getParameter("int32Number")
                            .getValue({
                                query: {
                                    int32Number: 1.1,
                                },
                            });

                        goodParamValue = api
                            .getOperation("/pet/findByStatus", "get")
                            .getParameter("int32")
                            .getValue({
                                query: {
                                    int32: 1,
                                },
                            });

                        goodParamNumberValue = api
                            .getOperation("/pet/findByStatus", "get")
                            .getParameter("int32Number")
                            .getValue({
                                query: {
                                    int32Number: 1,
                                },
                            });
                    })
                    .then(done, done);
            });
        });

        it("bad value", () => {
            var error = badParamValue.error;

            assert.ok(!badParamValue.valid);
            assert.ok(!_.isUndefined(badParamValue.value));
            assert.equal(badParamValue.raw, 1.1);
            assert.equal(error.message, "Value failed JSON Schema validation");
            assert.equal(error.code, "SCHEMA_VALIDATION_FAILED");
            assert.ok(error.failedValidation);
            assert.deepEqual(error.errors, [
                {
                    code: "INVALID_TYPE",
                    message: "Expected type integer but found type number",
                    params: ["integer", "number"],
                    path: [],
                },
            ]);
        });

        it("bad number value", () => {
            var error = badParamNumberValue.error;

            assert.ok(!badParamNumberValue.valid);
            assert.ok(!_.isUndefined(badParamNumberValue.value));
            assert.equal(badParamNumberValue.raw, 1.1);
            assert.equal(error.message, "Value failed JSON Schema validation");
            assert.equal(error.code, "SCHEMA_VALIDATION_FAILED");
            assert.ok(error.failedValidation);
            assert.deepEqual(error.errors, [
                {
                    code: "INVALID_FORMAT",
                    message:
                        "Object didn't pass validation for format int32: 1.1",
                    params: ["int32", 1.1],
                    path: [],
                },
            ]);
        });

        it("good value", () => {
            assert.ok(goodParamValue.valid);
        });

        it("good number value", () => {
            assert.ok(goodParamNumberValue.valid);
        });
    });

    describe("int64", () => {
        var badParamValue;
        var badParamNumberValue;
        var goodParamValue;
        var goodParamNumberValue;

        before(async () => {
            var cSwaggerDoc = _.cloneDeep(helpers.swaggerDoc);

            cSwaggerDoc.paths["/pet/findByStatus"].get.parameters.push({
                name: "int64",
                in: "query",
                type: "integer",
                format: "int64",
            });

            cSwaggerDoc.paths["/pet/findByStatus"].get.parameters.push({
                name: "int64Number",
                in: "query",
                type: "number",
                format: "int64",
            });

            await new Promise((done) => {
                // Test the format validator using parameter validation
                Sway.create({ definition: cSwaggerDoc })
                    .then((api) => {
                        badParamValue = api
                            .getOperation("/pet/findByStatus", "get")
                            .getParameter("int64")
                            .getValue({
                                query: {
                                    int64: 1.1,
                                },
                            });

                        badParamNumberValue = api
                            .getOperation("/pet/findByStatus", "get")
                            .getParameter("int64Number")
                            .getValue({
                                query: {
                                    int64Number: 1.1,
                                },
                            });

                        goodParamValue = api
                            .getOperation("/pet/findByStatus", "get")
                            .getParameter("int64")
                            .getValue({
                                query: {
                                    int64: 1,
                                },
                            });

                        goodParamNumberValue = api
                            .getOperation("/pet/findByStatus", "get")
                            .getParameter("int64Number")
                            .getValue({
                                query: {
                                    int64Number: 1,
                                },
                            });
                    })
                    .then(done, done);
            });
        });

        it("bad value", () => {
            var error = badParamValue.error;

            assert.ok(!badParamValue.valid);
            assert.ok(!_.isUndefined(badParamValue.value));
            assert.equal(badParamValue.raw, 1.1);
            assert.equal(error.message, "Value failed JSON Schema validation");
            assert.equal(error.code, "SCHEMA_VALIDATION_FAILED");
            assert.ok(error.failedValidation);
            assert.deepEqual(error.errors, [
                {
                    code: "INVALID_TYPE",
                    message: "Expected type integer but found type number",
                    params: ["integer", "number"],
                    path: [],
                },
            ]);
        });

        it.skip("bad number value", () => {
            var error = badParamNumberValue.error;

            assert.ok(!badParamNumberValue.valid);
            assert.ok(!_.isUndefined(badParamNumberValue.value));
            assert.equal(badParamNumberValue.raw, 1.1);
            assert.equal(error.message, "Value failed JSON Schema validation");
            assert.equal(error.code, "SCHEMA_VALIDATION_FAILED");
            assert.ok(error.failedValidation);
            assert.deepEqual(error.errors, [
                {
                    code: "INVALID_TYPE",
                    message: "Expected type integer but found type number",
                    params: ["integer", "number"],
                    path: [],
                },
                {
                    code: "INVALID_FORMAT",
                    message:
                        "Object didn't pass validation for format int64: 1.1",
                    params: ["int64", 1.1],
                    path: [],
                },
            ]);
        });

        it("good value", () => {
            assert.ok(goodParamValue.valid);
        });

        it("good number value", () => {
            assert.ok(goodParamNumberValue.valid);
        });
    });
});
