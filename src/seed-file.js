const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');
const { parse, stringify } = require('yaml');
const { compileSeedDocument } = require('./genomes');

const DEFAULT_SEED_PATH = 'seed/seed.yml';
const DEFAULT_SEED_SCRIPTS_PATH = 'seed/scripts';
const STABLE_VERIFICATION_ID = 'seed-baseline-visibility';
const GITIGNORE_SECTION_START = '# seed-lang';
const GITIGNORE_SECTION = `${GITIGNORE_SECTION_START}\n.seed/locks/\n`;

function renderSeedTemplate(options = {}) {
  return (
    stringify(seedTemplateDocument(options))
      .replace(/\n+$/, '')
      .concat('\n')
  );
}

function seedTemplateDocument({ genomes = [] } = {}) {
  const document = {
    metadata: {
      name: 'project-name',
      summary: 'Bounded behavior contract for a local repository.',
    },
    ...(genomes.length > 0 ? { genomes } : {}),
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
    security: {
      'repo-local-boundary': 'Seed commands must not read or write outside the repository root unless explicitly directed.',
    },
    environment: {
      'local-node-runtime': 'Seed CLI behavior assumes a local Node.js runtime.',
    },
    observability: {
      'clear-command-errors': 'Command failures must print clear user-facing errors.',
    },
    compatibility: {
      'default-seed-path': 'The default Seed file path remains seed/seed.yml.',
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
        evidence_required: [
          'Initialize and load seed/seed.yml successfully.',
          'Fail loudly if YAML cannot be parsed.',
          'Reject overwrite unless requested explicitly.',
        ],
      },
    ],
  };

  return document;
}


function ensureGitignore(root) {
  const gitignorePath = join(root, '.gitignore');
  const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';

  if (existing.includes(GITIGNORE_SECTION_START)) {
    return {
      path: gitignorePath,
      changed: false,
    };
  }

  const prefix = existing.length === 0 || existing.endsWith('\n') ? existing : `${existing}\n`;
  const separator = prefix.length === 0 || prefix.endsWith('\n\n') ? '' : '\n';
  writeFileSync(gitignorePath, `${prefix}${separator}${GITIGNORE_SECTION}`, 'utf8');

  return {
    path: gitignorePath,
    changed: true,
  };
}


function initSeed({ cwd, overwrite = false, genomes = [] } = {}) {
  const root = cwd ?? process.cwd();
  const seedPath = resolve(root, DEFAULT_SEED_PATH);
  const seedDir = dirname(seedPath);

  if (existsSync(seedPath) && !overwrite) {
    throw new Error(`Seed already exists at ${seedPath}. Use overwrite=true to replace it.`);
  }

  compileSeedDocument({ document: { genomes }, cwd: root, seedPath: DEFAULT_SEED_PATH });

  mkdirSync(seedDir, { recursive: true });
  mkdirSync(resolve(root, DEFAULT_SEED_SCRIPTS_PATH), { recursive: true });

  const text = renderSeedTemplate({ genomes });
  writeFileSync(seedPath, text, 'utf8');
  ensureGitignore(root);

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
    const rawDocument = parse(text);
    const compiled = compileSeedDocument({ document: rawDocument, cwd: root, seedPath: DEFAULT_SEED_PATH });
    return {
      path: seedPath,
      text: compiled.text ?? text,
      rawText: text,
      document: compiled.document,
      rawDocument,
      genomes: compiled.genomes,
      provenance: compiled.provenance,
    };
  } catch (err) {
    const parseError = new Error(`Failed to parse Seed YAML at ${seedPath}: ${err.message}`);
    parseError.cause = err;
    throw parseError;
  }
}

module.exports = {
  DEFAULT_SEED_PATH,
  DEFAULT_SEED_SCRIPTS_PATH,
  renderSeedTemplate,
  ensureGitignore,
  initSeed,
  loadSeed,
};
