const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { parse, stringify } = require('yaml');

const { DEFAULT_SEED_PATH, renderSeedTemplate } = require('../src/seed-file');
const { run } = require('../src/cli');

const PASS_CMD = process.execPath + ' -e "process.exit(0)"';
const FAIL_CMD = process.execPath + ' -e "process.exit(1)"';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'seed-cli-test-'));
}

function withTempDir(runTest) {
  const cwd = tempDir();
  fs.writeFileSync(path.join(cwd, 'implementation.js'), 'module.exports = {};\n', 'utf8');
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
  const originalWrite = process.stdout.write;

  console.log = (...items) => {
    output.push(items.map(String).join(' '));
  };
  console.error = (...items) => {
    errorOutput.push(items.map(String).join(' '));
  };
  process.stdout.write = (chunk) => {
    output.push(String(chunk).replace(/\n$/, ''));
    return true;
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
    process.stdout.write = originalWrite;
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


  test('init writes verified genomes from repeatable and list options', () => {
    withTempDir((cwd) => {
      const result = runCli(['init', '--genome', 'cli-nodejs', '--genomes', 'cli-human-output,cli-json-output'], cwd);
      assert.equal(result.code, 0);

      const document = parse(fs.readFileSync(path.join(cwd, DEFAULT_SEED_PATH), 'utf8'));
      assert.deepEqual(document.genomes, ['cli-nodejs', 'cli-human-output', 'cli-json-output']);

      const blueprint = runCli(['blueprint', '--section', 'interfaces'], cwd);
      assert.equal(blueprint.code, 0);
      assert.ok(blueprint.stdout.includes('Genomes: cli-interface [builtin], cli-nodejs [builtin], cli-human-output [builtin], cli-json-output [builtin]'));
    });
  });

  test('init rejects invalid genomes before writing', () => {
    withTempDir((cwd) => {
      const alias = runCli(['init', '--genome', 'cli-nodejs[constraints]', '--genomes', 'cli-human-output'], cwd);
      assert.equal(alias.code, 0);
      const document = parse(fs.readFileSync(path.join(cwd, DEFAULT_SEED_PATH), 'utf8'));
      assert.deepEqual(document.genomes, ['cli-nodejs[constraints]', 'cli-human-output']);
    });

    withTempDir((cwd) => {
      const invalid = runCli(['init', '--genome', 'missing-genome'], cwd);
      assert.equal(invalid.code, 1);
      assert.ok(invalid.stderr.includes('Unknown genome missing-genome'));
      assert.equal(fs.existsSync(path.join(cwd, DEFAULT_SEED_PATH)), false);
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

  test('validate rejects structurally malformed valid YAML', () => {
    withTempDir((cwd) => {
      const malformedPath = path.join(cwd, DEFAULT_SEED_PATH);
      fs.mkdirSync(path.dirname(malformedPath), { recursive: true });
      fs.writeFileSync(malformedPath, 'metadata:\n  name: incomplete\n', 'utf8');

      const malformed = runCli(['validate'], cwd);

      assert.equal(malformed.code, 1);
      assert.ok(malformed.stdout.includes('Errors ('));
      assert.ok(malformed.stdout.includes('missing-required-field /metadata/summary'));
      assert.ok(malformed.stdout.includes('missing-required-section /scope'));
      assert.ok(malformed.stderr.includes('Seed validation failed with structural errors'));
    });
  });

  test('validate shows warnings on weak but structurally valid contracts', () => {
    withTempDir((cwd) => {
      writeSeedFromTemplate(cwd, (document) => {
        document.interfaces = {
          cli: {
            purpose: 'CLI contract path.',
            examples: [],
          },
        };
        document.behavior.outputs = {
          'cli-output': 'CLI output stream',
        };
        document.errors = {};
        delete document.state['repo-local-state'].semantics;
      });

      const result = runCli(['validate'], cwd);
      assert.equal(result.code, 0);
      assert.ok(result.stdout.includes('Warnings ('));
      assert.ok(result.stdout.includes('interface-without-examples'));
      assert.ok(result.stdout.includes('outputs-without-errors'));
      assert.ok(result.stdout.includes('persistence-without-semantics'));
    });
  });


  test('diff compares current compiled Seed with the verification snapshot', () => {
    withTempDir((cwd) => {
      runCli(['init'], cwd);

      const missingSnapshot = runCli(['diff', '--no-color'], cwd);
      assert.equal(missingSnapshot.code, 1);
      assert.ok(missingSnapshot.stderr.includes('Seed snapshot missing'));

      assert.equal(runCli(['verify', 'start'], cwd).code, 0);
      const clean = runCli(['diff', '--no-color'], cwd);
      assert.equal(clean.code, 0);
      assert.equal(clean.stdout, 'No Seed diff.');

      const seedPath = path.join(cwd, DEFAULT_SEED_PATH);
      const document = parse(fs.readFileSync(seedPath, 'utf8'));
      document.behavior['local-commands'].description = 'Seed commands expose changed behavior for diff output.';
      fs.writeFileSync(seedPath, stringify(document), 'utf8');

      const diff = runCli(['diff', '--no-color'], cwd);
      assert.equal(diff.code, 0);
      assert.ok(diff.stdout.includes('--- .seed/seed.snapshot.yml'));
      assert.ok(diff.stdout.includes('+++ seed/seed.yml (compiled)'));
      assert.ok(diff.stdout.includes('@@ -'));
      assert.ok(diff.stdout.includes('Seed commands expose changed behavior for diff output.'));
      assert.equal(diff.stdout.includes('## Interfaces'), false);
      assert.ok(diff.stdout.split('\n').length < 16);
    });
  });
  test('blueprint renders markdown and json views from the Seed file', () => {
    withTempDir((cwd) => {
      runCli(['init'], cwd);

      const markdown = runCli(['blueprint'], cwd);
      assert.equal(markdown.code, 0);
      assert.ok(markdown.stdout.includes('# Seed Blueprint'));
      assert.ok(markdown.stdout.includes('## Global Policies'));
      assert.ok(markdown.stdout.includes('`security.repo-local-boundary`'));
      assert.ok(markdown.stdout.includes('## Interfaces'));
      assert.ok(markdown.stdout.includes('`interfaces.cli`'));

      const json = runCli(['blueprint', '--json'], cwd);
      assert.equal(json.code, 0);
      const parsed = JSON.parse(json.stdout);
      assert.equal(parsed.kind, 'seed-blueprint');
      assert.equal(parsed.source.path, DEFAULT_SEED_PATH);
      assert.ok(parsed.sections.some((section) => section.id === 'global-policies'));
      assert.ok(parsed.sections.some((section) => section.id === 'interfaces'));
    });
  });

  test('blueprint supports section, pagination, line windows, and reference filters', () => {
    withTempDir((cwd) => {
      runCli(['init'], cwd);

      const section = runCli(['blueprint', '--section', 'artifacts', '--limit', '1', '--offset', '0'], cwd);
      assert.equal(section.code, 0);
      assert.ok(section.stdout.includes('## Artifacts'));
      assert.ok(section.stdout.includes('`artifacts.baseline-seed`'));
      assert.equal(section.stdout.includes('## Interfaces'), false);

      const filtered = runCli(['blueprint', '--filter', '@security.repo-local-boundary', '--json'], cwd);
      assert.equal(filtered.code, 0);
      const parsed = JSON.parse(filtered.stdout);
      const addresses = parsed.sections.flatMap((entry) => entry.items.map((item) => item.address));
      assert.ok(addresses.includes('security.repo-local-boundary'));
      assert.equal(addresses.includes('interfaces.cli'), false);

      const windowed = runCli(['blueprint', '--head', '2', '--tail', '2'], cwd);
      assert.equal(windowed.code, 0);
      assert.ok(windowed.stdout.split('\n').length <= 6);
      assert.ok(windowed.stdout.includes('...'));
    });
  });

  test('blueprint uses compiled genome content and reports applied genomes', () => {
    withTempDir((cwd) => {
      writeSeedFromTemplate(cwd, (document) => {
        document.genomes = ['cli-nodejs', 'cli-json-output'];
        delete document.interfaces;
      });

      const markdown = runCli(['blueprint', '--section', 'interfaces'], cwd);
      assert.equal(markdown.code, 0);
      assert.ok(markdown.stdout.includes('Genomes: cli-interface [builtin], cli-nodejs [builtin], cli-json-output [builtin]'));
      assert.ok(markdown.stdout.includes('`interfaces.cli` [builtin:cli-nodejs]'));
      assert.ok(markdown.stdout.includes('User invokes the project from a terminal as a Node.js CLI.'));

      const json = runCli(['blueprint', '--section', 'functional-behavior', '--json'], cwd);
      assert.equal(json.code, 0);
      const parsed = JSON.parse(json.stdout);
      assert.deepEqual(parsed.source.genomes.map((entry) => entry.id), ['cli-interface', 'cli-nodejs', 'cli-json-output']);
      const addresses = parsed.sections.flatMap((section) => section.items.map((item) => item.address));
      assert.ok(addresses.includes('behavior.outputs.default-json'));
      const defaultJson = parsed.sections.flatMap((section) => section.items).find((item) => item.address === 'behavior.outputs.default-json');
      assert.equal(defaultJson.source.origin, 'builtin');
      assert.equal(defaultJson.source.id, 'cli-json-output');
    });
  });

  test('blueprint rejects unknown options and sections clearly', () => {
    withTempDir((cwd) => {
      runCli(['init'], cwd);

      const badOption = runCli(['blueprint', '--bogus'], cwd);
      assert.equal(badOption.code, 1);
      assert.ok(badOption.stderr.includes('Unknown option for seed blueprint'));

      const badSection = runCli(['blueprint', '--section', 'missing'], cwd);
      assert.equal(badSection.code, 1);
      assert.ok(badSection.stderr.includes('Unknown blueprint section missing'));
    });
  });


  test('genome list supports builtin, user, and repo filters', () => {
    withTempDir((cwd) => {
      const home = tempDir();
      const originalHome = process.env.HOME;
      try {
        process.env.HOME = home;
        fs.mkdirSync(path.join(home, '.seed', 'genomes'), { recursive: true });
        fs.writeFileSync(path.join(home, '.seed', 'genomes', 'user-demo.yml'), 'constraints:\n  user-demo: User genome.\n', 'utf8');
        fs.mkdirSync(path.join(cwd, 'seed', 'genomes'), { recursive: true });
        fs.writeFileSync(path.join(cwd, 'seed', 'genomes', 'repo-demo.yml'), 'constraints:\n  repo-demo: Repo genome.\n', 'utf8');

        const builtin = runCli(['genome', 'list', '--builtin'], cwd);
        assert.equal(builtin.code, 0);
        assert.ok(builtin.stdout.includes('builtin\tcli-nodejs\tbuiltin:cli-nodejs'));
        assert.equal(builtin.stdout.includes('user-demo'), false);
        assert.equal(builtin.stdout.includes('repo-demo'), false);

        const user = runCli(['genome', 'list', '--user'], cwd);
        assert.equal(user.code, 0);
        assert.ok(user.stdout.includes('user\tuser-demo'));
        assert.equal(user.stdout.includes('repo-demo'), false);

        const repo = runCli(['genome', 'list', '--repo'], cwd);
        assert.equal(repo.code, 0);
        assert.ok(repo.stdout.includes('repo\trepo-demo'));
        assert.equal(repo.stdout.includes('user-demo'), false);
      } finally {
        process.env.HOME = originalHome;
        fs.rmSync(home, { recursive: true, force: true });
      }
    });
  });

  test('genome init creates repo genome and refuses overwrite', () => {
    withTempDir((cwd) => {
      const first = runCli(['genome', 'init', 'repo-created'], cwd);
      const second = runCli(['genome', 'init', 'repo-created'], cwd);
      const third = runCli(['genome', 'init', 'repo-created', '--overwrite'], cwd);
      const genomePath = path.join(cwd, 'seed', 'genomes', 'repo-created.yml');

      assert.equal(first.code, 0);
      assert.equal(second.code, 1);
      assert.equal(third.code, 0);
      assert.equal(fs.existsSync(genomePath), true);
      const document = parse(fs.readFileSync(genomePath, 'utf8'));
      assert.equal(document.metadata.name, 'repo-created');
      assert.ok(second.stderr.includes('Genome already exists'));
    });
  });

  test('genome validate checks all by default and can filter repo genomes', () => {
    withTempDir((cwd) => {
      fs.mkdirSync(path.join(cwd, 'seed', 'genomes'), { recursive: true });
      fs.writeFileSync(path.join(cwd, 'seed', 'genomes', 'good.yml'), 'constraints:\n  good: Good genome.\n', 'utf8');
      fs.writeFileSync(path.join(cwd, 'seed', 'genomes', 'bad.yml'), 'constraints:\n  - anonymous\n', 'utf8');

      const repo = runCli(['genome', 'validate', '--repo'], cwd);
      assert.equal(repo.code, 1);
      assert.ok(repo.stdout.includes('Failed genomes (1/2):'));
      assert.ok(repo.stdout.includes('repo\tbad'));
      assert.ok(repo.stdout.includes('invalid-addressable-item'));

      fs.unlinkSync(path.join(cwd, 'seed', 'genomes', 'bad.yml'));
      const all = runCli(['genome', 'validate'], cwd);
      assert.equal(all.code, 0);
      assert.ok(all.stdout.includes('All genomes valid'));
    });
  });

  test('genome blueprint renders compiled genome without seed file context', () => {
    withTempDir((cwd) => {
      fs.mkdirSync(path.join(cwd, 'seed', 'genomes'), { recursive: true });
      fs.writeFileSync(path.join(cwd, 'seed', 'genomes', 'repo-blueprint.yml'), [
        'genomes:',
        '  - cli-nodejs[constraints]',
        'behavior:',
        '  demo: Demo behavior.',
      ].join('\n'), 'utf8');

      const markdown = runCli(['genome', 'blueprint', 'repo-blueprint', '--section', 'constraints'], cwd);
      assert.equal(markdown.code, 0);
      assert.ok(markdown.stdout.includes('# Seed Blueprint'));
      assert.ok(markdown.stdout.includes('Source: '));
      assert.ok(markdown.stdout.includes('repo-blueprint.yml'));
      assert.ok(markdown.stdout.includes('`constraints.nodejs-cli-runtime` [builtin:cli-nodejs]'));
      assert.equal(markdown.stdout.includes('seed/seed.yml'), false);

      const json = runCli(['genome', 'blueprint', 'repo-blueprint', '--json'], cwd);
      assert.equal(json.code, 0);
      const parsed = JSON.parse(json.stdout);
      assert.equal(parsed.source.path.endsWith('repo-blueprint.yml'), true);
      assert.ok(parsed.sections.some((section) => section.id === 'functional-behavior'));
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
        document.artifacts = {
          sample: {
            path: 'seed/sample.txt',
            description: 'Sample input file.',
          },
        };
        document.verifications = [
          {
            id: 'verify-first',
            title: 'First check',
            description: 'check first with @sample',
            artifacts: ['sample'],
            method: 'manual using @sample',
            evidence_required: ['manual'],
          },
          {
            id: 'verify-second',
            title: 'Second check',
            description: 'check second',
            method: 'manual',
            evidence_required: ['manual'],
          },
        ];
      });

      assert.equal(runCli(['verify', 'start'], cwd).code, 0);

      const firstClaim = runCli(['verify', 'next'], cwd);
      assert.equal(firstClaim.code, 0);
      assert.ok(firstClaim.stdout.includes('Claimed verification verify-first'));
      assert.ok(firstClaim.stdout.includes('source: manual'));
      assert.ok(firstClaim.stdout.includes('artifacts: sample'));
      assert.ok(firstClaim.stdout.includes('method: manual using @sample'));
      assert.ok(firstClaim.stdout.includes('global policies:'));
      assert.ok(firstClaim.stdout.includes('- @security.repo-local-boundary'));
      assert.ok(firstClaim.stdout.includes('referenced addresses:'));
      assert.ok(firstClaim.stdout.includes('- @verifications.verify-first - check first with @sample'));
      assert.ok(firstClaim.stdout.includes('referenced artifacts:'));
      assert.ok(firstClaim.stdout.includes('- @sample (artifacts.sample) path=seed/sample.txt - Sample input file.'));

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

  test('verify pending lists pending and expired items', () => {
    withTempDir((cwd) => {
      writeSeedFromTemplate(cwd, (document) => {
        document.behavior.counts = 'Count every character exactly.';
        document.verifications = [
          {
            id: 'manual-counts',
            title: 'Manual counts',
            description: 'Verify @behavior.counts manually.',
            method: 'Inspect implementation.',
            evidence_required: ['Manual evidence.'],
          },
        ];
      });
      const seedPath = path.join(cwd, DEFAULT_SEED_PATH);
      const seedText = fs.readFileSync(seedPath, 'utf8');

      assert.equal(runCli(['verify', 'start'], cwd).code, 0);
      const initialPending = runCli(['verify', 'pending'], cwd);
      assert.equal(initialPending.code, 0);
      assert.ok(initialPending.stdout.includes('Pending verification items'));
      assert.ok(initialPending.stdout.includes('- pending manual-counts @verifications.manual-counts'));

      assert.equal(runCli(['verify', 'next'], cwd).code, 0);
      assert.equal(runCli(['verify', 'confirm', 'manual-counts', '--owner', 'seed-cli', '--file', 'implementation.js', '--test-cmd', PASS_CMD, '--evidence', 'ok'], cwd).code, 0);
      let next = runCli(['verify', 'next'], cwd);
      while (next.stdout.includes('Claimed verification') && !next.stdout.includes('implicit-behavior-counts')) {
        const id = next.stdout.match(/Claimed verification ([^\n]+)/)[1];
        assert.equal(runCli(['verify', 'confirm', id, '--owner', 'seed-cli', '--file', 'implementation.js', '--test-cmd', PASS_CMD, '--evidence', 'ok'], cwd).code, 0);
        next = runCli(['verify', 'next'], cwd);
      }
      assert.ok(next.stdout.includes('Claimed verification implicit-behavior-counts'));
      assert.equal(runCli(['verify', 'confirm', 'implicit-behavior-counts', '--owner', 'seed-cli', '--file', 'implementation.js', '--test-cmd', PASS_CMD, '--evidence', 'ok'], cwd).code, 0);

      fs.writeFileSync(seedPath, seedText.replace('Count every character exactly.', 'Count every printable character exactly.'), 'utf8');
      const expiredPending = runCli(['verify', 'pending'], cwd);
      assert.equal(expiredPending.code, 0);
      assert.ok(expiredPending.stdout.includes('- expired manual-counts @verifications.manual-counts previous=confirmed'));
      assert.ok(expiredPending.stdout.includes('- expired implicit-behavior-counts @behavior.counts previous=confirmed'));
      assert.ok(expiredPending.stdout.includes('modified addresses: @behavior.counts'));

      const status = JSON.parse(runCli(['verify', 'status'], cwd).stdout);
      assert.equal(status.expired, 2);
      assert.equal(status.completed, false);
    });
  });

  test('confirm, fail, and status report completion and transitions', () => {
    withTempDir((cwd) => {
      writeSeedFromTemplate(cwd, (document) => {
        document.verifications = [
          {
            id: 'verify-first',
            title: 'First check',
            description: 'check first',
            method: 'manual',
            evidence_required: ['manual'],
          },
          {
            id: 'verify-second',
            title: 'Second check',
            description: 'check second',
            method: 'manual',
            evidence_required: ['manual'],
          },
        ];
      });

      assert.equal(runCli(['verify', 'start'], cwd).code, 0);

      const firstNext = runCli(['verify', 'next'], cwd);
      assert.equal(firstNext.code, 0);
      const confirmWithEvidence = runCli(
        ['verify', 'confirm', 'verify-first', '--owner', 'seed-cli', '--file', 'implementation.js', '--test-cmd', PASS_CMD, '--evidence', 'manual-check'],
        cwd,
      );
      assert.equal(confirmWithEvidence.code, 0);

      assert.equal(runCli(['verify', 'next'], cwd).code, 0);
      const failWithReason = runCli(
        ['verify', 'fail', 'verify-second', '--owner', 'seed-cli', '--file', 'implementation.js', '--test-cmd', FAIL_CMD, '--reason', 'environment missing'],
        cwd,
      );
      assert.equal(failWithReason.code, 0);

      const invalidConfirm = runCli(['verify', 'confirm', 'verify-missing', '--owner', 'seed-cli', '--file', 'implementation.js', '--test-cmd', PASS_CMD], cwd);
      assert.equal(invalidConfirm.code, 1);
      assert.ok(invalidConfirm.stderr.includes('Unknown verification id'));

      const transitionFail = runCli(['verify', 'fail', 'verify-first', '--owner', 'seed-cli', '--file', 'implementation.js', '--test-cmd', PASS_CMD], cwd);
      assert.equal(transitionFail.code, 1);
      assert.ok(transitionFail.stderr.includes('Invalid transition'));

      const status = runCli(['verify', 'status'], cwd);
      const parsed = JSON.parse(status.stdout);

      assert.equal(status.code, 0);
      assert.ok(parsed.total > 2);
      assert.equal(parsed.verified, 2);
      assert.equal(parsed.passed, 1);
      assert.equal(parsed.confirmed, 1);
      assert.equal(parsed.failed, 1);
      assert.equal(parsed.pending, parsed.total - 2);
      assert.equal(parsed.completed, false);
      assert.equal(parsed.satisfied, false);
      assert.equal(parsed.completion, 2 / parsed.total);

      const session = JSON.parse(fs.readFileSync(sessionPath(cwd), 'utf8'));
      const confirmed = session.items.find((entry) => entry.id === 'verify-first');
      const failed = session.items.find((entry) => entry.id === 'verify-second');
      assert.equal(confirmed.evidence, 'manual-check');
      assert.equal(confirmed.reason, null);
      assert.equal(failed.reason, 'environment missing');
      assert.equal(failed.evidence, null);

      const check = runCli(["verify", "check"], cwd);
      assert.equal(check.code, 1);
      assert.ok(check.stdout.includes("Seed verification check: 1/2 passed"));
      assert.ok(check.stdout.includes("- ok verify-first"));
      assert.ok(check.stdout.includes("- failed verify-second"));
    });
  });

  test('verify reset clears existing session progress in place', () => {
    withTempDir((cwd) => {
      writeSeedFromTemplate(cwd, (document) => {
        document.verifications = [
          {
            id: 'verify-first',
            title: 'First check',
            description: 'check first',
            method: 'manual',
            evidence_required: ['manual'],
          },
          {
            id: 'verify-second',
            title: 'Second check',
            description: 'check second',
            method: 'manual',
            evidence_required: ['manual'],
          },
        ];
      });

      assert.equal(runCli(['verify', 'start'], cwd).code, 0);
      const original = JSON.parse(fs.readFileSync(sessionPath(cwd), 'utf8'));

      assert.equal(runCli(['verify', 'next'], cwd).code, 0);
      assert.equal(runCli(['verify', 'confirm', 'verify-first', '--owner', 'seed-cli', '--file', 'implementation.js', '--test-cmd', PASS_CMD, '--evidence', 'done'], cwd).code, 0);
      assert.equal(runCli(['verify', 'next'], cwd).code, 0);
      assert.equal(runCli(['verify', 'fail', 'verify-second', '--owner', 'seed-cli', '--file', 'implementation.js', '--test-cmd', FAIL_CMD, '--reason', 'nope'], cwd).code, 0);

      const beforeReset = JSON.parse(runCli(['verify', 'status'], cwd).stdout);
      assert.equal(beforeReset.verified, 2);
      assert.equal(beforeReset.failed, 1);

      const reset = runCli(['verify', 'reset'], cwd);
      assert.equal(reset.code, 0);
      assert.ok(reset.stdout.includes("Reset verification session 'default'"));
      assert.ok(reset.stdout.includes('Items reset:'));

      const after = JSON.parse(fs.readFileSync(sessionPath(cwd), 'utf8'));
      assert.equal(after.sessionId, original.sessionId);
      assert.equal(after.createdAt, original.createdAt);
      assert.equal(after.seedHash, original.seedHash);
      assert.equal(after.snapshotPath, original.snapshotPath);
      assert.ok(after.updatedAt >= original.updatedAt);
      assert.deepEqual(after.items.map((entry) => entry.status), original.items.map((entry) => entry.status));
      assert.deepEqual(after.items.map((entry) => entry.attempts), original.items.map((entry) => entry.attempts));
      assert.equal(after.items.every((entry) => entry.claim === null), true);
      assert.equal(after.items.every((entry) => entry.evidence === null), true);
      assert.equal(after.items.every((entry) => entry.reason === null), true);
      assert.equal(after.items.every((entry) => Array.isArray(entry.evidence_files) && entry.evidence_files.length === 0), true);

      const status = JSON.parse(runCli(['verify', 'status'], cwd).stdout);
      assert.equal(status.verified, 0);
      assert.equal(status.failed, 0);
      assert.equal(status.pending, status.total);
      assert.equal(status.satisfied, false);

      const next = runCli(['verify', 'next'], cwd);
      assert.equal(next.code, 0);
      assert.ok(next.stdout.includes('Claimed verification verify-first'));
    });
  });

  test('verify owner option binds claim and confirm/fail operations', () => {
    withTempDir((cwd) => {
      runCli(['init'], cwd);
      runCli(['verify', 'start'], cwd);

      const claimed = runCli(['verify', 'next', '--owner', 'worker-a'], cwd);
      assert.equal(claimed.code, 0);
      assert.ok(claimed.stdout.includes('Claimed verification seed-baseline-visibility'));

      const missingOwner = runCli(
        ['verify', 'confirm', 'seed-baseline-visibility', '--file', 'implementation.js', '--test-cmd', PASS_CMD, '--evidence', 'ok'],
        cwd,
      );
      assert.equal(missingOwner.code, 1);
      assert.ok(missingOwner.stderr.includes('owner invalid'));

      const wrongOwner = runCli(
        ['verify', 'confirm', 'seed-baseline-visibility', '--owner', 'worker-b', '--file', 'implementation.js', '--test-cmd', PASS_CMD, '--evidence', 'ok'],
        cwd,
      );
      assert.equal(wrongOwner.code, 1);
      assert.ok(wrongOwner.stderr.includes('Invalid owner'));

      const rightOwner = runCli(
        ['verify', 'confirm', 'seed-baseline-visibility', '--owner', 'worker-a', '--file', 'implementation.js', '--test-cmd', PASS_CMD, '--evidence', 'ok'],
        cwd,
      );
      assert.equal(rightOwner.code, 0);
    });
  });

  test('verify report renders status, audit, files, and commands', () => {
    withTempDir((cwd) => {
      runCli(['init'], cwd);
      runCli(['verify', 'start'], cwd);
      runCli(['verify', 'next'], cwd);
      assert.equal(runCli(['verify', 'confirm', 'seed-baseline-visibility', '--owner', 'seed-cli', '--file', 'implementation.js', '--test-cmd', PASS_CMD, '--evidence', 'seed-baseline-visibility checked with npm test'], cwd).code, 0);

      const report = runCli(['verify', 'report'], cwd);
      assert.equal(report.code, 0);
      assert.ok(report.stdout.includes('Seed verification report'));
      assert.ok(report.stdout.includes('Status: total='));
      assert.ok(report.stdout.includes('Audit:'));
      assert.ok(report.stdout.includes('Global policies:'));
      assert.ok(report.stdout.includes('- @security.repo-local-boundary'));
      assert.ok(report.stdout.includes('- confirmed seed-baseline-visibility'));
      assert.ok(report.stdout.includes('files: implementation.js'));
      assert.ok(report.stdout.includes('commands:'));
      assert.ok(report.stdout.includes(PASS_CMD));
    });
  });

  test('verify audit reports incomplete sessions and weak evidence warnings', () => {
    withTempDir((cwd) => {
      runCli(['init'], cwd);
      runCli(['verify', 'start'], cwd);

      const initialAudit = runCli(['verify', 'audit'], cwd);
      assert.equal(initialAudit.code, 1);
      assert.ok(initialAudit.stdout.includes('Seed verification audit:'));
      assert.ok(initialAudit.stdout.includes('session-incomplete'));

      assert.equal(runCli(['verify', 'next'], cwd).code, 0);
      assert.equal(runCli(['verify', 'confirm', 'seed-baseline-visibility', '--owner', 'seed-cli', '--file', 'implementation.js', '--test-cmd', PASS_CMD, '--evidence', 'ok'], cwd).code, 0);

      const weakAudit = runCli(['verify', 'audit'], cwd);
      assert.equal(weakAudit.code, 1);
      assert.ok(weakAudit.stdout.includes('weak-evidence-text') || weakAudit.stdout.includes('generic-evidence-text'));
    });
  });

  test('verify confirm and fail options accept only known flags and require values', () => {
    withTempDir((cwd) => {
      runCli(['init'], cwd);
      runCli(['verify', 'start'], cwd);
      runCli(['verify', 'next'], cwd);

      const missingValue = runCli(
        ['verify', 'confirm', 'seed-baseline-visibility', '--owner', 'seed-cli', '--evidence'],
        cwd,
      );
      assert.equal(missingValue.code, 1);
      assert.ok(missingValue.stderr.includes('--evidence requires a value'));

      const wrongOption = runCli(
        ['verify', 'confirm', 'seed-baseline-visibility', '--owner', 'seed-cli', '--file', 'implementation.js', '--test-cmd', FAIL_CMD, '--reason', 'nope'],
        cwd,
      );
      assert.equal(wrongOption.code, 1);
      assert.ok(wrongOption.stderr.includes('Unknown option for seed verify confirm'));

      const missingId = runCli(
        ['verify', 'confirm', '--evidence', 'nope'],
        cwd,
      );
      assert.equal(missingId.code, 1);
      assert.ok(missingId.stderr.includes('requires exactly one <constraint-id>'));

      const failMissingValue = runCli(
        ['verify', 'fail', 'seed-baseline-visibility', '--owner', 'seed-cli', '--reason'],
        cwd,
      );
      assert.equal(failMissingValue.code, 1);
      const missingTestCommand = runCli(
        ["verify", "confirm", "seed-baseline-visibility", "--owner", "seed-cli", "--file", "implementation.js", "--evidence", "ok"],
        cwd,
      );
      assert.equal(missingTestCommand.code, 1);
      assert.ok(missingTestCommand.stderr.includes("requires at least one --test-cmd command"));

      const confirmWithFailingCommand = runCli(
        ["verify", "confirm", "seed-baseline-visibility", "--owner", "seed-cli", "--file", "implementation.js", "--test-cmd", FAIL_CMD, "--evidence", "ok"],
        cwd,
      );
      assert.equal(confirmWithFailingCommand.code, 1);
      assert.ok(confirmWithFailingCommand.stderr.includes("Cannot confirm item"));

      const failWithPassingCommand = runCli(
        ["verify", "fail", "seed-baseline-visibility", "--owner", "seed-cli", "--file", "implementation.js", "--test-cmd", PASS_CMD, "--reason", "nope"],
        cwd,
      );
      assert.equal(failWithPassingCommand.code, 1);
      assert.ok(failWithPassingCommand.stderr.includes("Cannot fail item"));
      assert.ok(failMissingValue.stderr.includes('--reason requires a value'));
    });
  });
});
