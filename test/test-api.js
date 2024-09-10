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

'use strict';

const {before, beforeEach, describe, it} = require('node:test');
var _ = require('lodash');
var assert = require('assert');
var tHelpers = require('./helpers');
var JsonRefs = require('json-refs');
var supportedHttpMethods = require('../lib/swagger-methods');
var Sway = tHelpers.getSway();

function getOperationCount (pathDef) {
  var count = 0;

  _.each(pathDef, function (operation, method) {
    if (supportedHttpMethods.indexOf(method) > -1) {
      count += 1;
    }
  });

  return count;
}

function runTests (mode) {
  var label = mode === 'with-refs' ? 'with' : 'without';
  var swaggerApi;

  before(async () => {
    await new Promise((done) => {
      function callback (api) {
        swaggerApi = api;

        done();
      }

      if (mode === 'with-refs') {
        tHelpers.getSwaggerApiRelativeRefs(callback);
      } else {
        tHelpers.getSwaggerApi(callback);
      }
    });
  });

  beforeEach(function () {
    swaggerApi.customValidators = [];
    swaggerApi.customFormats = {};

    // When we test SwaggerApi#registerFormat, it registers globally in ZSchema and it has to be unregistered
    swaggerApi.unregisterFormat('alwaysFails');
  });

  describe('should handle Swagger document ' + label + ' relative references', function () {
    describe('#getOperations', function () {
      it('should return all operations', function () {
        var operations = swaggerApi.getOperations();

        assert.equal(operations.length, _.reduce(swaggerApi.definitionFullyResolved.paths, function (count, path) {
          count += getOperationCount(path);

          return count;
        }, 0));

        // Validate the operations
      });

      it('should return return all operations for the given path', function () {
        var operations = swaggerApi.getOperations('/pet/{petId}');

        assert.ok(swaggerApi.getOperations().length > operations.length);
        assert.equal(operations.length, getOperationCount(swaggerApi.definitionFullyResolved.paths['/pet/{petId}']));
      });

      it('should return return no operations for a missing path', function () {
        assert.equal(swaggerApi.getOperations('/some/fake/path').length, 0);
      });
    });

    describe('#getOperation', function () {
      it('should return the expected operation by id', function () {
        tHelpers.checkType(swaggerApi.getOperation('addPet'), 'Operation');
      });

      describe('path + method', function () {
        it('should return the expected operation', function () {
          tHelpers.checkType(swaggerApi.getOperation('/pet/{petId}', 'get'), 'Operation');
        });

        it('should return no operation for missing path', function () {
          assert.ok(_.isUndefined(swaggerApi.getOperation('/petz/{petId}', 'get')));
        });

        it('should return no operation for missing method', function () {
          assert.ok(_.isUndefined(swaggerApi.getOperation('/pet/{petId}', 'head')));
        });
      });

      describe('http.ClientRequest (or similar)', function () {
        it('should return the expected operation', function () {
          tHelpers.checkType(swaggerApi.getOperation({
            method: 'GET',
            url: swaggerApi.basePath + '/pet/1'
          }), 'Operation');
        });

        it('should return the expected operation (req.originalUrl)', function () {
          tHelpers.checkType((swaggerApi.getOperation({
            method: 'GET',
            originalUrl: swaggerApi.basePath + '/pet/1'
          })), 'Operation');
        });

        it('should return no operation for missing path', function () {
          assert.ok(_.isUndefined(swaggerApi.getOperation({
            method: 'GET',
            url: swaggerApi.basePath + '/petz/1'
          })));
        });

        it('should return no operation for missing method', function () {
          assert.ok(_.isUndefined(swaggerApi.getOperation({
            method: 'HEAD',
            url: swaggerApi.basePath + '/pet/1'
          })));
        });
      });
    });

    describe('#getOperationsByTag', function () {
      it('should return no operation for incorrect tag', function () {
        var operations = swaggerApi.getOperationsByTag('incorrect tag');

        assert.equal(operations.length, 0);
      });

      it('should return all operations for the given tag', function () {
        var operations = swaggerApi.getOperationsByTag('store');

        assert.equal(operations.length,
          getOperationCount(swaggerApi.definitionFullyResolved.paths['/store/inventory']) +
          getOperationCount(swaggerApi.definitionFullyResolved.paths['/store/order']) +
          getOperationCount(swaggerApi.definitionFullyResolved.paths['/store/order/{orderId}']));
      });
    });

    describe('#getPath', function () {
      describe('path', function () {
        describe('multiple matches', function () {
          // This test is likely superfluous but while working on Issue 76 this was broken (pre-commit) and so this test
          // is here just to be sure.
          it('match identical', async function () {
            var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);
            var matches = [
              '/foo/{0}/baz',
              '/foo/{1}/baz'
            ];

            _.forEach(matches, function (newPath) {
              cSwagger.paths[newPath] = {};
            });

            await new Promise((resolve, reject) => {
              Sway.create({
                definition: cSwagger
              })
                .then(function (api) {
                  assert.equal(api.getPath('/foo/{1}/baz').path, matches[1]);
                })
                .then(resolve, reject);
            });
          });
        });

        it('should handle regex characters in path', async function () {
          var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);
          var path = '/foo/({bar})';

          cSwagger.paths[path] = {};

          await new Promise((resolve, reject) => {
            Sway.create({
              definition: cSwagger
            })
              .then(function (api) {
                tHelpers.checkType(api.getPath(path), 'Path');
              })
              .then(resolve, reject);
          });
        });

        it('should return the expected path object', function () {
          tHelpers.checkType(swaggerApi.getPath('/pet/{petId}'), 'Path');
        });

        it('should return no path object', function () {
          assert.ok(_.isUndefined(swaggerApi.getPath('/petz/{petId}')));
        });
      });

      describe('http.ClientRequest (or similar)', function () {
        describe('multiple matches', function () {
          it('complete static match', async function () {
            var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);
            var lesserMatches = [
              '/foo/bar/{baz}',
              '/foo/{bar}/baz',
              '/{foo}/bar/baz'
            ];
            var match = '/foo/bar/baz';

            _.forEach(lesserMatches.concat(match), function (newPath) {
              cSwagger.paths[newPath] = {};
            });

            await new Promise((resolve, reject) => {
              Sway.create({
                definition: cSwagger
              })
                .then(function (api) {
                  assert.equal(api.getPath({
                    url: swaggerApi.basePath + match
                  }).path, match);
                })
                .then(resolve, reject);
            });
          });

          // While this scenario should never happen in a valid Swagger document, we handle it anyways
          it('match multiple levels deep', async function () {
            var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);
            var lesserMatches = [
              '/foo/{bar}/baz/{qux}'
            ];
            var match = '/foo/{bar}/baz/qux';

            _.forEach(lesserMatches.concat(match), function (newPath) {
              cSwagger.paths[newPath] = {};
            });

            await new Promise((resolve, reject) => {
              Sway.create({
                definition: cSwagger
              })
                .then(function (api) {
                  assert.equal(api.getPath({
                    url: swaggerApi.basePath + match
                  }).path, match);
                })
                .then(resolve, reject);
            });
          });

          it('match single level deep', async function () {
            var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);
            var lesserMatches = [
              '/foo/{bar}/baz',
              '/{foo}/bar/baz'
            ];
            var match = '/foo/bar/{baz}';

            _.forEach(lesserMatches.concat(match), function (newPath) {
              cSwagger.paths[newPath] = {};
            });

            await new Promise((resolve, reject) => {
              Sway.create({
                definition: cSwagger
              })
                .then(function (api) {
                  assert.equal(api.getPath({
                    url: swaggerApi.basePath + match
                  }).path, match);
                })
                .then(resolve, reject);
            });
          });

          // While this scenario should never happen in a valid Swagger document, we handle it anyways
          it('match identical', async function () {
            var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);
            var matches = [
              '/foo/{0}/baz',
              '/foo/{1}/baz'
            ];

            _.forEach(matches, function (newPath) {
              cSwagger.paths[newPath] = {};
            });

            await new Promise((resolve, reject) => {
              Sway.create({
                definition: cSwagger
              })
                .then(function (api) {
                  tHelpers.checkType(api.getPath({
                    url: swaggerApi.basePath + '/foo/bar/baz'
                  }), 'Path');
                })
                .then(resolve, reject);
            });
          });
        });

        it('should handle regex characters in path', async function () {
          var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);
          var path = '/foo/({bar})';

          cSwagger.paths[path] = {};

          await new Promise((resolve, reject) => {
            Sway.create({
              definition: cSwagger
            })
              .then(function (api) {
                tHelpers.checkType(api.getPath({
                  url: swaggerApi.basePath + '/foo/(bar)'
                }), 'Path');
              })
              .then(resolve, reject);
          });
        });

        it('should return the expected path object', function () {
          tHelpers.checkType(swaggerApi.getPath({
            url: swaggerApi.basePath + '/pet/1'
          }), 'Path');
        });

        it('should return no path object', function () {
          assert.ok(_.isUndefined(swaggerApi.getPath({
            url: swaggerApi.basePath + '/petz/1'
          })));
        });
      });
    });

    describe('#getPaths', function () {
      it('should return the expected path objects', function () {
        assert.equal(swaggerApi.getPaths().length, Object.keys(swaggerApi.definitionFullyResolved.paths).length);
      });
    });

    describe('#registerFormat', function () {
      it('should throw TypeError for invalid arguments', function () {
        var scenarios = [
          [[], 'name is required'],
          [[true], 'name must be a string'],
          [['test'], 'validator is required'],
          [['test', true], 'validator must be a function']
        ];

        _.forEach(scenarios, function (scenario) {
          try {
            swaggerApi.registerFormat.apply(swaggerApi, scenario[0]);

            tHelpers.shouldHadFailed();
          } catch (err) {
            assert.equal(scenario[1], err.message);
          }
        });
      });

      it('should add validator to list of validators', async function () {
        var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

        cSwagger.definitions.Pet.properties.customFormat = {
          format: 'alwaysFails',
          type: 'string'
        };

        await new Promise((resolve, reject) => {
          Sway.create({
            definition: cSwagger
          })
            .then(function (api) {
              var req = {
                body: {
                  customFormat: 'shouldFail',
                  name: 'Test Pet',
                  photoUrls: []
                }
              };
              var paramValue = api.getOperation('/pet', 'post').getParameter('body').getValue(req);

              assert.ok(_.isUndefined(paramValue.error));
              assert.deepEqual(req.body, paramValue.raw);
              assert.deepEqual(req.body, paramValue.value);

              // Register the custom format
              api.registerFormat('alwaysFails', function () {
                return false;
              });

              paramValue = api.getOperation('/pet', 'post').getParameter('body').getValue(req);

              assert.equal(paramValue.error.message, 'Value failed JSON Schema validation');
              assert.equal(paramValue.error.code, 'SCHEMA_VALIDATION_FAILED');
              assert.deepEqual(paramValue.error.path, ['paths', '/pet', 'post', 'parameters', '0']);
              assert.ok(paramValue.error.failedValidation)
              assert.deepEqual(paramValue.error.errors, [
                {
                  code: 'INVALID_FORMAT',
                  params: ['alwaysFails', 'shouldFail'],
                  message: "Object didn't pass validation for format alwaysFails: shouldFail",
                  path: ['customFormat']
                }
              ]);
              assert.deepEqual(req.body, paramValue.raw);
              assert.deepEqual(req.body, paramValue.value);
            })
            .then(resolve, reject);
        });
      });
    });

    describe('#registerValidator', function () {
      it('should throw TypeError for invalid arguments', function () {
        var scenarios = [
          [[], 'validator is required'],
          [['wrongType'], 'validator must be a function']
        ];

        _.forEach(scenarios, function (scenario) {
          try {
            swaggerApi.registerValidator.apply(swaggerApi, scenario[0]);

            tHelpers.shouldHadFailed();
          } catch (err) {
            assert.equal(scenario[1], err.message);
          }
        });
      });

      it('should add validator to list of validators', function () {
        var results = swaggerApi.validate();
        var expectedErrors = [
          'error'
        ];
        var expectedWarnings = [
          'warning'
        ];

        assert.deepEqual(results.errors, []);
        assert.deepEqual(results.warnings, []);

        swaggerApi.registerValidator(function (api) {
          tHelpers.checkType(api, 'SwaggerApi');

          return {
            errors: expectedErrors,
            warnings: expectedWarnings
          };
        });

        results = swaggerApi.validate();

        assert.deepEqual(results.errors, expectedErrors);
        assert.deepEqual(results.warnings, expectedWarnings);
      });
    });

    describe('#validate', function () {
      it('should return zero errors/warnings for a valid document', function () {
        var results = swaggerApi.validate();

        assert.deepEqual(results.errors, []);
        assert.deepEqual(results.warnings, []);
      });

      describe('should return errors for an invalid document', function () {
        it('does not validate against JSON Schema', async function () {
          var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

          delete cSwagger.paths;

          await new Promise((resolve, reject) => {
            Sway.create({
              definition: cSwagger
            })
              .then(function (api) {
                var results = api.validate();

                assert.deepEqual(results.warnings, []);
                assert.deepEqual(results.errors, [
                  {
                    code: 'OBJECT_MISSING_REQUIRED_PROPERTY',
                    message: 'Missing required property: paths',
                    params: ['paths'],
                    path: [],
                    schemaId: 'http://swagger.io/v2/schema.json#',
                    title: 'A JSON Schema for Swagger 2.0 API.'
                  }
                ]);
              })
              .then(resolve, reject);
          });
        });

        describe('array type missing required items property', function () {
          async function validateBrokenArray (cSwagger, path) {
            await new Promise((resolve, reject) => {
              Sway.create({
                definition: cSwagger
              })
                .then(function (api) {
                  var results = api.validate();

                  // Validate that all warnings are unused definitions
                  _.forEach(results.warnings, function (warning) {
                    assert.equal(warning.code, 'UNUSED_DEFINITION');
                  });

                  assert.deepEqual(results.errors, [
                    {
                      code: 'OBJECT_MISSING_REQUIRED_PROPERTY',
                      message: 'Missing required property: items',
                      path: path
                    }
                  ]);
                })
                .then(resolve, reject);
            });
          }

          describe('schema definitions', function () {
            describe('array', function () {
              it('no items', async function () {
                var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

                cSwagger.definitions.Pet = {
                  type: 'array'
                };

                await validateBrokenArray(cSwagger, ['definitions', 'Pet']);
              });

              it('items object', async function () {
                var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

                cSwagger.definitions.Pet = {
                  type: 'array',
                  items: {
                    type: 'array'
                  }
                };

                await validateBrokenArray(cSwagger, ['definitions', 'Pet', 'items']);
              });

              it('items array', async function () {
                var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

                cSwagger.definitions.Pet = {
                  type: 'array',
                  items: [
                    {
                      type: 'array'
                    }
                  ]
                };

                await validateBrokenArray(cSwagger, ['definitions', 'Pet', 'items', '0']);
              });
            });

            describe('object', function () {
              describe('additionalProperties', function () {
                it('no items', async function () {
                  var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

                  cSwagger.definitions.Pet = {
                    type: 'object',
                    additionalProperties: {
                      type: 'array'
                    }
                  };

                  await validateBrokenArray(cSwagger, ['definitions', 'Pet', 'additionalProperties']);
                });

                it('items object', async function () {
                  var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

                  cSwagger.definitions.Pet = {
                    type: 'object',
                    additionalProperties: {
                      type: 'array',
                      items: {
                        type: 'array'
                      }
                    }
                  };

                  await validateBrokenArray(cSwagger, ['definitions', 'Pet', 'additionalProperties', 'items']);
                });

                it('items array', async function () {
                  var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

                  cSwagger.definitions.Pet = {
                    type: 'object',
                    additionalProperties: {
                      type: 'array',
                      items: [
                        {
                          type: 'array'
                        }
                      ]
                    }
                  };

                  await validateBrokenArray(cSwagger,
                    ['definitions', 'Pet', 'additionalProperties', 'items', '0']);
                });
              });

              describe('properties', function () {
                it('no items', async function () {
                  var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

                  cSwagger.definitions.Pet = {
                    type: 'object',
                    properties: {
                      aliases: {
                        type: 'array'
                      }
                    }
                  };

                  await validateBrokenArray(cSwagger, ['definitions', 'Pet', 'properties', 'aliases']);
                });

                it('items object', async function () {
                  var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

                  cSwagger.definitions.Pet = {
                    type: 'object',
                    properties: {
                      aliases: {
                        type: 'array',
                        items: {
                          type: 'array'
                        }
                      }
                    }
                  };

                  await validateBrokenArray(cSwagger, ['definitions', 'Pet', 'properties', 'aliases', 'items']);
                });

                it('items array', async function () {
                  var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

                  cSwagger.definitions.Pet = {
                    type: 'object',
                    properties: {
                      aliases: {
                        type: 'array',
                        items: [
                          {
                            type: 'array'
                          }
                        ]
                      }
                    }
                  };

                  await validateBrokenArray(cSwagger, ['definitions', 'Pet', 'properties', 'aliases', 'items', '0']);
                });
              });

              describe('allOf', function () {
                it('no items', async function () {
                  var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

                  cSwagger.definitions.Pet = {
                    type: 'object',
                    allOf: [
                      {
                        type: 'array'
                      }
                    ]
                  };

                  await validateBrokenArray(cSwagger, ['definitions', 'Pet', 'allOf', '0']);
                });

                it('items object', async function () {
                  var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

                  cSwagger.definitions.Pet = {
                    type: 'object',
                    allOf: [
                      {
                        type: 'object',
                        properties: {
                          aliases: {
                            type: 'array',
                            items: {
                              type: 'array'
                            }
                          }
                        }
                      }
                    ]
                  };

                  await validateBrokenArray(cSwagger,
                    ['definitions', 'Pet', 'allOf', '0', 'properties', 'aliases', 'items']);
                });

                it('items array', async function () {
                  var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

                  cSwagger.definitions.Pet = {
                    type: 'object',
                    allOf: [
                      {
                        type: 'object',
                        properties: {
                          aliases: {
                            type: 'array',
                            items: [
                              {
                                type: 'array'
                              }
                            ]
                          }
                        }
                      }
                    ]
                  };

                  await validateBrokenArray(cSwagger,
                    ['definitions', 'Pet', 'allOf', '0', 'properties', 'aliases', 'items', '0']);
                });
              });
            });

            it('recursive', async function () {
              var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);
              var errorSchema = {
                type: 'object',
                allOf: [
                  {
                    type: 'array'
                  }
                ],
                properties: {
                  aliases: {
                    type: 'array'
                  }
                },
                additionalProperties: {
                  type: 'array'
                }
              };

              cSwagger.definitions.Pet = {
                allOf: [
                  errorSchema
                ],
                properties: {
                  aliases: errorSchema
                },
                additionalProperties: errorSchema
              };

              await new Promise((resolve, reject) => {
                Sway.create({
                  definition: cSwagger
                })
                  .then(function (api) {
                    var results = api.validate();

                    // Validate that all warnings are unused definitions
                    _.forEach(results.warnings, function (warning) {
                      assert.equal(warning.code, 'UNUSED_DEFINITION');
                    });

                    assert.deepEqual(results.errors, [
                      {
                        code: 'OBJECT_MISSING_REQUIRED_PROPERTY',
                        message: 'Missing required property: items',
                        path: ['definitions', 'Pet', 'additionalProperties', 'additionalProperties']
                      },
                      {
                        code: 'OBJECT_MISSING_REQUIRED_PROPERTY',
                        message: 'Missing required property: items',
                        path: ['definitions', 'Pet', 'additionalProperties', 'allOf', '0']
                      },
                      {
                        code: 'OBJECT_MISSING_REQUIRED_PROPERTY',
                        message: 'Missing required property: items',
                        path: ['definitions', 'Pet', 'additionalProperties', 'properties', 'aliases']
                      },
                      {
                        code: 'OBJECT_MISSING_REQUIRED_PROPERTY',
                        message: 'Missing required property: items',
                        path: ['definitions', 'Pet', 'allOf', '0', 'additionalProperties']
                      },
                      {
                        code: 'OBJECT_MISSING_REQUIRED_PROPERTY',
                        message: 'Missing required property: items',
                        path: ['definitions', 'Pet', 'allOf', '0', 'allOf', '0']
                      },
                      {
                        code: 'OBJECT_MISSING_REQUIRED_PROPERTY',
                        message: 'Missing required property: items',
                        path: ['definitions', 'Pet', 'allOf', '0', 'properties', 'aliases']
                      },
                      {
                        code: 'OBJECT_MISSING_REQUIRED_PROPERTY',
                        message: 'Missing required property: items',
                        path: ['definitions', 'Pet', 'properties', 'aliases', 'additionalProperties']
                      },
                      {
                        code: 'OBJECT_MISSING_REQUIRED_PROPERTY',
                        message: 'Missing required property: items',
                        path: ['definitions', 'Pet', 'properties', 'aliases', 'allOf', '0']
                      },
                      {
                        code: 'OBJECT_MISSING_REQUIRED_PROPERTY',
                        message: 'Missing required property: items',
                        path: ['definitions', 'Pet', 'properties', 'aliases', 'properties', 'aliases']
                      }
                    ]);
                  })
                  .then(resolve, reject);
              });
            });
          });

          describe('parameter definitions', function () {
            describe('global', function () {
              it('body parameter', async function () {
                var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

                cSwagger.parameters = {
                  petInBody: {
                    in: 'body',
                    name: 'body',
                    description: 'A Pet',
                    required: true,
                    schema: {
                      properties: {
                        aliases: {
                          type: 'array'
                        }
                      }
                    }
                  }
                };

                await validateBrokenArray(cSwagger, ['parameters', 'petInBody', 'schema', 'properties', 'aliases']);
              });

              it('non-body parameter', async function () {
                var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

                cSwagger.parameters = {
                  petStatus: _.cloneDeep(cSwagger.paths['/pet/findByStatus'].get.parameters[0])
                };

                delete cSwagger.parameters.petStatus.items;

                await validateBrokenArray(cSwagger, ['parameters', 'petStatus']);
              });
            });

            describe('path-level', function () {
              it('body parameter', async function () {
                var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

                cSwagger.paths['/pet'].parameters = [
                  {
                    in: 'body',
                    name: 'body',
                    description: 'A Pet',
                    required: true,
                    schema: {
                      properties: {
                        aliases: {
                          type: 'array'
                        }
                      }
                    }
                  }
                ];

                await validateBrokenArray(cSwagger,
                  ['paths', '/pet', 'parameters', '0', 'schema', 'properties', 'aliases']);
              });

              it('non-body parameter', async function () {
                var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

                cSwagger.paths['/pet'].parameters = [
                  _.cloneDeep(cSwagger.paths['/pet/findByStatus'].get.parameters[0])
                ];

                delete cSwagger.paths['/pet'].parameters[0].items;

                await validateBrokenArray(cSwagger, ['paths', '/pet', 'parameters', '0']);
              });
            });

            describe('operation', function () {
              it('body parameter', async function () {
                var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

                delete cSwagger.paths['/user/createWithArray'].post.parameters[0].schema.items;

                await validateBrokenArray(cSwagger,
                  ['paths', '/user/createWithArray', 'post', 'parameters', '0', 'schema']);
              });

              it('non-body parameter', async function () {
                var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

                delete cSwagger.paths['/pet/findByStatus'].get.parameters[0].items;

                await validateBrokenArray(cSwagger, ['paths', '/pet/findByStatus', 'get', 'parameters', '0']);
              });
            });
          });

          describe('responses', function () {
            describe('global', function () {
              it('headers', async function () {
                var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

                cSwagger.responses = {
                  success: {
                    description: 'A response indicative of a successful request',
                    headers: {
                      'X-Broken-Array': {
                        type: 'array'
                      }
                    }
                  }
                };

                await validateBrokenArray(cSwagger, ['responses', 'success', 'headers', 'X-Broken-Array']);
              });

              it('schema definition', async function () {
                var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

                cSwagger.responses = {
                  success: {
                    description: 'A response indicative of a successful request',
                    schema: {
                      type: 'array'
                    }
                  }
                };

                await validateBrokenArray(cSwagger, ['responses', 'success', 'schema']);
              });
            });

            describe('operation', function () {
              it('headers', async function () {
                var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

                cSwagger.paths['/pet/findByStatus'].get.responses['200'].headers = {
                  'X-Broken-Array': {
                    type: 'array'
                  }
                };

                await validateBrokenArray(cSwagger,
                  [
                    'paths',
                    '/pet/findByStatus',
                    'get',
                    'responses',
                    '200',
                    'headers',
                    'X-Broken-Array'
                  ]);
              });

              it('schema definition', async function () {
                var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

                delete cSwagger.paths['/pet/findByStatus'].get.responses['200'].schema.items;

                await validateBrokenArray(cSwagger,
                  ['paths', '/pet/findByStatus', 'get', 'responses', '200', 'schema']);
              });
            });
          });
        });

        describe('circular composition/inheritance', function () {
          function validateErrors (actual, expected) {
            assert.equal(actual.length, expected.length);

            _.each(actual, function (aErr) {
              assert.deepEqual(aErr, _.find(expected, function (vErr) {
                return JsonRefs.pathToPtr(aErr.path) === JsonRefs.pathToPtr(vErr.path);
              }));
            });
          }

          it('definition (direct)', async function () {
            var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

            cSwagger.definitions.A = {
              allOf: [
                {
                  $ref: '#/definitions/B'
                }
              ]
            };
            cSwagger.definitions.B = {
              allOf: [
                {
                  $ref: '#/definitions/A'
                }
              ]
            };

            await new Promise((resolve, reject) => {
              Sway.create({
                definition: cSwagger
              })
                .then(function (api) {
                  var results = api.validate();

                  assert.deepEqual(results.warnings, []);

                  validateErrors(results.errors, [
                    {
                      code: 'CIRCULAR_INHERITANCE',
                      lineage: ['#/definitions/B', '#/definitions/A', '#/definitions/B'],
                      message: 'Schema object inherits from itself: #/definitions/B',
                      path: ['definitions', 'B']
                    },
                    {
                      code: 'CIRCULAR_INHERITANCE',
                      lineage: ['#/definitions/A', '#/definitions/B', '#/definitions/A'],
                      message: 'Schema object inherits from itself: #/definitions/A',
                      path: ['definitions', 'A']
                    }
                  ]);
                })
                .then(resolve, reject);
            });
          });

          it('definition (indirect)', async function () {
            var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

            cSwagger.definitions.A = {
              allOf: [
                {
                  $ref: '#/definitions/B'
                }
              ]
            };
            cSwagger.definitions.B = {
              allOf: [
                {
                  $ref: '#/definitions/C'
                }
              ]
            };
            cSwagger.definitions.C = {
              allOf: [
                {
                  $ref: '#/definitions/A'
                }
              ]
            };

            await new Promise((resolve, reject) => {
              Sway.create({
                definition: cSwagger
              })
                .then(function (api) {
                  var results = api.validate();

                  assert.deepEqual(results.warnings, []);
                  validateErrors(results.errors, [
                    {
                      code: 'CIRCULAR_INHERITANCE',
                      lineage: ['#/definitions/C', '#/definitions/A', '#/definitions/B', '#/definitions/C'],
                      message: 'Schema object inherits from itself: #/definitions/C',
                      path: ['definitions', 'C']
                    },
                    {
                      code: 'CIRCULAR_INHERITANCE',
                      lineage: ['#/definitions/B', '#/definitions/C', '#/definitions/A', '#/definitions/B'],
                      message: 'Schema object inherits from itself: #/definitions/B',
                      path: ['definitions', 'B']
                    },
                    {
                      code: 'CIRCULAR_INHERITANCE',
                      lineage: ['#/definitions/A', '#/definitions/B', '#/definitions/C', '#/definitions/A'],
                      message: 'Schema object inherits from itself: #/definitions/A',
                      path: ['definitions', 'A']
                    }
                  ]);
                })
                .then(resolve, reject);
            });
          });

          it('inline schema', async function () {
            var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

            cSwagger.definitions.A = {
              allOf: [
                {
                  allOf: [
                    {
                      $ref: '#/definitions/A/allOf/0'
                    }
                  ]
                }
              ]
            };

            await new Promise((resolve, reject) => {
              Sway.create({
                definition: cSwagger
              })
                .then(function (api) {
                  var results = api.validate();

                  assert.deepEqual(results.warnings, []);
                  assert.deepEqual(results.errors, [
                    {
                      code: 'CIRCULAR_INHERITANCE',
                      lineage: ['#/definitions/A/allOf/0', '#/definitions/A/allOf/0'],
                      message: 'Schema object inherits from itself: #/definitions/A/allOf/0',
                      path: ['definitions', 'A', 'allOf', '0']
                    }
                  ]);
                })
                .then(resolve, reject);
            });
          });

          it('not composition/inheritance', async function () {
            var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

            cSwagger.definitions.Pet.properties.friends = {
              type: 'array',
              items: {
                $ref: '#/definitions/Pet'
              }
            };

            await new Promise((resolve, reject) => {
              Sway.create({
                definition: cSwagger
              })
                .then(function (api) {
                  var results = api.validate();

                  assert.deepEqual(results.errors, []);
                  assert.deepEqual(results.warnings, []);
                })
                .then(resolve, reject);
            });
          });
        });

        describe('default values fail JSON Schema validation', function () {
          it('schema-like object (non-body parameter)', async function () {
            var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

            cSwagger.paths['/pet'].post.parameters.push({
              in: 'query',
              name: 'status',
              description: 'The Pet status',
              required: true,
              type: 'string',
              default: 123
            });

            await new Promise((resolve, reject) => {
              Sway.create({
                definition: cSwagger
              })
                .then(function (api) {
                  var results = api.validate();

                  assert.deepEqual(results.warnings, []);
                  assert.deepEqual(results.errors, [
                    {
                      code: 'INVALID_TYPE',
                      description: 'The Pet status', // Copied in for non-body parameters
                      message: 'Expected type string but found type integer',
                      params: ['string', 'integer'],
                      path: ['paths', '/pet', 'post', 'parameters', '1', 'default']
                    }
                  ]);
                })
                .then(resolve, reject);
            });
          });

          it('schema object', async function () {
            var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

            cSwagger.definitions.Pet.properties.name.default = 123;

            await new Promise((resolve, reject) => {
              Sway.create({
                definition: cSwagger
              })
                .then(function (api) {
                  var results = api.validate();

                  assert.deepEqual(results.warnings, []);
                  assert.deepEqual(results.errors, [
                    {
                      code: 'INVALID_TYPE',
                      message: 'Expected type string but found type integer',
                      params: ['string', 'integer'],
                      path: ['definitions', 'Pet', 'properties', 'name', 'default']
                    }
                  ]);
                })
                .then(resolve, reject);
            });
          });
        });

        describe('duplicate operation parameter', function () {
          it('operation-level', async function () {
            var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);
            var cParam = _.cloneDeep(cSwagger.paths['/pet/findByStatus'].get.parameters[0]);

            // Alter the parameter so that it is not identical as that will create a JSON Schema uniqueness error
            cParam.description = 'Duplicate';

            cSwagger.paths['/pet/findByStatus'].get.parameters.push(cParam);

            await new Promise((resolve, reject) => {
              Sway.create({
                definition: cSwagger
              })
                .then(function (api) {
                  var results = api.validate();

                  assert.deepEqual(results.warnings, []);
                  assert.deepEqual(results.errors, [
                    {
                      code: 'DUPLICATE_PARAMETER',
                      message: 'Operation cannot have duplicate parameters: #/paths/~1pet~1findByStatus/get/parameters/1',
                      path: ['paths', '/pet/findByStatus', 'get', 'parameters', '1']
                    }
                  ]);
                })
                .then(resolve, reject);
            });
          });

          it('path-level', async function () {
            var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);
            var cParam = _.cloneDeep(cSwagger.paths['/pet/{petId}'].parameters[0]);

            // Alter the parameter so that it is not identical as that will create a JSON Schema uniqueness error
            cParam.description = 'Duplicate';

            cSwagger.paths['/pet/{petId}'].parameters.push(cParam);

            await new Promise((resolve, reject) => {
              Sway.create({
                definition: cSwagger
              })
                .then(function (api) {
                  var results = api.validate();

                  assert.deepEqual(results.warnings, []);
                  assert.deepEqual(results.errors, [
                    {
                      code: 'DUPLICATE_PARAMETER',
                      message: 'Operation cannot have duplicate parameters: #/paths/~1pet~1{petId}/parameters/1',
                      path: ['paths', '/pet/{petId}', 'parameters', '1']
                    }
                  ]);
                })
                .then(resolve, reject);
            });
          });
        });

        it('invalid JSON Reference', async function () {
          var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

          cSwagger.paths['/something'] = {
            $ref: 'http://:8080'
          };

          await new Promise((resolve, reject) => {
            Sway.create({
              definition: cSwagger
            })
              .then(function (api) {
                var results = api.validate();

                assert.deepEqual(results.warnings, []);
                assert.deepEqual(results.errors, [
                  {
                    code: 'INVALID_REFERENCE',
                    message: 'HTTP URIs must have a host.',
                    path: ['paths', '/something', '$ref']
                  }
                ]);
              })
              .then(resolve, reject);
          });
        });

        it('path parameter in pattern is empty', async function () {
          var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

          cSwagger.paths['/invalid/{}'] = {};

          await new Promise((resolve, reject) => {
            Sway.create({
              definition: cSwagger
            })
              .then(function (api) {
                var results = api.validate();

                assert.deepEqual(results.warnings, []);
                assert.deepEqual(results.errors, [
                  {
                    code: 'EMPTY_PATH_PARAMETER_DECLARATION',
                    message: 'Path parameter declaration cannot be empty: /invalid/{}',
                    path: ['paths', '/invalid/{}']
                  }
                ]);
              })
              .then(resolve, reject);
          });
        });

        it('missing path parameter declaration', async function () {
          var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

          cSwagger.paths['/pet/{petId}'].get.parameters = [
            {
              description: 'Superfluous path parameter',
              in: 'path',
              name: 'petId2',
              required: true,
              type: 'string'
            }
          ];

          await new Promise((resolve, reject) => {
            Sway.create({
              definition: cSwagger
            })
              .then(function (api) {
                var results = api.validate();

                assert.deepEqual(results.warnings, []);
                assert.deepEqual(results.errors, [
                  {
                    code: 'MISSING_PATH_PARAMETER_DECLARATION',
                    message: 'Path parameter is defined but is not declared: petId2',
                    path: ['paths', '/pet/{petId}', 'get', 'parameters', '0']
                  }
                ]);
              })
              .then(resolve, reject);
          });
        });

        it('missing path parameter definition', async function () {
          var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

          cSwagger.paths['/pet/{petId}'].parameters = [];

          await new Promise((resolve, reject) => {
            Sway.create({
              definition: cSwagger
            })
              .then(function (api) {
                var results = api.validate();

                assert.deepEqual(results.warnings, []);
                assert.deepEqual(results.errors, [
                  {
                    code: 'MISSING_PATH_PARAMETER_DEFINITION',
                    message: 'Path parameter is declared but is not defined: petId',
                    path: ['paths', '/pet/{petId}', 'get']
                  },
                  {
                    code: 'MISSING_PATH_PARAMETER_DEFINITION',
                    message: 'Path parameter is declared but is not defined: petId',
                    path: ['paths', '/pet/{petId}', 'post']
                  },
                  {
                    code: 'MISSING_PATH_PARAMETER_DEFINITION',
                    message: 'Path parameter is declared but is not defined: petId',
                    path: ['paths', '/pet/{petId}', 'delete']
                  }
                ]);
              })
              .then(resolve, reject);
          });
        });

        it('multiple equivalent paths', async function () {
          var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

          cSwagger.paths['/pet/{notPetId}'] = {};

          await new Promise((resolve, reject) => {
            Sway.create({
              definition: cSwagger
            })
              .then(function (api) {
                var results = api.validate();

                assert.deepEqual(results.warnings, []);
                assert.deepEqual(results.errors, [
                  {
                    code: 'EQUIVALENT_PATH',
                    message: 'Equivalent path already exists: /pet/{notPetId}',
                    path: ['paths', '/pet/{notPetId}']
                  }
                ]);
              })
              .then(resolve, reject);
          });
        });

        it('multiple operations with the same operationId', async function () {
          var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);
          var operationId = cSwagger.paths['/pet'].post.operationId;

          cSwagger.paths['/pet'].put.operationId = operationId;

          await new Promise((resolve, reject) => {
            Sway.create({
              definition: cSwagger
            })
              .then(function (api) {
                var results = api.validate();

                assert.deepEqual(results.warnings, []);
                assert.deepEqual(results.errors, [
                  {
                    code: 'DUPLICATE_OPERATIONID',
                    message: 'Cannot have multiple operations with the same operationId: ' + operationId,
                    path: ['paths', '/pet', 'put', 'operationId']
                  }
                ]);
              })
              .then(resolve, reject);
          });
        });

        it('operation has multiple body parameters', async function () {
          var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);
          var dBodyParam = _.cloneDeep(cSwagger.paths['/pet'].post.parameters[0]);

          dBodyParam.name = dBodyParam.name + 'Duplicate';

          cSwagger.paths['/pet'].post.parameters.push(dBodyParam);

          await new Promise((resolve, reject) => {
            Sway.create({
              definition: cSwagger
            })
              .then(function (api) {
                var results = api.validate();

                assert.deepEqual(results.warnings, []);
                assert.deepEqual(results.errors, [
                  {
                    code: 'MULTIPLE_BODY_PARAMETERS',
                    message: 'Operation cannot have multiple body parameters',
                    path: ['paths', '/pet', 'post']
                  }
                ]);
              })
              .then(resolve, reject);
          });
        });

        it('operation can have body or form parameter but not both', async function () {
          var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

          cSwagger.paths['/pet'].post.parameters.push({
            name: 'name',
            in: 'formData',
            description: 'The Pet name',
            required: true,
            type: 'string'
          });

          await new Promise((resolve, reject) => {
            Sway.create({
              definition: cSwagger
            })
              .then(function (api) {
                var results = api.validate();

                assert.deepEqual(results.warnings, []);
                assert.deepEqual(results.errors, [
                  {
                    code: 'INVALID_PARAMETER_COMBINATION',
                    message: 'Operation cannot have a body parameter and a formData parameter',
                    path: ['paths', '/pet', 'post']
                  }
                ]);
              })
              .then(resolve, reject);
          });
        });

        describe('missing required property definition', function () {
          it('allOf', async function () {
            var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

            delete cSwagger.definitions.Pet.properties.name;

            cSwagger.definitions.Pet.allOf = [
              {
                type: 'object',
                properties: _.cloneDeep(cSwagger.definitions.Pet.properties)

              }
            ];

            delete cSwagger.definitions.Pet.properties;

            await new Promise((resolve, reject) => {
              Sway.create({
                definition: cSwagger
              })
                .then(function (api) {
                  var results = api.validate();

                  assert.deepEqual(results.warnings, []);
                  assert.deepEqual(results.errors, [
                    {
                      code: 'OBJECT_MISSING_REQUIRED_PROPERTY_DEFINITION',
                      message: 'Missing required property definition: name',
                      path: ['definitions', 'Pet']
                    }
                  ]);
                })
                .then(resolve, reject);
            });
          });

          it('properties', async function () {
            var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

            delete cSwagger.definitions.Pet.properties.name;

            await new Promise((resolve, reject) => {
              Sway.create({
                definition: cSwagger
              })
                .then(function (api) {
                  var results = api.validate();

                  assert.deepEqual(results.warnings, []);
                  assert.deepEqual(results.errors, [
                    {
                      code: 'OBJECT_MISSING_REQUIRED_PROPERTY_DEFINITION',
                      message: 'Missing required property definition: name',
                      path: ['definitions', 'Pet']
                    }
                  ]);
                })
                .then(resolve, reject);
            });
          });
        });

        describe('unused definitions', function () {
          it('definition', async function () {
            var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

            cSwagger.definitions.Missing = {};

            await new Promise((resolve, reject) => {
              Sway.create({
                definition: cSwagger
              })
                .then(function (api) {
                  var results = api.validate();

                  assert.deepEqual(results.errors, []);
                  assert.deepEqual(results.warnings, [
                    {
                      code: 'UNUSED_DEFINITION',
                      message: 'Definition is not used: #/definitions/Missing',
                      path: ['definitions', 'Missing']
                    }
                  ]);
                })
                .then(resolve, reject);
            });
          });

          it('parameter', async function () {
            var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

            cSwagger.parameters = {
              missing: {
                name: 'missing',
                in: 'query',
                type: 'string'
              }
            };

            await new Promise((resolve, reject) => {
              Sway.create({
                definition: cSwagger
              })
                .then(function (api) {
                  var results = api.validate();

                  assert.deepEqual(results.errors, []);
                  assert.deepEqual(results.warnings, [
                    {
                      code: 'UNUSED_DEFINITION',
                      message: 'Definition is not used: #/parameters/missing',
                      path: ['parameters', 'missing']
                    }
                  ]);
                })
                .then(resolve, reject);
            });
          });

          it('response', async function () {
            var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

            cSwagger.responses = {
              Missing: {
                description: 'I am missing'
              }
            };

            await new Promise((resolve, reject) => {
              Sway.create({
                definition: cSwagger
              })
                .then(function (api) {
                  var results = api.validate();

                  assert.deepEqual(results.errors, []);
                  assert.deepEqual(results.warnings, [
                    {
                      code: 'UNUSED_DEFINITION',
                      message: 'Definition is not used: #/responses/Missing',
                      path: ['responses', 'Missing']
                    }
                  ]);
                })
                .then(resolve, reject);
            });
          });

          it('securityDefinition', async function () {
            var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

            cSwagger.securityDefinitions.missing = {
              type: 'apiKey',
              name: 'api_key',
              in: 'header'
            };

            await new Promise((resolve, reject) => {
              Sway.create({
                definition: cSwagger
              })
                .then(function (api) {
                  var results = api.validate();

                  assert.deepEqual(results.errors, []);
                  assert.deepEqual(results.warnings, [
                    {
                      code: 'UNUSED_DEFINITION',
                      message: 'Definition is not used: #/securityDefinitions/missing',
                      path: ['securityDefinitions', 'missing']
                    }
                  ]);
                })
                .then(resolve, reject);
            });
          });

          it('security scope', async function () {
            var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

            cSwagger.securityDefinitions.petstore_auth.scopes.missing = 'I am missing';

            await new Promise((resolve, reject) => {
              Sway.create({
                definition: cSwagger
              })
                .then(function (api) {
                  var results = api.validate();

                  assert.deepEqual(results.errors, []);
                  assert.deepEqual(results.warnings, [
                    {
                      code: 'UNUSED_DEFINITION',
                      message: 'Definition is not used: #/securityDefinitions/petstore_auth/scopes/missing',
                      path: ['securityDefinitions', 'petstore_auth', 'scopes', 'missing']
                    }
                  ]);
                })
                .then(resolve, reject);
            });
          });
        });

        describe('unresolvable references', function () {
          describe('json reference', function () {
            it('local', async function () {
              var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

              cSwagger.paths['/pet'].post.parameters[0].schema.$ref = '#/definitions/Missing';

              await new Promise((resolve, reject) => {
                Sway.create({
                  definition: cSwagger
                })
                  .then(function (api) {
                    var results = api.validate();

                    assert.deepEqual(results.warnings, []);
                    assert.deepEqual(results.errors, [
                      {
                        code: 'UNRESOLVABLE_REFERENCE',
                        message: 'Reference could not be resolved: #/definitions/Missing',
                        path: ['paths', '/pet', 'post', 'parameters', '0', 'schema', '$ref'],
                        error: 'JSON Pointer points to missing location: #/definitions/Missing'
                      }
                    ]);
                  })
                  .then(resolve, reject);
              });
            });

            it('remote', async function () {
              var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

              cSwagger.paths['/pet'].post.parameters[0].schema.$ref = 'fake.json';

              await new Promise((resolve, reject) => {
                Sway.create({
                  definition: cSwagger
                })
                  .then(function (api) {
                    var results = api.validate();
                    var error;

                    assert.deepEqual(results.warnings, []);
                    assert.equal(results.errors.length, 1);

                    error = results.errors[0];

                    assert.equal(error.code, 'UNRESOLVABLE_REFERENCE');
                    assert.equal(error.message, 'Reference could not be resolved: fake.json');
                    assert.deepEqual(error.path, ['paths', '/pet', 'post', 'parameters', '0', 'schema', '$ref']);
                    assert.ok(_.has(error, 'error'));
                  })
                  .then(resolve, reject);
              });
            });
          });

          describe('security definition', function () {
            it('global', async function () {
              var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

              cSwagger.security.push({
                missing: []
              });

              await new Promise((resolve, reject) => {
                Sway.create({
                  definition: cSwagger
                })
                  .then(function (api) {
                    var results = api.validate();

                    assert.deepEqual(results.warnings, []);
                    assert.deepEqual(results.errors, [
                      {
                        code: 'UNRESOLVABLE_REFERENCE',
                        message: 'Security definition could not be resolved: missing',
                        path: ['security', '1', 'missing']
                      }
                    ]);
                  })
                  .then(resolve, reject);
              });
            });

            it('operation-level', async function () {
              var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

              cSwagger.paths['/store/inventory'].get.security.push({
                missing: []
              });

              await new Promise((resolve, reject) => {
                Sway.create({
                  definition: cSwagger
                })
                  .then(function (api) {
                    var results = api.validate();

                    assert.deepEqual(results.warnings, []);
                    assert.deepEqual(results.errors, [
                      {
                        code: 'UNRESOLVABLE_REFERENCE',
                        message: 'Security definition could not be resolved: missing',
                        path: ['paths', '/store/inventory', 'get', 'security', '1', 'missing']
                      }
                    ]);
                  })
                  .then(resolve, reject);
              });
            });
          });

          describe('security scope definition', function () {
            it('global', async function () {
              var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

              cSwagger.security[0].petstore_auth.push('missing');

              await new Promise((resolve, reject) => {
                Sway.create({
                  definition: cSwagger
                })
                  .then(function (api) {
                    var results = api.validate();

                    assert.deepEqual(results.warnings, []);
                    assert.deepEqual(results.errors, [
                      {
                        code: 'UNRESOLVABLE_REFERENCE',
                        message: 'Security scope definition could not be resolved: missing',
                        path: ['security', '0', 'petstore_auth', '2']
                      }
                    ]);
                  })
                  .then(resolve, reject);
              });
            });

            it('operation-level', async function () {
              var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

              cSwagger.paths['/store/inventory'].get.security.push({
                'petstore_auth': [
                  'missing'
                ]
              });

              await new Promise((resolve, reject) => {
                Sway.create({
                  definition: cSwagger
                })
                  .then(function (api) {
                    var results = api.validate();

                    assert.deepEqual(results.warnings, []);
                    assert.deepEqual(results.errors, [
                      {
                        code: 'UNRESOLVABLE_REFERENCE',
                        message: 'Security scope definition could not be resolved: missing',
                        path: ['paths', '/store/inventory', 'get', 'security', '1', 'petstore_auth', '0']
                      }
                    ]);
                  })
                  .then(resolve, reject);
              });
            });
          });
        });
      });

      it('should return errors for JsonRefs errors', async function () {
        var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

        cSwagger.paths['/pet'].post.parameters[0].schema.$ref = '#definitions/Pet';

        await new Promise((resolve, reject) => {
          Sway.create({
            definition: cSwagger
          })
            .then(function (api) {
              assert.deepEqual(api.validate(), {
                errors: [
                  {
                    code: 'INVALID_REFERENCE',
                    message: 'ptr must start with a / or #/',
                    path: ['paths', '/pet', 'post', 'parameters', '0', 'schema', '$ref']
                  }
                ],
                warnings: []
              });
            })
            .then(resolve, reject);
        });
      });

      it('should return warnings for JsonRefs warnings', async function () {
        var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

        cSwagger.paths['/pet'].post.parameters[0].schema.extraField = 'This is an extra field';

        await new Promise((resolve, reject) => {
          Sway.create({
            definition: cSwagger
          })
            .then(function (api) {
              var results =  api.validate();

              assert.deepEqual(results, {
                errors: [],
                warnings: [
                  {
                    code: 'EXTRA_REFERENCE_PROPERTIES',
                    message: 'Extra JSON Reference properties will be ignored: extraField',
                    path: ['paths', '/pet', 'post', 'parameters', '0', 'schema']
                  }
                ]
              });
            })
            .then(resolve, reject);
        });
      });

      describe('human readable errors for invalid schema', function () {
        function validateError (api, defType) {
          var results = api.validate();

          assert.equal(results.errors.length, 1);
          assert.equal(results.warnings.length, 0);
          assert.equal(results.errors[0].message, 'Not a valid ' + defType + ' definition');
        }

        it('should handle parameter definition', async function () {
          var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

          cSwagger.paths['/pet'].post.parameters[0] = {};

          await new Promise((resolve, reject) => {
            Sway.create({
              definition: cSwagger
            })
              .then(function (api) {
                validateError(api, 'parameter');
              })
              .then(resolve, reject);
          });
        });

        it('should handle global parameter definition', async function () {
          var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

          cSwagger.parameters = {
            broken: {}
          };

          await new Promise((resolve, reject) => {
            Sway.create({
              definition: cSwagger
            })
              .then(function (api) {
                validateError(api, 'parameter');
              })
              .then(resolve, reject);
          });
        });

        it('should handle response definition', async function () {
          var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

          cSwagger.paths['/pet'].post.responses.default = {};

          await new Promise((resolve, reject) => {
            Sway.create({
              definition: cSwagger
            })
              .then(function (api) {
                validateError(api, 'response');
              })
              .then(resolve, reject);
          });
        });

        it('should handle response schema definition', async function () {
          var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

          cSwagger.paths['/pet'].post.responses.default = {
            description: 'A broken response',
            schema: []
          };

          await new Promise((resolve, reject) => {
            Sway.create({
              definition: cSwagger
            })
              .then(function (api) {
                validateError(api, 'response');
              })
              .then(resolve, reject);
          });
        });

        it('should handle schema additionalProperties definition', async function () {
          var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

          cSwagger.definitions.Broken = {
            type: 'object',
            additionalProperties: []
          };

          await new Promise((resolve, reject) => {
            Sway.create({
              definition: cSwagger
            })
              .then(function (api) {
                validateError(api, 'schema additionalProperties');
              })
              .then(resolve, reject);
          });
        });

        it('should handle schema items definition', async function () {
          var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

          cSwagger.definitions.Broken = {
            type: 'object',
            properties: {
              urls: {
                type: 'array',
                items: false
              }
            }
          };

          await new Promise((resolve, reject) => {
            Sway.create({
              definition: cSwagger
            })
              .then(function (api) {
                validateError(api, 'schema items');
              })
              .then(resolve, reject);
          });
        });

        it('should handle securityDefinitions definition', async function () {
          var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

          cSwagger.securityDefinitions.broken = {};

          await new Promise((resolve, reject) => {
            Sway.create({
              definition: cSwagger
            })
              .then(function (api) {
                validateError(api, 'securityDefinitions');
              })
              .then(resolve, reject);
          });
        });

        it('should handle schema items definition', async function () {
          var cSwagger = _.cloneDeep(tHelpers.swaggerDoc);

          cSwagger.definitions.Broken = {
            type: 'object',
            properties: {
              urls: {
                type: 'array',
                items: true
              }
            }
          };

          await new Promise((resolve, reject) => {
            Sway.create({
              definition: cSwagger
            })
              .then(function (api) {
                validateError(api, 'schema items');
              })
              .then(resolve, reject);
          });
        });
      });
    });
});
}

describe('SwaggerApi', function () {
  // Swagger document without references
  runTests('no-refs');
  // Swagger document with references
  runTests('with-refs');
});
