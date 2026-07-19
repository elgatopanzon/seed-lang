const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stringify } = require('yaml');

const {
  BUILTIN_GENOME_DIR,
  compileGenomeDocument,
  compileSeedDocument,
  listGenomeDefinitions,
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
  test('builtin genome definitions load from packaged YAML resources', () => {
    const expectedBuiltins = [
      'architecture-client-server',
      'architecture-component-boundaries',
      'architecture-ecs',
      'architecture-event-driven',
      'architecture-functional-core',
      'architecture-layered',
      'architecture-library-first',
      'architecture-modular-monolith',
      'architecture-monorepo-components',
      'architecture-pipeline',
      'architecture-plugin-host',
      'architecture-ports-and-adapters',
      'architecture-service-oriented',
      'architecture-shared-nothing-workers',
      'architecture-single-binary',
      'architecture-single-component',
      'architecture-state-machine',
      'architecture-worker-queue',
      'desktop-client',
      'desktop-dotnet',
      'desktop-electron',
      'desktop-gtk',
      'desktop-opengl',
      'desktop-qt',
      'desktop-tauri',
      'mobile-android-kotlin',
      'mobile-android-native',
      'mobile-app',
      'mobile-capacitor',
      'mobile-flutter',
      'mobile-ios-swift',
      'mobile-react-native',
      'cli-tui',
      'tui-client',
      'tui-go-bubble-tea',
      'tui-js-blessed',
      'tui-js-ink',
      'tui-ncurses',
      'tui-notcurses',
      'tui-python-textual',
      'tui-rust-cursive',
      'tui-rust-ratatui',
      'monorepo-api-mobile',
      'monorepo-api-web',
      'monorepo-component-boundaries',
      'monorepo-integration-verification',
      'monorepo-shared-api',
      'monorepo-shared-types',
      'monorepo-single-seed',
      'package-cargo',
      'package-docker',
      'package-go-install',
      'package-npm',
      'package-nuget',
      'package-pypi',
      'package-static-binary',
      'package-systemd-service',
      'obs-audit-log',
      'obs-clear-errors',
      'obs-debug-mode',
      'obs-error-codes',
      'obs-health-check',
      'obs-logs-json',
      'obs-logs-jsonl',
      'obs-metrics-prometheus',
      'obs-no-public-errors',
      'obs-structured-logs',
      'obs-tracing',
      'policy-audit-logs',
      'policy-authenticated',
      'policy-dependency-minimal',
      'policy-input-validation',
      'policy-no-external-dependencies',
      'policy-no-network',
      'policy-no-secrets-output',
      'policy-no-shell-injection',
      'policy-rbac',
      'policy-repo-local-files',
      'policy-safe-paths',
      'policy-traceability-logs',
      'state-event-log',
      'state-filesystem',
      'state-idempotent',
      'state-local-cache',
      'state-migrations',
      'state-mongodb',
      'state-mysql',
      'state-nosql',
      'state-postgres',
      'state-redis',
      'state-sqlite',
      'state-stateless',
      'state-versioned',
      'verify-api-contract',
      'verify-cli-golden-output',
      'verify-integration-tests',
      'verify-live-tests',
      'verify-no-network',
      'verify-performance-basic',
      'verify-property-tests',
      'verify-security-basic',
      'verify-seed-scripts',
      'verify-smoke-tests',
      'verify-snapshot-tests',
      'verify-unit-tests',
      'web-accessibility',
      'web-admin-panel',
      'web-dashboard',
      'web-form-workflows',
      'web-nextjs',
      'web-no-authentication',
      'web-pwa',
      'web-react',
      'web-responsive',
      'web-spa',
      'web-static',
      'web-svelte',
      'web-ui',
      'web-vite',
      'web-vue',
      'api-csharp-aspnet',
      'api-go-chi',
      'api-graphql',
      'api-grpc',
      'api-http',
      'api-json',
      'api-nodejs-express',
      'api-nodejs-fastify',
      'api-openapi',
      'api-python-fastapi',
      'api-python-flask',
      'api-rest',
      'api-rust-axum',
      'api-websocket',
      'cli-bash',
      'cli-c',
      'cli-config-csv',
      'cli-config-env-file',
      'cli-config-file',
      'cli-config-ini',
      'cli-yaml-output',
      'cli-table-output',
      'cli-quiet-verbose',
      'cli-progress-output',
      'cli-no-color',
      'cli-jsonl-output',
      'cli-json-input',
      'cli-human-input',
      'cli-csv-output',
      'cli-csv-input',
      'cli-color-output',
      'cli-cpp',
      'cli-csharp',
      'cli-env-vars',
      'cli-exit-codes',
      'cli-file-inputs',
      'cli-go',
      'cli-help-version',
      'cli-hello-world',
      'cli-human-output',
      'cli-interface',
      'cli-json-output',
      'cli-nodejs',
      'cli-posix',
      'cli-python',
      'cli-rust',
      'cli-single-command',
      'cli-stdin-stdout',
      'cli-subcommands',
    ];
    const files = fs.readdirSync(BUILTIN_GENOME_DIR).filter((entry) => entry.endsWith('.yml')).sort();
    assert.deepEqual(files, expectedBuiltins.map((id) => id + '.yml').sort());

    const definitions = listGenomeDefinitions({ origins: ['builtin'], home: '' });
    assert.deepEqual(definitions.map((entry) => entry.id), expectedBuiltins.sort());
    definitions.forEach((entry) => {
      const compiled = compileGenomeDocument({ id: entry.id, cwd: process.cwd(), home: '' });
      assert.equal(compiled.origin, 'builtin');
      assert.equal(compiled.path, 'builtin:' + entry.id);
      assert.equal(compiled.description.length > 0, true);
    });
    const nodejs = definitions.find((entry) => entry.id === 'cli-nodejs');
    assert.equal(nodejs.description, 'Adds Node.js runtime, npm dependency, Linux shell, and Node CLI structure expectations.');

    const compiled = compileGenomeDocument({ id: 'cli-human-output', cwd: process.cwd(), home: '' });
    assert.equal(compiled.description, 'Makes successful CLI output readable terminal text with user-facing error expectations.');
    assert.equal(compiled.provenance['behavior.outputs.default-human-output'].path, 'builtin:cli-human-output');

    const helloWorld = compileGenomeDocument({ id: 'cli-hello-world', cwd: process.cwd(), home: '' });
    assert.equal(helloWorld.provenance['interfaces.cli'].path, 'builtin:cli-single-command');
    assert.equal(helloWorld.provenance['behavior.hello-world-output'].path, 'builtin:cli-hello-world');
    assert.equal(helloWorld.document.behavior['hello-world-output'], 'Running the CLI prints exactly Hello, world! followed by one newline, writes nothing to stderr, and exits successfully.');
    assert.equal(helloWorld.provenance['verifications.hello-world'].path, 'builtin:cli-hello-world');

    const jsonl = compileGenomeDocument({ id: 'cli-jsonl-output', cwd: process.cwd(), home: '' });
    assert.equal(jsonl.provenance['behavior.outputs.default-jsonl'].path, 'builtin:cli-jsonl-output');

    const csvInput = compileGenomeDocument({ id: 'cli-csv-input', cwd: process.cwd(), home: '' });
    assert.equal(csvInput.provenance['behavior.inputs.csv-input'].path, 'builtin:cli-csv-input');

    const rest = compileGenomeDocument({ id: 'api-rest', cwd: process.cwd(), home: '' });
    assert.equal(rest.provenance['interfaces.http'].path, 'builtin:api-http');
    assert.equal(rest.provenance['behavior.rest-resource-routes'].path, 'builtin:api-rest');

    const express = compileGenomeDocument({ id: 'api-nodejs-express', cwd: process.cwd(), home: '' });
    assert.equal(express.provenance['constraints.express-api-runtime'].path, 'builtin:api-nodejs-express');
    assert.equal(express.provenance['environment.node-runtime'].path, 'builtin:cli-nodejs');

    const axum = compileGenomeDocument({ id: 'api-rust-axum', cwd: process.cwd(), home: '' });
    assert.equal(axum.provenance['constraints.axum-api-runtime'].path, 'builtin:api-rust-axum');
    assert.equal(axum.provenance['environment.rust-runtime'].path, 'builtin:cli-rust');

    const nextjs = compileGenomeDocument({ id: 'web-nextjs', cwd: process.cwd(), home: '' });
    assert.equal(nextjs.provenance['interfaces.web'].path, 'builtin:web-ui');
    assert.equal(nextjs.provenance['constraints.react-web-ui-runtime'].path, 'builtin:web-react');
    assert.equal(nextjs.provenance['constraints.nextjs-web-ui-runtime'].path, 'builtin:web-nextjs');

    const pwa = compileGenomeDocument({ id: 'web-pwa', cwd: process.cwd(), home: '' });
    assert.equal(pwa.provenance['behavior.web-app-manifest'].path, 'builtin:web-pwa');
    assert.equal(pwa.provenance['interfaces.web'].path, 'builtin:web-ui');

    const capacitor = compileGenomeDocument({ id: 'mobile-capacitor', cwd: process.cwd(), home: '' });
    assert.equal(capacitor.provenance['interfaces.mobile'].path, 'builtin:mobile-app');
    assert.equal(capacitor.provenance['interfaces.web'].path, 'builtin:web-ui');
    assert.equal(capacitor.provenance['constraints.capacitor-mobile-runtime'].path, 'builtin:mobile-capacitor');

    const tauri = compileGenomeDocument({ id: 'desktop-tauri', cwd: process.cwd(), home: '' });
    assert.equal(tauri.provenance['interfaces.desktop'].path, 'builtin:desktop-client');
    assert.equal(tauri.provenance['interfaces.web'].path, 'builtin:web-ui');
    assert.equal(tauri.provenance['environment.rust-runtime'].path, 'builtin:cli-rust');

    const textual = compileGenomeDocument({ id: 'tui-python-textual', cwd: process.cwd(), home: '' });
    assert.equal(textual.provenance['interfaces.tui'].path, 'builtin:tui-client');
    assert.equal(textual.provenance['behavior.tui-rendering.full-screen-redraw'].path, 'builtin:cli-tui');
    assert.equal(textual.provenance['environment.python-runtime'].path, 'builtin:cli-python');
    assert.equal(textual.provenance['constraints.textual-tui-runtime'].path, 'builtin:tui-python-textual');

    const cliTui = compileGenomeDocument({ id: 'cli-tui', cwd: process.cwd(), home: '' });
    assert.equal(cliTui.provenance['interfaces.tui'].path, 'builtin:tui-client');
    assert.equal(cliTui.provenance['behavior.tui-navigation.visible-focus'].path, 'builtin:cli-tui');
    assert.equal(cliTui.provenance['behavior.tui-lifecycle.restore-terminal'].path, 'builtin:cli-tui');
    assert.equal(cliTui.provenance['freedom.tui-framework'].path, 'builtin:cli-tui');

    const blessed = compileGenomeDocument({ id: 'tui-js-blessed', cwd: process.cwd(), home: '' });
    assert.equal(blessed.provenance['environment.neo-blessed-runtime'].path, 'builtin:tui-js-blessed');
    assert.equal(blessed.provenance['constraints.neo-blessed-tui-runtime'].path, 'builtin:tui-js-blessed');
    assert.equal(blessed.document.constraints['neo-blessed-tui-runtime'], 'The target project uses the maintained neo-blessed package for the JavaScript terminal UI.');

    const mongodb = compileGenomeDocument({ id: 'state-mongodb', cwd: process.cwd(), home: '' });
    assert.equal(mongodb.provenance['state.nosql'].path, 'builtin:state-nosql');
    assert.equal(mongodb.provenance['state.mongodb'].path, 'builtin:state-mongodb');

    const noNetwork = compileGenomeDocument({ id: 'verify-no-network', cwd: process.cwd(), home: '' });
    assert.equal(noNetwork.provenance['security.no-network'].path, 'builtin:verify-no-network');
    assert.equal(noNetwork.provenance['verifications.no-network'].path, 'builtin:verify-no-network');

    const seedScripts = compileGenomeDocument({ id: 'verify-seed-scripts', cwd: process.cwd(), home: '' });
    assert.equal(seedScripts.provenance['verifications.seed-scripts'].path, 'builtin:verify-seed-scripts');
    assert.equal(seedScripts.provenance['constraints.seed-scripts-location'].path, 'builtin:verify-seed-scripts');

    const policyNoNetwork = compileGenomeDocument({ id: 'policy-no-network', cwd: process.cwd(), home: '' });
    assert.equal(policyNoNetwork.provenance['security.no-network'].path, 'builtin:policy-no-network');
    assert.equal(policyNoNetwork.provenance['constraints.no-network-policy'].path, 'builtin:policy-no-network');

    const logsJson = compileGenomeDocument({ id: 'obs-logs-json', cwd: process.cwd(), home: '' });
    assert.equal(logsJson.provenance['observability.structured-logs'].path, 'builtin:obs-structured-logs');
    assert.equal(logsJson.provenance['observability.json-logs'].path, 'builtin:obs-logs-json');

    const health = compileGenomeDocument({ id: 'obs-health-check', cwd: process.cwd(), home: '' });
    assert.equal(health.provenance['interfaces.health'].path, 'builtin:obs-health-check');
    assert.equal(health.provenance['observability.health-check'].path, 'builtin:obs-health-check');

    const docker = compileGenomeDocument({ id: 'package-docker', cwd: process.cwd(), home: '' });
    assert.equal(docker.provenance['environment.docker-image'].path, 'builtin:package-docker');
    assert.equal(docker.provenance['constraints.docker-distribution'].path, 'builtin:package-docker');

    const apiWeb = compileGenomeDocument({ id: 'monorepo-api-web', cwd: process.cwd(), home: '' });
    assert.equal(apiWeb.provenance['interfaces.http'].path, 'builtin:api-http');
    assert.equal(apiWeb.provenance['interfaces.web'].path, 'builtin:web-ui');
    assert.equal(apiWeb.provenance['verifications.api-web-integration'].path, 'builtin:monorepo-api-web');

    const integration = compileGenomeDocument({ id: 'monorepo-integration-verification', cwd: process.cwd(), home: '' });
    assert.equal(integration.provenance['verifications.monorepo-integration'].path, 'builtin:monorepo-integration-verification');
    assert.equal(integration.provenance['constraints.monorepo-integration-required'].path, 'builtin:monorepo-integration-verification');

    const architectureExpectations = {
      'architecture-client-server': 'client-server-contract',
      'architecture-component-boundaries': 'component-interface-boundaries',
      'architecture-ecs': 'ecs-data-and-logic-separation',
      'architecture-event-driven': 'event-contracts',
      'architecture-functional-core': 'functional-core-boundary',
      'architecture-layered': 'inward-layer-dependencies',
      'architecture-library-first': 'library-owns-product-behavior',
      'architecture-modular-monolith': 'modular-monolith-boundaries',
      'architecture-monorepo-components': 'monorepo-component-ownership',
      'architecture-pipeline': 'pipeline-stage-contracts',
      'architecture-plugin-host': 'plugin-contract',
      'architecture-ports-and-adapters': 'ports-and-adapters-boundary',
      'architecture-service-oriented': 'service-contract-boundaries',
      'architecture-shared-nothing-workers': 'shared-nothing-coordination',
      'architecture-single-binary': 'single-binary-delivery',
      'architecture-single-component': 'single-component-cohesion',
      'architecture-state-machine': 'explicit-state-transitions',
      'architecture-worker-queue': 'worker-queue-contract',
    };
    Object.entries(architectureExpectations).forEach(([id, constraintId]) => {
      const architecture = compileGenomeDocument({ id, cwd: process.cwd(), home: '' });
      assert.equal(architecture.document.constraints[constraintId].policy, 'global');
      assert.equal(architecture.document.verifications.length > 0, true);
      assert.equal(architecture.provenance[`constraints.${constraintId}`].path, `builtin:${id}`);
    });

    const ecs = compileGenomeDocument({ id: 'architecture-ecs', cwd: process.cwd(), home: '' });
    assert.match(ecs.document.constraints['ecs-data-and-logic-separation'].description, /components.*systems/i);
    assert.match(ecs.document.constraints['entity-model'].description, /entity/i);
  });

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

  test('exclude selectors remove matching addresses from selected genomes', () => {
    const noNetwork = compileSeedDocument({
      document: {
        genomes: ['verify-no-network[!*no-network*]'],
      },
      cwd: process.cwd(),
      home: '',
    });

    assert.equal(noNetwork.document.security, undefined);
    assert.equal(noNetwork.document.verifications, undefined);
    assert.equal(noNetwork.document.constraints, undefined);
    assert.deepEqual(noNetwork.genomes.at(-1).exclude, ['*no-network*']);
    assert.equal(noNetwork.provenance['security.no-network'], undefined);

    const apiWithoutHttp = compileSeedDocument({
      document: {
        genomes: ['monorepo-api-web[interfaces,!*http*]'],
      },
      cwd: process.cwd(),
      home: '',
    });

    assert.equal(apiWithoutHttp.document.interfaces.http, undefined);
    assert.equal(apiWithoutHttp.document.interfaces.web.purpose, 'User interacts with the project through a browser-based UI.');
    assert.deepEqual(apiWithoutHttp.genomes.at(-1).include, ['interfaces']);
    assert.deepEqual(apiWithoutHttp.genomes.at(-1).exclude, ['*http*']);
  });

  test('genome exclusions remove a composed genome from the full graph', () => {
    const compiled = compileSeedDocument({
      document: {
        genomes: ['cli-hello-world', '!cli-single-command'],
        behavior: {
          local: 'Local Seed behavior remains present.',
        },
      },
      cwd: process.cwd(),
      home: '',
    });

    assert.deepEqual(compiled.genomes.map((entry) => entry.id), [
      'cli-interface',
      'cli-hello-world',
    ]);
    assert.equal(compiled.document.behavior['single-command-dispatch'], undefined);
    assert.equal(compiled.document.behavior['hello-world-output'].includes('Hello, world!'), true);
    assert.equal(compiled.document.behavior.local, 'Local Seed behavior remains present.');
    assert.equal(compiled.document.interfaces.cli.purpose, 'User invokes the project from a terminal as a CLI.');
    assert.equal(compiled.provenance['interfaces.cli'].id, 'cli-interface');
  });

  test('genome exclusions apply regardless of directive order and fail when unmatched', () => {
    const compiled = compileSeedDocument({
      document: {
        genomes: ['!cli-single-command', 'cli-hello-world'],
      },
      cwd: process.cwd(),
      home: '',
    });

    assert.equal(compiled.document.behavior['single-command-dispatch'], undefined);
    assert.throws(
      () => compileSeedDocument({
        document: { genomes: ['cli-hello-world', '!cli-subcommands'] },
        cwd: process.cwd(),
        home: '',
      }),
      /Genome exclusion !cli-subcommands did not match a composed genome/,
    );
  });

  test('object exclude selectors are equivalent to string excludes', () => {
    const compiled = compileSeedDocument({
      document: {
        genomes: [
          {
            id: 'verify-no-network',
            exclude: ['*no-network*'],
          },
        ],
      },
      cwd: process.cwd(),
      home: '',
    });

    assert.equal(compiled.document.security, undefined);
    assert.equal(compiled.document.verifications, undefined);
    assert.deepEqual(compiled.genomes.at(-1).exclude, ['*no-network*']);
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

    assert.throws(
      () => parseGenomeSpec('cli-nodejs[!]'),
      /empty exclude selector/,
    );

    assert.throws(
      () => compileSeedDocument({
        document: { genomes: ['cli-nodejs[!*missing*]'] },
        cwd: process.cwd(),
        home: '',
      }),
      /exclude \*missing\* did not match/,
    );
  });
});
