const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { parse, stringify } = require('yaml');

const { DEFAULT_SEED_PATH, renderSeedTemplate } = require('../src/seed-file');
const { run } = require('../src/cli');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'seed-cli-test-'));
}

function withTempDir(runTest) {
  const cwd = tempDir();
  try {
    return runTest(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

function runCli(args, cwd) {
  const output = [];
  const errorOutput = [];
  const originalCwd = process.cwd();
  const originalLog = console.log;
  const originalError = console.error;

  console.log = (...items) => {
    output.push(items.map(String).join(' '));
  };
  console.error = (...items) => {
    errorOutput.push(items.map(String).join(' '));
  };

  try {
    process.chdir(cwd);
    const code = run(args);
    return {
      code,
      stdout: output.join('\n'),
      stderr: errorOutput.join('\n'),
    };
  } finally {
    process.chdir(originalCwd);
    console.log = originalLog;
    console.error = originalError;
  }
}

function writeSeedFromTemplate(cwd, mutate) {
  const document = parse(renderSeedTemplate());
  mutate?.(document);

  const target = path.join(cwd, DEFAULT_SEED_PATH);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, stringify(document), 'utf8');
}

function sessionPath(cwd, sessionId = 'default') {
  return path.join(cwd, '.seed', 'sessions', `${sessionId}.json`);
}

function snapshotPath(cwd) {
  return path.join(cwd, '.seed', 'seed.snapshot.yml');
}

describe('seed cli', () => {
  test('init refuses overwrite by default and can initialize with overwrite flag', () => {
    withTempDir((cwd) => {
      const first = runCli(['init'], cwd);
      const second = runCli(['init'], cwd);
      const third = runCli(['init', '--overwrite'], cwd);

      assert.equal(first.code, 0);
      assert.equal(second.code, 1);
      assert.equal(third.code, 0);
      assert.equal(fs.existsSync(path.join(cwd, DEFAULT_SEED_PATH)), true);
      assert.ok(second.stderr.includes('already exists'));
    });
  });

  test('validate accepts generated template and rejects malformed YAML', () => {
    withTempDir((cwd) => {
      runCli(['init'], cwd);

      const valid = runCli(['validate'], cwd);
      assert.equal(valid.code, 0);
      assert.ok(valid.stdout.includes('Seed contract valid'));

      const malformedPath = path.join(cwd, DEFAULT_SEED_PATH);
      fs.writeFileSync(malformedPath, 'metadata: [invalid', 'utf8');
      const malformed = runCli(['validate'], cwd);
      assert.equal(malformed.code, 1);
      assert.ok(malformed.stderr.includes('Failed to parse Seed YAML'));
    });
  });

  test('validate shows warnings on weak but structurally valid contracts', () => {
    withTempDir((cwd) => {
      writeSeedFromTemplate(cwd, (document) => {
        document.interfaces = [
          {
            id: 'cli',
            purpose: 'CLI contract path.',
            examples: [],
          },
        ];
        document.behavior.outputs = ['CLI output stream'];
        document.errors = [];
        document.state.semantics = null;
        document.verifications[0].evidence = [];
      });

      const result = runCli(['validate'], cwd);
      assert.equal(result.code, 0);
      assert.ok(result.stdout.includes('Warnings ('));
      assert.ok(result.stdout.includes('interface-without-examples'));
      assert.ok(result.stdout.includes('outputs-without-errors'));
      assert.ok(result.stdout.includes('persistence-without-semantics'));
      assert.ok(result.stdout.includes('verification-without-evidence'));
    });
  });

  test('verify start creates .seed snapshot and session files', () => {
    withTempDir((cwd) => {
      runCli(['init'], cwd);
      const started = runCli(['verify', 'start'], cwd);

      assert.equal(started.code, 0);
      assert.equal(fs.existsSync(snapshotPath(cwd)), true);
      assert.equal(fs.existsSync(sessionPath(cwd)), true);
    });
  });

  test('verify next claims pending items exclusively and recovers stale leases', () => {
    withTempDir((cwd) => {
      writeSeedFromTemplate(cwd, (document) => {
        document.verifications = [
          { id: 'verify-first', title: 'First check', evidence: ['manual'] },
          { id: 'verify-second', title: 'Second check', evidence: ['manual'] },
        ];
      });

      assert.equal(runCli(['verify', 'start'], cwd).code, 0);

      const firstClaim = runCli(['verify', 'next'], cwd);
      assert.equal(firstClaim.code, 0);
      assert.ok(firstClaim.stdout.includes('Claimed verification verify-first'));

      const secondClaim = runCli(['verify', 'next'], cwd);
      assert.equal(secondClaim.code, 0);
      assert.ok(secondClaim.stdout.includes('Claimed verification verify-second'));

      const session = JSON.parse(fs.readFileSync(sessionPath(cwd), 'utf8'));
      session.items[0].status = 'claimed';
      session.items[0].claim = {
        owner: 'stale-worker',
        claimedAt: 1000,
        leaseUntil: 1001,
      };
      fs.writeFileSync(sessionPath(cwd), JSON.stringify(session, null, 2), 'utf8');

      const recovered = runCli(['verify', 'next'], cwd);
      assert.equal(recovered.code, 0);
      assert.ok(recovered.stdout.includes('Warning'));
      assert.ok(recovered.stdout.includes('recovered-stale-lease'));
      assert.ok(recovered.stdout.includes('Claimed verification verify-first'));
    });
  });

  test('confirm, fail, and status report completion and transitions', () => {
    withTempDir((cwd) => {
      writeSeedFromTemplate(cwd, (document) => {
        document.verifications = [
          { id: 'verify-first', title: 'First check', evidence: ['manual'] },
          { id: 'verify-second', title: 'Second check', evidence: ['manual'] },
        ];
      });

      assert.equal(runCli(['verify', 'start'], cwd).code, 0);

      const firstNext = runCli(['verify', 'next'], cwd);
      assert.equal(firstNext.code, 0);
      assert.equal(runCli(['verify', 'confirm', 'verify-first'], cwd).code, 0);

      assert.equal(runCli(['verify', 'next'], cwd).code, 0);
      assert.equal(runCli(['verify', 'fail', 'verify-second'], cwd).code, 0);

      const invalidConfirm = runCli(['verify', 'confirm', 'verify-missing'], cwd);
      assert.equal(invalidConfirm.code, 1);
      assert.ok(invalidConfirm.stderr.includes('Unknown verification id'));

      const transitionFail = runCli(['verify', 'fail', 'verify-first'], cwd);
      assert.equal(transitionFail.code, 1);
      assert.ok(transitionFail.stderr.includes('Invalid transition'));

      const status = runCli(['verify', 'status'], cwd);
      const parsed = JSON.parse(status.stdout);

      assert.equal(status.code, 0);
      assert.equal(parsed.total, 2);
      assert.equal(parsed.confirmed, 1);
      assert.equal(parsed.failed, 1);
      assert.equal(parsed.pending, 0);
      assert.equal(parsed.completed, false);
      assert.equal(parsed.completion, 0.5);
    });
  });
});
