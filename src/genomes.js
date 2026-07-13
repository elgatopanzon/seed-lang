const { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { parse, stringify } = require('yaml');
const { collectAddressableItems, validateGenomeDocument } = require('./validation');

const REFERENCE_PATTERN = /@([A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)*)/g;
const MAX_GENOME_DEPTH = 64;
const GENOME_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const BUILTIN_GENOMES = {
  'cli-interface': {
    interfaces: {
      cli: {
        purpose: 'User invokes the project from a terminal as a CLI.',
        examples: [
          '<command> --help',
        ],
      },
    },
    observability: {
      'stderr-errors': 'User-facing errors must be written to stderr.',
      'exit-codes': 'Exit code 0 means success; nonzero means validation, input, or execution failure.',
    },
  },
  'cli-nodejs': {
    genomes: [
      'cli-interface',
    ],
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
  'cli-human-output': {
    behavior: {
      outputs: {
        'default-human-output': 'The CLI interface outputs human-readable text by default for successful interactive use.',
        'readable-text': 'Successful output should be readable in a terminal without requiring a parser.',
      },
    },
    compatibility: {
      'human-output-stability': 'Human-readable output wording and layout may evolve, but it must remain understandable without external tooling.',
    },
    constraints: {
      'human-output-default': 'The target project CLI emits human-readable text as its default interface output format.',
    },
    observability: {
      'human-readable-errors': 'User-facing errors should be concise, actionable, and suitable for terminal display.',
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

function repoGenomeDir(cwd) {
  return resolve(cwd ?? process.cwd(), 'seed', 'genomes');
}

function userGenomeDir(home = process.env.HOME) {
  return home ? join(home, '.seed', 'genomes') : null;
}

function validateGenomeId(id) {
  if (typeof id !== 'string' || !GENOME_ID_PATTERN.test(id)) {
    throw new Error('genome id must start with an alphanumeric character and contain only letters, numbers, underscores, or hyphens');
  }
}

function listGenomeFiles(root, origin) {
  if (!root || !existsSync(root)) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => {
      const id = entry.name.replace(/\.ya?ml$/i, '');
      return {
        id,
        origin,
        path: join(root, entry.name),
      };
    });
}

function listGenomeDefinitions({ cwd, home = process.env.HOME, origins } = {}) {
  const selected = origins?.length ? new Set(origins) : null;
  const entries = [];

  if (!selected || selected.has('builtin')) {
    entries.push(...Object.keys(BUILTIN_GENOMES).map((id) => ({
      id,
      origin: 'builtin',
      path: `builtin:${id}`,
    })));
  }

  if (!selected || selected.has('user')) {
    entries.push(...listGenomeFiles(userGenomeDir(home), 'user'));
  }

  if (!selected || selected.has('repo')) {
    entries.push(...listGenomeFiles(repoGenomeDir(cwd), 'repo'));
  }

  return entries.sort((left, right) => {
    const originOrder = { builtin: 0, user: 1, repo: 2 };
    return (originOrder[left.origin] - originOrder[right.origin]) || left.id.localeCompare(right.id);
  });
}

function initRepoGenome({ cwd, id, overwrite = false } = {}) {
  validateGenomeId(id);
  const root = repoGenomeDir(cwd);
  const target = genomePath(root, id);

  if (existsSync(target) && !overwrite) {
    throw new Error(`Genome already exists at ${target}. Use --overwrite to replace it.`);
  }

  mkdirSync(root, { recursive: true });
  const document = {
    metadata: {
      name: id,
      summary: 'Repository-local Seed genome.',
    },
    constraints: {
      example: 'Replace this example constraint with reusable Seed content.',
    },
  };
  const text = stringify(document).replace(/\n+$/, '').concat('\n');
  writeFileSync(target, text, 'utf8');

  return {
    id,
    path: target,
    text,
    document,
  };
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

function sourceForGenome(genome) {
  return {
    type: 'genome',
    origin: genome.origin,
    id: genome.id,
    path: genome.path,
  };
}

function sourceForSeed(seedPath) {
  return {
    type: 'seed',
    origin: 'seed',
    path: seedPath,
  };
}

function applyProvenance(provenance, fragment, source) {
  const errors = [];
  collectAddressableItems(fragment, errors).forEach((item) => {
    provenance[item.address] = source;
  });
}

function collectReferences(value) {
  const refs = [];
  const visit = (entry) => {
    if (typeof entry === 'string') {
      for (const match of entry.matchAll(REFERENCE_PATTERN)) {
        refs.push(match[1]);
      }
      return;
    }

    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }

    if (isObject(entry)) {
      Object.values(entry).forEach(visit);
    }
  };

  visit(value);
  return refs;
}

function artifactDeclarations(value) {
  if (!isObject(value) || value.artifacts === undefined || !Array.isArray(value.artifacts)) {
    return [];
  }

  return value.artifacts.filter((entry) => typeof entry === 'string' && entry.length > 0);
}

function parseGenomeSpec(spec) {
  if (typeof spec === 'string') {
    const match = spec.match(/^([^\[\]]+)(?:\[([^\]]*)\])?$/);
    if (!match || match[1].trim() === '') {
      throw new Error('genomes entries must be non-empty genome ids or id[address] selectors.');
    }

    const id = match[1].trim();
    const include = match[2] === undefined ? null : [match[2].trim()].filter(Boolean);
    if (match[2] !== undefined && include.length === 0) {
      throw new Error(`genome selector ${spec} must include an address inside brackets.`);
    }

    return { id, include, label: spec };
  }

  if (isObject(spec)) {
    if (typeof spec.id !== 'string' || spec.id.trim() === '') {
      throw new Error('genome object entries must include a non-empty id.');
    }

    let include = null;
    if (spec.include !== undefined) {
      include = Array.isArray(spec.include) ? spec.include : [spec.include];
      if (!include.every((entry) => typeof entry === 'string' && entry.trim() !== '')) {
        throw new Error(`genome ${spec.id} include entries must be non-empty strings.`);
      }
      include = include.map((entry) => entry.trim());
    }

    return { id: spec.id.trim(), include, label: spec.id.trim() };
  }

  throw new Error('genomes entries must be strings or objects with id/include fields.');
}

function omitGenomeDirectives(document) {
  if (!isObject(document)) {
    return document;
  }

  const copy = structuredClone(document);
  delete copy.genomes;
  return copy;
}

function addressIndexes(document) {
  const errors = [];
  const items = collectAddressableItems(document, errors);
  const byAddress = new Map();
  const byArtifactId = new Map();

  items.forEach((item) => {
    byAddress.set(item.address, item);
    if (item.section === 'artifacts') {
      byArtifactId.set(item.id, item);
    }
  });

  return { items, byAddress, byArtifactId };
}

function selectorMatches(selector, item) {
  return item.address === selector || item.address.startsWith(`${selector}.`);
}

function setAddressValue(document, address, value) {
  const parts = address.split('.');
  let cursor = document;

  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      cursor[part] = mergeSeedFragments(cursor[part], value);
      return;
    }

    if (!isObject(cursor[part])) {
      cursor[part] = {};
    }
    cursor = cursor[part];
  });
}

function projectGenomeDocument({ document, provenance, include, source, genomeId }) {
  if (!include) {
    return {
      document: omitGenomeDirectives(document),
      provenance: { ...provenance },
    };
  }

  const { items, byAddress, byArtifactId } = addressIndexes(document);
  const selected = new Set();
  const queue = [];

  function enqueueAddress(address) {
    if (!selected.has(address)) {
      selected.add(address);
      queue.push(address);
    }
  }

  include.forEach((selector) => {
    let matched = false;

    items.forEach((item) => {
      if (item.section === selector || selectorMatches(selector, item)) {
        enqueueAddress(item.address);
        matched = true;
      }
    });

    if (!matched && byArtifactId.has(selector)) {
      enqueueAddress(byArtifactId.get(selector).address);
      matched = true;
    }

    if (!matched) {
      throw new Error(`Genome ${genomeId} include ${selector} did not match an address, section, or artifact id.`);
    }
  });

  for (let index = 0; index < queue.length; index += 1) {
    const item = byAddress.get(queue[index]);
    if (!item) {
      continue;
    }

    collectReferences(item.value).forEach((ref) => {
      if (byAddress.has(ref)) {
        enqueueAddress(ref);
      } else if (byArtifactId.has(ref)) {
        enqueueAddress(byArtifactId.get(ref).address);
      }
    });

    artifactDeclarations(item.value).forEach((artifactId) => {
      if (byArtifactId.has(artifactId)) {
        enqueueAddress(byArtifactId.get(artifactId).address);
      }
    });
  }

  const projected = {};
  const projectedProvenance = {};
  Array.from(selected).sort().forEach((address) => {
    const item = byAddress.get(address);
    if (!item) {
      return;
    }

    setAddressValue(projected, address, item.value);
    projectedProvenance[address] = provenance[address] ?? source;
  });

  return {
    document: projected,
    provenance: projectedProvenance,
  };
}

function mergeProvenance(target, source) {
  Object.assign(target, source);
}

function compileGenomeSpec(spec, context) {
  const parsed = parseGenomeSpec(spec);
  const compiled = compileGenomeById(parsed.id, context);
  const projected = projectGenomeDocument({
    document: compiled.document,
    provenance: compiled.provenance,
    include: parsed.include,
    source: sourceForGenome(compiled.genome),
    genomeId: parsed.id,
  });

  return {
    document: projected.document,
    provenance: projected.provenance,
    genomes: compiled.genomes.map((entry, index) => {
      if (index !== compiled.genomes.length - 1 || !parsed.include) {
        return entry;
      }

      return {
        ...entry,
        include: parsed.include,
      };
    }),
  };
}

function compileDocument({ document, context, source, keepGenomeDirectives = false }) {
  if (!isObject(document)) {
    return { document, genomes: [], provenance: {} };
  }

  const genomeSpecs = document.genomes ?? [];
  if (!Array.isArray(genomeSpecs)) {
    throw new Error('genomes must be an array of genome ids or genome selector objects when provided.');
  }

  let compiled = {};
  const provenance = {};
  const genomes = [];

  genomeSpecs.forEach((spec) => {
    const genome = compileGenomeSpec(spec, context);
    compiled = mergeSeedFragments(compiled, genome.document);
    mergeProvenance(provenance, genome.provenance);
    genomes.push(...genome.genomes);
  });

  const ownDocument = keepGenomeDirectives ? structuredClone(document) : omitGenomeDirectives(document);
  compiled = mergeSeedFragments(compiled, ownDocument);
  applyProvenance(provenance, ownDocument, source);

  return {
    document: compiled,
    genomes,
    provenance,
  };
}

function compileGenomeById(id, context) {
  if (context.stack.includes(id)) {
    throw new Error(`Genome cycle detected: ${[...context.stack, id].join(' -> ')}`);
  }

  if (context.stack.length >= context.maxDepth) {
    throw new Error(`Genome recursion exceeded max depth ${context.maxDepth}: ${[...context.stack, id].join(' -> ')}`);
  }

  const genome = resolveGenome({ id, cwd: context.cwd, home: context.home });
  const nextContext = {
    ...context,
    stack: [...context.stack, id],
  };
  const compiled = compileDocument({
    document: genome.document,
    context: nextContext,
    source: sourceForGenome(genome),
    keepGenomeDirectives: false,
  });

  return {
    document: compiled.document,
    provenance: compiled.provenance,
    genomes: [
      ...compiled.genomes,
      {
        id,
        origin: genome.origin,
        path: genome.path,
      },
    ],
    genome,
  };
}

function compileGenomeDocument({ id, cwd, home, maxDepth = MAX_GENOME_DEPTH } = {}) {
  validateGenomeId(id);
  const context = {
    cwd,
    home,
    stack: [],
    maxDepth,
  };
  const compiled = compileGenomeById(id, context);

  return {
    id,
    path: compiled.genome.path,
    origin: compiled.genome.origin,
    document: compiled.document,
    text: stringify(compiled.document).replace(/\n+$/, '').concat('\n'),
    genomes: compiled.genomes,
    provenance: compiled.provenance,
  };
}

function validateGenomeDefinition({ id, cwd, home } = {}) {
  try {
    const compiled = compileGenomeDocument({ id, cwd, home });
    const result = validateGenomeDocument(compiled.document);
    return {
      id,
      origin: compiled.origin,
      path: compiled.path,
      errors: result.errors,
      warnings: result.warnings,
    };
  } catch (error) {
    return {
      id,
      origin: 'unknown',
      path: null,
      errors: [{ code: 'genome-error', path: '/', message: error.message }],
      warnings: [],
    };
  }
}

function validateGenomeDefinitions({ cwd, home, origins } = {}) {
  return listGenomeDefinitions({ cwd, home, origins }).map((entry) => validateGenomeDefinition({
    id: entry.id,
    cwd,
    home,
  }));
}

function compileSeedDocument({ document, cwd, home, seedPath = 'seed/seed.yml', maxDepth = MAX_GENOME_DEPTH } = {}) {
  const context = {
    cwd,
    home,
    stack: [],
    maxDepth,
  };

  const compiled = compileDocument({
    document,
    context,
    source: sourceForSeed(seedPath),
    keepGenomeDirectives: true,
  });

  return {
    document: compiled.document,
    text: isObject(compiled.document) ? stringify(compiled.document).replace(/\n+$/, '').concat('\n') : undefined,
    genomes: compiled.genomes,
    provenance: compiled.provenance,
  };
}

module.exports = {
  BUILTIN_GENOMES,
  compileGenomeDocument,
  compileSeedDocument,
  initRepoGenome,
  listGenomeDefinitions,
  mergeSeedFragments,
  parseGenomeSpec,
  resolveGenome,
  validateGenomeDefinition,
  validateGenomeDefinitions,
};
