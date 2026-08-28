'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const cliPath = path.join(repositoryRoot, 'src', 'cli.js');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-installer-rollback-'));
const codexHome = path.join(temporaryRoot, 'codex');
const target = path.join(codexHome, 'skills', 'seed-lang');
const marker = path.join(target, 'prior-installation.txt');
const originalArgv = process.argv;
const originalCodexHome = process.env.CODEX_HOME;
const originalHome = process.env.HOME;
const originalRenameSync = fs.renameSync;
const originalStderrWrite = process.stderr.write;
let renameCalls = 0;
let diagnostics = '';

try {
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(marker, 'prior installation\n');

  fs.renameSync = function (...args) {
    renameCalls += 1;
    if (renameCalls === 2) {
      throw new Error('controlled staged replacement failure');
    }
    return originalRenameSync.apply(this, args);
  };
  process.argv = [process.execPath, cliPath, 'install-skill', '--codex'];
  process.env.CODEX_HOME = codexHome;
  process.env.HOME = path.join(temporaryRoot, 'home');
  process.stderr.write = function (chunk, ...args) {
    diagnostics += String(chunk);
    return true;
  };

  const exitCode = require(cliPath).run();

  assert.notEqual(exitCode, 0, 'controlled replacement failure unexpectedly succeeded');
  assert.match(diagnostics, /controlled staged replacement failure/);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'prior installation\n');
  assert.deepEqual(fs.readdirSync(target), ['prior-installation.txt']);
  assert.deepEqual(
    fs.readdirSync(path.dirname(target)).filter((entry) => entry !== 'seed-lang'),
    [],
    'installer left staged or backup content behind',
  );
} finally {
  fs.renameSync = originalRenameSync;
  process.argv = originalArgv;
  process.stderr.write = originalStderrWrite;
  if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = originalCodexHome;
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log('Skill installer rollback preserved the prior installation after controlled failure.');
