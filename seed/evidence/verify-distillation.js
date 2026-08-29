'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { builtinModules } = require('node:module');
const YAML = require('yaml');

const repositoryRoot = path.resolve(__dirname, '..', '..');

const producerDefinitions = {
  'npm-test': { command: 'npm', args: ['test'] },
  'cli-external-tests': { command: process.execPath, args: ['--test', 'test/cli.test.js', 'test/external-references.test.js'] },
  'cli-seed-file-tests': { command: process.execPath, args: ['--test', 'test/cli.test.js', 'test/seed-file.test.js'] },
  'genome-tests': { command: process.execPath, args: ['--test', 'test/genomes.test.js'] },
  'contract-tests': { command: process.execPath, args: ['--test', 'test/validation.test.js', 'test/seed-file.test.js', 'test/external-references.test.js'] },
  'verification-tests': { command: process.execPath, args: ['--test', 'test/verification-store.test.js'] },
  'pager': { command: process.execPath, args: ['src/cli.js', 'blueprint', '--pager'], env: { PAGER: 'cat' } },
  'license': { command: process.execPath, args: ['seed/scripts/verify-license.js'] },
  'readme': { command: process.execPath, args: ['seed/scripts/verify-readme.js'] },
  'installer-rollback': { command: process.execPath, args: ['seed/scripts/verify-skill-installer-rollback.js'] },
  'genome-validate': { command: process.execPath, args: ['src/cli.js', 'genome', 'validate', '--builtin'] },
  boundary: { command: process.execPath, args: ['seed/evidence/verify-distillation.js', 'boundary'] },
  'master-boundary': { command: process.execPath, args: ['seed/evidence/verify-distillation.js', 'master-boundary'] },
  dependencies: { command: process.execPath, args: ['seed/evidence/verify-distillation.js', 'dependencies'] },
  'genome-compatibility': { command: process.execPath, args: ['seed/evidence/verify-distillation.js', 'genome-compatibility'] },
  package: { command: process.execPath, args: ['seed/evidence/verify-distillation.js', 'package'] },
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });

  assert.ifError(result.error);
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result.stdout;
}

function walkFiles(target, files) {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    files.push(target);
    return;
  }
  for (const name of fs.readdirSync(target).sort()) {
    walkFiles(path.join(target, name), files);
  }
}

function producerInputHash(slug) {
  const inputs = [
    'LICENSE',
    'README.md',
    'package.json',
    'package-lock.json',
    'src',
    'test',
    'resources',
    'seed/seed.yml',
    'seed/distillation-exclusions.md',
    'seed/scripts',
    'seed/evidence/verify-distillation.js',
  ];
  const files = [];
  for (const input of inputs) walkFiles(path.join(repositoryRoot, input), files);
  const hash = crypto.createHash('sha256').update(`producer:${slug}\0`);
  for (const filename of files.sort()) {
    hash.update(path.relative(repositoryRoot, filename));
    hash.update('\0');
    hash.update(fs.readFileSync(filename));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function ancestorCommandLines() {
  const commands = [];
  let pid = process.ppid;
  for (let depth = 0; depth < 6 && pid > 1; depth += 1) {
    try {
      commands.push(fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' '));
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      pid = Number.parseInt(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1], 10);
    } catch {
      break;
    }
  }
  return commands;
}

function isConfirmationCommand() {
  return ancestorCommandLines().some((command) => command.includes('src/cli.js verify confirm'));
}

function readProducerCache(cachePath, slug, inputHash) {
  try {
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (cache.schema === 1 && cache.slug === slug && cache.inputHash === inputHash && cache.exitCode === 0) {
      return cache;
    }
    throw new Error(`Shared producer cache is invalid: ${cachePath}`);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function executeProducer(slug) {
  const definition = producerDefinitions[slug];
  assert.ok(definition, `Unknown shared producer ${slug}.`);
  const result = spawnSync(definition.command, definition.args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, ...definition.env },
  });
  assert.ifError(result.error);
  return {
    schema: 1,
    slug,
    inputHash: producerInputHash(slug),
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    executedAt: new Date().toISOString(),
  };
}

function printProducerResult(result, reused) {
  process.stdout.write(
    `Shared producer ${result.slug} ${reused ? 'reused' : 'executed'}; input=${result.inputHash}; executedAt=${result.executedAt}\n`,
  );
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.exitCode !== 0) process.exitCode = result.exitCode || 1;
}

function verifySharedProducer(slug) {
  if (!isConfirmationCommand()) {
    printProducerResult(executeProducer(slug), false);
    return;
  }

  const inputHash = producerInputHash(slug);
  const cacheRoot = path.join(os.tmpdir(), `seed-distillation-producers-${crypto.createHash('sha256').update(repositoryRoot).digest('hex').slice(0, 16)}`);
  const cachePath = path.join(cacheRoot, `${slug}.json`);
  const lockPath = `${cachePath}.lock`;
  fs.mkdirSync(cacheRoot, { recursive: true });

  const cached = readProducerCache(cachePath, slug, inputHash);
  if (cached) {
    printProducerResult(cached, true);
    return;
  }

  let lock;
  try {
    lock = fs.openSync(lockPath, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline) {
      const shared = readProducerCache(cachePath, slug, inputHash);
      if (shared) {
        printProducerResult(shared, true);
        return;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
    throw new Error(`Timed out waiting for shared producer ${slug}.`);
  }

  try {
    const result = executeProducer(slug);
    if (result.exitCode === 0) {
      const temporaryPath = `${cachePath}.${process.pid}.tmp`;
      fs.writeFileSync(temporaryPath, `${JSON.stringify(result)}\n`, { flag: 'wx' });
      fs.renameSync(temporaryPath, cachePath);
    }
    printProducerResult(result, false);
  } finally {
    fs.closeSync(lock);
    fs.rmSync(lockPath, { force: true });
  }
}

function readSeed() {
  const seedPath = path.join(repositoryRoot, 'seed', 'seed.yml');
  return YAML.parse(fs.readFileSync(seedPath, 'utf8'));
}

function verifyBoundary() {
  const seed = readSeed();
  const excluded = seed.scope?.excluded;
  const excludedBoundaries = Object.keys(excluded || {}).filter((key) => key !== 'artifacts');

  assert.deepEqual(seed.requirements, [], 'master requirements must be empty');
  assert.deepEqual(
    excludedBoundaries,
    ['visual-ui'],
    'master must contain exactly one explicit excluded visual-ui boundary',
  );
  assert.deepEqual(excluded.artifacts, ['distillation-exclusions']);
  assert.deepEqual(excluded['visual-ui'].artifacts, ['distillation-exclusions']);
  assert.equal(
    seed.artifacts['distillation-exclusions'].path,
    'seed/distillation-exclusions.md',
  );

  for (const [id, artifact] of Object.entries(seed.artifacts)) {
    if (!artifact.path) continue;
    const artifactPath = path.resolve(repositoryRoot, artifact.path);
    assert.equal(
      artifactPath.startsWith(`${repositoryRoot}${path.sep}`),
      true,
      `artifact ${id} escapes the repository`,
    );
    assert.equal(fs.existsSync(artifactPath), true, `artifact ${id} is missing: ${artifact.path}`);
  }

  console.log(`Structural master boundary passed (${Object.keys(seed.artifacts).length} direct artifacts).`);
}

function verifyMasterBoundary() {
  verifyBoundary();

  run(process.execPath, ['src/cli.js', 'validate']);
  const blueprint = JSON.parse(run(process.execPath, ['src/cli.js', 'blueprint', '--json']));
  const section = (id) => blueprint.sections.find((entry) => entry.id === id);
  const seed = readSeed();

  assert.equal(blueprint.kind, 'seed-blueprint');
  assert.equal(blueprint.requirementsReady, true);
  assert.deepEqual(blueprint.requirements, []);
  assert.deepEqual(
    blueprint.source.genomes.map(({ id, include }) => ({ id, ...(include ? { include } : {}) })),
    [
      { id: 'cli-interface' },
      {
        id: 'cli-nodejs',
        include: [
          'environment.npm-install',
          'constraints.nodejs-cli-runtime',
          'freedom.nodejs-cli-structure',
        ],
      },
      { id: 'cli-subcommands' },
      { id: 'cli-exit-codes' },
      { id: 'package-npm' },
      { id: 'state-filesystem' },
      { id: 'verify-unit-tests' },
      { id: 'verify-integration-tests' },
      { id: 'repo-readme' },
      { id: 'policy-dependency-minimal' },
    ],
    'constructed blueprint genome selection changed',
  );

  const expectedArtifacts = {
    'repo-readme': 'README.md',
    'repo-license': 'LICENSE',
    'package-manifest': 'package.json',
    'dependency-lock': 'package-lock.json',
    'genome-catalog': 'resources/genomes',
    'portable-skill': 'resources/skills/seed-lang',
    'source-contract': 'src',
    'test-contract': 'test',
    'distillation-exclusions': 'seed/distillation-exclusions.md',
    'seed-evidence-scripts': 'seed/scripts',
  };
  assert.deepEqual(
    Object.fromEntries(section('artifacts').items.map((item) => [item.id, item.value.path])),
    expectedArtifacts,
    'constructed blueprint artifact closure changed',
  );

  const expectedGlobalPolicies = [
    'constraints.readme-command-accuracy',
    'constraints.explicit-license-choice',
    'constraints.license-metadata-consistency',
    'constraints.selected-seed-authority',
    'constraints.verification-state-integrity',
    'constraints.dependency-snapshot-ownership',
    'security.filesystem-path-boundary',
    'security.dependency-minimal',
    'security.repository-boundaries',
    'security.validated-identifiers-and-evidence',
    'security.trusted-proof-command-interface',
    'security.trusted-pager-interface',
  ];
  assert.deepEqual(
    section('global-policies').items.map((item) => item.address),
    expectedGlobalPolicies,
    'constructed blueprint global policies changed',
  );

  assert.deepEqual(Object.keys(seed.scope.excluded).filter((key) => key !== 'artifacts'), ['visual-ui']);
  console.log(
    `Constructed master passed (${blueprint.source.genomes.length} genomes; ${Object.keys(expectedArtifacts).length} artifacts; ${expectedGlobalPolicies.length} global policies).`,
  );
}

function packageName(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0];
}

function verifyDependencies() {
  const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package-lock.json'), 'utf8'));
  const declared = Object.keys(manifest.dependencies || {}).sort();
  const lockedRoot = lock.packages?.['']?.dependencies || {};
  const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
  const imported = new Set();
  const sourceDirectory = path.join(repositoryRoot, 'src');

  for (const filename of fs.readdirSync(sourceDirectory).filter((name) => name.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(sourceDirectory, filename), 'utf8');
    for (const match of source.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const specifier = match[1];
      if (!specifier.startsWith('.') && !builtins.has(specifier)) imported.add(packageName(specifier));
    }
  }

  assert.deepEqual(Object.keys(lockedRoot).sort(), declared, 'manifest and lock root dependencies differ');
  assert.deepEqual([...imported].sort(), declared, 'runtime dependencies must match production imports');
  for (const dependency of declared) {
    assert.equal(
      typeof lock.packages?.[`node_modules/${dependency}`]?.version,
      'string',
      `lock is missing resolved runtime dependency ${dependency}`,
    );
  }

  console.log(`Dependency surface passed (${declared.join(', ')}; manifest, lock, and production imports agree).`);
}

function verifyGenomeCompatibility() {
  const baseline = run('git', ['ls-tree', '-r', '--name-only', 'a07f0e6', '--', 'resources/genomes']);
  const baselineIds = baseline.trim().split('\n').filter((name) => name.endsWith('.yml')).map((name) => path.basename(name, '.yml')).sort();
  const currentIds = fs.readdirSync(path.join(repositoryRoot, 'resources', 'genomes'))
    .filter((name) => name.endsWith('.yml'))
    .map((name) => path.basename(name, '.yml'))
    .sort();
  assert.deepEqual(currentIds, baselineIds, 'built-in genome IDs differ from authoritative commit a07f0e6');
  const digest = crypto.createHash('sha256').update(`${currentIds.join('\n')}\n`).digest('hex');
  console.log(`Genome compatibility passed (${currentIds.length} exact IDs; sha256=${digest}; baseline=a07f0e6).`);
}

function verifyPackage() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-pack-evidence-'));
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'));
    const output = run('npm', ['pack', '--dry-run', '--json'], {
      env: { ...process.env, npm_config_cache: path.join(temporaryRoot, 'npm-cache') },
    });
    const [pack] = JSON.parse(output);
    const files = pack.files.map((entry) => entry.path);
    const cli = pack.files.find((entry) => entry.path === 'src/cli.js');

    assert.equal(pack.name, 'seed-lang');
    assert.equal(pack.version, '0.0.0');
    assert.equal(manifest.private, true, 'package must remain private during the prototype');
    assert.deepEqual(manifest.bin, { seed: 'src/cli.js' }, 'package must expose exactly one seed executable');
    assert.deepEqual(manifest.files, ['src', 'resources', 'README.md'], 'npm package selection changed');
    for (const required of ['LICENSE', 'README.md', 'package.json', 'src/cli.js']) {
      assert.equal(files.includes(required), true, `package missing ${required}`);
    }
    for (const prefix of ['resources/genomes/', 'resources/skills/seed-lang/', 'src/']) {
      assert.equal(files.some((entry) => entry.startsWith(prefix)), true, `package missing ${prefix}`);
    }
    for (const forbidden of ['package-lock.json', 'seed/']) {
      assert.equal(
        files.some((entry) => entry === forbidden || entry.startsWith(forbidden)),
        false,
        `package unexpectedly includes ${forbidden}`,
      );
    }
    assert.equal(files.some((entry) => entry.startsWith('test/')), false, 'package includes tests');
    assert.equal((cli.mode & 0o111) !== 0, true, 'packaged CLI is not executable');
    console.log(`Package surface passed (${pack.id}; ${pack.entryCount} entries; executable src/cli.js).`);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

const operation = process.argv[2];
if (operation === 'boundary') verifyBoundary();
else if (operation === 'master-boundary') verifyMasterBoundary();
else if (operation === 'dependencies') verifyDependencies();
else if (operation === 'genome-compatibility') verifyGenomeCompatibility();
else if (operation === 'package') verifyPackage();
else if (operation === 'producer') verifySharedProducer(process.argv[3]);
else throw new Error('Expected boundary, master-boundary, dependencies, genome-compatibility, package, or producer operation.');
