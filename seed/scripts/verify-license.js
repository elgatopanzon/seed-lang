'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const packageManifest = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
);
const dependencyLock = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, 'package-lock.json'), 'utf8'),
);
const license = fs.readFileSync(path.join(repositoryRoot, 'LICENSE'), 'utf8');

assert.equal(packageManifest.license, 'MIT', 'package.json must declare MIT');
assert.ok(dependencyLock.packages?.[''], 'package-lock.json has no root package entry');
assert.equal(
  dependencyLock.packages[''].license,
  packageManifest.license,
  'root package-lock license must match package.json',
);
assert.match(license, /^MIT License$/m, 'LICENSE does not identify the MIT License');
assert.match(
  license,
  /Permission is hereby granted, free of charge/,
  'LICENSE is missing the MIT permission grant',
);
assert.match(
  license,
  /THE SOFTWARE IS PROVIDED "AS IS"/,
  'LICENSE is missing the MIT warranty disclaimer',
);

console.log('Repository license passed (LICENSE, package.json, and root package-lock entry: MIT).');
