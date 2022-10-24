> **Note** This is a fork of [apigee-127/sway](https://github.com/apigee-127/sway) with goal to only support Node 16
> with fewer dependencies

A library that simplifies [Swagger][swagger] integrations.  This library handles the minutiae of loading Swagger
documents *(local and remote)*, resolving references *(local, remote)*, building an object model and providing you with
a rich set of APIs for things like Swagger document validation, request/response validation, etc.  For more details on
the available APIs, please view the [API Documentation](https://github.com/frodeaa/sway-node/blob/master/docs/API.md).

Sway will always be built around the latest stable release of Swagger, which happens to be version `2.0` right now.
This means that its APIs and object model will be specific to that version of Swagger and supporting any other versions
of Swagger will require a conversion step prior to using Sway.

## Project Badges

![example workflow](https://github.com/github/docs/actions/workflows/main.yml/badge.svg)
* Build status: ![Build Status](https://github.com/frodeaa/sway-node/actions/workflows/node.js.yml/badge.svg)
* Downloads: [![NPM Downloads Per Month](http://img.shields.io/npm/dm/sway-node.svg)](https://www.npmjs.org/package/sway-node)
* License: [![License](http://img.shields.io/npm/l/sway-node.svg)](https://github.com/frodeaa/sway-node/blob/master/LICENSE)
* Version: [![NPM Version](http://img.shields.io/npm/v/sway-node.svg)](https://www.npmjs.org/package/sway-node)

## Installation

Installation for Node.js applications can be done via [NPM][npm].

```
npm install sway --save
```

## Documentation

The documentation for this project can be found here: [/docs/README](/docs/README.md)

Of course, if you just want a quick link to the API documentation, that would be here:[/docs/API.md](/docs/API.md)

[npm]: https://www.npmjs.org/
[swagger]: http://swagger.io
