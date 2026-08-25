const { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');
const { stringify } = require('yaml');
const { compileSeedDocument } = require('./genomes');
const { parseSeedYaml } = require('./seed-yaml');

const DEFAULT_SEED_PATH = 'seed/seed.yml';
const DEFAULT_SEED_SCRIPTS_PATH = 'seed/scripts';
const DEFAULT_SEED_NAME = 'master';
const SAFE_SEED_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
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

function assertSeedName(seedName) {
  if (seedName === undefined || seedName === null) {
    return;
  }

  if (typeof seedName !== 'string' || !SAFE_SEED_NAME.test(seedName)) {
    throw new Error('seed name must use letters, numbers, underscores, or hyphens and start with a letter or number.');
  }

  if (seedName.toLowerCase() === DEFAULT_SEED_NAME) {
    throw new Error(`seed name '${DEFAULT_SEED_NAME}' is reserved for the default Seed.`);
  }
}

function seedPaths(seedName) {
  assertSeedName(seedName);
  if (!seedName) {
    return {
      seedPath: DEFAULT_SEED_PATH,
      seedScriptsPath: DEFAULT_SEED_SCRIPTS_PATH,
      statePath: '.seed',
    };
  }

  return {
    seedPath: `seed/${seedName}/seed.yml`,
    seedScriptsPath: `seed/${seedName}/scripts`,
    statePath: `.seed/${seedName}`,
  };
}

function listSeeds({ cwd } = {}) {
  const root = cwd ?? process.cwd();
  const seeds = [];

  if (existsSync(resolve(root, DEFAULT_SEED_PATH))) {
    seeds.push({ name: DEFAULT_SEED_NAME, path: DEFAULT_SEED_PATH });
  }

  const seedDir = resolve(root, 'seed');
  if (!existsSync(seedDir)) {
    return seeds;
  }

  readdirSync(seedDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => {
      try {
        assertSeedName(entry.name);
        return true;
      } catch (error) {
        return false;
      }
    })
    .filter((entry) => existsSync(resolve(seedDir, entry.name, 'seed.yml')))
    .sort((left, right) => left.name.localeCompare(right.name))
    .forEach((entry) => {
      seeds.push({ name: entry.name, path: `seed/${entry.name}/seed.yml` });
    });

  return seeds;
}

function seedTemplateDocument({ genomes = [], seedName } = {}) {
  const paths = seedPaths(seedName);
  const document = {
    metadata: {
      name: 'project-name',
      summary: 'Bounded behavior contract for a local repository.',
    },
    requirements: [],
    ...(genomes.length > 0 ? { genomes } : {}),
    scope: {
      included: {
        'local-filesystem': 'Local filesystem artifacts within the repository root.',
        'local-state': `Command-level state under \`${paths.statePath}\` and \`${paths.seedPath}\`.`,
      },
      excluded: {
        'external-services': 'External services outside this repository.',
        'remote-publishing': 'Remote synchronization and publishing workflows.',
      },
    },
    artifacts: {
      'baseline-seed': {
        path: paths.seedPath,
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
        remediation: `Run seed init${seedName ? ` --seed ${seedName}` : ''} to create ${paths.seedPath}.`,
      },
    },
    state: {
      'repo-local-state': {
        location: paths.statePath,
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
      'seed-path': `The Seed file path is ${paths.seedPath}.`,
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
          `Initialize and load ${paths.seedPath} successfully.`,
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


function initSeed({ cwd, seedName, overwrite = false, genomes = [] } = {}) {
  const root = cwd ?? process.cwd();
  const paths = seedPaths(seedName);
  const seedPath = resolve(root, paths.seedPath);
  const seedDir = dirname(seedPath);

  if (existsSync(seedPath) && !overwrite) {
    throw new Error(`Seed already exists at ${seedPath}. Use overwrite=true to replace it.`);
  }

  compileSeedDocument({ document: { genomes }, cwd: root, seedPath: paths.seedPath });

  mkdirSync(seedDir, { recursive: true });
  mkdirSync(resolve(root, paths.seedScriptsPath), { recursive: true });

  const text = renderSeedTemplate({ genomes, seedName });
  writeFileSync(seedPath, text, 'utf8');
  ensureGitignore(root);

  return {
    path: seedPath,
    text,
    document: parseSeedYaml(text),
  };
}

function loadSeed({ cwd, seedName } = {}) {
  const root = cwd ?? process.cwd();
  const paths = seedPaths(seedName);
  const seedPath = resolve(root, paths.seedPath);

  if (!existsSync(seedPath)) {
    throw new Error(`Seed contract missing at ${seedPath}. Run 'seed init' to create it.`);
  }

  const text = readFileSync(seedPath, 'utf8');

  try {
    const rawDocument = parseSeedYaml(text);
    const compiled = compileSeedDocument({ document: rawDocument, cwd: root, seedPath: paths.seedPath });
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
  DEFAULT_SEED_NAME,
  assertSeedName,
  listSeeds,
  seedPaths,
  renderSeedTemplate,
  ensureGitignore,
  initSeed,
  loadSeed,
};
