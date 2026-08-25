'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { collectExternalReferences } = require('../src/external-references');

describe('cross-Seed reference syntax', () => {
  test('collects compiled and genome-qualified references', () => {
    assert.deepEqual(collectExternalReferences({
      description: 'Use @master:interfaces.http and @core:genome/api-http:artifacts.openapi.',
      local: '@constraints.local-only',
    }), [
      {
        seedName: 'master',
        genomeId: null,
        address: 'interfaces.http',
        raw: '@master:interfaces.http',
      },
      {
        seedName: 'core',
        genomeId: 'api-http',
        address: 'artifacts.openapi',
        raw: '@core:genome/api-http:artifacts.openapi',
      },
    ]);
  });
});
