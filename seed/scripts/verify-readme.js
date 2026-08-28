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
for (const heading of [
  '## Requirements',
  '## Install From This Repository',
  '## Quick Start',
  '## Genomes',
  '## Blueprints And Diffs',
  '## Verification',
  '## Command Summary',
  '## Development',
  '## Current Boundaries',
]) {
  assert.match(readme, new RegExp(`^${heading}$`, 'm'), `README missing ${heading}`);
}

const shellBlocks = [...readme.matchAll(/```sh\n([\s\S]*?)\n```/g)].map((match) => match[1]);
assert.ok(shellBlocks.length > 0, 'README has no shell command blocks');

const shellCommands = shellBlocks
  .flatMap((block) => block.replace(/\\\n\s*/g, ' ').split('\n'))
  .map((line) => line.trim())
  .filter(Boolean);

for (const command of shellCommands) {
  assert.match(
    command,
    /^(cd|git clone|node src\/cli\.js|npm (install|pack|test)|seed)(?:\s|$)/,
    `README shell command is not classified: ${command}`,
  );
}

for (const command of [
  'seed --help',
  'seed init',
  'seed validate',
  'seed blueprint',
  'seed genome list',
  'seed genome validate --builtin',
  'seed verify start',
  'seed verify status',
  'seed install-skill --codex',
  'seed install-skill --claude',
  'npm test',
  'npm pack --dry-run --json',
]) {
  assert.ok(shellCommands.includes(command), `README missing documented command: ${command}`);
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-readme-'));
const projectRoot = path.join(temporaryRoot, 'project');
fs.mkdirSync(projectRoot);

const env = {
  ...process.env,
  HOME: path.join(temporaryRoot, 'home'),
  CODEX_HOME: path.join(temporaryRoot, 'codex'),
  CLAUDE_HOME: path.join(temporaryRoot, 'claude'),
  NO_COLOR: '1',
  TERM: 'dumb',
};

try {
  run(['--help'], projectRoot, env);
  run(['init'], projectRoot, env);
  run(['validate'], projectRoot, env);
  run(['blueprint', '--json'], projectRoot, env);
  run(['genome', 'list', '--builtin'], projectRoot, env);
  run(['genome', 'blueprint', 'cli-nodejs', '--json'], projectRoot, env);
  run(['genome', 'validate', '--builtin'], projectRoot, env);
  run(['verify', 'start'], projectRoot, env);
  run(['verify', 'pending'], projectRoot, env);
  run(['verify', 'status'], projectRoot, env);
  run(['diff', '--no-color'], projectRoot, env);
  run(['blueprint', 'diff', '--no-color'], projectRoot, env);
  run(['init', '--seed', 'ui'], projectRoot, env);
  run(['validate', '--seed', 'ui'], projectRoot, env);
  run(['list'], projectRoot, env);
  run(['install-skill', '--codex'], projectRoot, env);
  run(['install-skill', '--claude'], projectRoot, env);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log(`README command inventory passed (${shellCommands.length} commands; disposable execution passed).`);
