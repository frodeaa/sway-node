> **Note** This is a fork of [apigee-127/sway](https://github.com/apigee-127/sway). Its goals are to support the
> active and maintenance [Node.js LTS releases][node-releases] and to keep dependencies to a minimum.

A library that simplifies [Swagger][swagger] integrations.  This library handles the minutiae of loading Swagger
documents *(from a file, a URL or an object)*, resolving local references, building an object model and providing you
with a rich set of APIs for things like Swagger document validation, request/response validation, etc.

Sway supports Swagger `2.0` only.  Documents in other versions, such as OpenAPI 3, must be converted before using Sway.

## Differences from upstream

* Requires Node.js 22.19 or later.  CI tests on the active LTS release.
* Only local references (`#/...`) are resolved.  External and relative references are reported as invalid.
* `Sway.create` rejects a document whose `pattern` values the JSON Schema validator will not compile, because they are
  invalid or considered unsafe (ReDoS).  The error lists the path of each pattern.  Rewrite such patterns without a
  repeated or optional group that contains another quantifier, for example `^\d+$|^\d+\.\d+$` instead of
  `^\d+(\.\d+)?$`.

## Installation

```
npm install sway-node
```

## API Documentation

The API documentation can be found in [API.md](API.md).

## Swagger Resources

* Specification: https://swagger.io/specification/v2/
* JSON Schema: [lib/validation/swagger-2.0-schema.json](../lib/validation/swagger-2.0-schema.json), a copy of the
  official schema whose `host` pattern is rewritten so the JSON Schema validator accepts it

## Swagger Validation

Swagger validation can be broken up into three phases:

* `Structural Validation`: This is where we use the Swagger provided JSON Schema linked above and use a JSON Schema
validator to validate the structure of your Swagger document
* `Semantic Validation`: This is where to do validation above and beyond the general structure of your Swagger document.
The reason for this is that there are some situations that cannot be described using JSON Schema.  There are also
situations where the existing JSON Schema for Swagger is broken or not as strict as it could be.
* `Custom Validation`: This is user-configurable validation that typically fall into stylistic checks.

`Structural Validation` is the only type of validation that occurs in a special way.  If structural validation fails,
no other validation will occur.  But once the structural validation happens, `Semantic Validation` and
`Custom Validation` will happen.

### Semantic Validation

| Description | Type  |
| :---------  | :---: |
| Operations cannot have both a `body` parameter and a `formData` parameter | Error |
| Operations must have only one `body` parameter | Error |
| Operations must have unique *(`name` + `in` combination)* parameters | Error |
| Operations must have unique `operationId` | Error |
| Path parameters declared in the path string need matching parameter definitions *(Either at the path-level or the operation)* | Error |
| Path parameter declarations do not allow empty names *(`/path/{}` is not valid)* | Error |
| Path parameters definition *(Either at the path-level or the operation)* need matching paramater declarations | Error |
| Path strings must be *(equivalently)* different *(Example: `/pet/{petId}` and `/pet/{petId2}` are equivalently the same and would generate an error)* | Error |
| Paths must have unique *(`name` + `in` combination)* parameters | Error |
| Referenceable definitions should be *used* by being referenced in the appropriate way | Warning |
| References must point to existing documents or document fragments | Error |
| The `default` property for [Schema Objects][schema-object], or schema-like objects *(non-body parameters)*, must validate against the respective JSON Schema | Error |
| Circular composition/inheritance for [Schema Objects][schema-object] is not allowed *(You can have circular references everywhere except in composition/inheritance.)* | Error |
| The `items` property for [Schema Objects][schema-object], or schema-like objects *(non-body parameters)*, is required when `type` is set to `array` _(See [swagger-api/swagger-spec/issues/174](https://github.com/swagger-api/swagger-spec/issues/174))_ | Error |
| The `required` properties for a [Schema Object][schema-object] must be defined in the object or one of its ancestors | Error |

[node-releases]: https://nodejs.org/en/about/previous-releases
[schema-object]: https://github.com/swagger-api/swagger-spec/blob/master/versions/2.0.md#schemaObject
[swagger]: https://swagger.io/specification/v2/
