const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stringify } = require('yaml');

const {
  compileSeedDocument,
  mergeSeedFragments,
  parseGenomeSpec,
  resolveGenome,
} = require('../src/genomes');
const { validateSeedDocument } = require('../src/validation');

function tempDir(prefix = 'seed-genome-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withTempDir(runTest) {
  const cwd = tempDir();
  try {
    return runTest(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

function writeYaml(file, document) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, stringify(document), 'utf8');
}

describe('seed genomes', () => {
  test('builtin genomes recursively compose into a compiled seed document', () => {
    const compiled = compileSeedDocument({
      document: {
        genomes: ['cli-nodejs', 'cli-json-output'],
        metadata: {
          name: 'sample',
          summary: 'Sample project.',
        },
      },
      cwd: process.cwd(),
      home: '',
    });

    assert.deepEqual(compiled.genomes.map((entry) => entry.id), [
      'cli-interface',
      'cli-nodejs',
      'cli-json-output',
    ]);
    assert.equal(compiled.genomes[0].origin, 'builtin');
    assert.equal(compiled.document.interfaces.cli.purpose, 'User invokes the project from a terminal as a Node.js CLI.');
    assert.equal(compiled.document.behavior.outputs['default-json'], 'The CLI interface outputs JSON by default for successful machine-readable results.');
    assert.equal(compiled.document.compatibility['json-field-stability'], 'JSON output fields must not be renamed or removed without a Seed change.');
    assert.equal(compiled.provenance['interfaces.cli'].id, 'cli-nodejs');
    assert.equal(compiled.provenance['observability.stderr-errors'].id, 'cli-interface');
    assert.equal(compiled.provenance['behavior.outputs.default-json'].id, 'cli-json-output');
  });

  test('human output genome defines human-readable CLI output defaults', () => {
    const compiled = compileSeedDocument({
      document: {
        genomes: ['cli-nodejs', 'cli-human-output'],
      },
      cwd: process.cwd(),
      home: '',
    });

    assert.equal(compiled.document.behavior.outputs['default-human-output'], 'The CLI interface outputs human-readable text by default for successful interactive use.');
    assert.equal(compiled.document.behavior.outputs['readable-text'], 'Successful output should be readable in a terminal without requiring a parser.');
    assert.equal(compiled.document.constraints['human-output-default'], 'The target project CLI emits human-readable text as its default interface output format.');
    assert.equal(compiled.provenance['behavior.outputs.default-human-output'].id, 'cli-human-output');
  });

  test('local seed values override the same genome addresses', () => {
    const compiled = compileSeedDocument({
      document: {
        genomes: ['cli-nodejs'],
        interfaces: {
          cli: {
            purpose: 'Project-specific CLI purpose.',
          },
        },
        constraints: {
          'nodejs-cli-runtime': 'Use Node.js 22 or newer.',
        },
      },
      cwd: process.cwd(),
      home: '',
    });

    assert.equal(compiled.document.interfaces.cli.purpose, 'Project-specific CLI purpose.');
    assert.equal(compiled.document.constraints['nodejs-cli-runtime'], 'Use Node.js 22 or newer.');
    assert.deepEqual(compiled.document.interfaces.cli.examples, [
      'node ./src/cli.js --help',
      '<command> --help',
    ]);
    assert.equal(compiled.provenance['interfaces.cli'].origin, 'seed');
    assert.equal(compiled.provenance['constraints.nodejs-cli-runtime'].origin, 'seed');
    assert.equal(compiled.provenance['freedom.nodejs-cli-structure'].id, 'cli-nodejs');
  });

  test('string cherry-pick selectors can import a full section or one address', () => {
    const section = compileSeedDocument({
      document: {
        genomes: ['cli-nodejs[constraints]'],
      },
      cwd: process.cwd(),
      home: '',
    });
    assert.equal(section.document.constraints['nodejs-cli-runtime'].description, 'The implementation is a Node.js command line application.');
    assert.equal(section.document.interfaces, undefined);
    assert.equal(section.provenance['constraints.nodejs-cli-runtime'].id, 'cli-nodejs');
    assert.deepEqual(section.genomes.at(-1).include, ['constraints']);

    const address = compileSeedDocument({
      document: {
        genomes: ['cli-nodejs[constraints.nodejs-cli-runtime]'],
      },
      cwd: process.cwd(),
      home: '',
    });
    assert.deepEqual(Object.keys(address.document.constraints), ['nodejs-cli-runtime']);
    assert.equal(address.document.environment, undefined);
  });

  test('object include selectors are equivalent to string cherry-picks', () => {
    const compiled = compileSeedDocument({
      document: {
        genomes: [
          {
            id: 'cli-nodejs',
            include: [
              'constraints',
              'environment.node-runtime',
            ],
          },
        ],
      },
      cwd: process.cwd(),
      home: '',
    });

    assert.equal(compiled.document.constraints['nodejs-cli-runtime'].description, 'The implementation is a Node.js command line application.');
    assert.equal(compiled.document.environment['node-runtime'].description, 'Must run on Node.js 20 or newer.');
    assert.equal(compiled.document.environment['npm-install'], undefined);
    assert.equal(compiled.document.interfaces, undefined);
    assert.deepEqual(compiled.genomes.at(-1).include, ['constraints', 'environment.node-runtime']);
  });

  test('cherry-picks import referenced addresses and declared artifacts', () => {
    withTempDir((cwd) => {
      writeYaml(path.join(cwd, 'seed', 'genomes', 'reference-demo.yml'), {
        artifacts: {
          sample: {
            path: 'seed/artifacts/sample.txt',
            description: 'Sample artifact.',
          },
        },
        behavior: {
          demo: {
            description: 'Use @constraints.required and @sample.',
            artifacts: ['sample'],
          },
        },
        constraints: {
          required: 'Referenced constraint.',
          skipped: 'Unreferenced constraint.',
        },
      });

      const compiled = compileSeedDocument({
        document: {
          genomes: ['reference-demo[behavior.demo]'],
        },
        cwd,
        home: '',
      });

      assert.equal(compiled.document.behavior.demo.description, 'Use @constraints.required and @sample.');
      assert.equal(compiled.document.constraints.required.description, 'Referenced constraint.');
      assert.equal(compiled.document.constraints.skipped, undefined);
      assert.equal(compiled.document.artifacts.sample.path, 'seed/artifacts/sample.txt');
    });
  });

  test('broken references stay in selected content so validation can fail loudly', () => {
    withTempDir((cwd) => {
      writeYaml(path.join(cwd, 'seed', 'genomes', 'broken-reference.yml'), {
        behavior: {
          demo: 'Use @constraints.missing.',
        },
      });

      const compiled = compileSeedDocument({
        document: {
          metadata: {
            name: 'broken-demo',
            summary: 'Broken reference demo.',
          },
          genomes: ['broken-reference[behavior.demo]'],
          scope: {
            included: {
              demo: 'Demo scope.',
            },
          },
          interfaces: {
            cli: {
              purpose: 'Demo CLI.',
              examples: ['demo --help'],
            },
          },
          errors: {},
          constraints: {
            existing: 'Existing constraint.',
          },
          freedom: {
            internal: 'Internal structure is free.',
          },
          verifications: [
            {
              id: 'manual',
              description: 'Manual check.',
              method: 'Inspect output.',
              evidence_required: ['Observed output.'],
            },
          ],
        },
        cwd,
        home: '',
      });

      const result = validateSeedDocument(compiled.document);
      assert.equal(result.errors.some((entry) => entry.code === 'invalid-reference' && entry.message.includes('@constraints.missing')), true);
    });
  });

  test('recursive genome cycles fail loudly', () => {
    withTempDir((cwd) => {
      writeYaml(path.join(cwd, 'seed', 'genomes', 'cycle-a.yml'), {
        genomes: ['cycle-b'],
        constraints: {
          a: 'A.',
        },
      });
      writeYaml(path.join(cwd, 'seed', 'genomes', 'cycle-b.yml'), {
        genomes: ['cycle-a'],
        constraints: {
          b: 'B.',
        },
      });

      assert.throws(
        () => compileSeedDocument({
          document: { genomes: ['cycle-a'] },
          cwd,
          home: '',
        }),
        /Genome cycle detected: cycle-a -> cycle-b -> cycle-a/,
      );
    });
  });

  test('arrays with id fields merge by id and non-id arrays replace', () => {
    const merged = mergeSeedFragments(
      {
        verifications: [
          { id: 'same', description: 'base', method: 'base', evidence_required: ['base'] },
          { id: 'base-only', description: 'base only' },
        ],
        tags: ['base'],
      },
      {
        verifications: [
          { id: 'same', method: 'override' },
          { id: 'override-only', description: 'override only' },
        ],
        tags: ['override'],
      },
    );

    assert.equal(merged.verifications.length, 3);
    assert.equal(merged.verifications.find((entry) => entry.id === 'same').description, 'base');
    assert.equal(merged.verifications.find((entry) => entry.id === 'same').method, 'override');
    assert.deepEqual(merged.tags, ['override']);
  });

  test('repo genomes override user genomes and user genomes override builtins for the same id', () => {
    withTempDir((cwd) => {
      const home = tempDir('seed-genome-home-');
      try {
        writeYaml(path.join(home, '.seed', 'genomes', 'cli-nodejs.yml'), {
          interfaces: {
            cli: {
              purpose: 'User genome CLI.',
            },
          },
        });
        writeYaml(path.join(cwd, 'seed', 'genomes', 'cli-nodejs.yml'), {
          interfaces: {
            cli: {
              purpose: 'Repo genome CLI.',
            },
          },
        });

        const resolved = resolveGenome({ id: 'cli-nodejs', cwd, home });
        assert.equal(resolved.origin, 'repo');
        assert.equal(resolved.document.interfaces.cli.purpose, 'Repo genome CLI.');

        const compiled = compileSeedDocument({
          document: { genomes: ['cli-nodejs'] },
          cwd,
          home,
        });
        assert.equal(compiled.document.interfaces.cli.purpose, 'Repo genome CLI.');
        assert.equal(compiled.provenance['interfaces.cli'].origin, 'repo');
        assert.equal(compiled.provenance['interfaces.cli'].path, path.join(cwd, 'seed', 'genomes', 'cli-nodejs.yml'));
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });
  });

  test('unknown genomes and malformed selectors fail loudly', () => {
    assert.throws(
      () => compileSeedDocument({
        document: { genomes: ['missing-genome'] },
        cwd: process.cwd(),
        home: '',
      }),
      /Unknown genome missing-genome/,
    );

    assert.throws(
      () => parseGenomeSpec('cli-nodejs[]'),
      /must include an address inside brackets/,
    );
  });
});
