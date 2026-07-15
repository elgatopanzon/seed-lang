const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { parse } = require('yaml');
const assert = require('node:assert/strict');
const { test, describe } = require('node:test');

const PASS_CMD = process.execPath + ' -e "process.exit(0)"';
const FAIL_CMD = process.execPath + ' -e "process.exit(1)"';

const {
  checkSession,
  claimNext,
  confirmItem,
  failItem,
  getPendingItems,
  getStatus,
  startSession,
  syncSession,
  verificationAudit,
  verificationReport,
} = require('../src/verification-store');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'seed-verification-store-test-'));
}

function withTempDir(run) {
  const cwd = tempDir();
  fs.writeFileSync(path.join(cwd, 'implementation.js'), 'module.exports = {};\n', 'utf8');
  try {
    return run(cwd);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

function sampleDocument() {
  return {
    verifications: [
      {
        id: 'verify-begin',
        title: 'first verification',
        description: 'confirm the first behavior',
        method: 'manual review',
        artifacts: ['sample-input'],
        evidence_required: ['manual-check'],
      },
      {
        id: 'verify-next',
        title: 'second verification',
        description: 'confirm second behavior',
        method: 'manual review',
        evidence_required: ['manual-check'],
      },
      {
        id: 'verify-final',
        title: 'third verification',
        description: 'confirm third behavior',
        method: 'manual review',
        evidence_required: ['manual-check'],
      },
    ],
  };
}

function sessionFile(cwd, sessionId = 'default') {
  return path.join(cwd, '.seed', 'sessions', `${sessionId}.json`);
}

function snapshotFile(cwd) {
  return path.join(cwd, '.seed', 'seed.snapshot.yml');
}

function lockPath(cwd, sessionId = 'default') {
  return path.join(cwd, '.seed', 'locks', `${sessionId}.lock`);
}

function testFileHash(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function passCommand(label) {
  return `${process.execPath} -e "process.exit(0)" ${label}`;
}

describe('verification store', () => {
  test('startSession writes the original snapshot and versioned, hashed items in seed order', () => {
    const result = withTempDir((cwd) => {
      const document = sampleDocument();
      startSession({
        cwd,
        seedDocument: document,
        seedText: 'metadata:\n  name: exact-source\n',
        sessionId: 'default',
        now: () => 12_345,
      });

      const snapText = fs.readFileSync(snapshotFile(cwd), 'utf8');
      const session = JSON.parse(fs.readFileSync(sessionFile(cwd), 'utf8'));

      assert.equal(snapText, 'metadata:\n  name: exact-source\n');
      assert.equal(session.schemaVersion, 1);
      assert.equal(
        session.seedHash,
        createHash('sha256').update(snapText, 'utf8').digest('hex'),
      );
      assert.equal(session.createdAt, 12_345);
      assert.equal(session.updatedAt, 12_345);
      assert.equal(session.snapshotPath, '.seed/seed.snapshot.yml');
      assert.deepEqual(
        session.items.map((entry) => entry.id),
        ['verify-begin', 'verify-next', 'verify-final'],
      );
      assert.equal(session.items.every((entry) => entry.status === 'pending'), true);
      assert.equal(session.items[0].title, 'first verification');
      assert.equal(session.items[0].description, 'confirm the first behavior');
      assert.equal(session.items[0].address, 'verifications.verify-begin');
      assert.deepEqual(session.items[0].artifacts, ['sample-input']);
      assert.deepEqual(session.items[0].evidence_required, ['manual-check']);
      return true;
    });

    assert.equal(result, true);
  });


  test('startSession adds implicit verification items for addressable contract obligations', () => {
    withTempDir((cwd) => {
      startSession({
        cwd,
        seedDocument: {
          artifacts: {
            sample: {
              path: 'seed/sample.txt',
              description: 'Sample input.',
            },
          },
          behavior: {
            counts: {
              description: 'Counts characters from @sample.',
              artifacts: ['sample'],
            },
          },
          security: {
            'no-network-access': 'Must not make outbound network calls.',
          },
          freedom: {
            'module-layout': 'Implementation may choose module layout.',
          },
          verifications: [
            {
              id: 'manual-check',
              title: 'Manual check',
              description: 'manual verification',
              method: 'manual',
              evidence_required: ['manual evidence'],
            },
          ],
        },
        seedText: 'seed-contract-text',
      });

      const session = JSON.parse(fs.readFileSync(sessionFile(cwd), 'utf8'));
      const ids = session.items.map((entry) => entry.id);
      const behaviorItem = session.items.find((entry) => entry.id === 'implicit-behavior-counts');
      const securityItem = session.items.find((entry) => entry.id === 'implicit-security-no-network-access');

      assert.deepEqual(ids, [
        'manual-check',
        'implicit-behavior-counts',
        'implicit-security-no-network-access',
      ]);
      assert.equal(session.items[0].source, 'manual');
      assert.equal(behaviorItem.source, 'implicit');
      assert.equal(behaviorItem.address, 'behavior.counts');
      assert.equal(behaviorItem.description, 'Verify @behavior.counts is satisfied.');
      assert.deepEqual(behaviorItem.artifacts, ['sample']);
      assert.ok(behaviorItem.evidence_required.some((entry) => entry.includes('@behavior.counts')));
      assert.equal(securityItem.source, 'implicit');
      assert.equal(ids.includes('implicit-freedom-module-layout'), false);
    });
  });

  test('claimNext writes one atomic claim and returns claim metadata', () => {
    withTempDir((cwd) => {
      startSession({
        cwd,
        seedDocument: sampleDocument(),
        seedText: 'seed-contract-text',
      });

      const result = claimNext({
        cwd,
        owner: 'worker-A',
        leaseMs: 120000,
        now: () => 10_000,
      });

      const state = JSON.parse(fs.readFileSync(sessionFile(cwd), 'utf8'));
      const claimed = state.items.find((entry) => entry.id === 'verify-begin');

      assert.equal(result.item.id, 'verify-begin');
      assert.equal(result.claim.owner, 'worker-A');
      assert.equal(result.claim.claimedAt, 10_000);
      assert.equal(result.claim.leaseUntil, 130_000);
      assert.equal(result.recoveredIds.length, 0);
      assert.equal(claimed.status, 'claimed');
      assert.equal(claimed.claim.owner, 'worker-A');
    });
  });

  test('claimNext recovers stale claims and returns stale ids as warnings', () => {
    withTempDir((cwd) => {
      startSession({
        cwd,
        seedDocument: sampleDocument(),
        seedText: 'seed-contract-text',
      });

      const session = JSON.parse(fs.readFileSync(sessionFile(cwd), 'utf8'));
      session.items[0] = {
        ...session.items[0],
        status: 'claimed',
        claim: {
          owner: 'worker-old',
          claimedAt: 1000,
          leaseUntil: 1001,
        },
      };
      fs.writeFileSync(sessionFile(cwd), JSON.stringify(session, null, 2), 'utf8');

      const result = claimNext({
        cwd,
        now: () => 9_000,
        owner: 'worker-new',
      });

      const refreshed = JSON.parse(fs.readFileSync(sessionFile(cwd), 'utf8'));
      const first = refreshed.items[0];

      assert.deepEqual(result.recoveredIds, ['verify-begin']);
      assert.equal(Array.isArray(result.warnings), true);
      assert.equal(result.warnings[0].code, 'recovered-stale-lease');
      assert.equal(result.item.id, 'verify-begin');
      assert.equal(result.claim.owner, 'worker-new');
      assert.equal(first.status, 'claimed');
      assert.equal(first.claim.owner, 'worker-new');
    });
  });

  test('confirmItem and failItem only transition claimed items and persist metadata', () => {
    withTempDir((cwd) => {
      startSession({
        cwd,
        seedDocument: sampleDocument(),
        seedText: 'seed-contract-text',
      });

      claimNext({ cwd, owner: 'worker-A', now: () => 1_000 });
      confirmItem({
        cwd,
        itemId: 'verify-begin',
        owner: 'worker-A',
        files: ['implementation.js'],
          testCommands: [PASS_CMD],
        now: () => 2_000,
        evidence: 'verified manually',
      });

      claimNext({ cwd, owner: 'worker-A', now: () => 3_000 });
      failItem({
        cwd,
        itemId: 'verify-next',
        owner: 'worker-A',
        files: ['implementation.js'],
          testCommands: [FAIL_CMD],
        now: () => 3_500,
        reason: 'environment missing',
      });

      const session = JSON.parse(fs.readFileSync(sessionFile(cwd), 'utf8'));
      const confirmed = session.items.find((entry) => entry.id === 'verify-begin');
      const failed = session.items.find((entry) => entry.id === 'verify-next');
      const pending = session.items.find((entry) => entry.id === 'verify-final');

      assert.equal(confirmed.status, 'confirmed');
      assert.equal(confirmed.evidence, 'verified manually');
      assert.equal(confirmed.test_commands[0].cwd, '.');
      assert.equal(failed.status, 'failed');
      assert.equal(failed.reason, 'environment missing');
      assert.equal(pending.status, 'pending');
      assert.deepEqual(confirmed.evidence_files.map((entry) => entry.path), ['implementation.js']);
      assert.match(confirmed.evidence_files[0].sha256, /^[a-f0-9]{64}$/);
    });
  });

  test('unknown ids throw explicit errors on confirm', () => {
    withTempDir((cwd) => {
      startSession({
        cwd,
        seedDocument: sampleDocument(),
        seedText: 'seed-contract-text',
      });

      assert.throws(() => {
        confirmItem({
          cwd,
          itemId: 'missing-id',
          owner: 'worker-A',
          files: ['implementation.js'],
          testCommands: [PASS_CMD],
          evidence: 'works',
        });
      }, /Unknown verification id/);
    });
  });

  test('invalid transitions are rejected', () => {
    withTempDir((cwd) => {
      startSession({
        cwd,
        seedDocument: sampleDocument(),
        seedText: 'seed-contract-text',
      });

      assert.throws(() => {
        confirmItem({
          cwd,
          itemId: 'verify-next',
          owner: 'worker-A',
          files: ['implementation.js'],
          testCommands: [PASS_CMD],
          evidence: 'works',
        });
      }, /Invalid transition/);
    });
  });

  test('getStatus returns totals, counts, completion and failed ids', () => {
    withTempDir((cwd) => {
      startSession({
        cwd,
        sessionId: 'default',
        seedDocument: sampleDocument(),
        seedText: 'seed-contract-text',
      });

      claimNext({ cwd, owner: 'worker-A', now: () => 1_000 });
      confirmItem({
        cwd,
        itemId: 'verify-begin',
        owner: 'worker-A',
        files: ['implementation.js'],
          testCommands: [PASS_CMD],
        now: () => 2_000,
        evidence: 'ok',
      });
      claimNext({ cwd, owner: 'worker-B', now: () => 3_000 });
      failItem({
        cwd,
        itemId: 'verify-next',
        owner: 'worker-B',
        files: ['implementation.js'],
          testCommands: [FAIL_CMD],
        now: () => 3_500,
        reason: 'not available',
      });

      const status = getStatus({ cwd, sessionId: 'default' });

      assert.equal(status.total, 3);
      assert.equal(status.verified, 2);
      assert.equal(status.passed, 1);
      assert.equal(status.confirmed, 1);
      assert.equal(status.failed, 1);
      assert.equal(status.pending, 1);
      assert.equal(status.claimed, 0);
      assert.equal(status.failedIds[0], 'verify-next');
      assert.equal(status.completed, false);
      assert.equal(status.satisfied, false);
      assert.equal(status.completion, 2 / 3);
    });
  });

  test('lock contention throws a clear lock failure', () => {
    withTempDir((cwd) => {
      startSession({
        cwd,
        seedDocument: sampleDocument(),
        seedText: 'seed-contract-text',
      });
      fs.mkdirSync(lockPath(cwd), { recursive: true });

      assert.throws(() => {
        claimNext({ cwd, owner: 'worker-A', lockWaitMs: 0 });
      }, /Could not acquire lock/);
    });
  });

  test('blocked and needs_review are valid stored statuses reported without transitions', () => {
    withTempDir((cwd) => {
      startSession({
        cwd,
        seedDocument: sampleDocument(),
        seedText: 'seed-contract-text',
      });
      const session = JSON.parse(fs.readFileSync(sessionFile(cwd), 'utf8'));
      session.items[0].status = 'blocked';
      session.items[1].status = 'needs_review';
      fs.writeFileSync(sessionFile(cwd), JSON.stringify(session, null, 2), 'utf8');

      const status = getStatus({ cwd });
      assert.equal(status.blocked, 1);
      assert.equal(status.needs_review, 1);
      assert.throws(() => {
        confirmItem({
          cwd,
          itemId: 'verify-begin',
          owner: 'worker-A',
          files: ['implementation.js'],
          testCommands: [PASS_CMD],
          evidence: 'not claimable',
        });
      }, /Invalid transition/);
    });
  });

  test('missing or invalid session schema fields are rejected as corrupt state', () => {
    const mutations = [
      (session) => { delete session.schemaVersion; },
      (session) => { session.schemaVersion = 2; },
      (session) => { delete session.seedHash; },
      (session) => { session.seedHash = 'not-a-sha256'; },
      (session) => { delete session.createdAt; },
      (session) => { session.updatedAt = 'yesterday'; },
    ];

    mutations.forEach((mutate) => {
      withTempDir((cwd) => {
        startSession({
          cwd,
          seedDocument: sampleDocument(),
          seedText: 'seed-contract-text',
        });
        const session = JSON.parse(fs.readFileSync(sessionFile(cwd), 'utf8'));
        mutate(session);
        fs.writeFileSync(sessionFile(cwd), JSON.stringify(session, null, 2), 'utf8');

        assert.throws(() => getStatus({ cwd }), /Corrupt session state/);
      });
    });
  });

  test('invalid claim timestamps are rejected as corrupt state', () => {
    withTempDir((cwd) => {
      startSession({
        cwd,
        seedDocument: sampleDocument(),
        seedText: 'seed-contract-text',
      });
      const session = JSON.parse(fs.readFileSync(sessionFile(cwd), 'utf8'));
      session.items[0].status = 'claimed';
      session.items[0].claim = {
        owner: 'worker-A',
        claimedAt: 2_000,
        leaseUntil: 1_000,
      };
      fs.writeFileSync(sessionFile(cwd), JSON.stringify(session, null, 2), 'utf8');

      assert.throws(() => getStatus({ cwd }), /claim metadata/);
    });
  });

  test('snapshot content that does not match the stored seed hash is rejected', () => {
    withTempDir((cwd) => {
      startSession({
        cwd,
        seedDocument: sampleDocument(),
        seedText: 'metadata:\n  name: original\n',
      });
      fs.writeFileSync(snapshotFile(cwd), 'metadata:\n  name: altered\n', 'utf8');

      assert.throws(() => getStatus({ cwd }), /seedHash does not match snapshot/);
    });
  });

  test('corrupt session JSON fails loudly', () => {
    withTempDir((cwd) => {
      startSession({
        cwd,
        seedDocument: sampleDocument(),
        seedText: 'seed-contract-text',
      });
      fs.writeFileSync(sessionFile(cwd), '{invalid-json', 'utf8');

      assert.throws(() => {
        getStatus({ cwd });
      }, /Failed to parse session state/);
    });
  });

  test('every export rejects session ids that are not safe local filenames', () => {
    withTempDir((cwd) => {
      const invalidSessionId = '../../seed-session-escape';
      const calls = [
        () => startSession({
          cwd,
          sessionId: invalidSessionId,
          seedDocument: sampleDocument(),
          seedText: 'seed-contract-text',
        }),
        () => claimNext({ cwd, sessionId: invalidSessionId, owner: 'worker-A' }),
        () => confirmItem({
          cwd,
          sessionId: invalidSessionId,
          itemId: 'verify-begin',
          owner: 'worker-A',
          files: ['implementation.js'],
          testCommands: [PASS_CMD],
          evidence: 'ok',
        }),
        () => failItem({
          cwd,
          sessionId: invalidSessionId,
          itemId: 'verify-begin',
          owner: 'worker-A',
          files: ['implementation.js'],
          testCommands: [FAIL_CMD],
          reason: 'failed',
        }),
        () => getStatus({ cwd, sessionId: invalidSessionId }),
      ];

      calls.forEach((call) => {
        assert.throws(call, /sessionId must be a safe repo-local filename/);
      });
      assert.equal(fs.existsSync(path.join(cwd, '.seed')), false);
    });
  });

  test('claimNext rejects an empty owner without persisting a claim', () => {
    withTempDir((cwd) => {
      startSession({
        cwd,
        seedDocument: sampleDocument(),
        seedText: 'seed-contract-text',
      });

      ['', '   '].forEach((owner) => {
        assert.throws(() => {
          claimNext({ cwd, owner });
        }, /owner must be a non-empty string/);
      });

      const session = JSON.parse(fs.readFileSync(sessionFile(cwd), 'utf8'));
      assert.equal(session.items.every((entry) => entry.status === 'pending'), true);
    });
  });

  test('confirmItem and failItem require the exact claim owner', () => {
    withTempDir((cwd) => {
      startSession({
        cwd,
        seedDocument: sampleDocument(),
        seedText: 'seed-contract-text',
      });
      claimNext({ cwd, owner: 'worker-A', now: () => 1_000 });

      assert.throws(() => {
        confirmItem({
          cwd,
          itemId: 'verify-begin',
          evidence: 'ok',
          now: () => 2_000,
        });
      }, /owner must be a non-empty string/);
      assert.throws(() => {
        confirmItem({
          cwd,
          itemId: 'verify-begin',
          owner: 'worker-B',
          files: ['implementation.js'],
          testCommands: [PASS_CMD],
          evidence: 'ok',
          now: () => 2_000,
        });
      }, /Invalid owner/);
      assert.throws(() => {
        failItem({
          cwd,
          itemId: 'verify-begin',
          reason: 'failed',
          now: () => 2_000,
        });
      }, /owner must be a non-empty string/);
      assert.throws(() => {
        failItem({
          cwd,
          itemId: 'verify-begin',
          owner: 'worker-B',
          files: ['implementation.js'],
          testCommands: [FAIL_CMD],
          reason: 'failed',
          now: () => 2_000,
        });
      }, /Invalid owner/);

      const session = JSON.parse(fs.readFileSync(sessionFile(cwd), 'utf8'));
      assert.equal(session.items[0].status, 'claimed');
      assert.equal(session.items[0].claim.owner, 'worker-A');
    });
  });

  test('duplicate item ids are rejected as corrupt session state', () => {
    withTempDir((cwd) => {
      startSession({
        cwd,
        seedDocument: sampleDocument(),
        seedText: 'seed-contract-text',
      });
      const session = JSON.parse(fs.readFileSync(sessionFile(cwd), 'utf8'));
      session.items[1].id = session.items[0].id;
      fs.writeFileSync(sessionFile(cwd), JSON.stringify(session, null, 2), 'utf8');

      assert.throws(() => {
        getStatus({ cwd });
      }, /duplicate item id/);
    });
  });

  test('legacy absolute snapshot paths are accepted and normalized in memory', () => {
    withTempDir((cwd) => {
      startSession({
        cwd,
        sessionId: 'default',
        seedDocument: sampleDocument(),
        seedText: 'seed-contract-text',
      });
      const session = JSON.parse(fs.readFileSync(sessionFile(cwd), 'utf8'));
      session.snapshotPath = snapshotFile(cwd);
      session.items[0].status = 'confirmed';
      session.items[0].test_commands = [{ command: PASS_CMD, cwd }];
      fs.writeFileSync(sessionFile(cwd), JSON.stringify(session, null, 2), 'utf8');

      assert.doesNotThrow(() => getStatus({ cwd }));
      claimNext({ cwd, owner: 'worker-A', now: () => 1_000 });

      const normalized = JSON.parse(fs.readFileSync(sessionFile(cwd), 'utf8'));
      assert.equal(normalized.snapshotPath, '.seed/seed.snapshot.yml');
      assert.equal(normalized.items[0].test_commands[0].cwd, '.');
    });
  });

  test('session id and filename mismatch is rejected as corrupt state', () => {
    withTempDir((cwd) => {
      startSession({
        cwd,
        sessionId: 'expected-session',
        seedDocument: sampleDocument(),
        seedText: 'seed-contract-text',
      });
      const session = JSON.parse(fs.readFileSync(sessionFile(cwd, 'expected-session'), 'utf8'));
      session.sessionId = 'different-session';
      fs.writeFileSync(
        sessionFile(cwd, 'expected-session'),
        JSON.stringify(session, null, 2),
        'utf8',
      );

      assert.throws(() => {
        getStatus({ cwd, sessionId: 'expected-session' });
      }, /does not match requested sessionId/);
    });
  });

  test('confirmItem accepts omitted evidence and stores null', () => {
    withTempDir((cwd) => {
      startSession({
        cwd,
        seedDocument: sampleDocument(),
        seedText: 'seed-contract-text',
      });

      claimNext({ cwd, owner: 'worker-A', now: () => 1_000 });
      confirmItem({
        cwd,
        itemId: 'verify-begin',
        owner: 'worker-A',
        files: ['implementation.js'],
          testCommands: [PASS_CMD],
        now: () => 2_000,
      });

      const session = JSON.parse(fs.readFileSync(sessionFile(cwd), 'utf8'));
      const confirmed = session.items.find((entry) => entry.id === 'verify-begin');
      assert.equal(confirmed.evidence, null);
      assert.equal(confirmed.reason, null);
    });
  });

  test('failItem accepts omitted reason and stores null', () => {
    withTempDir((cwd) => {
      startSession({
        cwd,
        seedDocument: sampleDocument(),
        seedText: 'seed-contract-text',
      });

      claimNext({ cwd, owner: 'worker-A', now: () => 1_000 });
      failItem({
        cwd,
        itemId: 'verify-begin',
        owner: 'worker-A',
        files: ['implementation.js'],
          testCommands: [FAIL_CMD],
        now: () => 2_000,
      });

      const session = JSON.parse(fs.readFileSync(sessionFile(cwd), 'utf8'));
      const failed = session.items.find((entry) => entry.id === 'verify-begin');
      assert.equal(failed.reason, null);
      assert.equal(failed.evidence, null);
    });
  });

  test('syncSession promotes the current Seed snapshot after a satisfied session', () => {
    withTempDir((cwd) => {
      fs.mkdirSync(path.join(cwd, 'seed'), { recursive: true });
      const seedText = [
        'verifications:',
        '  - id: verify-begin',
        '    title: first verification',
        '    description: confirm the first behavior',
        '    method: manual review',
        '    evidence_required:',
        '      - manual-check',
        '  - id: verify-next',
        '    title: second verification',
        '    description: confirm second behavior',
        '    method: manual review',
        '    evidence_required:',
        '      - manual-check',
        '  - id: verify-final',
        '    title: third verification',
        '    description: confirm third behavior',
        '    method: manual review',
        '    evidence_required:',
        '      - manual-check',
        '',
      ].join('\n');
      fs.writeFileSync(path.join(cwd, 'seed', 'seed.yml'), seedText, 'utf8');
      startSession({
        cwd,
        seedDocument: sampleDocument(),
        seedText,
      });

      ['verify-begin', 'verify-next', 'verify-final'].forEach((id, index) => {
        claimNext({ cwd, owner: 'worker-A', now: () => 1_000 + index });
        confirmItem({
          cwd,
          itemId: id,
          owner: 'worker-A',
          files: ['implementation.js'],
          testCommands: [PASS_CMD],
          evidence: id,
          now: () => 2_000 + index,
        });
      });

      const synced = syncSession({ cwd, now: () => 3_000 });
      const status = getStatus({ cwd });

      assert.equal(synced.synced, true);
      assert.equal(synced.preserved, 3);
      assert.equal(synced.pending, 0);
      assert.equal(status.satisfied, true);
      assert.equal(status.expired, 0);
    });
  });

  test('confirmItem and failItem require evidence files', () => {
    withTempDir((cwd) => {
      startSession({
        cwd,
        seedDocument: sampleDocument(),
        seedText: 'seed-contract-text',
      });

      claimNext({ cwd, owner: 'worker-A', now: () => 1_000 });
      assert.throws(() => {
        confirmItem({
          cwd,
          itemId: 'verify-begin',
          owner: 'worker-A',
          evidence: 'ok',
          now: () => 1_500,
        });
      }, /at least one evidence file path is required/);
    });
  });

  test('status reports expired evidence and next reclaims expired items', () => {
    withTempDir((cwd) => {
      startSession({
        cwd,
        seedDocument: sampleDocument(),
        seedText: 'seed-contract-text',
      });

      claimNext({ cwd, owner: 'worker-A', now: () => 1_000 });
      confirmItem({
        cwd,
        itemId: 'verify-begin',
        owner: 'worker-A',
        files: ['implementation.js'],
          testCommands: [PASS_CMD],
        evidence: 'ok',
        now: () => 2_000,
      });
      fs.writeFileSync(path.join(cwd, 'implementation.js'), 'changed\n', 'utf8');

      const status = getStatus({ cwd });
      assert.equal(status.expired, 1);
      assert.deepEqual(status.expiredIds, ['verify-begin']);
      assert.equal(status.expiredEvidence[0].files[0].status, 'modified');
      assert.equal(status.satisfied, false);

      const next = claimNext({ cwd, owner: 'worker-B', now: () => 3_000 });
      assert.equal(next.item.id, 'verify-next');

      const finalPending = claimNext({ cwd, owner: 'worker-B', now: () => 4_000 });
      assert.equal(finalPending.item.id, 'verify-final');

      const expiredNext = claimNext({ cwd, owner: 'worker-B', now: () => 5_000 });
      assert.equal(expiredNext.item.id, 'verify-begin');
    });
  });
  test('modified Seed addresses expire verified items that reference them', () => {
    withTempDir((cwd) => {
      fs.mkdirSync(path.join(cwd, 'seed'), { recursive: true });
      const seedPath = path.join(cwd, 'seed', 'seed.yml');
      const seedText = [
        'behavior:',
        '  counts: Count every character exactly.',
        'verifications:',
        '  - id: manual-counts',
        '    title: Manual counts',
        '    description: Verify @behavior.counts manually.',
        '    method: Inspect implementation.',
        '    evidence_required:',
        '      - Manual evidence.',
        '',
      ].join('\n');
      fs.writeFileSync(seedPath, seedText, 'utf8');
      startSession({
        cwd,
        seedDocument: parse(seedText),
        seedText,
      });

      claimNext({ cwd, owner: 'worker-A', now: () => 1_000 });
      confirmItem({
        cwd,
        itemId: 'manual-counts',
        owner: 'worker-A',
        files: ['implementation.js'],
          testCommands: [PASS_CMD],
        evidence: 'ok',
        now: () => 2_000,
      });
      claimNext({ cwd, owner: 'worker-A', now: () => 3_000 });
      confirmItem({
        cwd,
        itemId: 'implicit-behavior-counts',
        owner: 'worker-A',
        files: ['implementation.js'],
          testCommands: [PASS_CMD],
        evidence: 'ok',
        now: () => 4_000,
      });

      fs.writeFileSync(seedPath, seedText.replace('Count every character exactly.', 'Count every printable character exactly.'), 'utf8');

      const status = getStatus({ cwd });
      assert.equal(status.expired, 2);
      assert.deepEqual(status.expiredIds, ['manual-counts', 'implicit-behavior-counts']);
      assert.deepEqual(status.expiredEvidence.map((entry) => entry.kind), ['seed-address', 'seed-address']);
      assert.deepEqual(status.expiredEvidence[0].modifiedAddresses, ['behavior.counts']);
      assert.deepEqual(status.modifiedSeedAddresses, ['behavior.counts']);
      assert.equal(status.verified, 0);
      assert.equal(status.pending, 2);
      assert.equal(status.completed, false);
      assert.equal(status.satisfied, false);

      const pending = getPendingItems({ cwd });
      assert.deepEqual(pending.map((entry) => entry.id), ['manual-counts', 'implicit-behavior-counts']);
      assert.equal(pending.every((entry) => entry.status === 'expired'), true);
      assert.equal(pending[0].previousStatus, 'confirmed');

      const next = claimNext({ cwd, owner: 'worker-B', now: () => 5_000 });
      assert.equal(next.item.id, 'manual-counts');
      confirmItem({
        cwd,
        itemId: 'manual-counts',
        owner: 'worker-B',
        files: ['implementation.js'],
          testCommands: [PASS_CMD],
        evidence: 'ok after Seed change',
        now: () => 6_000,
      });

      const implicitNext = claimNext({ cwd, owner: 'worker-B', now: () => 7_000 });
      assert.equal(implicitNext.item.id, 'implicit-behavior-counts');
      confirmItem({
        cwd,
        itemId: 'implicit-behavior-counts',
        owner: 'worker-B',
        files: ['implementation.js'],
          testCommands: [PASS_CMD],
        evidence: 'implicit ok after Seed change',
        now: () => 8_000,
      });

      const reverified = getStatus({ cwd });
      assert.equal(reverified.expired, 0);
      assert.equal(reverified.completed, true);
      assert.equal(reverified.satisfied, true);
      assert.deepEqual(reverified.modifiedSeedAddresses, ['behavior.counts']);

      const synced = syncSession({ cwd, now: () => 9_000 });
      const syncedStatus = getStatus({ cwd });
      assert.equal(synced.synced, true);
      assert.equal(synced.preserved, 2);
      assert.equal(synced.pending, 0);
      assert.equal(syncedStatus.satisfied, true);
      assert.equal(syncedStatus.expired, 0);
      assert.deepEqual(syncedStatus.modifiedSeedAddresses, []);
    });
  });

  test('legacy terminal evidence without test commands expires and check reruns stored commands', () => {
    withTempDir((cwd) => {
      startSession({
        cwd,
        seedDocument: sampleDocument(),
        seedText: 'seed-contract-text',
      });

      const session = JSON.parse(fs.readFileSync(sessionFile(cwd), 'utf8'));
      session.items[0].status = 'confirmed';
      session.items[0].evidence_files = [{ path: 'implementation.js', sha256: testFileHash(fs.readFileSync(path.join(cwd, 'implementation.js'))) }];
      session.items[1].status = 'confirmed';
      session.items[1].evidence_files = [{ path: 'implementation.js', sha256: testFileHash(fs.readFileSync(path.join(cwd, 'implementation.js'))) }];
      session.items[1].test_commands = [{ command: PASS_CMD }];
      fs.writeFileSync(sessionFile(cwd), JSON.stringify(session, null, 2), 'utf8');

      const status = getStatus({ cwd });
      assert.equal(status.expired, 1);
      assert.deepEqual(status.expiredIds, ['verify-begin']);
      assert.equal(status.expiredEvidence[0].missingTestCommands, true);

      const check = checkSession({ cwd });
      assert.equal(check.total, 2);
      assert.equal(check.passed, 1);
      assert.equal(check.failed, 1);
      assert.equal(check.ok, false);
      assert.equal(check.items[0].error, 'missing test commands');
      assert.equal(check.items[1].commands[0].passed, true);
    });
  });

  test('verificationReport returns status, audit, and per-item evidence details', () => {
    withTempDir((cwd) => {
      startSession({
        cwd,
        seedDocument: sampleDocument(),
        seedText: 'seed-contract-text',
      });

      claimNext({ cwd, owner: 'worker-A', now: () => 1_000 });
      confirmItem({
        cwd,
        itemId: 'verify-begin',
        owner: 'worker-A',
        files: ['implementation.js'],
        testCommands: [passCommand('verify-begin')],
        evidence: 'verify-begin checked with item-specific command',
        now: () => 1_500,
      });

      const report = verificationReport({ cwd });
      assert.equal(report.sessionId, 'default');
      assert.equal(report.status.total, 3);
      assert.equal(report.status.verified, 1);
      assert.equal(report.audit.ok, false);
      assert.equal(report.items.length, 3);

      const first = report.items.find((item) => item.id === 'verify-begin');
      assert.equal(first.status, 'confirmed');
      assert.equal(first.evidence_files[0].path, 'implementation.js');
      assert.equal(first.test_commands[0].command, passCommand('verify-begin'));
      assert.deepEqual(first.references.unresolved, ['sample-input']);
    });
  });

  test('verificationAudit passes complete executable evidence and flags missing command evidence', () => {
    withTempDir((cwd) => {
      startSession({
        cwd,
        seedDocument: sampleDocument(),
        seedText: 'seed-contract-text',
      });

      ['verify-begin', 'verify-next', 'verify-final'].forEach((id, index) => {
        claimNext({ cwd, owner: 'worker-A', now: () => 1_000 + index * 1_000 });
        confirmItem({
          cwd,
          itemId: id,
          owner: 'worker-A',
          files: ['implementation.js'],
          testCommands: [passCommand(id)],
          evidence: id + ' checked with item-specific command',
          now: () => 1_500 + index * 1_000,
        });
      });

      const audit = verificationAudit({ cwd });
      assert.equal(audit.ok, true);
      assert.equal(audit.errors.length, 0);
      assert.equal(audit.audited, 3);
      assert.equal(audit.total, 3);

      const session = JSON.parse(fs.readFileSync(sessionFile(cwd), 'utf8'));
      delete session.items[0].test_commands;
      fs.writeFileSync(sessionFile(cwd), JSON.stringify(session, null, 2), 'utf8');

      const failedAudit = verificationAudit({ cwd });
      assert.equal(failedAudit.ok, false);
      assert.ok(failedAudit.errors.some((issue) => issue.code === 'expired-evidence'));
      assert.ok(failedAudit.errors.some((issue) => issue.code === 'missing-test-commands'));
    });
  });

  test('failItem and confirmItem reject non-string evidence/reason values', () => {
    withTempDir((cwd) => {
      startSession({
        cwd,
        seedDocument: sampleDocument(),
        seedText: 'seed-contract-text',
      });

      claimNext({ cwd, owner: 'worker-A', now: () => 1_000 });
      assert.throws(() => {
        confirmItem({
          cwd,
          itemId: 'verify-begin',
          owner: 'worker-A',
          files: ['implementation.js'],
          testCommands: [PASS_CMD],
          evidence: 12,
          now: () => 1_500,
        });
      }, /confirmItem requires evidence/);

      claimNext({ cwd, owner: 'worker-A', now: () => 2_000 });
      assert.throws(() => {
        failItem({
          cwd,
          itemId: 'verify-next',
          owner: 'worker-A',
          files: ['implementation.js'],
          testCommands: [FAIL_CMD],
          reason: 12,
          now: () => 2_500,
        });
      }, /failItem requires reason/);
    });
  });
});
