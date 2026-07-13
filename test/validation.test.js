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

  test('reports every required top-level section when missing or malformed', () => {
    const requiredSections = [
      'metadata',
      'scope',
      'interfaces',
      'behavior',
      'errors',
      'constraints',
      'freedom',
      'verifications',
    ];

    requiredSections.forEach((section) => {
      const missingDocument = parse(renderSeedTemplate());
      delete missingDocument[section];

      assert.ok(
        validateSeedDocument(missingDocument).errors.some((entry) => entry.path === `/${section}`),
        `expected missing ${section} to yield an error`,
      );

      const malformedDocument = parse(renderSeedTemplate());
      malformedDocument[section] = 'wrong shape';

      assert.ok(
        validateSeedDocument(malformedDocument).errors.some((entry) => entry.path === `/${section}`),
        `expected malformed ${section} to yield an error`,
      );
    });
  });

  test('allows state to be omitted', () => {
    const document = parse(renderSeedTemplate());
    delete document.state;

    const result = validateSeedDocument(document);

    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 0);
  });

  test('requires metadata summary', () => {
    const missingSummary = parse(renderSeedTemplate());
    delete missingSummary.metadata.summary;

    const result = validateSeedDocument(missingSummary);
    assert.equal(result.errors.some((entry) => entry.path === '/metadata/summary'), true);
  });

  test('requires scope included and excluded as non-empty string arrays', () => {
    const missingIncluded = parse(renderSeedTemplate());
    delete missingIncluded.scope.included;

    const missingExcluded = parse(renderSeedTemplate());
    delete missingExcluded.scope.excluded;

    const emptyInvalid = parse(renderSeedTemplate());
    emptyInvalid.scope.excluded = [];

    const badEntry = parse(renderSeedTemplate());
    badEntry.scope.excluded = [''];

    assert.equal(
      validateSeedDocument(missingIncluded).errors.some((entry) => entry.path === '/scope/included'),
      true,
    );
    assert.equal(
      validateSeedDocument(missingExcluded).errors.some((entry) => entry.path === '/scope/excluded'),
      true,
    );
    assert.equal(
      validateSeedDocument(emptyInvalid).errors.some((entry) => entry.path === '/scope/excluded'),
      true,
    );
    assert.equal(
      validateSeedDocument(badEntry).errors.some((entry) => entry.path === '/scope/excluded'),
      true,
    );
  });

  test('requires verification description/method/evidenceGuidance and allows optional traceability', () => {
    const invalid = parse(renderSeedTemplate());
    invalid.verifications = [
      {
        id: invalid.verifications[0].id,
        title: invalid.verifications[0].title,
        method: invalid.verifications[0].method,
      },
    ];

    const missingMethod = parse(renderSeedTemplate());
    delete missingMethod.verifications[0].method;
    const missingDescription = parse(renderSeedTemplate());
    delete missingDescription.verifications[0].description;
    const missingEvidenceGuidance = parse(renderSeedTemplate());
    delete missingEvidenceGuidance.verifications[0].evidenceGuidance;

    assert.equal(validateSeedDocument(invalid).errors.some((entry) => entry.path === '/verifications/0/description'), true);
    assert.equal(validateSeedDocument(missingMethod).errors.some((entry) => entry.path === '/verifications/0/method'), true);
    assert.equal(validateSeedDocument(missingEvidenceGuidance).errors.some((entry) => entry.path === '/verifications/0/evidenceGuidance'), true);

    const validWithTraceability = parse(renderSeedTemplate());
    validWithTraceability.verifications[0].traceability = ['metadata.name', 'scope.included'];
    const valid = validateSeedDocument(validWithTraceability);
    assert.equal(valid.errors.length, 0);
  });

  test('reports duplicate and malformed verification ids as errors', () => {
    const document = parse(renderSeedTemplate());
    document.verifications = [
      {
        id: 'seed-baseline-visibility',
        title: 'One',
        description: 'desc',
        method: 'method',
        evidenceGuidance: ['evidence'],
      },
      {
        id: 'seed-baseline-visibility',
        title: 'Two',
        description: 'desc',
        method: 'method',
        evidenceGuidance: ['evidence'],
      },
      {
        id: 'Invalid ID',
        title: 'Three',
        description: 'desc',
        method: 'method',
        evidenceGuidance: ['evidence'],
      },
    ];

    const result = validateSeedDocument(document);
    const errorCodes = codes(result.errors);

    result.errors.forEach((entry) => {
      assert.deepEqual(Object.keys(entry), ['code', 'path', 'message']);
    });
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

    const result = validateSeedDocument(document);

    assert.equal(result.errors.length, 0);
    assert.ok(result.warnings.length >= 2);
    result.warnings.forEach((entry) => {
      assert.deepEqual(Object.keys(entry), ['code', 'path', 'message']);
    });
    assert.ok(codes(result.warnings).includes('interface-without-examples'));
    assert.ok(codes(result.warnings).includes('persistence-without-semantics'));
    assert.ok(codes(result.warnings).includes('outputs-without-errors'));
  });
});
