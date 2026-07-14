const {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  renameSync,
  writeFileSync,
} = require('node:fs');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { parse } = require('yaml');
const { dirname, isAbsolute, join, relative, resolve, sep } = require('node:path');
const { loadSeed } = require('./seed-file');
const { collectGlobalPolicyItems, collectPresentAddressableItems, normalizeAddressableSection } = require('./validation');

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
const DEFAULT_LOCK_WAIT_MS = 60_000;
const DEFAULT_LOCK_RETRY_MS = 50;
const DEFAULT_TEST_COMMAND_TIMEOUT_MS = 30_000;
const MAX_TEST_COMMAND_OUTPUT_CHARS = 4_000;
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

function sleepMs(ms) {
  if (ms <= 0) {
    return;
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withLock(path, action, { waitMs = DEFAULT_LOCK_WAIT_MS, retryMs = DEFAULT_LOCK_RETRY_MS } = {}) {
  let locked = false;
  const startedAt = Date.now();

  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch (error) {
    throw new Error(`Failed to prepare lock directory for ${path}: ${error.message}`);
  }

  while (!locked) {
    try {
      mkdirSync(path);
      locked = true;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw new Error(`Failed to acquire lock at ${path}: ${error.message}`);
      }

      const elapsed = Date.now() - startedAt;
      if (elapsed >= waitMs) {
        throw new Error(`Could not acquire lock at ${path} within ${waitMs}ms. Another process holds the session lock.`);
      }

      sleepMs(Math.min(retryMs, waitMs - elapsed));
    }
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

function fileHash(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function safeRelativeFilePath(cwd, filePath) {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    throw new Error('evidence file path must be a non-empty string.');
  }

  if (isAbsolute(filePath)) {
    throw new Error('evidence file path must be repo-relative: ' + filePath);
  }

  const root = workspaceRoot(cwd);
  const absolutePath = resolve(root, filePath);
  const relativePath = relative(root, absolutePath);
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('evidence file path must stay inside the repository: ' + filePath);
  }

  return relativePath.split(sep).join('/');
}

function truncateOutput(value) {
  if (typeof value !== 'string') {
    return '';
  }

  if (value.length <= MAX_TEST_COMMAND_OUTPUT_CHARS) {
    return value;
  }

  return value.slice(0, MAX_TEST_COMMAND_OUTPUT_CHARS) + '\n[truncated]';
}

function normalizeTestCommands(commands) {
  if (!Array.isArray(commands) || commands.length === 0) {
    throw new Error('at least one test command is required.');
  }

  return commands.map((command, index) => {
    if (typeof command !== 'string' || command.trim().length === 0) {
      throw new Error('test command ' + (index + 1) + ' must be a non-empty string.');
    }
    return command;
  });
}

function runTestCommands(cwd, commands, { now } = {}) {
  const normalized = normalizeTestCommands(commands);
  return normalized.map((command) => {
    const startedAt = resolveNow(now);
    const started = Date.now();
    const result = spawnSync(command, {
      cwd: workspaceRoot(cwd),
      shell: true,
      encoding: 'utf8',
      timeout: DEFAULT_TEST_COMMAND_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    });
    const durationMs = Date.now() - started;
    const exitCode = typeof result.status === 'number' ? result.status : null;
    const timedOut = result.error?.code === 'ETIMEDOUT';

    return {
      command,
      cwd: workspaceRoot(cwd),
      shell: true,
      timeoutMs: DEFAULT_TEST_COMMAND_TIMEOUT_MS,
      exitCode,
      signal: result.signal ?? null,
      timedOut,
      passed: exitCode === 0 && !timedOut,
      stdout: truncateOutput(result.stdout),
      stderr: truncateOutput(result.stderr ?? result.error?.message ?? ''),
      durationMs,
      executedAt: startedAt,
    };
  });
}

function assertTransitionCommandResults(itemId, targetStatus, results) {
  if (targetStatus === 'confirmed') {
    const failed = results.filter((entry) => !entry.passed);
    if (failed.length > 0) {
      throw new Error('Cannot confirm item ' + itemId + ': test command failed: ' + failed[0].command);
    }
    return;
  }

  if (targetStatus === 'failed') {
    if (results.every((entry) => entry.passed)) {
      throw new Error('Cannot fail item ' + itemId + ': all test commands exited 0.');
    }
    return;
  }

  throw new Error('Unknown transition status ' + targetStatus + '.');
}

function hashEvidenceFiles(cwd, files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('at least one evidence file path is required.');
  }

  const seen = new Set();
  return files.map((filePath) => {
    const relativePath = safeRelativeFilePath(cwd, filePath);
    if (seen.has(relativePath)) {
      throw new Error('duplicate evidence file path: ' + relativePath);
    }
    seen.add(relativePath);

    const absolutePath = join(workspaceRoot(cwd), relativePath);
    if (!existsSync(absolutePath)) {
      throw new Error('evidence file missing at ' + relativePath + '.');
    }

    return {
      path: relativePath,
      sha256: fileHash(readFileSync(absolutePath)),
    };
  });
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
      method: verification.value.method ?? null,
      artifacts: structuredClone(verification.value.artifacts ?? []),
      evidence_required: structuredClone(verification.value.evidence_required),
      attempts: 0,
      evidence: null,
      reason: null,
      evidence_files: [],
      test_commands: [],
      seed_evidence: null,
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
      method: null,
      artifacts: [...artifacts],
      evidence_required: [
        'Verification approach used.',
        `Relevant command output, code path, or inspection notes for @${target.address}.`,
        `Pass/fail reason tied to @${target.address}.`,
      ],
      attempts: 0,
      evidence: null,
      reason: null,
      evidence_files: [],
      test_commands: [],
      seed_evidence: null,
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

function textReferences(value) {
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
  return refs;
}

function shortDescription(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (value && typeof value === 'object' && typeof value.description === 'string') {
    return value.description;
  }
  return null;
}

function artifactLocation(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value.path ?? value.url ?? null;
}

function verificationReferencesFromDocument(document, item) {
  const errors = [];
  const entries = collectPresentAddressableItems(document, errors);
  const byAddress = new Map(entries.map((entry) => [entry.address, entry]));
  const artifacts = entries.filter((entry) => entry.section === 'artifacts');
  const artifactsById = new Map(artifacts.map((entry) => [entry.id, entry]));
  const artifactsByAddress = new Map(artifacts.map((entry) => [entry.address, entry]));
  const addressRefs = new Set();
  const artifactRefs = new Set();
  const unresolved = new Set();

  if (item.address) {
    addressRefs.add(item.address);
  }

  textReferences({
    title: item.title,
    description: item.description,
    method: item.method,
    evidence_required: item.evidence_required,
  }).forEach((ref) => {
    if (artifactsById.has(ref)) {
      artifactRefs.add(ref);
    } else if (artifactsByAddress.has(ref)) {
      artifactRefs.add(artifactsByAddress.get(ref).id);
    } else if (byAddress.has(ref)) {
      addressRefs.add(ref);
    } else {
      unresolved.add(ref);
    }
  });

  (item.artifacts ?? []).forEach((artifactId) => {
    if (artifactsById.has(artifactId)) {
      artifactRefs.add(artifactId);
    } else if (artifactsByAddress.has(artifactId)) {
      artifactRefs.add(artifactsByAddress.get(artifactId).id);
    } else {
      unresolved.add(artifactId);
    }
  });

  return {
    addresses: [...addressRefs]
      .filter((address) => byAddress.has(address))
      .sort()
      .map((address) => {
        const entry = byAddress.get(address);
        return {
          address,
          id: entry.id,
          section: entry.section,
          description: shortDescription(entry.value),
        };
      }),
    artifacts: [...artifactRefs]
      .filter((id) => artifactsById.has(id))
      .sort()
      .map((id) => {
        const entry = artifactsById.get(id);
        return {
          id,
          address: entry.address,
          path: artifactLocation(entry.value),
          description: shortDescription(entry.value),
        };
      }),
    unresolved: [...unresolved].sort(),
  };
}

function globalPoliciesFromDocument(document) {
  const errors = [];
  const policies = collectGlobalPolicyItems(document, errors);
  if (errors.length > 0) {
    throw new Error('Failed to collect global policies: ' + errors.map((entry) => entry.message).join('; '));
  }

  return policies.map((policy) => ({
    id: policy.id,
    address: policy.address,
    section: policy.section,
    description: shortDescription(policy.value),
  }));
}

function globalPolicies(cwd) {
  const snapshotText = readFileSync(snapshotPath(cwd), 'utf8');
  const document = parse(snapshotText);
  return globalPoliciesFromDocument(document);
}

function verificationReferences(cwd, item) {
  const snapshotText = readFileSync(snapshotPath(cwd), 'utf8');
  const document = parse(snapshotText);
  return verificationReferencesFromDocument(document, item);
}

function currentSeedEvidence(cwd, item) {
  const seed = loadSeed({ cwd });
  const references = verificationReferencesFromDocument(seed.document, item);
  const fingerprints = addressFingerprints(seed.document);
  const referencedAddresses = [
    ...references.addresses.map((entry) => entry.address),
    ...references.artifacts.map((entry) => entry.address),
  ];

  return {
    seedHash: seedHash(seed.text),
    addresses: [...new Set(referencedAddresses)]
      .filter((address) => fingerprints.has(address))
      .sort()
      .map((address) => ({
        address,
        fingerprint: fingerprints.get(address),
      })),
  };
}

function storedSeedEvidenceFingerprint(item, address) {
  if (!item.seed_evidence || !Array.isArray(item.seed_evidence.addresses)) {
    return null;
  }

  const entry = item.seed_evidence.addresses.find((candidate) => candidate.address === address);
  if (!entry || typeof entry.fingerprint !== 'string') {
    return null;
  }
  return entry.fingerprint;
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

function terminalStatus(item) {
  return ['confirmed', 'failed'].includes(item.status);
}

function currentEvidenceExpiration(cwd, item) {
  const files = Array.isArray(item.evidence_files) ? item.evidence_files : [];
  if (!terminalStatus(item) || files.length === 0) {
    return null;
  }

  const changedFiles = [];
  files.forEach((file) => {
    if (!file || typeof file.path !== 'string' || typeof file.sha256 !== 'string') {
      changedFiles.push({
        path: file?.path ?? null,
        expectedSha256: file?.sha256 ?? null,
        actualSha256: null,
        status: 'invalid',
      });
      return;
    }

    const relativePath = safeRelativeFilePath(cwd, file.path);
    const absolutePath = join(workspaceRoot(cwd), relativePath);
    if (!existsSync(absolutePath)) {
      changedFiles.push({
        path: relativePath,
        expectedSha256: file.sha256,
        actualSha256: null,
        status: 'missing',
      });
      return;
    }

    const actualSha256 = fileHash(readFileSync(absolutePath));
    if (actualSha256 !== file.sha256) {
      changedFiles.push({
        path: relativePath,
        expectedSha256: file.sha256,
        actualSha256,
        status: 'modified',
      });
    }
  });

  if (changedFiles.length === 0) {
    return null;
  }

  return {
    kind: 'evidence-file',
    id: item.id,
    address: item.address ?? null,
    status: item.status,
    files: changedFiles,
  };
}

function currentTestCommandExpiration(item) {
  if (!terminalStatus(item)) {
    return null;
  }

  if (Array.isArray(item.test_commands) && item.test_commands.length > 0) {
    return null;
  }

  return {
    kind: 'test-command-missing',
    id: item.id,
    address: item.address ?? null,
    status: item.status,
    reason: 'terminal verification evidence is missing test_commands',
  };
}

function currentSeedAddressExpiration(cwd, item, changedAddresses) {
  if (!terminalStatus(item) || changedAddresses.size === 0) {
    return null;
  }

  const references = verificationReferences(cwd, item);
  const referencedAddresses = [
    ...references.addresses.map((entry) => entry.address),
    ...references.artifacts.map((entry) => entry.address),
  ];
  const currentSeed = loadSeed({ cwd });
  const currentFingerprints = addressFingerprints(currentSeed.document);
  const modifiedAddresses = referencedAddresses
    .filter((address) => changedAddresses.has(address))
    .filter((address) => storedSeedEvidenceFingerprint(item, address) !== currentFingerprints.get(address));
  if (modifiedAddresses.length === 0) {
    return null;
  }

  return {
    kind: 'seed-address',
    id: item.id,
    address: item.address ?? null,
    status: item.status,
    modifiedAddresses,
  };
}

function currentItemExpiration(cwd, item, changedAddresses = new Set()) {
  const evidence = currentEvidenceExpiration(cwd, item);
  const testCommand = currentTestCommandExpiration(item);
  const seedAddress = currentSeedAddressExpiration(cwd, item, changedAddresses);

  if (!evidence && !testCommand && !seedAddress) {
    return null;
  }

  return {
    kind: [evidence?.kind, testCommand?.kind, seedAddress?.kind].filter(Boolean).join('+'),
    id: item.id,
    address: item.address ?? null,
    status: item.status,
    files: evidence?.files ?? [],
    missingTestCommands: Boolean(testCommand),
    modifiedAddresses: seedAddress?.modifiedAddresses ?? [],
  };
}

function collectExpiredEvidence(cwd, items, changedAddresses = new Set()) {
  return items
    .map((item) => currentItemExpiration(cwd, item, changedAddresses))
    .filter(Boolean);
}

function nextExpiredEvidenceItem(cwd, items, changedAddresses = new Set()) {
  return items.find((item) => currentItemExpiration(cwd, item, changedAddresses));
}

function itemSummary(item, references = { addresses: [], artifacts: [], unresolved: [] }, policies = []) {
  return {
    id: item.id,
    source: item.source ?? null,
    address: item.address ?? null,
    title: item.title ?? null,
    description: item.description ?? null,
    method: item.method ?? null,
    artifacts: item.artifacts ?? [],
    evidence_required: item.evidence_required,
    references,
    globalPolicies: policies,
    status: item.status,
  };
}

function startSession({
  cwd,
  sessionId = DEFAULT_SESSION_ID,
  seedDocument,
  seedText,
  now,
  lockWaitMs = DEFAULT_LOCK_WAIT_MS,
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
  }, { waitMs: lockWaitMs });

  return { rootPath: root, session };
}

function claimNext({
  cwd,
  sessionId = DEFAULT_SESSION_ID,
  owner = `seed-${Date.now()}`,
  leaseMs = DEFAULT_LEASE_MS,
  now,
  lockWaitMs = DEFAULT_LOCK_WAIT_MS,
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

    let seedChanges = new Set();
    try {
      seedChanges = new Set(modifiedSeedAddresses(cwd));
    } catch (error) {
      seedChanges = new Set();
    }
    const next = nextPendingItem(state.items) ?? nextExpiredEvidenceItem(cwd, state.items, seedChanges);
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
      item: next ? itemSummary(next, verificationReferences(cwd, next), globalPolicies(cwd)) : null,
      claim: next ? next.claim : null,
      recoveredIds: recovered.recovered,
      warnings: recovered.recovered.length
        ? [{ code: 'recovered-stale-lease', ids: recovered.recovered }]
        : [],
    };
  }, { waitMs: lockWaitMs });
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
  files,
  testCommands,
  lockWaitMs = DEFAULT_LOCK_WAIT_MS,
}) {
  assertSessionId(sessionId);
  assertOwner(owner);
  const evidenceFiles = hashEvidenceFiles(cwd, files);

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

    const testCommandResults = runTestCommands(cwd, testCommands, { now });
    assertTransitionCommandResults(itemId, targetStatus, testCommandResults);

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
    item.evidence_files = evidenceFiles;
    item.test_commands = testCommandResults;
    try {
      item.seed_evidence = currentSeedEvidence(cwd, item);
    } catch (error) {
      item.seed_evidence = null;
    }
    state.updatedAt = nowValue;

    writeJsonAtomically(path, state);
    return itemSummary(item, verificationReferences(cwd, item), globalPolicies(cwd));
  }, { waitMs: lockWaitMs });
}

function confirmItem(options = {}) {
  return transitionItem({ ...options, targetStatus: 'confirmed' });
}

function failItem(options = {}) {
  return transitionItem({ ...options, targetStatus: 'failed' });
}

function resetSession({
  cwd,
  sessionId = DEFAULT_SESSION_ID,
  now,
  lockWaitMs = DEFAULT_LOCK_WAIT_MS,
} = {}) {
  assertSessionId(sessionId);

  const nowValue = normalizeNow(now);
  const path = sessionPath(cwd, sessionId);
  const label = `session state ${path}`;
  const lock = lockPath(cwd, sessionId);

  return withLock(lock, () => {
    const state = readSessionState(cwd, sessionId, label);
    const snapshotText = readFileSync(snapshotPath(cwd), 'utf8');
    let seedDocument;

    try {
      seedDocument = parse(snapshotText);
    } catch (error) {
      throw new Error(`Failed to parse snapshot for session ${sessionId}: ${error.message}`);
    }

    assertSeedDocument(seedDocument);
    state.items = buildSessionItems(seedDocument);
    state.updatedAt = nowValue;

    writeJsonAtomically(path, state);
    return {
      sessionId,
      reset: state.items.length,
      session: state,
    };
  }, { waitMs: lockWaitMs });
}

function itemFingerprint(item) {
  return JSON.stringify(item.value ?? null);
}

function addressFingerprints(document) {
  const errors = [];
  const entries = collectPresentAddressableItems(document, errors);
  if (errors.length > 0) {
    throw new Error('Failed to collect addressable Seed items: ' + errors.map((entry) => entry.message).join('; '));
  }

  return new Map(entries.map((entry) => [entry.address, itemFingerprint(entry)]));
}

function modifiedSeedAddresses(cwd) {
  const snapshotText = readFileSync(snapshotPath(cwd), 'utf8');
  const snapshotDocument = parse(snapshotText);
  const currentSeed = loadSeed({ cwd });
  const snapshotItems = addressFingerprints(snapshotDocument);
  const currentItems = addressFingerprints(currentSeed.document);
  const addresses = new Set([...snapshotItems.keys(), ...currentItems.keys()]);

  return [...addresses]
    .filter((address) => snapshotItems.get(address) !== currentItems.get(address))
    .sort();
}

function summarizeStatus(cwd, state) {
  let seedChanges = [];
  try {
    seedChanges = modifiedSeedAddresses(cwd);
  } catch (error) {
    seedChanges = [{ error: error.message }];
  }
  const changedAddresses = new Set(seedChanges.filter((entry) => typeof entry === 'string'));
  const expiredEvidence = collectExpiredEvidence(cwd, state.items, changedAddresses);
  const expiredIds = expiredEvidence.map((entry) => entry.id);
  const expiredIdSet = new Set(expiredIds);

  const total = state.items.length;
  const pending = state.items.filter((entry) => entry.status === 'pending').length + expiredIdSet.size;
  const claimed = state.items.filter((entry) => entry.status === 'claimed').length;
  const confirmed = state.items.filter((entry) => entry.status === 'confirmed' && !expiredIdSet.has(entry.id)).length;
  const failed = state.items.filter((entry) => entry.status === 'failed' && !expiredIdSet.has(entry.id)).length;
  const blocked = state.items.filter((entry) => entry.status === 'blocked').length;
  const needsReview = state.items.filter((entry) => entry.status === 'needs_review').length;
  const failedIds = state.items
    .filter((entry) => entry.status === 'failed' && !expiredIdSet.has(entry.id))
    .map((entry) => entry.id);

  const verified = confirmed + failed;
  const passed = confirmed;
  const completion = total === 0 ? 0 : verified / total;
  const completed = total > 0 && verified === total;
  const expired = expiredEvidence.length;
  const satisfied = completed && failed === 0 && expired === 0;

  return {
    sessionId: state.sessionId,
    total,
    verified,
    passed,
    pending,
    claimed,
    confirmed,
    failed,
    blocked,
    needs_review: needsReview,
    expired,
    expiredIds,
    expiredEvidence,
    failedIds,
    modifiedSeedAddresses: seedChanges,
    completion,
    completed,
    satisfied,
  };
}

function getPendingItems({ cwd, sessionId = DEFAULT_SESSION_ID } = {}) {
  assertSessionId(sessionId);

  const path = sessionPath(cwd, sessionId);
  const label = 'session state ' + path;
  const state = readSessionState(cwd, sessionId, label);
  const seedChanges = new Set(modifiedSeedAddresses(cwd));
  const expirations = collectExpiredEvidence(cwd, state.items, seedChanges);
  const expirationById = new Map(expirations.map((entry) => [entry.id, entry]));

  return state.items
    .map((item) => {
      const expiration = expirationById.get(item.id);
      if (expiration) {
        return {
          ...itemSummary(item, verificationReferences(cwd, item), globalPolicies(cwd)),
          status: 'expired',
          previousStatus: item.status,
          expiration,
        };
      }

      if (item.status === 'pending') {
        return itemSummary(item, verificationReferences(cwd, item), globalPolicies(cwd));
      }

      return null;
    })
    .filter(Boolean);
}

function syncSession({
  cwd,
  sessionId = DEFAULT_SESSION_ID,
  now,
  lockWaitMs = DEFAULT_LOCK_WAIT_MS,
} = {}) {
  assertSessionId(sessionId);

  const nowValue = normalizeNow(now);
  const path = sessionPath(cwd, sessionId);
  const label = 'session state ' + path;
  const lock = lockPath(cwd, sessionId);

  return withLock(lock, () => {
    const state = readSessionState(cwd, sessionId, label);
    const status = summarizeStatus(cwd, state);
    if (!status.satisfied) {
      throw new Error('seed verify sync requires the current session to be completed, satisfied, and free of expired evidence.');
    }

    const seed = loadSeed({ cwd });
    const changedAddresses = new Set(modifiedSeedAddresses(cwd));
    const oldById = new Map(state.items.map((item) => [item.id, item]));
    const nextItems = buildSessionItems(seed.document).map((item) => {
      const old = oldById.get(item.id);
      if (
        old
        && old.address === item.address
        && ['confirmed', 'failed'].includes(old.status)
        && !currentItemExpiration(cwd, old, changedAddresses)
      ) {
        return {
          ...item,
          status: old.status,
          attempts: old.attempts ?? item.attempts,
          evidence: old.evidence ?? null,
          reason: old.reason ?? null,
          evidence_files: structuredClone(old.evidence_files ?? []),
          test_commands: structuredClone(old.test_commands ?? []),
          seed_evidence: structuredClone(old.seed_evidence ?? null),
        };
      }
      return item;
    });

    writeFileSync(snapshotPath(cwd), seed.text, 'utf8');
    state.seedHash = seedHash(seed.text);
    state.updatedAt = nowValue;
    state.items = nextItems;
    writeJsonAtomically(path, state);

    return {
      sessionId,
      synced: true,
      preserved: nextItems.filter((item) => ['confirmed', 'failed'].includes(item.status)).length,
      pending: nextItems.filter((item) => item.status === 'pending').length,
      modifiedSeedAddresses: [...changedAddresses],
      session: state,
    };
  }, { waitMs: lockWaitMs });
}

function verificationAudit({ cwd, sessionId = DEFAULT_SESSION_ID } = {}) {
  assertSessionId(sessionId);

  const path = sessionPath(cwd, sessionId);
  const label = 'session state ' + path;
  const state = readSessionState(cwd, sessionId, label);
  const status = summarizeStatus(cwd, state);
  const errors = [];
  const warnings = [];
  const commandUsage = new Map();
  const policies = globalPolicies(cwd);
  const byAddress = new Map(state.items.map((item) => [item.address, item]));

  function addIssue(target, code, item, message, extra = {}) {
    target.push({
      code,
      id: item?.id ?? null,
      address: item?.address ?? null,
      message,
      ...extra,
    });
  }

  if (!status.completed) {
    addIssue(errors, 'session-incomplete', null, 'verification session is not complete', {
      pending: status.pending,
      claimed: status.claimed,
      total: status.total,
      verified: status.verified,
    });
  }

  if (status.expired > 0) {
    addIssue(errors, 'expired-evidence', null, 'verification session contains expired evidence', {
      expired: status.expired,
      expiredIds: status.expiredIds,
    });
  }

  if (status.failed > 0) {
    addIssue(errors, 'failed-verifications', null, 'verification session contains failed items', {
      failed: status.failed,
      failedIds: status.failedIds,
    });
  }

  policies.forEach((policy) => {
    const item = byAddress.get(policy.address);
    if (!item) {
      errors.push({
        code: 'missing-global-policy-verification',
        id: null,
        address: policy.address,
        message: 'global policy has no verification item',
      });
      return;
    }

    if (!terminalStatus(item)) {
      addIssue(errors, 'global-policy-not-terminal', item, 'global policy verification is not terminal', { policyAddress: policy.address });
      return;
    }

    if (item.status !== 'confirmed') {
      addIssue(errors, 'global-policy-not-confirmed', item, 'global policy verification is not confirmed', { policyAddress: policy.address });
    }

    const text = [
      item.evidence,
      item.reason,
      ...(item.test_commands ?? []).map((entry) => entry?.command),
    ].filter(Boolean).join(' ').toLowerCase();
    const addressToken = policy.address.toLowerCase();
    const idToken = policy.id.toLowerCase();
    if (!text.includes(addressToken) && !text.includes(idToken) && !text.includes('global') && !text.includes('policy')) {
      addIssue(warnings, 'weak-global-policy-evidence', item, 'global policy evidence should explicitly mention the policy address or global policy intent', { policyAddress: policy.address });
    }
  });

  state.items.forEach((item) => {
    if (!terminalStatus(item)) {
      addIssue(errors, 'item-not-terminal', item, 'item is not confirmed or failed', { status: item.status });
      return;
    }

    const files = Array.isArray(item.evidence_files) ? item.evidence_files : [];
    if (files.length === 0) {
      addIssue(errors, 'missing-evidence-files', item, 'terminal item has no evidence files');
    }

    const commands = Array.isArray(item.test_commands) ? item.test_commands : [];
    if (commands.length === 0) {
      addIssue(errors, 'missing-test-commands', item, 'terminal item has no test commands');
    }

    const supportText = item.status === 'confirmed' ? item.evidence : item.reason;
    if (typeof supportText !== 'string' || supportText.trim().length < 12) {
      addIssue(warnings, 'weak-evidence-text', item, 'evidence or reason text is short or missing');
    } else if (/^(ok|done|works|verified|manual-check|pass|passed)$/i.test(supportText.trim())) {
      addIssue(warnings, 'generic-evidence-text', item, 'evidence or reason text is generic');
    }

    commands.forEach((commandResult, index) => {
      if (!commandResult || typeof commandResult !== 'object') {
        addIssue(errors, 'invalid-test-command-record', item, 'test command record is not an object', { index });
        return;
      }

      if (typeof commandResult.command !== 'string' || commandResult.command.trim().length === 0) {
        addIssue(errors, 'invalid-test-command', item, 'test command is missing command text', { index });
        return;
      }

      const command = commandResult.command.trim();
      const usage = commandUsage.get(command) ?? [];
      usage.push({ id: item.id, address: item.address ?? null });
      commandUsage.set(command, usage);

      if (item.status === 'confirmed' && commandResult.passed !== true) {
        addIssue(errors, 'confirmed-command-not-passing', item, 'confirmed item stores a non-passing test command', {
          command,
          exitCode: commandResult.exitCode ?? null,
        });
      }

      if (item.status === 'failed' && commandResult.passed === true) {
        addIssue(errors, 'failed-command-passing', item, 'failed item stores a passing test command', {
          command,
          exitCode: commandResult.exitCode ?? null,
        });
      }

      if (/^\.\/seed\/scripts\//.test(command) && command.trim().split(/\s+/).length < 2) {
        addIssue(warnings, 'script-command-without-case', item, 'Seed verification script command has no named case argument', { command });
      }
    });

    if (item.status === 'failed' && commands.length > 0 && commands.every((entry) => entry?.passed === true)) {
      addIssue(errors, 'failed-item-has-no-failing-command', item, 'failed item has no failing stored command');
    }
  });

  commandUsage.forEach((usage, command) => {
    if (usage.length <= 1) {
      return;
    }

    const addresses = [...new Set(usage.map((entry) => entry.address).filter(Boolean))];
    const ids = usage.map((entry) => entry.id);
    const code = usage.length > 5 ? 'broad-command-reuse' : 'command-reuse';
    warnings.push({
      code,
      id: null,
      address: null,
      message: 'same test command is reused across multiple verification items',
      command,
      count: usage.length,
      ids,
      addresses,
    });
  });

  return {
    sessionId: state.sessionId,
    total: state.items.length,
    audited: state.items.filter((item) => terminalStatus(item)).length,
    ok: errors.length === 0,
    errors,
    warnings,
    status,
  };
}

function verificationReport({ cwd, sessionId = DEFAULT_SESSION_ID } = {}) {
  assertSessionId(sessionId);

  const path = sessionPath(cwd, sessionId);
  const label = 'session state ' + path;
  const state = readSessionState(cwd, sessionId, label);
  const status = summarizeStatus(cwd, state);
  const audit = verificationAudit({ cwd, sessionId });
  const expirationsById = new Map((status.expiredEvidence ?? []).map((entry) => [entry.id, entry]));
  const auditErrorsById = new Map();
  const auditWarningsById = new Map();
  const globalErrors = [];
  const globalWarnings = [];

  const collectIssue = (map, globals, issue) => {
    if (!issue.id) {
      globals.push(issue);
      return;
    }

    const issues = map.get(issue.id) ?? [];
    issues.push(issue);
    map.set(issue.id, issues);
  };

  audit.errors.forEach((issue) => collectIssue(auditErrorsById, globalErrors, issue));
  audit.warnings.forEach((issue) => collectIssue(auditWarningsById, globalWarnings, issue));

  const items = state.items.map((item) => ({
    id: item.id,
    address: item.address ?? null,
    source: item.source ?? null,
    status: item.status,
    previousStatus: expirationsById.has(item.id) ? item.status : null,
    title: item.title ?? null,
    description: item.description ?? null,
    method: item.method ?? null,
    evidence_required: structuredClone(item.evidence_required ?? []),
    evidence: item.evidence ?? null,
    reason: item.reason ?? null,
    attempts: item.attempts ?? 0,
    references: itemSummary(item, verificationReferences(cwd, item)).references,
    evidence_files: structuredClone(item.evidence_files ?? []),
    test_commands: structuredClone(item.test_commands ?? []),
    expiration: expirationsById.get(item.id) ?? null,
    audit_errors: auditErrorsById.get(item.id) ?? [],
    audit_warnings: auditWarningsById.get(item.id) ?? [],
  }));

  return {
    sessionId: state.sessionId,
    status,
    global_policies: globalPolicies(cwd),
    audit,
    global_errors: globalErrors,
    global_warnings: globalWarnings,
    items,
  };
}

function checkSession({ cwd, sessionId = DEFAULT_SESSION_ID, now } = {}) {
  assertSessionId(sessionId);

  const path = sessionPath(cwd, sessionId);
  const label = 'session state ' + path;
  const state = readSessionState(cwd, sessionId, label);
  const checkedAt = resolveNow(now);
  const items = state.items
    .filter((item) => terminalStatus(item))
    .map((item) => {
      if (!Array.isArray(item.test_commands) || item.test_commands.length === 0) {
        return {
          id: item.id,
          address: item.address ?? null,
          status: item.status,
          ok: false,
          error: 'missing test commands',
          commands: [],
        };
      }

      const commands = runTestCommands(cwd, item.test_commands.map((entry) => entry.command), { now });
      const commandsMatchStatus = item.status === 'confirmed'
        ? commands.every((entry) => entry.passed)
        : commands.some((entry) => !entry.passed);
      return {
        id: item.id,
        address: item.address ?? null,
        status: item.status,
        ok: item.status === 'confirmed' ? commandsMatchStatus : false,
        commandsMatchStatus,
        commands,
      };
    });
  const missing = items.filter((item) => item.error === 'missing test commands').length;
  const passed = items.filter((item) => item.ok).length;
  const failed = items.length - passed;

  return {
    sessionId: state.sessionId,
    checkedAt,
    total: items.length,
    passed,
    failed,
    missing,
    ok: failed === 0,
    items,
  };
}

function getStatus({ cwd, sessionId = DEFAULT_SESSION_ID } = {}) {
  assertSessionId(sessionId);

  const path = sessionPath(cwd, sessionId);
  const label = 'session state ' + path;
  const state = readSessionState(cwd, sessionId, label);
  return summarizeStatus(cwd, state);
}

module.exports = {
  startSession,
  claimNext,
  confirmItem,
  failItem,
  resetSession,
  syncSession,
  getStatus,
  getPendingItems,
  checkSession,
  verificationAudit,
  verificationReport,
};
