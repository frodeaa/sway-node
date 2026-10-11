> **Note** This is a fork of [apigee-127/sway](https://github.com/apigee-127/sway). Its goals are to support the
> active and maintenance [Node.js LTS releases][node-releases] and to keep dependencies to a minimum.

A library that simplifies [Swagger][swagger] integrations.  This library handles the minutiae of loading Swagger
documents *(from a file, a URL or an object)*, resolving local references, building an object model and providing you
with a rich set of APIs for things like Swagger document validation, request/response validation, etc.  For more details
on the available APIs, please view the [API Documentation](docs/API.md).

Sway supports Swagger `2.0` only.  Documents in other versions, such as OpenAPI 3, must be converted before using Sway.

## Differences from upstream

* Requires Node.js 22.19 or later.  CI tests on the active LTS release.
* Only local references (`#/...`) are resolved.  External and relative references are reported as invalid.
* `Sway.create` rejects a document whose `pattern` values the JSON Schema validator will not compile, because they are
  invalid or considered unsafe (ReDoS).  The error lists the path of each pattern.  Rewrite such patterns without a
  repeated or optional group that contains another quantifier, for example `^\d+$|^\d+\.\d+$` instead of
  `^\d+(\.\d+)?$`.

## Project Badges

* Build status: [![Build Status](https://github.com/frodeaa/sway-node/actions/workflows/node.js.yml/badge.svg)](https://github.com/frodeaa/sway-node/actions/workflows/node.js.yml)
* Downloads: [![NPM Downloads Per Month](https://img.shields.io/npm/dm/sway-node.svg)](https://www.npmjs.com/package/sway-node)
* License: [![License](https://img.shields.io/npm/l/sway-node.svg)](LICENSE)
* Version: [![NPM Version](https://img.shields.io/npm/v/sway-node.svg)](https://www.npmjs.com/package/sway-node)

## Installation

```
npm install sway-node
```

## Documentation

The documentation for this project can be found in [docs/README.md](docs/README.md), and the API documentation in
[docs/API.md](docs/API.md).

[node-releases]: https://nodejs.org/en/about/previous-releases
[swagger]: https://swagger.io/specification/v2/
