const { existsSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { parse, stringify } = require('yaml');

const BUILTIN_GENOMES = {
  'cli-nodejs': {
    interfaces: {
      cli: {
        purpose: 'User invokes the project from a terminal as a Node.js CLI.',
        examples: [
          'node ./src/cli.js --help',
          '<command> --help',
        ],
      },
    },
    environment: {
      'node-runtime': 'Must run on Node.js 20 or newer.',
      'npm-install': 'Dependencies are installed with npm from package.json and package-lock.json when present.',
      linux: 'Must run on Linux shells.',
    },
    observability: {
      'stderr-errors': 'User-facing errors must be written to stderr.',
      'exit-codes': 'Exit code 0 means success; nonzero means validation, input, or execution failure.',
    },
    security: {
      'no-secret-output': 'Must not print environment variables, tokens, or credentials unless explicitly required by the Seed.',
    },
    constraints: {
      'nodejs-cli-runtime': 'The implementation is a Node.js command line application.',
    },
    freedom: {
      'nodejs-cli-structure': 'Implementation may choose any maintainable internal Node.js module structure.',
    },
  },
  'cli-json-output': {
    behavior: {
      outputs: {
        'default-json': 'The CLI interface outputs JSON by default for successful machine-readable results.',
        'valid-json': 'Successful output must parse as valid JSON.',
      },
    },
    compatibility: {
      'json-field-stability': 'JSON output fields must not be renamed or removed without a Seed change.',
    },
    constraints: {
      'json-output-default': 'The target project CLI emits JSON as its default interface output format.',
    },
    observability: {
      'json-errors': 'If errors are emitted as JSON, they must still use nonzero exit codes.',
    },
  },
};

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function arrayHasIds(value) {
  return value.every((entry) => isObject(entry) && typeof entry.id === 'string' && entry.id.length > 0);
}

function mergeArrays(base, override) {
  if (!arrayHasIds(base) || !arrayHasIds(override)) {
    return structuredClone(override);
  }

  const merged = base.map((entry) => structuredClone(entry));
  const indexes = new Map(merged.map((entry, index) => [entry.id, index]));

  override.forEach((entry) => {
    if (indexes.has(entry.id)) {
      const index = indexes.get(entry.id);
      merged[index] = mergeSeedFragments(merged[index], entry);
      return;
    }

    indexes.set(entry.id, merged.length);
    merged.push(structuredClone(entry));
  });

  return merged;
}

function mergeSeedFragments(base, override) {
  if (Array.isArray(base) && Array.isArray(override)) {
    return mergeArrays(base, override);
  }

  if (isObject(base) && isObject(override)) {
    const merged = { ...structuredClone(base) };
    Object.entries(override).forEach(([key, value]) => {
      if (key in merged) {
        merged[key] = mergeSeedFragments(merged[key], value);
      } else {
        merged[key] = structuredClone(value);
      }
    });
    return merged;
  }

  return structuredClone(override);
}

function genomePath(root, id) {
  return join(root, `${id}.yml`);
}

function loadGenomeFile(path, id, origin) {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const document = parse(readFileSync(path, 'utf8'));
    if (!isObject(document)) {
      throw new Error('genome file must contain an object');
    }
    return { id, origin, path, document };
  } catch (error) {
    throw new Error(`Failed to load genome ${id} from ${path}: ${error.message}`);
  }
}

function resolveGenome({ id, cwd, home = process.env.HOME } = {}) {
  let resolved = null;

  if (BUILTIN_GENOMES[id]) {
    resolved = {
      id,
      origin: 'builtin',
      path: `builtin:${id}`,
      document: structuredClone(BUILTIN_GENOMES[id]),
    };
  }

  if (home) {
    const userGenome = loadGenomeFile(genomePath(join(home, '.seed', 'genomes'), id), id, 'user');
    if (userGenome) {
      resolved = userGenome;
    }
  }

  const repoGenome = loadGenomeFile(genomePath(resolve(cwd ?? process.cwd(), 'seed', 'genomes'), id), id, 'repo');
  if (repoGenome) {
    resolved = repoGenome;
  }

  if (!resolved) {
    throw new Error(`Unknown genome ${id}. Checked builtin genomes, ~/.seed/genomes, and seed/genomes.`);
  }

  return resolved;
}

function compileSeedDocument({ document, cwd, home } = {}) {
  if (!isObject(document)) {
    return { document, genomes: [] };
  }

  const genomeIds = document.genomes ?? [];
  if (!Array.isArray(genomeIds)) {
    throw new Error('genomes must be an array of genome ids when provided.');
  }

  let compiled = {};
  const genomes = genomeIds.map((id) => {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new Error('genomes entries must be non-empty strings.');
    }

    const genome = resolveGenome({ id, cwd, home });
    compiled = mergeSeedFragments(compiled, genome.document);
    return {
      id,
      origin: genome.origin,
      path: genome.path,
    };
  });

  compiled = mergeSeedFragments(compiled, document);

  return {
    document: compiled,
    text: stringify(compiled).replace(/\n+$/, '').concat('\n'),
    genomes,
  };
}

module.exports = {
  BUILTIN_GENOMES,
  compileSeedDocument,
  mergeSeedFragments,
  resolveGenome,
};
