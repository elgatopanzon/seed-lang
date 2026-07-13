const {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  renameSync,
  writeFileSync,
} = require('node:fs');
const { createHash } = require('node:crypto');
const { dirname, join, resolve } = require('node:path');
const { normalizeAddressableSection } = require('./validation');

const REFERENCE_PATTERN = /@([A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)*)/g;
const IMPLICIT_VERIFICATION_SECTIONS = [
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
];

const DEFAULT_SESSION_ID = 'default';
const DEFAULT_LEASE_MS = 60_000;
const SESSION_SCHEMA_VERSION = 1;
const VALID_STATUSES = [
  'pending',
  'claimed',
  'confirmed',
  'failed',
  'blocked',
  'needs_review',
];
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

function assertSessionId(sessionId) {
  if (typeof sessionId !== 'string' || !SAFE_SESSION_ID.test(sessionId)) {
    throw new Error('sessionId must be a safe repo-local filename using letters, numbers, underscores, or hyphens.');
  }
}

function assertOwner(owner) {
  if (typeof owner !== 'string' || owner.trim().length === 0) {
    throw new Error('owner must be a non-empty string.');
  }
}

function workspaceRoot(cwd) {
  return resolve(cwd ?? process.cwd());
}

function seedRootPath(cwd) {
  return join(workspaceRoot(cwd), '.seed');
}

function snapshotPath(cwd) {
  return join(seedRootPath(cwd), 'seed.snapshot.yml');
}

function sessionsDir(cwd) {
  return join(seedRootPath(cwd), 'sessions');
}

function locksDir(cwd) {
  return join(seedRootPath(cwd), 'locks');
}

function sessionPath(cwd, sessionId) {
  return join(sessionsDir(cwd), `${sessionId}.json`);
}

function lockPath(cwd, sessionId) {
  return join(locksDir(cwd), `${sessionId}.lock`);
}

function ensureStateDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}

function readJsonFile(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} missing at ${path}.`);
  }

  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to parse ${label} at ${path}: ${error.message}`);
  }
}

function writeJsonAtomically(path, payload) {
  ensureStateDir(path);
  const tmp = `${path}.${Date.now()}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  renameSync(tmp, path);
}

function withLock(path, action) {
  let locked = false;
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch (error) {
    throw new Error(`Failed to prepare lock directory for ${path}: ${error.message}`);
  }

  try {
    mkdirSync(path);
    locked = true;
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`Could not acquire lock at ${path}. Another process holds the session lock.`);
    }
    throw new Error(`Failed to acquire lock at ${path}: ${error.message}`);
  }

  try {
    return action();
  } catch (error) {
    throw error;
  } finally {
    if (locked) {
      rmSync(path, { recursive: true, force: true });
    }
  }
}

function resolveNow(now) {
  const nowValue = now?.() ?? Date.now();
  if (typeof nowValue !== 'number' || !Number.isFinite(nowValue)) {
    throw new Error('now() must return a finite number.');
  }
  return nowValue;
}

function isClaimObject(value) {
  return value
    && typeof value === 'object'
    && typeof value.owner === 'string'
    && value.owner.trim().length > 0
    && typeof value.claimedAt === 'number'
    && Number.isFinite(value.claimedAt)
    && typeof value.leaseUntil === 'number'
    && Number.isFinite(value.leaseUntil)
    && value.leaseUntil >= value.claimedAt;
}

function assertFiniteTimestamp(value, field, sourcePath) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Corrupt session state at ${sourcePath}: ${field} must be a finite timestamp.`);
  }
}

function seedHash(seedText) {
  return createHash('sha256').update(seedText, 'utf8').digest('hex');
}

function assertSessionShape(session, sourcePath, expectedSessionId, expectedSnapshotPath) {
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    throw new Error(`Corrupt session state at ${sourcePath}: expected object.`);
  }

  if (typeof session.sessionId !== 'string' || !session.sessionId) {
    throw new Error(`Corrupt session state at ${sourcePath}: sessionId must be a non-empty string.`);
  }

  if (session.sessionId !== expectedSessionId) {
    throw new Error(
      `Corrupt session state at ${sourcePath}: stored sessionId ${session.sessionId} does not match requested sessionId ${expectedSessionId}.`,
    );
  }

  if (session.schemaVersion !== SESSION_SCHEMA_VERSION) {
    throw new Error(
      `Corrupt session state at ${sourcePath}: unsupported schemaVersion ${session.schemaVersion}.`,
    );
  }

  if (typeof session.seedHash !== 'string' || !SHA256_HEX.test(session.seedHash)) {
    throw new Error(`Corrupt session state at ${sourcePath}: seedHash must be a SHA-256 hex digest.`);
  }

  assertFiniteTimestamp(session.createdAt, 'createdAt', sourcePath);
  assertFiniteTimestamp(session.updatedAt, 'updatedAt', sourcePath);

  if (session.snapshotPath !== expectedSnapshotPath) {
    throw new Error(`Corrupt session state at ${sourcePath}: snapshotPath does not match repo-local snapshot.`);
  }

  if (!Array.isArray(session.items)) {
    throw new Error(`Corrupt session state at ${sourcePath}: items must be an array.`);
  }

  const itemIds = new Set();
  session.items.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Corrupt session state at ${sourcePath}: item ${index} is not an object.`);
    }

    if (typeof entry.id !== 'string' || !entry.id) {
      throw new Error(`Corrupt session state at ${sourcePath}: item ${index} missing id.`);
    }

    if (itemIds.has(entry.id)) {
      throw new Error(`Corrupt session state at ${sourcePath}: duplicate item id ${entry.id}.`);
    }
    itemIds.add(entry.id);

    if (!VALID_STATUSES.includes(entry.status)) {
      throw new Error(`Corrupt session state at ${sourcePath}: item ${entry.id} has invalid status ${entry.status}.`);
    }

    if (entry.status === 'claimed' && !isClaimObject(entry.claim)) {
      throw new Error(`Corrupt session state at ${sourcePath}: item ${entry.id} is claimed without valid claim metadata.`);
    }

    if (entry.status !== 'claimed' && entry.claim != null) {
      throw new Error(`Corrupt session state at ${sourcePath}: item ${entry.id} has claim metadata without claimed status.`);
    }
  });
}

function normalizedVerifications(seedDocument) {
  const errors = [];
  const items = normalizeAddressableSection('verifications', seedDocument.verifications, errors);

  if (errors.length > 0) {
    throw new Error(`startSession requires valid verifications: ${errors.map((entry) => entry.message).join('; ')}`);
  }

  return items;
}

function normalizedImplicitTargets(seedDocument) {
  const items = [];

  IMPLICIT_VERIFICATION_SECTIONS.forEach((section) => {
    if (seedDocument[section] === undefined) {
      return;
    }

    const errors = [];
    const normalized = normalizeAddressableSection(section, seedDocument[section], errors, { allowEmpty: section === 'errors' });
    if (errors.length > 0) {
      throw new Error(`startSession requires valid ${section}: ${errors.map((entry) => entry.message).join('; ')}`);
    }

    items.push(...normalized);
  });

  return items;
}

function implicitIdForAddress(address) {
  return `implicit-${address.replace(/\./g, '-')}`;
}

function collectMentionedArtifacts(value) {
  const refs = new Set();
  const visit = (entry) => {
    if (typeof entry === 'string') {
      for (const match of entry.matchAll(REFERENCE_PATTERN)) {
        refs.add(match[1]);
      }
      return;
    }

    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }

    if (entry && typeof entry === 'object') {
      Object.values(entry).forEach(visit);
    }
  };

  visit(value);
  return [...refs];
}

function buildManualSessionItems(seedDocument) {
  return normalizedVerifications(seedDocument).map((verification) => {
    const id = verification.address.replace(/^verifications\./, '');
    return {
      id,
      source: 'manual',
      address: verification.address,
      status: 'pending',
      claim: null,
      title: verification.value.title ?? null,
      description: verification.value.description ?? null,
      artifacts: structuredClone(verification.value.artifacts ?? []),
      evidence_required: structuredClone(verification.value.evidence_required),
      attempts: 0,
      evidence: null,
      reason: null,
    };
  });
}

function declaredArtifactIds(seedDocument) {
  if (seedDocument.artifacts === undefined) {
    return new Set();
  }

  const errors = [];
  const artifacts = normalizeAddressableSection('artifacts', seedDocument.artifacts, errors);
  if (errors.length > 0) {
    return new Set();
  }

  return new Set(artifacts.flatMap((artifact) => [artifact.id, artifact.address]));
}

function buildImplicitSessionItems(seedDocument) {
  const declaredArtifacts = declaredArtifactIds(seedDocument);

  return normalizedImplicitTargets(seedDocument).map((target) => {
    const artifacts = new Set((target.value.artifacts ?? []).filter((artifactId) => declaredArtifacts.has(artifactId)));
    collectMentionedArtifacts(target.value)
      .filter((artifactId) => declaredArtifacts.has(artifactId))
      .forEach((artifactId) => artifacts.add(artifactId));

    return {
      id: implicitIdForAddress(target.address),
      source: 'implicit',
      address: target.address,
      status: 'pending',
      claim: null,
      title: `Implicit verification for ${target.address}`,
      description: `Verify @${target.address} is satisfied.`,
      artifacts: [...artifacts],
      evidence_required: [
        'Verification approach used.',
        `Relevant command output, code path, or inspection notes for @${target.address}.`,
        `Pass/fail reason tied to @${target.address}.`,
      ],
      attempts: 0,
      evidence: null,
      reason: null,
    };
  });
}

function assertUniqueSessionItems(items) {
  const ids = new Set();
  items.forEach((item) => {
    if (ids.has(item.id)) {
      throw new Error(`startSession requires all verification item ids to be unique. Duplicate id found: ${item.id}`);
    }
    ids.add(item.id);
  });
}

function assertSeedDocument(seedDocument) {
  if (!seedDocument || typeof seedDocument !== 'object' || Array.isArray(seedDocument)) {
    throw new Error('startSession requires seed document object.');
  }

  const verifications = normalizedVerifications(seedDocument);
  const ids = new Set();

  verifications.forEach((entry) => {
    const id = entry.address.replace(/^verifications\./, '');
    if (ids.has(id)) {
      throw new Error(`startSession requires all verification ids to be unique. Duplicate id found: ${id}`);
    }
    ids.add(id);
  });
}

function readSessionState(cwd, sessionId, sourceLabel) {
  const state = readJsonFile(sessionPath(cwd, sessionId), sourceLabel);
  const sourceSnapshotPath = snapshotPath(cwd);
  assertSessionShape(state, sourceLabel, sessionId, sourceSnapshotPath);

  if (!existsSync(sourceSnapshotPath)) {
    throw new Error(`Snapshot missing at ${sourceSnapshotPath}.`);
  }

  const snapshotText = readFileSync(sourceSnapshotPath, 'utf8');
  if (seedHash(snapshotText) !== state.seedHash) {
    throw new Error(`Corrupt session state at ${sourceLabel}: seedHash does not match snapshot.`);
  }
  return state;
}

function normalizeNow(now) {
  const value = resolveNow(now);
  return value;
}

function buildSessionItems(seedDocument) {
  const items = [
    ...buildManualSessionItems(seedDocument),
    ...buildImplicitSessionItems(seedDocument),
  ];
  assertUniqueSessionItems(items);
  return items;
}

function isClaimStale(claim, now) {
  return claim.leaseUntil <= now;
}

function recoverStaleClaims(items, now) {
  const recovered = [];
  let changed = false;

  items.forEach((item) => {
    if (item.status !== 'claimed') {
      return;
    }

    if (!isClaimObject(item.claim)) {
      throw new Error(`Corrupt session state: claimed item ${item.id} lacks valid claim metadata.`);
    }

    if (!isClaimStale(item.claim, now)) {
      return;
    }

    item.status = 'pending';
    item.claim = null;
    item.attempts = Math.max(0, item.attempts ?? 0);
    recovered.push(item.id);
    changed = true;
  });

  return { changed, recovered };
}

function nextPendingItem(items) {
  return items.find((item) => item.status === 'pending');
}

function itemSummary(item) {
  return {
    id: item.id,
    source: item.source ?? null,
    address: item.address ?? null,
    title: item.title ?? null,
    description: item.description ?? null,
    artifacts: item.artifacts ?? [],
    evidence_required: item.evidence_required,
    status: item.status,
  };
}

function startSession({
  cwd,
  sessionId = DEFAULT_SESSION_ID,
  seedDocument,
  seedText,
  now,
} = {}) {
  assertSessionId(sessionId);

  if (typeof seedText !== 'string') {
    throw new Error('startSession requires seedText string.');
  }

  assertSeedDocument(seedDocument);

  const nowValue = normalizeNow(now);
  const root = seedRootPath(cwd);
  const items = buildSessionItems(seedDocument);
  const sourceSnapshotPath = snapshotPath(cwd);

  const session = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId,
    seedHash: seedHash(seedText),
    createdAt: nowValue,
    updatedAt: nowValue,
    snapshotPath: sourceSnapshotPath,
    items,
  };

  withLock(lockPath(cwd, sessionId), () => {
    ensureStateDir(sourceSnapshotPath);
    writeFileSync(sourceSnapshotPath, seedText, 'utf8');
    writeJsonAtomically(sessionPath(cwd, sessionId), session);
  });

  return { rootPath: root, session };
}

function claimNext({
  cwd,
  sessionId = DEFAULT_SESSION_ID,
  owner = `seed-${Date.now()}`,
  leaseMs = DEFAULT_LEASE_MS,
  now,
} = {}) {
  assertSessionId(sessionId);
  assertOwner(owner);

  if (typeof leaseMs !== 'number' || !Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new Error('claimNext requires leaseMs to be a positive number.');
  }

  const nowValue = normalizeNow(now);
  const path = sessionPath(cwd, sessionId);
  const label = `session state ${path}`;
  const lock = lockPath(cwd, sessionId);

  return withLock(lock, () => {
    const state = readSessionState(cwd, sessionId, label);
    const recovered = recoverStaleClaims(state.items, nowValue);

    const next = nextPendingItem(state.items);
    if (next) {
      next.status = 'claimed';
      next.claim = {
        owner,
        claimedAt: nowValue,
        leaseUntil: nowValue + leaseMs,
      };
      next.attempts = (next.attempts ?? 0) + 1;
      state.updatedAt = nowValue;
    } else {
      state.updatedAt = nowValue;
    }

    writeJsonAtomically(path, state);

    return {
      item: next ? itemSummary(next) : null,
      claim: next ? next.claim : null,
      recoveredIds: recovered.recovered,
      warnings: recovered.recovered.length
        ? [{ code: 'recovered-stale-lease', ids: recovered.recovered }]
        : [],
    };
  });
}

function transitionItem({
  cwd,
  sessionId = DEFAULT_SESSION_ID,
  itemId,
  owner,
  now,
  targetStatus,
  evidence,
  reason,
}) {
  assertSessionId(sessionId);
  assertOwner(owner);

  if (typeof itemId !== 'string' || !itemId) {
    throw new Error('expected itemId string.');
  }

  const nowValue = normalizeNow(now);
  const path = sessionPath(cwd, sessionId);
  const label = `session state ${path}`;
  const lock = lockPath(cwd, sessionId);

  return withLock(lock, () => {
    const state = readSessionState(cwd, sessionId, label);
    const item = state.items.find((entry) => entry.id === itemId);

    if (!item) {
      throw new Error(`Unknown verification id ${itemId} in session ${sessionId}.`);
    }

    if (item.status !== 'claimed') {
      throw new Error(`Invalid transition for item ${itemId}: expected claimed, found ${item.status}.`);
    }

    if (isClaimStale(item.claim, nowValue)) {
      item.status = 'pending';
      item.claim = null;
      writeJsonAtomically(path, state);
      throw new Error(`Invalid transition for item ${itemId}: claim lease expired and was recovered.`);
    }

    if (item.claim.owner !== owner) {
      throw new Error(`Invalid owner for item ${itemId}: expected ${item.claim.owner}, received ${owner}.`);
    }

    if (targetStatus === 'confirmed') {
      if (evidence !== undefined && typeof evidence !== 'string') {
        throw new Error(`confirmItem requires evidence to be a string for item ${itemId}.`);
      }
      item.evidence = evidence === undefined ? null : evidence;
      item.reason = null;
    } else if (targetStatus === 'failed') {
      if (reason !== undefined && typeof reason !== 'string') {
        throw new Error(`failItem requires reason to be a string for item ${itemId}.`);
      }
      item.reason = reason === undefined ? null : reason;
      item.evidence = null;
    } else {
      throw new Error(`Unknown transition status ${targetStatus}.`);
    }

    item.status = targetStatus;
    item.claim = null;
    state.updatedAt = nowValue;

    writeJsonAtomically(path, state);
    return itemSummary(item);
  });
}

function confirmItem(options = {}) {
  return transitionItem({ ...options, targetStatus: 'confirmed' });
}

function failItem(options = {}) {
  return transitionItem({ ...options, targetStatus: 'failed' });
}

function getStatus({ cwd, sessionId = DEFAULT_SESSION_ID } = {}) {
  assertSessionId(sessionId);

  const path = sessionPath(cwd, sessionId);
  const label = `session state ${path}`;
  const state = readSessionState(cwd, sessionId, label);

  const total = state.items.length;
  const pending = state.items.filter((entry) => entry.status === 'pending').length;
  const claimed = state.items.filter((entry) => entry.status === 'claimed').length;
  const confirmed = state.items.filter((entry) => entry.status === 'confirmed').length;
  const failed = state.items.filter((entry) => entry.status === 'failed').length;
  const blocked = state.items.filter((entry) => entry.status === 'blocked').length;
  const needsReview = state.items.filter((entry) => entry.status === 'needs_review').length;
  const failedIds = state.items.filter((entry) => entry.status === 'failed').map((entry) => entry.id);

  const verified = confirmed + failed;
  const passed = confirmed;
  const completion = total === 0 ? 0 : verified / total;
  const completed = total > 0 && verified === total;
  const satisfied = completed && failed === 0;

  return {
    sessionId,
    total,
    verified,
    passed,
    pending,
    claimed,
    confirmed,
    failed,
    blocked,
    needs_review: needsReview,
    failedIds,
    completion,
    completed,
    satisfied,
  };
}

module.exports = {
  startSession,
  claimNext,
  confirmItem,
  failItem,
  getStatus,
};
