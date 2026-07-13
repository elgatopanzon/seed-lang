const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { test, describe } = require('node:test');

const {
  claimNext,
  confirmItem,
  failItem,
  getStatus,
  startSession,
} = require('../src/verification-store');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'seed-verification-store-test-'));
}

function withTempDir(run) {
  const cwd = tempDir();
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
        evidenceGuidance: ['manual-check'],
      },
      {
        id: 'verify-next',
        title: 'second verification',
        description: 'confirm second behavior',
        method: 'manual review',
        evidenceGuidance: ['manual-check'],
      },
      {
        id: 'verify-final',
        title: 'third verification',
        description: 'confirm third behavior',
        method: 'manual review',
        evidenceGuidance: ['manual-check'],
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
      assert.deepEqual(
        session.items.map((entry) => entry.id),
        ['verify-begin', 'verify-next', 'verify-final'],
      );
      assert.equal(session.items.every((entry) => entry.status === 'pending'), true);
      assert.equal(session.items[0].title, 'first verification');
      assert.equal(session.items[0].description, 'confirm the first behavior');
      assert.equal(session.items[0].address, 'verifications.verify-begin');
      assert.deepEqual(session.items[0].artifacts, ['sample-input']);
      assert.deepEqual(session.items[0].evidenceGuidance, ['manual-check']);
      return true;
    });

    assert.equal(result, true);
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
        now: () => 2_000,
        evidence: 'verified manually',
      });

      claimNext({ cwd, owner: 'worker-A', now: () => 3_000 });
      failItem({
        cwd,
        itemId: 'verify-next',
        owner: 'worker-A',
        now: () => 3_500,
        reason: 'environment missing',
      });

      const session = JSON.parse(fs.readFileSync(sessionFile(cwd), 'utf8'));
      const confirmed = session.items.find((entry) => entry.id === 'verify-begin');
      const failed = session.items.find((entry) => entry.id === 'verify-next');
      const pending = session.items.find((entry) => entry.id === 'verify-final');

      assert.equal(confirmed.status, 'confirmed');
      assert.equal(confirmed.evidence, 'verified manually');
      assert.equal(failed.status, 'failed');
      assert.equal(failed.reason, 'environment missing');
      assert.equal(pending.status, 'pending');
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
        now: () => 2_000,
        evidence: 'ok',
      });
      claimNext({ cwd, owner: 'worker-B', now: () => 3_000 });
      failItem({
        cwd,
        itemId: 'verify-next',
        owner: 'worker-B',
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
        claimNext({ cwd, owner: 'worker-A' });
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
          evidence: 'ok',
        }),
        () => failItem({
          cwd,
          sessionId: invalidSessionId,
          itemId: 'verify-begin',
          owner: 'worker-A',
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
        now: () => 2_000,
      });

      const session = JSON.parse(fs.readFileSync(sessionFile(cwd), 'utf8'));
      const failed = session.items.find((entry) => entry.id === 'verify-begin');
      assert.equal(failed.reason, null);
      assert.equal(failed.evidence, null);
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
          reason: 12,
          now: () => 2_500,
        });
      }, /failItem requires reason/);
    });
  });
});
