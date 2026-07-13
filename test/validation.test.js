const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('yaml');

const { renderSeedTemplate } = require('../src/seed-file');
const { validateSeedDocument } = require('../src/validation');

describe('validation', () => {
  function codes(list) {
    return list.map((entry) => entry.code);
  }

  test('rendered template has no structural errors', () => {
    const document = parse(renderSeedTemplate());
    const result = validateSeedDocument(document);

    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 0);
  });

  test('reports malformed required structure', () => {
    const result = validateSeedDocument({});
    assert.ok(result.errors.length >= 1);
    assert.ok(codes(result.errors).includes('missing-required-section'));
  });

  test('reports duplicate and malformed verification ids as errors', () => {
    const document = parse(renderSeedTemplate());
    document.verifications = [
      { id: 'seed-baseline-visibility', title: 'One', evidence: ['proof'] },
      { id: 'seed-baseline-visibility', title: 'Two', evidence: ['proof'] },
      { id: 'Invalid ID', title: 'Three', evidence: ['proof'] },
    ];

    const result = validateSeedDocument(document);
    const errorCodes = codes(result.errors);

    assert.ok(errorCodes.includes('duplicate-verification-id'));
    assert.ok(errorCodes.includes('malformed-verification-id'));
    assert.equal(result.warnings.length, 0);
  });

  test('flags interface without examples as warning', () => {
    const document = parse(renderSeedTemplate());
    document.interfaces = [
      {
        id: 'local-files',
        purpose: 'Read and write local artifacts.',
      },
    ];

    const result = validateSeedDocument(document);

    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].code, 'interface-without-examples');
  });

  test('flags warnings for weak-contract violations while keeping document valid', () => {
    const document = parse(renderSeedTemplate());
    document.interfaces = [
      {
        id: 'cli',
        purpose: 'CLI behavior path.',
        examples: [],
      },
    ];
    document.state.semantics = null;
    document.behavior.outputs = [
      'CLI output contract',
    ];
    document.errors = [];
    document.verifications = [
      {
        id: 'seed-baseline-visibility',
        title: document.verifications[0].title,
        evidence: [],
      },
    ];

    const result = validateSeedDocument(document);

    assert.equal(result.errors.length, 0);
    assert.ok(result.warnings.length >= 2);
    assert.ok(codes(result.warnings).includes('interface-without-examples'));
    assert.ok(codes(result.warnings).includes('persistence-without-semantics'));
    assert.ok(codes(result.warnings).includes('outputs-without-errors'));
    assert.ok(codes(result.warnings).includes('verification-without-evidence'));
  });
});
