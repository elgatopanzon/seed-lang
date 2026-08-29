const {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  renameSync,
  writeFileSync,
} = require('node:fs');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { parse } = require('yaml');
const { dirname, isAbsolute, join, relative, resolve, sep } = require('node:path');
const { loadSeed, seedPaths } = require('./seed-file');
const { canonicalJson } = require('./canonical-json');
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
const DEFAULT_TEST_COMMAND_TIMEOUT_MS = 300_000;
const SESSION_SCHEMA_VERSION = 1;
const SESSION_COMMAND_CWD = '.';
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
const PRODUCT_REVISION_EXCLUDED_DIRECTORIES = new Set(['.git', '.seed', 'node_modules']);

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

function sessionSnapshotPath(seedName) {
  return join(seedPaths(seedName).statePath, 'seed.snapshot.yml');
}

function seedRootPath(cwd, seedName) {
  return join(workspaceRoot(cwd), seedPaths(seedName).statePath);
}

function snapshotPath(cwd, seedName) {
  return join(seedRootPath(cwd, seedName), 'seed.snapshot.yml');
}

function dependencySnapshotPath(cwd, seedName) {
  return join(seedRootPath(cwd, seedName), 'dependencies.snapshot.json');
}

function sessionsDir(cwd, seedName) {
  return join(seedRootPath(cwd, seedName), 'sessions');
}

function locksDir(cwd, seedName) {
  return join(seedRootPath(cwd, seedName), 'locks');
}

function sessionPath(cwd, seedName, sessionId) {
  return join(sessionsDir(cwd, seedName), `${sessionId}.json`);
}

function lockPath(cwd, seedName, sessionId) {
  return join(locksDir(cwd, seedName), `${sessionId}.lock`);
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
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
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

function fallbackProductFiles(root) {
  const files = [];
  const visit = (directory, relativeDirectory = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isDirectory() && PRODUCT_REVISION_EXCLUDED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath, relativePath);
      } else {
        files.push(relativePath);
      }
    }
  };
  visit(root);
  return files;
}

function productFiles(root) {
  const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (listed.status !== 0) {
    return fallbackProductFiles(root);
  }
  return listed.stdout
    .split('\0')
    .filter(Boolean)
    .filter((filePath) => ![...PRODUCT_REVISION_EXCLUDED_DIRECTORIES]
      .some((directory) => filePath === directory || filePath.startsWith(`${directory}/`)))
    .sort();
}

function productRevision(cwd) {
  const root = workspaceRoot(cwd);
  const hash = createHash('sha256').update('seed-product-revision-v1\0');
  for (const filePath of productFiles(root)) {
    const absolutePath = join(root, filePath);
    hash.update(filePath);
    hash.update('\0');
    if (!existsSync(absolutePath)) {
      hash.update('missing\0');
      continue;
    }
    const stat = lstatSync(absolutePath);
    hash.update(String(stat.mode & 0o777));
    hash.update('\0');
    if (stat.isSymbolicLink()) {
      hash.update('symlink\0');
      hash.update(readlinkSync(absolutePath));
    } else if (stat.isFile()) {
      hash.update('file\0');
      hash.update(readFileSync(absolutePath));
    } else {
      hash.update('other\0');
    }
    hash.update('\0');
  }
  return hash.digest('hex');
}

function commandResultHash(result) {
  const { resultHash, ...payload } = result;
  return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
}

function isSharedCommandResult(result) {
  return result && [
    result.productRevision,
    result.producerItemId,
    result.reused,
    result.resultHash,
  ].some((value) => value !== undefined);
}

function assertSharedCommandResult(result, sourcePath, itemId, index) {
  if (!isSharedCommandResult(result)) {
    return;
  }
  const prefix = `Corrupt session state at ${sourcePath}: shared command result ${itemId}[${index}]`;
  const requiredStrings = ['command', 'cwd', 'stdout', 'stderr', 'productRevision', 'producerItemId', 'resultHash'];
  for (const field of requiredStrings) {
    if (typeof result[field] !== 'string' || (field !== 'stdout' && field !== 'stderr' && result[field].length === 0)) {
      throw new Error(`${prefix} requires ${field}.`);
    }
  }
  if (!SHA256_HEX.test(result.productRevision)) {
    throw new Error(`${prefix} productRevision must be a SHA-256 hex digest.`);
  }
  if (!SHA256_HEX.test(result.resultHash) || commandResultHash(result) !== result.resultHash) {
    throw new Error(`${prefix} resultHash does not match the complete stored result.`);
  }
  if (result.cwd !== SESSION_COMMAND_CWD || result.shell !== true || typeof result.reused !== 'boolean') {
    throw new Error(`${prefix} has invalid execution metadata.`);
  }
  if (typeof result.timeoutMs !== 'number' || !Number.isFinite(result.timeoutMs)
    || typeof result.durationMs !== 'number' || !Number.isFinite(result.durationMs)
    || typeof result.executedAt !== 'number' || !Number.isFinite(result.executedAt)
    || typeof result.timedOut !== 'boolean' || typeof result.passed !== 'boolean'
    || !(result.exitCode === null || Number.isInteger(result.exitCode))
    || !(result.signal === null || typeof result.signal === 'string')) {
    throw new Error(`${prefix} is missing complete execution diagnostics.`);
  }
}

function reusedCommandResult(result) {
  const reused = {
    ...structuredClone(result),
    reused: true,
  };
  reused.resultHash = commandResultHash(reused);
  return reused;
}

function producerCommandResult(result, producerItemId) {
  const producer = {
    ...structuredClone(result),
    producerItemId,
    reused: false,
  };
  producer.resultHash = commandResultHash(producer);
  return producer;
}

function fanOutCommandResults(items, resultsByCommand) {
  const producersByCommand = new Map();
  return items.map((item) => ({
    item,
    commands: item.test_commands.map((entry) => {
      if (!resultsByCommand.has(entry.command)) {
        return structuredClone(entry);
      }
      const result = resultsByCommand.get(entry.command);
      const producerItemId = producersByCommand.get(entry.command);
      if (producerItemId) {
        return reusedCommandResult(producerCommandResult(result, producerItemId));
      }
      producersByCommand.set(entry.command, item.id);
      return producerCommandResult(result, item.id);
    }),
  }));
}

function updateSharedCommandConsumers(state, producerItem, results) {
  const producersByCommand = new Map(results
    .filter((result) => result.passed === true && result.reused === false)
    .map((result) => [result.command, result]));
  if (producersByCommand.size === 0) {
    return;
  }
  state.items.forEach((item) => {
    if (item === producerItem || item.status !== 'confirmed' || !Array.isArray(item.test_commands)) {
      return;
    }
    item.test_commands = item.test_commands.map((entry) => {
      const producer = producersByCommand.get(entry.command);
      return producer ? reusedCommandResult(producer) : entry;
    });
  });
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

function runTestCommands(cwd, commands, {
  now,
  producerItemId = 'verification-session',
  reusableResults = [],
} = {}) {
  const normalized = normalizeTestCommands(commands);
  const revision = productRevision(cwd);
  const reusableByCommand = new Map(
    reusableResults
      .filter((result) => (
        isSharedCommandResult(result)
        && result.passed === true
        && result.productRevision === revision
      ))
      .map((result) => [result.command, result]),
  );
  return normalized.map((command) => {
    const reusable = reusableByCommand.get(command);
    if (reusable) {
      return reusedCommandResult(reusable);
    }

    const startedAt = resolveNow(now);
    const started = Date.now();
    const result = spawnSync(command, {
      cwd: workspaceRoot(cwd),
      shell: true,
      encoding: 'utf8',
      timeout: DEFAULT_TEST_COMMAND_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
    const durationMs = Date.now() - started;
    const exitCode = typeof result.status === 'number' ? result.status : null;
    const timedOut = result.error?.code === 'ETIMEDOUT';

    const resultRecord = {
      command,
      cwd: SESSION_COMMAND_CWD,
      shell: true,
      timeoutMs: DEFAULT_TEST_COMMAND_TIMEOUT_MS,
      exitCode,
      signal: result.signal ?? null,
      timedOut,
      passed: exitCode === 0 && !timedOut,
      stdout: result.stdout ?? '',
      stderr: [result.stderr, result.error?.message].filter(Boolean).join('\n'),
      durationMs,
      executedAt: startedAt,
      productRevision: revision,
      producerItemId,
      reused: false,
    };
    const completedRevision = productRevision(cwd);
    if (completedRevision !== revision) {
      throw new Error(`Test command mutated product content and cannot produce reusable evidence: ${command}`);
    }
    resultRecord.resultHash = commandResultHash(resultRecord);
    reusableByCommand.set(command, resultRecord);
    return resultRecord;
  });
}

function assertTransitionCommandResults(itemId, targetStatus, results) {
  if (targetStatus === 'confirmed') {
    const failed = results.filter((entry) => !entry.passed);
    if (failed.length > 0) {
      const diagnostics = failed.map((entry) => {
        const exitCode = entry.exitCode === null ? 'null' : entry.exitCode;
        const signal = entry.signal === null ? 'null' : entry.signal;
        return [
          `[failed] exit=${exitCode} signal=${signal} timedOut=${entry.timedOut} cmd=${entry.command}`,
          'stdout:',
          entry.stdout,
          'stderr:',
          entry.stderr,
        ].join('\n');
      }).join('\n');
      throw new Error(`Cannot confirm item ${itemId}: test command failed\n${diagnostics}`);
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

function assertSessionShape(session, sourcePath, expectedSessionId, expectedSnapshotPath, legacySnapshotPath) {
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

  if (![expectedSnapshotPath, legacySnapshotPath].includes(session.snapshotPath)) {
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

    if (entry.test_commands !== undefined && !Array.isArray(entry.test_commands)) {
      throw new Error(`Corrupt session state at ${sourcePath}: item ${entry.id} test_commands must be an array.`);
    }
    (entry.test_commands ?? []).forEach((result, commandIndex) => {
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new Error(`Corrupt session state at ${sourcePath}: item ${entry.id} has an invalid command result at ${commandIndex}.`);
      }
      assertSharedCommandResult(result, sourcePath, entry.id, commandIndex);
    });

    if (entry.test_command_attempts !== undefined && !Array.isArray(entry.test_command_attempts)) {
      throw new Error(`Corrupt session state at ${sourcePath}: item ${entry.id} test_command_attempts must be an array.`);
    }
    (entry.test_command_attempts ?? []).forEach((attempt, attemptIndex) => {
      const prefix = `Corrupt session state at ${sourcePath}: item ${entry.id} test_command_attempts[${attemptIndex}]`;
      if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt)) {
        throw new Error(`${prefix} must be an object.`);
      }
      if (!['confirmed', 'failed'].includes(attempt.targetStatus)) {
        throw new Error(`${prefix} has invalid targetStatus ${attempt.targetStatus}.`);
      }
      assertFiniteTimestamp(attempt.attemptedAt, `${entry.id} test command attempt attemptedAt`, sourcePath);
      if (!Array.isArray(attempt.test_commands) || attempt.test_commands.length === 0) {
        throw new Error(`${prefix} requires test_commands.`);
      }
      attempt.test_commands.forEach((result, commandIndex) => {
        if (!result || typeof result !== 'object' || Array.isArray(result)) {
          throw new Error(`${prefix} has an invalid command result at ${commandIndex}.`);
        }
        assertSharedCommandResult(result, sourcePath, entry.id, commandIndex);
      });
    });
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
        if (entry[match.index + match[0].length] === ':') {
          continue;
        }
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
      test_command_attempts: [],
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
      test_command_attempts: [],
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

function normalizeStoredSessionPaths(state, cwd, seedName) {
  state.snapshotPath = sessionSnapshotPath(seedName);
  const root = workspaceRoot(cwd);

  state.items.forEach((item) => {
    const commands = [
      ...(item.test_commands ?? []),
      ...(item.test_command_attempts ?? []).flatMap((attempt) => attempt.test_commands ?? []),
    ];
    commands.forEach((command) => {
      if (!command || typeof command !== 'object') {
        return;
      }

      if (command.cwd === root || (typeof command.cwd === 'string' && isAbsolute(command.cwd))) {
        command.cwd = SESSION_COMMAND_CWD;
      }
    });
  });
}

function readSessionState(cwd, seedName, sessionId, sourceLabel) {
  const state = readJsonFile(sessionPath(cwd, seedName, sessionId), sourceLabel);
  const sourceSnapshotPath = snapshotPath(cwd, seedName);
  assertSessionShape(state, sourceLabel, sessionId, sessionSnapshotPath(seedName), sourceSnapshotPath);
  normalizeStoredSessionPaths(state, cwd, seedName);

  if (!existsSync(sourceSnapshotPath)) {
    throw new Error(`Snapshot missing at ${sourceSnapshotPath}.`);
  }

  const snapshotText = readFileSync(sourceSnapshotPath, 'utf8');
  if (seedHash(snapshotText) !== state.seedHash) {
    throw new Error(`Corrupt session state at ${sourceLabel}: seedHash does not match snapshot.`);
  }
  return reconcileSessionState(cwd, seedName, state);
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

function reconcileSessionState(cwd, seedName, state) {
  const root = workspaceRoot(cwd);
  const currentSeedPath = resolve(root, seedPaths(seedName).seedPath);
  if (!existsSync(currentSeedPath)) {
    return state;
  }

  const currentSeed = loadSeed({ cwd, seedName });
  const currentItems = buildSessionItems(currentSeed.document);
  const storedById = new Map(state.items.map((item) => [item.id, item]));
  const preservedFields = [
    'status',
    'claim',
    'attempts',
    'evidence',
    'reason',
    'evidence_files',
    'test_commands',
    'test_command_attempts',
    'seed_evidence',
  ];

  state.items = currentItems.map((current) => {
    const stored = storedById.get(current.id);
    if (!stored || stored.address !== current.address || stored.source !== current.source) {
      return current;
    }

    const reconciled = { ...current };
    preservedFields.forEach((field) => {
      if (stored[field] !== undefined) {
        reconciled[field] = structuredClone(stored[field]);
      }
    });
    return reconciled;
  });
  return state;
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

function globalPolicies(cwd, seedName) {
  const snapshotText = readFileSync(snapshotPath(cwd, seedName), 'utf8');
  const document = parse(snapshotText);
  return globalPoliciesFromDocument(document);
}

function verificationReferences(cwd, seedName, item) {
  const snapshotText = readFileSync(snapshotPath(cwd, seedName), 'utf8');
  const document = parse(snapshotText);
  return verificationReferencesFromDocument(document, item);
}

function currentSeedEvidence(cwd, seedName, item) {
  const seed = loadSeed({ cwd, seedName });
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

function currentSeedAddressExpiration(cwd, seedName, item, changedAddresses) {
  if (!terminalStatus(item) || changedAddresses.size === 0) {
    return null;
  }

  const references = verificationReferences(cwd, seedName, item);
  const referencedAddresses = [
    ...references.addresses.map((entry) => entry.address),
    ...references.artifacts.map((entry) => entry.address),
  ];
  const currentSeed = loadSeed({ cwd, seedName });
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

function currentItemExpiration(cwd, seedName, item, changedAddresses = new Set()) {
  const evidence = currentEvidenceExpiration(cwd, item);
  const testCommand = currentTestCommandExpiration(item);
  const seedAddress = currentSeedAddressExpiration(cwd, seedName, item, changedAddresses);

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

function collectExpiredEvidence(cwd, seedName, items, changedAddresses = new Set()) {
  return items
    .map((item) => currentItemExpiration(cwd, seedName, item, changedAddresses))
    .filter(Boolean);
}

function nextExpiredEvidenceItem(cwd, seedName, items, changedAddresses = new Set()) {
  return items.find((item) => currentItemExpiration(cwd, seedName, item, changedAddresses));
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
  seedName,
  sessionId = DEFAULT_SESSION_ID,
  seedDocument,
  seedText,
  externalReferences = [],
  now,
  lockWaitMs = DEFAULT_LOCK_WAIT_MS,
} = {}) {
  assertSessionId(sessionId);

  if (typeof seedText !== 'string') {
    throw new Error('startSession requires seedText string.');
  }

  assertSeedDocument(seedDocument);

  const nowValue = normalizeNow(now);
  const root = seedRootPath(cwd, seedName);
  const items = buildSessionItems(seedDocument);
  const sourceSnapshotPath = snapshotPath(cwd, seedName);

  const session = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId,
    seedHash: seedHash(seedText),
    createdAt: nowValue,
    updatedAt: nowValue,
    snapshotPath: sessionSnapshotPath(seedName),
    items,
  };

  withLock(lockPath(cwd, seedName, sessionId), () => {
    ensureStateDir(sourceSnapshotPath);
    writeFileSync(sourceSnapshotPath, seedText, 'utf8');
    writeFileSync(dependencySnapshotPath(cwd, seedName), canonicalJson(externalReferences, 2) + '\n', 'utf8');
    writeJsonAtomically(sessionPath(cwd, seedName, sessionId), session);
  }, { waitMs: lockWaitMs });

  return { rootPath: root, session };
}

function claimNext({
  cwd,
  seedName,
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
  const path = sessionPath(cwd, seedName, sessionId);
  const label = `session state ${path}`;
  const lock = lockPath(cwd, seedName, sessionId);

  return withLock(lock, () => {
    const state = readSessionState(cwd, seedName, sessionId, label);
    const recovered = recoverStaleClaims(state.items, nowValue);

    let seedChanges = new Set();
    try {
      seedChanges = new Set(modifiedSeedAddresses(cwd, seedName));
    } catch (error) {
      seedChanges = new Set();
    }
    const next = nextPendingItem(state.items) ?? nextExpiredEvidenceItem(cwd, seedName, state.items, seedChanges);
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
      item: next ? itemSummary(next, verificationReferences(cwd, seedName, next), globalPolicies(cwd, seedName)) : null,
      claim: next ? next.claim : null,
      recoveredIds: recovered.recovered,
      warnings: recovered.recovered.length
        ? [{ code: 'recovered-stale-lease', ids: recovered.recovered }]
        : [],
    };
  }, { waitMs: lockWaitMs });
}

function claimItem({
  cwd,
  seedName,
  itemId,
  sessionId = DEFAULT_SESSION_ID,
  owner = `seed-${Date.now()}`,
  leaseMs = DEFAULT_LEASE_MS,
  now,
  lockWaitMs = DEFAULT_LOCK_WAIT_MS,
} = {}) {
  assertSessionId(sessionId);
  assertOwner(owner);

  if (typeof itemId !== 'string' || itemId.length === 0) {
    throw new Error('claimItem requires a verification item id.');
  }
  if (typeof leaseMs !== 'number' || !Number.isFinite(leaseMs) || leaseMs <= 0) {
    throw new Error('claimItem requires leaseMs to be a positive number.');
  }

  const nowValue = normalizeNow(now);
  const path = sessionPath(cwd, seedName, sessionId);
  const label = `session state ${path}`;
  const lock = lockPath(cwd, seedName, sessionId);

  return withLock(lock, () => {
    const state = readSessionState(cwd, seedName, sessionId, label);
    const recovered = recoverStaleClaims(state.items, nowValue);
    const item = state.items.find((entry) => entry.id === itemId);
    if (!item) {
      throw new Error(`Unknown verification id ${itemId} in session ${sessionId}.`);
    }
    let seedChanges = new Set();
    try {
      seedChanges = new Set(modifiedSeedAddresses(cwd, seedName));
    } catch (error) {
      seedChanges = new Set();
    }
    const expiration = currentItemExpiration(cwd, seedName, item, seedChanges);
    const alreadyClaimed = item.status === 'claimed' && item.claim?.owner === owner;
    if (item.status !== 'pending' && !expiration && !alreadyClaimed) {
      throw new Error(`Cannot claim verification ${itemId}: expected pending, found ${item.status}.`);
    }
    if (!alreadyClaimed) {
      item.status = 'claimed';
      item.claim = {
        owner,
        claimedAt: nowValue,
        leaseUntil: nowValue + leaseMs,
      };
      item.attempts = (item.attempts ?? 0) + 1;
    }
    state.updatedAt = nowValue;
    writeJsonAtomically(path, state);
    return {
      item: itemSummary(item, verificationReferences(cwd, seedName, item), globalPolicies(cwd, seedName)),
      claim: item.claim,
      recoveredIds: recovered.recovered,
      warnings: recovered.recovered.length
        ? [{ code: 'recovered-stale-lease', ids: recovered.recovered }]
        : [],
    };
  }, { waitMs: lockWaitMs });
}

function transitionItem({
  cwd,
  seedName,
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
  const path = sessionPath(cwd, seedName, sessionId);
  const label = `session state ${path}`;
  const lock = lockPath(cwd, seedName, sessionId);

  return withLock(lock, () => {
    const state = readSessionState(cwd, seedName, sessionId, label);
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

    const reusableResults = state.items.flatMap((entry) => (
      Array.isArray(entry.test_commands) ? entry.test_commands : []
    ));
    const testCommandResults = runTestCommands(cwd, testCommands, {
      now,
      producerItemId: itemId,
      reusableResults,
    });
    try {
      assertTransitionCommandResults(itemId, targetStatus, testCommandResults);
    } catch (error) {
      item.test_command_attempts = [
        ...(item.test_command_attempts ?? []),
        {
          targetStatus,
          attemptedAt: nowValue,
          test_commands: structuredClone(testCommandResults),
        },
      ];
      item.test_commands = testCommandResults;
      state.updatedAt = nowValue;
      writeJsonAtomically(path, state);
      throw error;
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
    item.evidence_files = evidenceFiles;
    item.test_commands = testCommandResults;
    if (targetStatus === 'confirmed') {
      updateSharedCommandConsumers(state, item, testCommandResults);
    }
    try {
      item.seed_evidence = currentSeedEvidence(cwd, seedName, item);
    } catch (error) {
      item.seed_evidence = null;
    }
    state.updatedAt = nowValue;

    writeJsonAtomically(path, state);
    return itemSummary(item, verificationReferences(cwd, seedName, item), globalPolicies(cwd, seedName));
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
  seedName,
  sessionId = DEFAULT_SESSION_ID,
  now,
  lockWaitMs = DEFAULT_LOCK_WAIT_MS,
} = {}) {
  assertSessionId(sessionId);

  const nowValue = normalizeNow(now);
  const path = sessionPath(cwd, seedName, sessionId);
  const label = `session state ${path}`;
  const lock = lockPath(cwd, seedName, sessionId);

  return withLock(lock, () => {
    const state = readSessionState(cwd, seedName, sessionId, label);
    const snapshotText = readFileSync(snapshotPath(cwd, seedName), 'utf8');
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
  return canonicalJson(item.value ?? null);
}

function addressFingerprints(document) {
  const errors = [];
  const entries = collectPresentAddressableItems(document, errors);
  if (errors.length > 0) {
    throw new Error('Failed to collect addressable Seed items: ' + errors.map((entry) => entry.message).join('; '));
  }

  return new Map(entries.map((entry) => [entry.address, itemFingerprint(entry)]));
}

function modifiedSeedAddresses(cwd, seedName) {
  const snapshotText = readFileSync(snapshotPath(cwd, seedName), 'utf8');
  const snapshotDocument = parse(snapshotText);
  const currentSeed = loadSeed({ cwd, seedName });
  const snapshotItems = addressFingerprints(snapshotDocument);
  const currentItems = addressFingerprints(currentSeed.document);
  const addresses = new Set([...snapshotItems.keys(), ...currentItems.keys()]);

  return [...addresses]
    .filter((address) => snapshotItems.get(address) !== currentItems.get(address))
    .sort();
}

function summarizeStatus(cwd, seedName, state) {
  let seedChanges = [];
  try {
    seedChanges = modifiedSeedAddresses(cwd, seedName);
  } catch (error) {
    seedChanges = [{ error: error.message }];
  }
  const changedAddresses = new Set(seedChanges.filter((entry) => typeof entry === 'string'));
  const expiredEvidence = collectExpiredEvidence(cwd, seedName, state.items, changedAddresses);
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

function getPendingItems({ cwd, seedName, sessionId = DEFAULT_SESSION_ID } = {}) {
  assertSessionId(sessionId);

  const path = sessionPath(cwd, seedName, sessionId);
  const label = 'session state ' + path;
  const state = readSessionState(cwd, seedName, sessionId, label);
  const seedChanges = new Set(modifiedSeedAddresses(cwd, seedName));
  const expirations = collectExpiredEvidence(cwd, seedName, state.items, seedChanges);
  const expirationById = new Map(expirations.map((entry) => [entry.id, entry]));

  return state.items
    .map((item) => {
      const expiration = expirationById.get(item.id);
      if (expiration) {
        return {
          ...itemSummary(item, verificationReferences(cwd, seedName, item), globalPolicies(cwd, seedName)),
          status: 'expired',
          previousStatus: item.status,
          expiration,
        };
      }

      if (item.status === 'pending') {
        return itemSummary(item, verificationReferences(cwd, seedName, item), globalPolicies(cwd, seedName));
      }

      return null;
    })
    .filter(Boolean);
}

function syncSession({
  cwd,
  seedName,
  externalReferences = [],
  sessionId = DEFAULT_SESSION_ID,
  now,
  lockWaitMs = DEFAULT_LOCK_WAIT_MS,
} = {}) {
  assertSessionId(sessionId);

  const nowValue = normalizeNow(now);
  const path = sessionPath(cwd, seedName, sessionId);
  const label = 'session state ' + path;
  const lock = lockPath(cwd, seedName, sessionId);

  return withLock(lock, () => {
    const state = readSessionState(cwd, seedName, sessionId, label);
    const status = summarizeStatus(cwd, seedName, state);
    if (!status.satisfied) {
      throw new Error('seed verify sync requires the current session to be completed, satisfied, and free of expired evidence.');
    }

    const seed = loadSeed({ cwd, seedName });
    const changedAddresses = new Set(modifiedSeedAddresses(cwd, seedName));
    const oldById = new Map(state.items.map((item) => [item.id, item]));
    const nextItems = buildSessionItems(seed.document).map((item) => {
      const old = oldById.get(item.id);
      if (
        old
        && old.address === item.address
        && ['confirmed', 'failed'].includes(old.status)
        && !currentItemExpiration(cwd, seedName, old, changedAddresses)
      ) {
        return {
          ...item,
          status: old.status,
          attempts: old.attempts ?? item.attempts,
          evidence: old.evidence ?? null,
          reason: old.reason ?? null,
          evidence_files: structuredClone(old.evidence_files ?? []),
          test_commands: structuredClone(old.test_commands ?? []),
          test_command_attempts: structuredClone(old.test_command_attempts ?? []),
          seed_evidence: structuredClone(old.seed_evidence ?? null),
        };
      }
      return item;
    });

    writeFileSync(snapshotPath(cwd, seedName), seed.text, 'utf8');
    writeFileSync(dependencySnapshotPath(cwd, seedName), canonicalJson(externalReferences, 2) + '\n', 'utf8');
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

function verificationAudit({ cwd, seedName, sessionId = DEFAULT_SESSION_ID } = {}) {
  assertSessionId(sessionId);

  const path = sessionPath(cwd, seedName, sessionId);
  const label = 'session state ' + path;
  const state = readSessionState(cwd, seedName, sessionId, label);
  const status = summarizeStatus(cwd, seedName, state);
  const errors = [];
  const warnings = [];
  const commandUsage = new Map();
  const policies = globalPolicies(cwd, seedName);
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
      usage.push({ id: item.id, address: item.address ?? null, result: commandResult });
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
    const sharedResults = usage.map((entry) => entry.result).filter(isSharedCommandResult);
    if (sharedResults.length === usage.length) {
      const groupsByRevision = new Map();
      usage.forEach((entry) => {
        const group = groupsByRevision.get(entry.result.productRevision) ?? [];
        group.push(entry);
        groupsByRevision.set(entry.result.productRevision, group);
      });
      let inconsistent = groupsByRevision.size !== 1;
      groupsByRevision.forEach((entries) => {
        const results = entries.map((entry) => entry.result);
        const executions = new Set(results.map((result) => result.executedAt));
        const producers = new Set(results.map((result) => result.producerItemId));
        const coldEntries = entries.filter((entry) => entry.result.reused === false);
        const producerItemId = producers.size === 1 ? [...producers][0] : null;
        if (
          executions.size !== 1
          || producers.size !== 1
          || coldEntries.length !== 1
          || coldEntries[0].id !== producerItemId
        ) {
          inconsistent = true;
        }
      });
      if (inconsistent) {
        errors.push({
          code: 'duplicate-command-executions',
          id: null,
          address: null,
          message: 'shared test command has multiple producer executions for one product revision',
          command,
          count: usage.length,
          ids,
          addresses,
        });
      }
      return;
    }

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

function verificationReport({ cwd, seedName, sessionId = DEFAULT_SESSION_ID } = {}) {
  assertSessionId(sessionId);

  const path = sessionPath(cwd, seedName, sessionId);
  const label = 'session state ' + path;
  const state = readSessionState(cwd, seedName, sessionId, label);
  const status = summarizeStatus(cwd, seedName, state);
  const audit = verificationAudit({ cwd, seedName, sessionId });
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
    references: itemSummary(item, verificationReferences(cwd, seedName, item)).references,
    evidence_files: structuredClone(item.evidence_files ?? []),
    test_commands: structuredClone(item.test_commands ?? []),
    test_command_attempts: structuredClone(item.test_command_attempts ?? []),
    expiration: expirationsById.get(item.id) ?? null,
    audit_errors: auditErrorsById.get(item.id) ?? [],
    audit_warnings: auditWarningsById.get(item.id) ?? [],
  }));

  return {
    sessionId: state.sessionId,
    status,
    global_policies: globalPolicies(cwd, seedName),
    audit,
    global_errors: globalErrors,
    global_warnings: globalWarnings,
    items,
  };
}

function checkSession({ cwd, seedName, sessionId = DEFAULT_SESSION_ID, now } = {}) {
  assertSessionId(sessionId);

  const path = sessionPath(cwd, seedName, sessionId);
  const label = 'session state ' + path;
  const state = readSessionState(cwd, seedName, sessionId, label);
  const checkedAt = resolveNow(now);
  const terminalItems = state.items.filter((item) => terminalStatus(item));
  const recordedCommands = terminalItems.flatMap((item) => (
    Array.isArray(item.test_commands)
      ? item.test_commands.map((entry) => entry.command)
      : []
  ));
  const uniqueCommandList = Array.from(new Set(recordedCommands));
  const uniqueResults = uniqueCommandList.length > 0
    ? runTestCommands(cwd, uniqueCommandList, { now, producerItemId: 'verify-check' })
    : [];
  const resultsByCommand = new Map(uniqueResults.map((result) => [result.command, result]));
  const fannedResults = new Map(fanOutCommandResults(
    terminalItems.filter((item) => Array.isArray(item.test_commands) && item.test_commands.length > 0),
    resultsByCommand,
  ).map(({ item, commands }) => [item.id, commands]));
  const items = terminalItems.map((item) => {
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

    const commands = fannedResults.get(item.id);
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
    recordedCommandTotal: recordedCommands.length,
    uniqueCommandTotal: uniqueCommandList.length,
    ok: failed === 0,
    items,
  };
}

function refreshExpiredEvidence({
  cwd,
  seedName,
  sessionId = DEFAULT_SESSION_ID,
  owner,
  now,
  lockWaitMs = DEFAULT_LOCK_WAIT_MS,
} = {}) {
  assertSessionId(sessionId);
  assertOwner(owner);

  const path = sessionPath(cwd, seedName, sessionId);
  const label = 'session state ' + path;
  const lock = lockPath(cwd, seedName, sessionId);

  return withLock(lock, () => {
    const state = readSessionState(cwd, seedName, sessionId, label);
    const status = summarizeStatus(cwd, seedName, state);
    const modifiedAddresses = status.modifiedSeedAddresses ?? [];
    const modifiedAddressErrors = modifiedAddresses
      .filter((entry) => entry && typeof entry === 'object' && typeof entry.error === 'string')
      .map((entry) => entry.error);
    if (modifiedAddressErrors.length > 0) {
      throw new Error(
        'Cannot mechanically refresh evidence because Seed address comparison failed: '
        + modifiedAddressErrors.join('; '),
      );
    }
    if (modifiedAddresses.length > 0) {
      throw new Error(
        'Cannot mechanically refresh evidence while Seed addresses are modified: '
        + modifiedAddresses.filter((entry) => typeof entry === 'string').join(', '),
      );
    }
    if (status.expired === 0) {
      throw new Error('No expired verification evidence is available to refresh.');
    }
    const newPending = status.pending - status.expired;
    if (
      newPending !== 0
      || status.claimed !== 0
      || status.failed !== 0
      || status.blocked !== 0
      || status.needs_review !== 0
    ) {
      throw new Error(
        'Mechanical evidence refresh requires an expiry-only queue: '
        + `pending=${newPending} claimed=${status.claimed} failed=${status.failed} `
        + `blocked=${status.blocked} needs_review=${status.needs_review}`,
      );
    }
    const unsupported = status.expiredEvidence.filter((entry) => entry.kind !== 'evidence-file');
    if (unsupported.length > 0) {
      throw new Error(
        'Mechanical evidence refresh supports evidence-file expiry only: '
        + unsupported.map((entry) => entry.id).join(', '),
      );
    }

    const expiredIds = new Set(status.expiredIds);
    const expiredItems = state.items.filter((item) => expiredIds.has(item.id));
    for (const item of expiredItems) {
      if (item.status !== 'confirmed') {
        throw new Error(
          `Mechanical evidence refresh requires prior confirmed state for ${item.id}; found ${item.status}.`,
        );
      }
      if (!Array.isArray(item.evidence_files) || item.evidence_files.length === 0) {
        throw new Error(`Mechanical evidence refresh requires evidence files for ${item.id}.`);
      }
      if (!Array.isArray(item.test_commands) || item.test_commands.length === 0) {
        throw new Error(`Mechanical evidence refresh requires test commands for ${item.id}.`);
      }
    }

    const recordedCommands = expiredItems.flatMap((item) => (
      Array.isArray(item.test_commands)
        ? item.test_commands.map((entry) => entry.command)
        : []
    ));
    const uniqueCommandList = Array.from(new Set(recordedCommands));
    const uniqueResults = uniqueCommandList.length > 0
      ? runTestCommands(cwd, uniqueCommandList, { now, producerItemId: 'refresh-expired' })
      : [];
    const failedCommands = uniqueResults.filter((result) => !result.passed);
    if (failedCommands.length > 0) {
      return {
        sessionId,
        owner,
        ok: false,
        refreshed: 0,
        refreshedIds: [],
        recordedCommandTotal: recordedCommands.length,
        uniqueCommandTotal: uniqueCommandList.length,
        failedCommands,
      };
    }

    const resultsByCommand = new Map(
      uniqueResults.map((result) => [result.command, result]),
    );
    const affectedCommands = new Set(uniqueCommandList);
    const affectedItems = state.items.filter((item) => (
      item.status === 'confirmed'
      && Array.isArray(item.test_commands)
      && item.test_commands.some((entry) => affectedCommands.has(entry.command))
    ));
    const fannedResults = fanOutCommandResults(affectedItems, resultsByCommand);
    for (const { item, commands } of fannedResults) {
      item.test_commands = commands;
    }
    for (const item of expiredItems) {
      item.evidence_files = hashEvidenceFiles(
        cwd,
        item.evidence_files.map((entry) => entry.path),
      );
      try {
        item.seed_evidence = currentSeedEvidence(cwd, seedName, item);
      } catch (error) {
        item.seed_evidence = null;
      }
    }
    state.updatedAt = resolveNow(now);
    writeJsonAtomically(path, state);
    return {
      sessionId,
      owner,
      ok: true,
      refreshed: expiredItems.length,
      refreshedIds: expiredItems.map((item) => item.id),
      recordedCommandTotal: recordedCommands.length,
      uniqueCommandTotal: uniqueCommandList.length,
      failedCommands: [],
    };
  }, { waitMs: lockWaitMs });
}

function getStatus({ cwd, seedName, sessionId = DEFAULT_SESSION_ID } = {}) {
  assertSessionId(sessionId);

  const path = sessionPath(cwd, seedName, sessionId);
  const label = 'session state ' + path;
  const state = readSessionState(cwd, seedName, sessionId, label);
  return summarizeStatus(cwd, seedName, state);
}

module.exports = {
  startSession,
  claimItem,
  claimNext,
  confirmItem,
  failItem,
  resetSession,
  syncSession,
  getStatus,
  getPendingItems,
  checkSession,
  refreshExpiredEvidence,
  verificationAudit,
  verificationReport,
};
