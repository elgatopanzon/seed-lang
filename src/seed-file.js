const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');
const { parse, stringify } = require('yaml');

const DEFAULT_SEED_PATH = 'seed/seed.yml';
const STABLE_VERIFICATION_ID = 'seed-baseline-visibility';

function renderSeedTemplate() {
  return (
    stringify(seedTemplateDocument())
      .replace(/\n+$/, '')
      .concat('\n')
  );
}

function seedTemplateDocument() {
  return {
    metadata: {
      name: 'project-name',
      version: '0.1.0',
      description: 'Bounded behavior contract for a local project',
    },
    scope: {
      boundary: 'prototype command execution and local repository behavior',
      assumptions: [
        'Runs in an isolated repository workspace',
      ],
    },
    interfaces: [
      {
        id: 'local-files',
        purpose: 'Read and write project-local seed and state artifacts.',
        examples: [
          'seed init',
          'seed validate',
        ],
      },
    ],
    behavior: {
      summary: [
        'Seed commands must only read/write files inside the repository root unless directed.',
        'Seed contract state is authoritative for bounded project expectations.',
      ],
    },
    errors: [
      {
        code: 'seed.missing_file',
        when: 'Required seed contract is absent.',
        remediation: 'Run seed init to create seed/seed.yml.',
      },
    ],
    state: {
      location: '.seed',
      persistence: 'local repository',
      semantics: 'verification state and snapshots are ephemeral command history artifacts',
    },
    constraints: [
      'Only local filesystem artifacts under repository root are in scope.',
    ],
    freedom: [
      'Implementation choices outside this contract are unconstrained.',
    ],
    verifications: [
      {
        id: STABLE_VERIFICATION_ID,
        title: 'Seed contract can be created and loaded without validation failures',
        evidence: [
          'Initialize and load seed/seed.yml successfully.',
          'Fail loudly if YAML cannot be parsed.',
          'Reject overwrite unless requested explicitly.',
        ],
      },
    ],
  };
}

function initSeed({ cwd, overwrite = false } = {}) {
  const root = cwd ?? process.cwd();
  const seedPath = resolve(root, DEFAULT_SEED_PATH);
  const seedDir = dirname(seedPath);

  if (existsSync(seedPath) && !overwrite) {
    throw new Error(`Seed already exists at ${seedPath}. Use overwrite=true to replace it.`);
  }

  mkdirSync(seedDir, { recursive: true });

  const text = renderSeedTemplate();
  writeFileSync(seedPath, text, 'utf8');

  return {
    path: seedPath,
    text,
    document: parse(text),
  };
}

function loadSeed({ cwd } = {}) {
  const root = cwd ?? process.cwd();
  const seedPath = resolve(root, DEFAULT_SEED_PATH);

  if (!existsSync(seedPath)) {
    throw new Error(`Seed contract missing at ${seedPath}. Run 'seed init' to create it.`);
  }

  const text = readFileSync(seedPath, 'utf8');

  try {
    return {
      path: seedPath,
      text,
      document: parse(text),
    };
  } catch (err) {
    const parseError = new Error(`Failed to parse Seed YAML at ${seedPath}: ${err.message}`);
    parseError.cause = err;
    throw parseError;
  }
}

module.exports = {
  DEFAULT_SEED_PATH,
  renderSeedTemplate,
  initSeed,
  loadSeed,
};
