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

var _ = require("lodash");
var helpers = require("./lib/helpers");
var { $RefParser } = require("@apidevtools/json-schema-ref-parser");
var SwaggerApi = require("./lib/types/api");
var { collectAndSanitizeRefs } = require("./lib/json-ref-utils");

/**
 * A library for simpler [Swagger](http://swagger.io/) integrations.
 *
 * @module sway
 */

/**
 * Creates a SwaggerApi object from its Swagger definition(s).
 *
 * @param {module:sway.CreateOptions} options - The options for loading the definition(s)
 *
 * @returns {Promise<module:sway.SwaggerApi>} The promise
 *
 * @example
 * SwaggerApi.create({definition: 'http://petstore.swagger.io/v2/swagger.yaml'})
 *   .then(function (api) {
 *     console.log('Documentation URL: ', api.documentationUrl);
 *   }, function (err) {
 *     console.error(err.stack);
 *   });
 */
module.exports.create = (options) => {
    var allTasks = Promise.resolve();
    var cOptions;

    // Validate arguments
    allTasks = allTasks.then(
        () =>
            new Promise((resolve) => {
                if (_.isUndefined(options)) {
                    throw new TypeError("options is required");
                } else if (!_.isPlainObject(options)) {
                    throw new TypeError("options must be an object");
                } else if (_.isUndefined(options.definition)) {
                    throw new TypeError("options.definition is required");
                } else if (
                    !_.isPlainObject(options.definition) &&
                    !_.isString(options.definition)
                ) {
                    throw new TypeError(
                        "options.definition must be either an object or a string",
                    );
                } else if (
                    !_.isUndefined(options.jsonRefs) &&
                    !_.isPlainObject(options.jsonRefs)
                ) {
                    throw new TypeError("options.jsonRefs must be an object");
                } else if (
                    !_.isUndefined(options.customFormats) &&
                    !_.isArray(options.customFormats)
                ) {
                    throw new TypeError(
                        "options.customFormats must be an array",
                    );
                } else if (
                    !_.isUndefined(options.customValidators) &&
                    !_.isArray(options.customValidators)
                ) {
                    throw new TypeError(
                        "options.customValidators must be an array",
                    );
                }

                helpers.validateOptionsAllAreFunctions(
                    options.customFormats,
                    "customFormats",
                );
                helpers.validateOptionsAllAreFunctions(
                    options.customValidators,
                    "customValidators",
                );

                resolve();
            }),
    );

    // Make a copy of the input options so as not to alter them
    cOptions = _.cloneDeep(options);

    //
    allTasks = allTasks
        // Resolve references using json-schema-ref-parser
        .then(async () => {
            var definition = cOptions.definition;
            var rawDoc;
            var parser;

            if (_.isString(definition)) {
                parser = new $RefParser();
                rawDoc = await parser.parse(definition);
            } else {
                rawDoc = definition;
            }

            // Clone rawDoc, then collect ref metadata and sanitize in a single pass.
            // Invalid/missing refs are replaced with {} before the parser sees them.
            var sanitizedDoc = _.cloneDeep(rawDoc);
            var refs = collectAndSanitizeRefs(sanitizedDoc);

            // Dereference all local references; external resolution is disabled as a
            // safety net — only local #/... refs should remain after sanitization
            var definitionFullyResolved = await $RefParser.dereference(
                sanitizedDoc,
                {
                    dereference: { circular: true },
                    resolve: { external: false },
                },
            );

            return {
                // The original Swagger definition (not dereferenced)
                definition: rawDoc,
                // No external refs to resolve — same as the original definition
                definitionRemotesResolved: rawDoc,
                // The Swagger definition with all local refs fully resolved
                definitionFullyResolved: definitionFullyResolved,
                refs: refs,
            };
        })
        // Process the Swagger document and return the API
        .then((results) => {
            // We need to remove all circular objects as z-schema does not work with them:
            //   https://github.com/zaggino/z-schema/issues/137
            helpers.removeCirculars(results.definition);
            helpers.removeCirculars(results.definitionRemotesResolved);
            helpers.removeCirculars(results.definitionFullyResolved);

            // Create object model
            return new SwaggerApi(
                results.definition,
                results.definitionRemotesResolved,
                results.definitionFullyResolved,
                results.refs,
                options,
            );
        });

    return allTasks;
};
