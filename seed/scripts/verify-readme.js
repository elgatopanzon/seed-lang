'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const cliPath = path.join(repositoryRoot, 'src', 'cli.js');
const readmePath = path.join(repositoryRoot, 'README.md');

function run(args, cwd, env) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    env,
    encoding: 'utf8',
  });

  assert.equal(
    result.status,
    0,
    `seed ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

const readme = fs.readFileSync(readmePath, 'utf8');
const contentAssertions = [
  [/Seed is a contract language and CLI for specifying bounded software behavior/, 'product purpose'],
  [/Seed is currently a prototype[\s\S]*package is private[\s\S]*not published to\n> a package registry/, 'prototype and package status'],
  [/## Requirements[\s\S]*Node\.js with npm[\s\S]*local project repository[\s\S]*coding agent with shell and filesystem access/, 'prerequisites'],
  [/## Install From This Repository[\s\S]*git clone[\s\S]*npm install -g \.[\s\S]*The CLI executable is `seed`/, 'repository installation'],
  [/## Install The Agent Skill[\s\S]*seed install-skill --codex[\s\S]*seed install-skill --claude[\s\S]*atomically replaces only the\nexisting `seed-lang` skill directory/, 'portable skill installation'],
  [/## Quick Start[\s\S]*seed init[\s\S]*seed validate[\s\S]*seed blueprint[\s\S]*seed verify start/, 'quick-start workflow'],
  [/## Seed Contract Structure[\s\S]*requirements[\s\S]*scope[\s\S]*verifications[\s\S]*Any item mentioning an artifact must list that artifact ID/, 'Seed structure and artifact rule'],
  [/## Genomes[\s\S]*Genome precedence, lowest to highest[\s\S]*Unknown genomes and unmatched complete-genome exclusions fail loudly/, 'genome behavior'],
  [/## Blueprints And Diffs[\s\S]*complete model-facing contract[\s\S]*blueprint diff[\s\S]*compiled YAML/, 'blueprint and diff behavior'],
  [/## Standalone Seed Driven Development[\s\S]*Update the Seed contract first[\s\S]*Reverify new and expired items/, 'standalone SDD workflow'],
  [/## Verification[\s\S]*repository-local evidence ledger[\s\S]*Every confirmation requires[\s\S]*Completion requires/, 'verification workflow'],
  [/## Command Summary[\s\S]*seed verify refresh-expired[\s\S]*Run `seed --help` for the exact current syntax/, 'command summary'],
  [/## Repository Layout[\s\S]*resources\/[\s\S]*verification-store\.js[\s\S]*test\/\s+Node test suite/, 'repository layout'],
  [/## Development[\s\S]*npm test[\s\S]*genome validate --builtin[\s\S]*npm pack --dry-run --json/, 'development checks'],
  [/## Current Boundaries[\s\S]*does not choose product requirements[\s\S]*does not provide agent persistence[\s\S]*prototype/, 'current boundaries'],
];

for (const [pattern, description] of contentAssertions) {
  assert.match(readme, pattern, `README missing promised ${description}`);
}

const shellBlocks = [...readme.matchAll(/```sh\n([\s\S]*?)\n```/g)].map((match) => match[1]);
assert.ok(shellBlocks.length > 0, 'README has no shell command blocks');

const shellCommands = shellBlocks
  .flatMap((block) => block.replace(/\\\n\s*/g, ' ').split('\n'))
  .map((line) => line.trim())
  .filter(Boolean);

const staticReasons = new Map([
  ['npm install -g /path/to/seed-lang', 'placeholder path and global installation'],
  ['git clone https://github.com/elgatopanzon/seed-lang.git', 'network repository bootstrap'],
  ['cd seed-lang', 'working-directory transition after clone'],
  ['npm install', 'dependency installation mutates the checkout and may use the network'],
  ['npm install -g .', 'global installation mutates the real npm prefix'],
  ['cd /path/to/project', 'placeholder working-directory transition'],
  ['seed blueprint --filter @behavior.outputs', 'illustrative address that depends on the target Seed'],
  ['seed blueprint --pager', 'interactive pager handoff'],
  ['seed verify claim ITEM_ID --owner codex', 'placeholder item and state-dependent claim transition'],
  ['seed verify confirm ITEM_ID  --owner codex  --file src/feature.js  --file test/feature.test.js  --test-cmd "node --test test/feature.test.js"  --evidence "ITEM_ID exercised the production path and passed its focused test"', 'placeholder item, files, and terminal evidence transition'],
  ['seed verify fail ITEM_ID  --owner codex  --file src/feature.js  --test-cmd "node --test test/feature.test.js"  --reason "ITEM_ID fails the declared empty-input behavior"', 'placeholder item, file, and terminal evidence transition'],
  ['seed verify inject ITEM_ID  --owner codex  --authorization operator-requested-sdd-injection  --file src/feature.js  --file test/feature.test.js  --pass-cmd "node --test test/feature.test.js"  --evidence "ITEM_ID changed path was directly evaluated as passing"', 'placeholder item, files, and operator-authorized injection transition'],
  ['seed verify check', 'state-dependent replay covered by the repository test producer'],
  ['seed verify audit', 'state-dependent completion gate covered by the repository test producer'],
  ['seed verify report', 'state-dependent report covered by the repository test producer'],
  ['seed verify sync', 'state-dependent snapshot mutation covered by the repository test producer'],
  ['seed verify refresh-expired --owner automation --json', 'state-dependent evidence refresh covered by the repository test producer'],
  ['npm test', 'shared exact repository test producer declared by the Seed'],
  ['npm pack --dry-run --json', 'separate read-only package-surface verification'],
]);

const executableCommands = new Set([
  'seed install-skill --codex',
  'seed --help',
  'seed install-skill --claude',
  'seed init',
  'seed init --genome cli-nodejs',
  'seed init --genomes cli-nodejs,cli-human-output,repo-readme',
  'seed validate',
  'seed blueprint',
  'seed blueprint --section global-policies',
  'seed blueprint --section verification-plan',
  'seed verify start',
  'seed verify pending',
  'seed genome list',
  'seed genome list --builtin',
  'seed genome search docker',
  'seed genome search graceful shutdown --full-text',
  'seed genome blueprint cli-nodejs',
  'seed genome blueprint repo-open-source-ready --section global-policies',
  'seed genome validate --builtin',
  'seed genome init project-conventions',
  'seed genome validate --repo',
  'seed blueprint --color',
  'seed blueprint --no-color',
  'seed blueprint --json',
  'seed blueprint --section interfaces',
  'seed blueprint --head 100',
  'seed blueprint diff --no-color',
  'seed diff --no-color',
  'seed verify status',
  'seed verify next --owner codex',
  'seed --repo /path/to/project validate',
  'seed --repo /path/to/project blueprint',
  'seed --repo /path/to/project verify status',
  'seed init --seed ui',
  'seed validate --seed ui',
  'seed verify start --seed ui',
  'seed list',
  'node src/cli.js genome validate --builtin',
]);

assert.equal(shellCommands.length, 64, 'README shell command inventory changed');
for (const command of shellCommands) {
  assert.ok(
    executableCommands.has(command) || staticReasons.has(command),
    `README shell command has no asserted disposition: ${command}`,
  );
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-readme-'));
const env = {
  ...process.env,
  HOME: path.join(temporaryRoot, 'home'),
  CODEX_HOME: path.join(temporaryRoot, 'codex'),
  CLAUDE_HOME: path.join(temporaryRoot, 'claude'),
  NO_COLOR: '1',
  TERM: 'dumb',
};
const executed = new Set();

function execute(command, args, cwd) {
  run(args, cwd, env);
  executed.add(command);
}

function createProject(name) {
  const project = path.join(temporaryRoot, name);
  fs.mkdirSync(project);
  return project;
}

try {
  const projectRoot = createProject('project');
  execute('seed --help', ['--help'], projectRoot);
  execute('seed init', ['init'], projectRoot);
  execute('seed validate', ['validate'], projectRoot);
  execute('seed blueprint', ['blueprint'], projectRoot);
  execute('seed blueprint --section global-policies', ['blueprint', '--section', 'global-policies'], projectRoot);
  execute('seed blueprint --section verification-plan', ['blueprint', '--section', 'verification-plan'], projectRoot);
  execute('seed blueprint --color', ['blueprint', '--color'], projectRoot);
  execute('seed blueprint --no-color', ['blueprint', '--no-color'], projectRoot);
  execute('seed blueprint --json', ['blueprint', '--json'], projectRoot);
  execute('seed blueprint --section interfaces', ['blueprint', '--section', 'interfaces'], projectRoot);
  execute('seed blueprint --head 100', ['blueprint', '--head', '100'], projectRoot);
  execute('seed genome list', ['genome', 'list'], projectRoot);
  execute('seed genome list --builtin', ['genome', 'list', '--builtin'], projectRoot);
  execute('seed genome search docker', ['genome', 'search', 'docker'], projectRoot);
  execute('seed genome search graceful shutdown --full-text', ['genome', 'search', 'graceful', 'shutdown', '--full-text'], projectRoot);
  execute('seed genome blueprint cli-nodejs', ['genome', 'blueprint', 'cli-nodejs'], projectRoot);
  execute('seed genome blueprint repo-open-source-ready --section global-policies', ['genome', 'blueprint', 'repo-open-source-ready', '--section', 'global-policies'], projectRoot);
  execute('seed genome validate --builtin', ['genome', 'validate', '--builtin'], projectRoot);
  execute('node src/cli.js genome validate --builtin', ['genome', 'validate', '--builtin'], repositoryRoot);
  execute('seed genome init project-conventions', ['genome', 'init', 'project-conventions'], projectRoot);
  execute('seed genome validate --repo', ['genome', 'validate', '--repo'], projectRoot);
  execute('seed verify start', ['verify', 'start'], projectRoot);
  execute('seed verify pending', ['verify', 'pending'], projectRoot);
  execute('seed verify status', ['verify', 'status'], projectRoot);
  execute('seed blueprint diff --no-color', ['blueprint', 'diff', '--no-color'], projectRoot);
  execute('seed diff --no-color', ['diff', '--no-color'], projectRoot);
  execute('seed verify next --owner codex', ['verify', 'next', '--owner', 'codex'], projectRoot);
  execute('seed --repo /path/to/project validate', ['--repo', projectRoot, 'validate'], temporaryRoot);
  execute('seed --repo /path/to/project blueprint', ['--repo', projectRoot, 'blueprint'], temporaryRoot);
  execute('seed --repo /path/to/project verify status', ['--repo', projectRoot, 'verify', 'status'], temporaryRoot);
  execute('seed init --seed ui', ['init', '--seed', 'ui'], projectRoot);
  execute('seed validate --seed ui', ['validate', '--seed', 'ui'], projectRoot);
  execute('seed verify start --seed ui', ['verify', 'start', '--seed', 'ui'], projectRoot);
  execute('seed list', ['list'], projectRoot);
  execute('seed install-skill --codex', ['install-skill', '--codex'], projectRoot);
  execute('seed install-skill --claude', ['install-skill', '--claude'], projectRoot);

  const genomeProject = createProject('genome-project');
  execute('seed init --genome cli-nodejs', ['init', '--genome', 'cli-nodejs'], genomeProject);
  const genomesProject = createProject('genomes-project');
  execute(
    'seed init --genomes cli-nodejs,cli-human-output,repo-readme',
    ['init', '--genomes', 'cli-nodejs,cli-human-output,repo-readme'],
    genomesProject,
  );

  assert.deepEqual(
    [...executableCommands].filter((command) => !executed.has(command)),
    [],
    'README executable command dispositions were not all exercised',
  );
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log(
  `README contract passed (${shellCommands.length} commands: ${executed.size} disposable executions, ${staticReasons.size} asserted non-execution reasons).`,
);
