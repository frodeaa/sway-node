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

'use strict';

var _ = require('lodash');
var JsonRefs = require('json-refs');
var Operation = require('./operation');
var Parameter = require('./parameter');
var pathToRegexp = require('path-to-regexp');
var supportedHttpMethods = require('../swagger-methods');

/**
 * The Path object.
 *
 * **Note:** Do not use directly.
 *
 * **Extra Properties:** Other than the documented properties, this object also exposes all properties of the
 *                       definition object.
 *
 * @param {module:sway.SwaggerApi} api - The `SwaggerApi` object
 * @param {string} path - The path string
 * @param {object} definition - The path definition *(The raw path definition __after__ remote references were
 * resolved)*
 * @param {object} definitionFullyResolved - The path definition with all of its resolvable references resolved
 * @param {string[]} pathToDefinition - The path segments to the path definition
 *
 * @property {module:sway.SwaggerApi} api - The `SwaggerApi` object
 * @property {object} definition - The path definition *(The raw path definition __after__ remote references were
 * resolved)*
 * @property {object} definitionFullyResolved - The path definition with all of its resolvable references resolved
 * @property {module:sway.Operation[]} operationObjects - The `Operation` objects
 * @property {module:sway.Parameter[]} parameterObjects - The path-level `Parameter` objects
 * @property {string} path - The path string
 * @property {string[]} pathToDefinition - The path segments to the path definition
 * @property {ptr} ptr - The JSON Pointer to the path
 * @property {regexp} regexp - The `RegExp` used to match request paths against this path
 *
 * @constructor
 *
 * @memberof module:sway
 */
function Path (api, path, definition, definitionFullyResolved, pathToDefinition) {
  var basePathPrefix = api.definitionFullyResolved.basePath || '/';
  var that = this;
  var sanitizedPath;
  var keys = []

  // TODO: We could/should refactor this to use the path module

  // Remove trailing slash from the basePathPrefix so we do not end up with double slashes
  if (basePathPrefix.charAt(basePathPrefix.length - 1) === '/') {
    basePathPrefix = basePathPrefix.substring(0, basePathPrefix.length - 1);
  }

  // Converts Swagger parameters to Express-style parameters, and also escapes all path-to-regexp special characters
  //
  // @see: https://github.com/pillarjs/path-to-regexp/issues/76#issuecomment-219085357
  sanitizedPath = basePathPrefix + path.replace('(', '\\(') // path-to-regexp
                                       .replace(')', '\\)') // path-to-regexp
                                       .replace(':', '\\:') // path-to-regexp
                                       .replace('*', '\\*') // path-to-regexp
                                       .replace('+', '\\+') // path-to-regexp
                                       .replace('?', '\\?') // path-to-regexp
                                       .replace(/\{/g, ':') // Swagger -> Express-style
                                       .replace(/\}/g, ''); // Swagger -> Express-style

  // Assign local properties
  this.api = api;
  this.definition = definition;
  this.definitionFullyResolved = definitionFullyResolved;
  this.path = path;
  this.pathToDefinition = pathToDefinition;
  this.ptr = JsonRefs.pathToPtr(pathToDefinition);
  try {
    keys = []
    this.regexp = pathToRegexp.pathToRegexp(sanitizedPath, keys, {sensitive: true});
    this.regexp.keys = keys;
    // eslint-disable-next-line  no-unused-vars
  } catch (err) {
    // pathToRegexp throw error if sanitizedPath is invalid
    // let the result be a regex that will not match anything
    keys = []
    this.regexp = pathToRegexp.pathToRegexp('---NO-MATCH---', keys, {sensitive: true});
    this.regexp.keys = keys;
  }

  // Assign local properties from the Swagger definition properties
  _.assign(this, definitionFullyResolved);

  this.parameterObjects = _.map(definitionFullyResolved.parameters, function (paramDef, index) {
    var pPath = pathToDefinition.concat(['parameters', index.toString()]);

    return new Parameter(that,
                         _.get(api.definitionRemotesResolved, pPath),
                         paramDef,
                         pPath);
  });

  this.operationObjects = _.reduce(definitionFullyResolved, function (operations, operationDef, method) {
    var oPath = pathToDefinition.concat(method);

    if (supportedHttpMethods.indexOf(method) > -1) {
      operations.push(new Operation(that, method, _.get(api.definitionRemotesResolved, oPath), operationDef, oPath));
    }

    return operations;
  }, []);
}

/**
 * Return the operation for this path and operation id or method.
 *
 * @param {string} idOrMethod - The operation id or method
 *
 * @returns {module:sway.Operation[]} The `Operation` objects for this path and method or `undefined` if there is no
 * operation for the provided method
 */
Path.prototype.getOperation = function (idOrMethod) {
  return _.find(this.operationObjects, function (operationObject) {
    return operationObject.operationId === idOrMethod || operationObject.method === idOrMethod.toLowerCase();
  });
};

/**
 * Return the operations for this path.
 *
 * @returns {module:sway.Operation[]} The `Operation` objects for this path
 */
Path.prototype.getOperations = function () {
  return this.operationObjects;
};

/**
 * Return the operations for this path and tag.
 *
 * @param {string} tag - The tag
 *
 * @returns {module:sway.Operation[]} The `Operation` objects for this path and tag
 */
Path.prototype.getOperationsByTag = function (tag) {
  return _.filter(this.operationObjects, function (operationObject) {
    return _.includes(operationObject.tags, tag);
  });
};

/**
 * Return the parameters for this path.
 *
 * @returns {module:sway.Parameter[]} The `Parameter` objects for this path
 */
Path.prototype.getParameters = function () {
  return this.parameterObjects;
};

module.exports = Path;
