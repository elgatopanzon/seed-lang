const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('yaml');

const { renderSeedTemplate } = require('../src/seed-file');
const { collectGlobalPolicyItems, normalizeAddressableSection, validateSeedDocument } = require('../src/validation');

describe('validation', () => {
  function codes(list) {
    return list.map((entry) => entry.code);
  }

  test('rendered template has no structural errors or warnings', () => {
    const document = parse(renderSeedTemplate());
    const result = validateSeedDocument(document);

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
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

  test('allows optional addressable sections to be omitted', () => {
    const document = parse(renderSeedTemplate());
    delete document.artifacts;
    delete document.security;
    delete document.environment;
    delete document.observability;
    delete document.compatibility;
    delete document.state;
    document.verifications[0].description = 'The Seed contract template can be initialized and validated.';
    document.verifications[0].method = 'Run seed init, then seed validate.';
    delete document.verifications[0].artifacts;

    const result = validateSeedDocument(document);

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
  });

  test('does not require metadata version', () => {
    const document = parse(renderSeedTemplate());

    assert.equal(document.metadata.version, undefined);
    assert.equal(validateSeedDocument(document).errors.some((entry) => entry.path === '/metadata/version'), false);
  });

  test('normalizes list objects, tree objects, and tree string shorthand into addresses', () => {
    const errors = [];
    const items = [
      ...normalizeAddressableSection('constraints', [
        { id: 'output-json', description: 'Output is JSON.' },
      ], errors),
      ...normalizeAddressableSection('freedom', {
        'module-layout': 'Any maintainable module layout is allowed.',
      }, errors),
      ...normalizeAddressableSection('behavior', {
        counting: {
          description: 'Count input characters.',
          whitespace: {
            description: 'Whitespace is counted.',
            artifacts: ['baseline-seed'],
          },
        },
      }, errors),
      ...normalizeAddressableSection('security', {
        'no-network-access': 'Must not make outbound network calls.',
      }, errors),
    ];

    assert.deepEqual(errors, []);
    assert.ok(items.some((item) => item.address === 'constraints.output-json'));
    assert.ok(items.some((item) => item.address === 'freedom.module-layout'));
    assert.ok(items.some((item) => item.address === 'behavior.counting'));
    assert.ok(items.some((item) => item.address === 'behavior.counting.whitespace'));
    assert.deepEqual(
      items.find((item) => item.address === 'behavior.counting.whitespace').value.artifacts,
      ['baseline-seed'],
    );
    assert.ok(items.some((item) => item.address === 'security.no-network-access'));
  });


  test('validates policy values and treats security as global by default', () => {
    const document = parse(renderSeedTemplate());
    document.constraints['offline-only'] = {
      description: 'No network access is allowed.',
      policy: 'global',
    };
    document.security['repo-local-boundary'] = 'Only read and write inside the repository.';

    let result = validateSeedDocument(document);
    assert.deepEqual(result.errors, []);
    const policyAddresses = collectGlobalPolicyItems(document).map((item) => item.address);
    assert.ok(policyAddresses.includes('constraints.offline-only'));
    assert.ok(policyAddresses.includes('security.repo-local-boundary'));

    document.constraints['offline-only'].policy = 'project-wide';
    result = validateSeedDocument(document);
    assert.ok(codes(result.errors).includes('invalid-policy'));
  });

  test('rejects anonymous strings in list-based addressable sections', () => {
    const document = parse(renderSeedTemplate());
    document.constraints = ['Must not be anonymous.'];

    const result = validateSeedDocument(document);

    assert.ok(codes(result.errors).includes('invalid-addressable-item'));
  });

  test('requires verification description/method/evidence_required and rejects manual traceability', () => {
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
    const missingEvidenceGuidance = parse(renderSeedTemplate());
    delete missingEvidenceGuidance.verifications[0].evidence_required;
    const manualTraceability = parse(renderSeedTemplate());
    manualTraceability.verifications[0].traceability = ['metadata.name', 'scope.included'];

    assert.equal(validateSeedDocument(invalid).errors.some((entry) => entry.path === '/verifications/0/description'), true);
    assert.equal(validateSeedDocument(missingMethod).errors.some((entry) => entry.path === '/verifications/0/method'), true);
    assert.equal(validateSeedDocument(missingEvidenceGuidance).errors.some((entry) => entry.path === '/verifications/0/evidence_required'), true);
    assert.ok(codes(validateSeedDocument(manualTraceability).errors).includes('manual-traceability'));
  });

  test('reports duplicate and malformed addresses as errors', () => {
    const document = parse(renderSeedTemplate());
    document.verifications = [
      {
        id: 'seed-baseline-visibility',
        title: 'One',
        description: 'desc',
        method: 'method',
        evidence_required: ['evidence'],
      },
      {
        id: 'seed-baseline-visibility',
        title: 'Two',
        description: 'desc',
        method: 'method',
        evidence_required: ['evidence'],
      },
      {
        id: 'Invalid ID',
        title: 'Three',
        description: 'desc',
        method: 'method',
        evidence_required: ['evidence'],
      },
    ];

    const result = validateSeedDocument(document);
    const errorCodes = codes(result.errors);

    result.errors.forEach((entry) => {
      assert.deepEqual(Object.keys(entry), ['code', 'path', 'message']);
    });
    assert.ok(errorCodes.includes('duplicate-address'));
    assert.ok(errorCodes.includes('malformed-id'));
  });

  test('flags interface without examples as warning', () => {
    const document = parse(renderSeedTemplate());
    document.interfaces = {
      cli: {
        purpose: 'CLI behavior path.',
      },
    };

    const result = validateSeedDocument(document);

    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].code, 'interface-without-examples');
  });

  test('validates artifact paths and references', () => {
    const document = parse(renderSeedTemplate());
    document.artifacts = {
      'file-with-aba': {
        path: 'artifacts/aba.txt',
        description: 'Input file containing aba.',
      },
    };
    document.verifications[0] = {
      id: 'counts-basic-file',
      title: 'Counts characters in one file',
      description: 'Given @file-with-aba, the CLI reports expected counts.',
      artifacts: ['file-with-aba'],
      method: 'Run the CLI using @file-with-aba as input.',
      evidence_required: ['Command used.', 'Observed output.'],
    };

    const result = validateSeedDocument(document);

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings, []);
  });

  test('rejects missing artifact definitions, missing artifact declarations, and invalid absolute paths', () => {
    const document = parse(renderSeedTemplate());
    document.artifacts = {
      'file-with-aba': {
        path: '/tmp/aba.txt',
        description: 'Input file containing aba.',
      },
    };
    document.verifications[0] = {
      id: 'counts-basic-file',
      title: 'Counts characters in one file',
      description: 'Given @file-with-aba and @missing-artifact, the CLI reports expected counts.',
      artifacts: ['missing-artifact'],
      method: 'Run the CLI using @file-with-aba as input.',
      evidence_required: ['Observed output.'],
    };

    const result = validateSeedDocument(document);
    const errorCodes = codes(result.errors);

    assert.ok(errorCodes.includes('invalid-artifact-path'));
    assert.ok(errorCodes.includes('missing-artifact'));
    assert.ok(errorCodes.includes('missing-artifact-declaration'));
    assert.ok(errorCodes.includes('invalid-reference'));
  });

  test('warns when a global artifact is never referenced', () => {
    const document = parse(renderSeedTemplate());
    document.artifacts.unused = {
      path: 'artifacts/unused.txt',
      description: 'Unused input.',
    };

    const result = validateSeedDocument(document);

    assert.equal(result.errors.length, 0);
    assert.ok(codes(result.warnings).includes('unreferenced-artifact'));
  });

  test('validates non-artifact @ references against addressable contract items', () => {
    const document = parse(renderSeedTemplate());
    document.verifications[0].description = 'Confirm @behavior.local-commands and @security.repo-local-boundary still hold.';
    document.verifications[0].method = 'Read @behavior.local-commands and @security.repo-local-boundary, then validate implementation behavior.';

    const valid = validateSeedDocument(document);
    assert.deepEqual(valid.errors, []);

    document.verifications[0].description = 'Confirm @behavior.missing still holds.';
    const invalid = validateSeedDocument(document);
    assert.ok(codes(invalid.errors).includes('invalid-reference'));
  });

  test('flags warnings for weak-contract violations while keeping document valid', () => {
    const document = parse(renderSeedTemplate());
    document.interfaces = {
      cli: {
        purpose: 'CLI behavior path.',
        examples: [],
      },
    };
    document.state = {
      'repo-local-state': {
        location: '.seed',
        persistence: 'local repository',
      },
    };
    document.behavior.outputs = {
      'cli-output': 'CLI output contract',
    };
    document.errors = {};

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
