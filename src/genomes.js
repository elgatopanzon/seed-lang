const { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { stringify } = require('yaml');
const { collectAddressableItems, collectPresentAddressableItems, validateGenomeDocument } = require('./validation');
const { parseSeedYaml } = require('./seed-yaml');

const REFERENCE_PATTERN = /@([A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)*)/g;
const MAX_GENOME_DEPTH = 64;
const GENOME_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const ADDRESSABLE_SECTION_NAMES = new Set([
  'scope',
  'interfaces',
  'behavior',
  'errors',
  'state',
  'constraints',
  'security',
  'environment',
  'observability',
  'compatibility',
  'freedom',
  'artifacts',
  'verifications',
]);

const BUILTIN_GENOME_DIR = join(__dirname, '..', 'resources', 'genomes');

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function arrayHasIds(value) {
  return value.every((entry) => isObject(entry) && typeof entry.id === 'string' && entry.id.length > 0);
}

function idArrayAsObject(value) {
  if (!arrayHasIds(value)) {
    return null;
  }

  return Object.fromEntries(value.map((entry) => {
    const { id, ...item } = entry;
    return [id, structuredClone(item)];
  }));
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

function mergeSeedFragments(base, override, addressable = false) {
  if (Array.isArray(base) && Array.isArray(override)) {
    return mergeArrays(base, override);
  }

  if (addressable && Array.isArray(base) && isObject(override)) {
    const normalized = idArrayAsObject(base);
    if (normalized) {
      return mergeSeedFragments(normalized, override, true);
    }
  }

  if (addressable && isObject(base) && Array.isArray(override)) {
    const normalized = idArrayAsObject(override);
    if (normalized) {
      return mergeSeedFragments(base, normalized, true);
    }
  }

  if (isObject(base) && isObject(override)) {
    const merged = { ...structuredClone(base) };
    Object.entries(override).forEach(([key, value]) => {
      if (key in merged) {
        merged[key] = mergeSeedFragments(merged[key], value, addressable || ADDRESSABLE_SECTION_NAMES.has(key));
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

function listGenomeFiles(root, origin, publicPathFor = (filePath) => filePath) {
  if (!root || !existsSync(root)) {
    return [];
  }

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => {
      const id = entry.name.replace(/\.ya?ml$/i, '');
      const filePath = join(root, entry.name);
      let description = '';
      try {
        const document = parseSeedYaml(readFileSync(filePath, 'utf8'));
        description = document?.metadata?.description ?? document?.metadata?.summary ?? '';
      } catch (error) {
        description = '';
      }
      return {
        id,
        origin,
        path: publicPathFor(filePath, id),
        filePath,
        description,
      };
    });
}

function listGenomeDefinitions({ cwd, home = process.env.HOME, origins } = {}) {
  const selected = origins?.length ? new Set(origins) : null;
  const entries = [];

  if (!selected || selected.has('builtin')) {
    entries.push(...listGenomeFiles(BUILTIN_GENOME_DIR, 'builtin', (_filePath, id) => `builtin:${id}`));
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

function includesQuery(value, query) {
  return typeof value === 'string' && value.toLowerCase().includes(query);
}

function addressValueIncludesQuery(value, query) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).toLowerCase().includes(query);
  }

  if (Array.isArray(value)) {
    return value.some((entry) => addressValueIncludesQuery(entry, query));
  }

  if (isObject(value)) {
    return Object.entries(value).some(([key, entry]) => key !== 'id' && addressValueIncludesQuery(entry, query));
  }

  return false;
}

function searchGenomeDefinitions({ cwd, home = process.env.HOME, origins, query, fullText = false } = {}) {
  if (typeof query !== 'string' || query.trim() === '') {
    throw new Error('Genome search requires a query.');
  }

  const normalizedQuery = query.trim().toLowerCase();

  return listGenomeDefinitions({ cwd, home, origins }).flatMap((entry) => {
    const matches = [];
    let tags = [];

    if (includesQuery(entry.id, normalizedQuery)) {
      matches.push({ type: 'id', value: entry.id });
    }

    try {
      const document = parseSeedYaml(readFileSync(entry.filePath, 'utf8'));
      const metadata = isObject(document?.metadata) ? document.metadata : {};
      tags = Array.isArray(metadata.tags)
        ? metadata.tags.filter((tag) => typeof tag === 'string')
        : [];

      if (includesQuery(metadata.name, normalizedQuery)) {
        matches.push({ type: 'name', value: metadata.name });
      }

      if (includesQuery(metadata.summary, normalizedQuery) || includesQuery(metadata.description, normalizedQuery)) {
        matches.push({ type: 'description' });
      }

      tags.forEach((tag) => {
        if (includesQuery(tag, normalizedQuery)) {
          matches.push({ type: 'tag', value: tag });
        }
      });

      const addressErrors = [];
      const items = collectPresentAddressableItems(document, addressErrors);
      items.forEach((item) => {
        if (includesQuery(item.address, normalizedQuery)) {
          matches.push({ type: 'address', address: item.address });
        }
      });

      if (fullText) {
        items.forEach((item) => {
          if (addressValueIncludesQuery(item.value, normalizedQuery)) {
            matches.push({ type: 'text', address: item.address });
          }
        });
      }
    } catch (error) {
      // A malformed definition remains searchable by its filename-derived ID.
    }

    if (matches.length === 0) {
      return [];
    }

    return [{
      id: entry.id,
      origin: entry.origin,
      path: entry.path,
      tags,
      matches,
    }];
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

function loadGenomeFile(filePath, id, origin, publicPath = filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const document = parseSeedYaml(readFileSync(filePath, 'utf8'));
    if (!isObject(document)) {
      throw new Error('genome file must contain an object');
    }
    return { id, origin, path: publicPath, filePath, document };
  } catch (error) {
    throw new Error(`Failed to load genome ${id} from ${filePath}: ${error.message}`);
  }
}

function resolveGenome({ id, cwd, home = process.env.HOME } = {}) {
  let resolved = null;

  const builtinGenome = loadGenomeFile(genomePath(BUILTIN_GENOME_DIR, id), id, 'builtin', `builtin:${id}`);
  if (builtinGenome) {
    resolved = builtinGenome;
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
  collectPresentAddressableItems(fragment, errors).forEach((item) => {
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

function normalizeSelectorEntries(value, fieldName, genomeId) {
  const entries = Array.isArray(value) ? value : [value];
  if (!entries.every((entry) => typeof entry === 'string' && entry.trim() !== '')) {
    throw new Error(`genome ${genomeId} ${fieldName} entries must be non-empty strings.`);
  }

  return entries.map((entry) => entry.trim());
}

function splitSelectorEntries(selectorText, specLabel) {
  const entries = selectorText.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) {
    throw new Error(`genome selector ${specLabel} must include an address inside brackets.`);
  }

  const include = [];
  const exclude = [];
  entries.forEach((entry) => {
    if (entry.startsWith('!')) {
      const selector = entry.slice(1).trim();
      if (selector.length === 0) {
        throw new Error(`genome selector ${specLabel} has an empty exclude selector.`);
      }
      exclude.push(selector);
      return;
    }

    include.push(entry);
  });

  return {
    include: include.length > 0 ? include : null,
    exclude,
  };
}
function parseGenomeSpec(spec) {
  if (typeof spec === 'string') {
    if (spec.startsWith('!')) {
      const id = spec.slice(1).trim();
      validateGenomeId(id);
      return { id, excludeGenome: true, label: spec };
    }

    const match = spec.match(/^([^\[\]]+)(?:\[([^\]]*)\])?$/);
    if (!match || match[1].trim() === '') {
      throw new Error('genomes entries must be non-empty genome ids or id[address] selectors.');
    }

    const id = match[1].trim();
    if (match[2] === undefined) {
      return { id, include: null, exclude: [], label: spec };
    }

    const selectors = splitSelectorEntries(match[2], spec);
    return { id, include: selectors.include, exclude: selectors.exclude, label: spec };
  }

  if (isObject(spec)) {
    if (typeof spec.id !== 'string' || spec.id.trim() === '') {
      throw new Error('genome object entries must include a non-empty id.');
    }

    let include = null;
    if (spec.include !== undefined) {
      include = normalizeSelectorEntries(spec.include, 'include', spec.id);
    }

    const exclude = spec.exclude === undefined
      ? []
      : normalizeSelectorEntries(spec.exclude, 'exclude', spec.id);

    return { id: spec.id.trim(), include, exclude, label: spec.id.trim() };
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
  return item.address === selector || item.address.startsWith(selector + '.');
}

function globPatternMatches(pattern, value) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp('^' + escaped + '$').test(value);
}

function excludeSelectorMatches(selector, item) {
  if (selector.includes('*')) {
    return globPatternMatches(selector, item.address) || globPatternMatches(selector, item.id);
  }

  return item.section === selector || selectorMatches(selector, item) || item.id === selector;
}

function deleteAddressValue(document, address) {
  const parts = address.split('.');
  const stack = [];
  let cursor = document;

  for (const part of parts.slice(0, -1)) {
    if (!isObject(cursor?.[part])) {
      return;
    }
    stack.push([cursor, part]);
    cursor = cursor[part];
  }

  if (!isObject(cursor)) {
    return;
  }

  delete cursor[parts.at(-1)];

  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const [parent, key] = stack[index];
    if (isObject(parent[key]) && Object.keys(parent[key]).length === 0) {
      delete parent[key];
    }
  }
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

function projectGenomeDocument({ document, provenance, include, exclude = [], source, genomeId }) {
  const { items, byAddress, byArtifactId } = addressIndexes(document);
  const excluded = new Set();

  exclude.forEach((selector) => {
    let matched = false;

    items.forEach((item) => {
      if (excludeSelectorMatches(selector, item)) {
        excluded.add(item.address);
        matched = true;
      }
    });

    if (!matched && byArtifactId.has(selector)) {
      excluded.add(byArtifactId.get(selector).address);
      matched = true;
    }

    if (!matched) {
      throw new Error(`Genome ${genomeId} exclude ${selector} did not match an address, section, artifact id, or glob pattern.`);
    }
  });

  if (!include) {
    const projected = omitGenomeDirectives(document);
    const projectedProvenance = { ...provenance };
    Array.from(excluded).sort().forEach((address) => {
      deleteAddressValue(projected, address);
      delete projectedProvenance[address];
    });
    return {
      document: projected,
      provenance: projectedProvenance,
    };
  }

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
    if (excluded.has(address)) {
      return;
    }

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
  if (compiled.excluded) {
    return { document: {}, provenance: {}, genomes: [] };
  }
  const projected = projectGenomeDocument({
    document: compiled.document,
    provenance: compiled.provenance,
    include: parsed.include,
    exclude: parsed.exclude,
    source: sourceForGenome(compiled.genome),
    genomeId: parsed.id,
  });

  return {
    document: projected.document,
    provenance: projected.provenance,
    genomes: compiled.genomes.map((entry, index) => {
      if (index !== compiled.genomes.length - 1 || (!parsed.include && parsed.exclude.length === 0)) {
        return entry;
      }

      return {
        ...entry,
        ...(parsed.include ? { include: parsed.include } : {}),
        ...(parsed.exclude.length > 0 ? { exclude: parsed.exclude } : {}),
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

  const parsedSpecs = genomeSpecs.map(parseGenomeSpec);
  const ownExclusions = parsedSpecs
    .filter((spec) => spec.excludeGenome)
    .map((spec) => ({ id: spec.id, matched: false }));
  const documentContext = {
    ...context,
    exclusions: [...(context.exclusions ?? []), ...ownExclusions],
  };

  let compiled = {};
  const provenance = {};
  const genomes = [];

  genomeSpecs.forEach((spec, index) => {
    if (parsedSpecs[index].excludeGenome) {
      return;
    }

    const genome = compileGenomeSpec(spec, documentContext);
    compiled = mergeSeedFragments(compiled, genome.document);
    mergeProvenance(provenance, genome.provenance);
    genomes.push(...genome.genomes);
  });

  const unmatched = ownExclusions.find((exclusion) => !exclusion.matched);
  if (unmatched) {
    throw new Error(`Genome exclusion !${unmatched.id} did not match a composed genome.`);
  }

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
  const exclusions = (context.exclusions ?? []).filter((entry) => entry.id === id);
  if (exclusions.length > 0) {
    exclusions.forEach((entry) => {
      entry.matched = true;
    });
    return { excluded: true };
  }

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
        description: genome.document?.metadata?.description ?? genome.document?.metadata?.summary ?? '',
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
    description: compiled.genome.document?.metadata?.description ?? compiled.genome.document?.metadata?.summary ?? '',
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
      description: compiled.description ?? '',
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
  BUILTIN_GENOME_DIR,
  compileGenomeDocument,
  compileSeedDocument,
  initRepoGenome,
  listGenomeDefinitions,
  mergeSeedFragments,
  parseGenomeSpec,
  resolveGenome,
  searchGenomeDefinitions,
  validateGenomeDefinition,
  validateGenomeDefinitions,
};
