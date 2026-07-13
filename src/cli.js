#!/usr/bin/env node
'use strict';

const path = require('node:path');
const {
  DEFAULT_SEED_PATH,
  initSeed,
  loadSeed,
} = require('./seed-file');
const { validateSeedDocument } = require('./validation');
const {
  claimNext,
  confirmItem,
  failItem,
  getStatus,
  startSession,
} = require('./verification-store');

const DEFAULT_OWNER = 'seed-cli';

function usage() {
  return [
    'seed init [--overwrite]',
    'seed validate',
    'seed verify start',
    'seed verify next',
    'seed verify confirm <constraint-id>',
    'seed verify fail <constraint-id>',
    'seed verify status',
    '',
    `seed source defaults to ${DEFAULT_SEED_PATH} and current working directory`,
    'default session id is \'default\'',
  ].join('\n');
}

function printIssues(title, issues) {
  issues.forEach((issue) => {
    console.log(`- ${issue.code} ${issue.path}: ${issue.message}`);
  });
}

function printValidationResult(result) {
  const { errors, warnings } = result;

  if (warnings.length > 0) {
    console.log(`Warnings (${warnings.length}):`);
    printIssues('warning', warnings);
  }

  if (errors.length > 0) {
    console.log(`Errors (${errors.length}):`);
    printIssues('error', errors);
  }
}

function exitWithError(message) {
  console.error(`Error: ${message}`);
  return 1;
}

function ensureNoExtraArgs(args, allowed) {
  if (args.length !== allowed) {
    return false;
  }

  return args.every((item) => !item.startsWith('-'));
}

function handleValidate(cwd) {
  let seed;

  try {
    seed = loadSeed({ cwd });
  } catch (error) {
    return exitWithError(error.message);
  }

  const result = validateSeedDocument(seed.document);
  printValidationResult(result);

  if (result.errors.length > 0) {
    return exitWithError('Seed validation failed with structural errors.');
  }

  console.log(`Seed contract valid at ${seed.path}`);
  return 0;
}

function ensureSeedReady(cwd) {
  let seed;

  try {
    seed = loadSeed({ cwd });
  } catch (error) {
    throw error;
  }

  const validation = validateSeedDocument(seed.document);
  printValidationResult(validation);

  if (validation.errors.length > 0) {
    throw new Error(`Seed validation failed with ${validation.errors.length} structural error(s).`);
  }

  return seed;
}

function handleVerifyStart(cwd) {
  const seed = ensureSeedReady(cwd);
  const started = startSession({
    cwd,
    seedDocument: seed.document,
    seedText: seed.text,
  });

  console.log(`Started verification session '${started.session.sessionId}'.`);
  console.log(`Session file: ${path.join(cwd, '.seed', 'sessions', `${started.session.sessionId}.json`)}`);
  return 0;
}

function handleVerifyNext(cwd) {
  const result = claimNext({
    cwd,
    owner: DEFAULT_OWNER,
  });

  result.warnings.forEach((warning) => {
    console.log(`Warning: ${warning.code} ${warning.ids.join(', ')}`);
  });

  if (!result.item) {
    console.log('No pending verification items.');
    return 0;
  }

  console.log(`Claimed verification ${result.item.id}`);
  if (result.item.title) {
    console.log(`title: ${result.item.title}`);
  }

  if (result.item.description) {
    console.log(`description: ${result.item.description}`);
  }

  if (Array.isArray(result.item.evidenceGuidance) && result.item.evidenceGuidance.length > 0) {
    console.log(`evidence guidance: ${result.item.evidenceGuidance.join('; ')}`);
  }

  return 0;
}

function handleVerifyConfirm(cwd, constraintId) {
  try {
    const item = confirmItem({
      cwd,
      itemId: constraintId,
      owner: DEFAULT_OWNER,
      evidence: `Confirmed through CLI for ${constraintId}`,
    });

    console.log(`Confirmed verification ${constraintId}`);
    console.log(`status: ${item.status}`);
    return 0;
  } catch (error) {
    return exitWithError(error.message);
  }
}

function handleVerifyFail(cwd, constraintId) {
  try {
    const item = failItem({
      cwd,
      itemId: constraintId,
      owner: DEFAULT_OWNER,
      reason: `Failed through CLI for ${constraintId}`,
    });

    console.log(`Marked verification ${constraintId} as failed`);
    console.log(`status: ${item.status}`);
    return 0;
  } catch (error) {
    return exitWithError(error.message);
  }
}

function handleVerifyStatus(cwd) {
  const status = getStatus({ cwd });
  console.log(JSON.stringify(status, null, 2));
  return 0;
}

function run(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    console.log(usage());
    return 0;
  }

  const [command, ...rest] = argv;

  if (command === 'init') {
    const allowed = rest.filter((item) => item.startsWith('-'));
    if (allowed.some((item) => item !== '--overwrite') || !ensureNoExtraArgs(rest.filter((item) => !item.startsWith('-')), 0)) {
      return exitWithError(`Unknown option for seed init: ${allowed.join(' ')}`);
    }

    try {
      const created = initSeed({
        cwd: process.cwd(),
        overwrite: rest.includes('--overwrite'),
      });
      console.log(`Initialized seed contract at ${created.path}`);
      return 0;
    } catch (error) {
      return exitWithError(error.message);
    }
  }

  if (command === 'validate') {
    if (rest.length !== 0) {
      return exitWithError('seed validate does not take positional arguments.');
    }

    return handleValidate(process.cwd());
  }

  if (command === 'verify') {
    if (rest.length === 0) {
      return exitWithError('seed verify requires a subcommand.');
    }

    const [subcommand, ...subRest] = rest;

    if (subcommand === 'start') {
      if (!ensureNoExtraArgs(subRest, 0)) {
        return exitWithError('seed verify start does not take arguments.');
      }

      try {
        return handleVerifyStart(process.cwd());
      } catch (error) {
        return exitWithError(error.message);
      }
    }

    if (subcommand === 'next') {
      if (!ensureNoExtraArgs(subRest, 0)) {
        return exitWithError('seed verify next does not take arguments.');
      }

      try {
        return handleVerifyNext(process.cwd());
      } catch (error) {
        return exitWithError(error.message);
      }
    }

    if (subcommand === 'confirm') {
      if (!ensureNoExtraArgs(subRest, 1)) {
        return exitWithError('seed verify confirm requires exactly one <constraint-id>.');
      }

      const [id] = subRest;
      return handleVerifyConfirm(process.cwd(), id);
    }

    if (subcommand === 'fail') {
      if (!ensureNoExtraArgs(subRest, 1)) {
        return exitWithError('seed verify fail requires exactly one <constraint-id>.');
      }

      const [id] = subRest;
      return handleVerifyFail(process.cwd(), id);
    }

    if (subcommand === 'status') {
      if (!ensureNoExtraArgs(subRest, 0)) {
        return exitWithError('seed verify status does not take arguments.');
      }

      try {
        return handleVerifyStatus(process.cwd());
      } catch (error) {
        return exitWithError(error.message);
      }
    }

    return exitWithError(`Unknown verify subcommand ${subcommand}.`);
  }

  return exitWithError(`Unknown command ${command}.`);
}

if (require.main === module) {
  process.exit(run());
}

module.exports = { run };
