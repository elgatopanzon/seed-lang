const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, resolve } = require('node:path');
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
      summary: 'Bounded behavior contract for a local repository.',
    },
    scope: {
      included: {
        'local-filesystem': 'Local filesystem artifacts within the repository root.',
        'local-state': 'Command-level state under `.seed` and `seed/seed.yml`.',
      },
      excluded: {
        'external-services': 'External services outside this repository.',
        'remote-publishing': 'Remote synchronization and publishing workflows.',
      },
    },
    artifacts: {
      'baseline-seed': {
        path: 'seed/seed.yml',
        description: 'The project-local Seed file used as the contract source.',
      },
    },
    interfaces: {
      cli: {
        purpose: 'User invokes Seed from a terminal.',
        examples: [
          'seed init',
          'seed validate',
        ],
      },
    },
    behavior: {
      'local-commands': {
        description: 'Seed commands must only read/write files inside the repository root unless directed.',
      },
      'contract-authority': {
        description: 'Seed contract state is authoritative for bounded project expectations.',
      },
    },
    errors: {
      'missing-seed-file': {
        code: 'seed.missing_file',
        when: 'Required seed contract is absent.',
        remediation: 'Run seed init to create seed/seed.yml.',
      },
    },
    state: {
      'repo-local-state': {
        location: '.seed',
        persistence: 'local repository',
        semantics: 'verification state and snapshots are ephemeral command history artifacts',
      },
    },
    constraints: {
      'repo-local-only': 'Only local filesystem artifacts under repository root are in scope.',
    },
    freedom: {
      'implementation-choice': 'Implementation choices outside this contract are unconstrained.',
    },
    verifications: [
      {
        id: STABLE_VERIFICATION_ID,
        title: 'Seed contract can be created and loaded without validation failures',
        description: 'The Seed contract template at @baseline-seed can be initialized, read, and validated for structural correctness.',
        artifacts: [
          'baseline-seed',
        ],
        method: 'Run seed init, then seed validate, then check for zero structural errors using @baseline-seed.',
        evidenceGuidance: [
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
