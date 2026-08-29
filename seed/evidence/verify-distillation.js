'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');

const repositoryRoot = path.resolve(__dirname, '..', '..');

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

function verifyBoundary() {
  const seedPath = path.join(repositoryRoot, 'seed', 'seed.yml');
  const seed = YAML.parse(fs.readFileSync(seedPath, 'utf8'));
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

  const blueprint = JSON.parse(run(process.execPath, ['src/cli.js', 'blueprint', '--json']));
  const items = blueprint.sections.flatMap((section) => section.items);
  const globalPolicies = blueprint.sections.find((section) => section.id === 'global-policies');

  assert.equal(blueprint.requirementsReady, true);
  assert.equal(items.length, 145, 'constructed blueprint item count changed');
  assert.equal(globalPolicies.items.length, 12, 'constructed blueprint global-policy count changed');
  console.log(
    `Master boundary passed (${items.length} items; ${globalPolicies.items.length} global policies; ${Object.keys(seed.artifacts).length} artifacts).`,
  );
}

function verifyPackage() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-pack-evidence-'));
  try {
    const output = run('npm', ['pack', '--dry-run', '--json'], {
      env: { ...process.env, npm_config_cache: path.join(temporaryRoot, 'npm-cache') },
    });
    const [pack] = JSON.parse(output);
    const files = pack.files.map((entry) => entry.path);
    const cli = pack.files.find((entry) => entry.path === 'src/cli.js');

    assert.equal(pack.name, 'seed-lang');
    assert.equal(pack.version, '0.0.0');
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
else if (operation === 'package') verifyPackage();
else throw new Error('Expected boundary or package operation.');
