const {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  renameSync,
  writeFileSync,
} = require('node:fs');
const { dirname, join, resolve } = require('node:path');
const { parse, stringify } = require('yaml');

const DEFAULT_SESSION_ID = 'default';
const DEFAULT_LEASE_MS = 60_000;
const VALID_STATUSES = ['pending', 'claimed', 'confirmed', 'failed'];
const SAFE_SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

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

function sessionPath(cwd, sessionId) {
  return join(sessionsDir(cwd), `${sessionId}.json`);
}

function lockPath(cwd, sessionId) {
  return join(sessionsDir(cwd), `${sessionId}.lock`);
}

function ensureStateDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}

function readYamlFile(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} missing at ${path}.`);
  }

  const text = readFileSync(path, 'utf8');
  try {
    return parse(text);
  } catch (error) {
    throw new Error(`Failed to parse ${label} at ${path}: ${error.message}`);
  }
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
    && Number.isFinite(value.leaseUntil);
}

function assertSessionShape(session, sourcePath, expectedSessionId) {
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

function assertSeedDocument(seedDocument) {
  if (!seedDocument || typeof seedDocument !== 'object' || Array.isArray(seedDocument)) {
    throw new Error('startSession requires seed document object.');
  }

  if (!Array.isArray(seedDocument.verifications)) {
    throw new Error('startSession requires seed document with verifications array.');
  }

  const ids = new Set();
  seedDocument.verifications.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`startSession requires verification entry at index ${index} to be an object.`);
    }
    if (typeof entry.id !== 'string' || !entry.id) {
      throw new Error(`startSession requires verification entry at index ${index} to provide an id.`);
    }
    if (ids.has(entry.id)) {
      throw new Error(`startSession requires all verification ids to be unique. Duplicate id found: ${entry.id}`);
    }
    ids.add(entry.id);
  });
}

function ensureSnapshotSeedPath(cwd) {
  return resolve(cwd, 'seed', 'seed.yml');
}

function readSessionState(cwd, sessionId, sourceLabel) {
  const state = readJsonFile(sessionPath(cwd, sessionId), sourceLabel);
  assertSessionShape(state, sourceLabel, sessionId);
  return state;
}

function normalizeNow(now) {
  const value = resolveNow(now);
  return value;
}

function buildSessionItems(seedDocument) {
  return seedDocument.verifications.map((verification) => ({
    id: verification.id,
    status: 'pending',
    claim: null,
    title: verification.title ?? null,
    evidenceGuidance: Array.isArray(verification.evidence)
      ? verification.evidence.slice()
      : [],
    attempts: 0,
    evidence: null,
    reason: null,
  }));
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
    title: item.title ?? null,
    evidenceGuidance: item.evidenceGuidance,
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

  const snapshot = {
    createdAt: nowValue,
    seedPath: ensureSnapshotSeedPath(workspaceRoot(cwd)),
    text: seedText,
    verifications: items.map(({ id, title, evidenceGuidance }) => ({
      id,
      title,
      evidenceGuidance,
    })),
  };

  ensureStateDir(snapshotPath(cwd));
  writeFileSync(snapshotPath(cwd), stringify(snapshot), 'utf8');

  const session = {
    sessionId,
    createdAt: nowValue,
    updatedAt: nowValue,
    snapshotPath: snapshotPath(cwd),
    items,
  };

  ensureStateDir(sessionPath(cwd, sessionId));
  writeJsonAtomically(sessionPath(cwd, sessionId), session);

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
      if (typeof evidence !== 'string') {
        throw new Error(`confirmItem requires evidence string for item ${itemId}.`);
      }
      item.evidence = evidence;
      item.reason = null;
    } else if (targetStatus === 'failed') {
      if (typeof reason !== 'string') {
        throw new Error(`failItem requires reason string for item ${itemId}.`);
      }
      item.reason = reason;
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
  const failedIds = state.items.filter((entry) => entry.status === 'failed').map((entry) => entry.id);

  const completion = total === 0 ? 0 : confirmed / total;
  const completed = total > 0 && confirmed === total;

  return {
    sessionId,
    total,
    pending,
    claimed,
    confirmed,
    failed,
    failedIds,
    completion,
    completed,
  };
}

module.exports = {
  startSession,
  claimNext,
  confirmItem,
  failItem,
  getStatus,
};
