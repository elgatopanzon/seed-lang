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
  applyLineWindow,
  compileBlueprint,
  pageOutput,
  renderMarkdown,
} = require('./blueprint');
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
    'seed blueprint [--json] [--section ID] [--filter @ADDRESS] [--limit N] [--offset N] [--head N] [--tail N] [--pager]',
    'seed verify start',
    'seed verify next',
    'seed verify confirm <constraint-id> [--evidence TEXT]',
    'seed verify fail <constraint-id> [--reason TEXT]',
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

function parseConstraintActionArgs(args, command, optionName) {
  if (args.length === 0 || args[0].startsWith('-')) {
    return { error: `seed verify ${command} requires exactly one <constraint-id>.` };
  }

  const constraintId = args[0];

  if (args.length === 1) {
    return { constraintId, payload: undefined };
  }

  const option = `--${optionName}`;
  if (args.length === 2) {
    if (args[1] === option) {
      return { error: `seed verify ${command} ${option} requires a value.` };
    }

    if (args[1].startsWith('--')) {
      return { error: `Unknown option for seed verify ${command}: ${args[1]}` };
    }

    return { error: `seed verify ${command} requires exactly one <constraint-id>.` };
  }

  if (args.length > 3) {
    return { error: `Unknown option for seed verify ${command}: ${args[1]}` };
  }

  if (args[1] !== option) {
    return { error: `Unknown option for seed verify ${command}: ${args[1]}` };
  }

  if (args[2] === undefined || args[2].startsWith('--') || args[2] === '') {
    return { error: `seed verify ${command} ${option} requires a value.` };
  }

  return {
    constraintId,
    payload: args[2],
  };
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

function parseNonNegativeInteger(value, option) {
  if (value === undefined || value === '' || value.startsWith('-')) {
    return { error: `${option} requires a non-negative integer.` };
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return { error: `${option} requires a non-negative integer.` };
  }

  return { value: parsed };
}

function parseBlueprintArgs(args) {
  const options = {
    filters: [],
    json: false,
    pager: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--pager') {
      options.pager = true;
    } else if (arg === '--filter') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        return { error: '--filter requires an @address value.' };
      }
      options.filters.push(value);
      index += 1;
    } else if (arg === '--section') {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        return { error: '--section requires a section id.' };
      }
      options.section = value;
      index += 1;
    } else if (['--limit', '--offset', '--head', '--tail'].includes(arg)) {
      const parsed = parseNonNegativeInteger(args[index + 1], arg);
      if (parsed.error) {
        return parsed;
      }
      options[arg.slice(2)] = parsed.value;
      index += 1;
    } else {
      return { error: `Unknown option for seed blueprint: ${arg}` };
    }
  }

  return { options };
}

function handleBlueprint(cwd, args) {
  const parsed = parseBlueprintArgs(args);
  if (parsed.error) {
    return exitWithError(parsed.error);
  }

  let seed;
  try {
    seed = ensureSeedReady(cwd);
  } catch (error) {
    return exitWithError(error.message);
  }

  try {
    const blueprint = compileBlueprint({
      document: seed.document,
      seedPath: DEFAULT_SEED_PATH,
      genomes: seed.genomes ?? [],
      filters: parsed.options.filters,
      section: parsed.options.section,
      limit: parsed.options.limit,
      offset: parsed.options.offset,
    });

    if (parsed.options.json) {
      console.log(JSON.stringify(blueprint, null, 2));
      return 0;
    }

    const rendered = applyLineWindow(renderMarkdown(blueprint), {
      head: parsed.options.head,
      tail: parsed.options.tail,
    });

    if (parsed.options.pager) {
      return pageOutput(rendered);
    }

    process.stdout.write(rendered);
    return 0;
  } catch (error) {
    return exitWithError(error.message);
  }
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
  if (result.item.source) {
    console.log(`source: ${result.item.source}`);
  }

  if (result.item.title) {
    console.log(`title: ${result.item.title}`);
  }

  if (result.item.description) {
    console.log(`description: ${result.item.description}`);
  }

  if (Array.isArray(result.item.artifacts) && result.item.artifacts.length > 0) {
    console.log(`artifacts: ${result.item.artifacts.join(', ')}`);
  }

  if (Array.isArray(result.item.evidence_required) && result.item.evidence_required.length > 0) {
    console.log(`evidence required: ${result.item.evidence_required.join('; ')}`);
  }

  return 0;
}

function handleVerifyConfirm(cwd, constraintId, evidence) {
  try {
    const item = confirmItem({
      cwd,
      itemId: constraintId,
      owner: DEFAULT_OWNER,
      evidence,
    });

    console.log(`Confirmed verification ${constraintId}`);
    console.log(`status: ${item.status}`);
    return 0;
  } catch (error) {
    return exitWithError(error.message);
  }
}

function handleVerifyFail(cwd, constraintId, reason) {
  try {
    const item = failItem({
      cwd,
      itemId: constraintId,
      owner: DEFAULT_OWNER,
      reason,
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

  if (command === 'blueprint') {
    return handleBlueprint(process.cwd(), rest);
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
      const parsed = parseConstraintActionArgs(subRest, 'confirm', 'evidence', 'evidence');
      if (parsed.error) {
        return exitWithError(parsed.error);
      }

      return handleVerifyConfirm(process.cwd(), parsed.constraintId, parsed.payload);
    }

    if (subcommand === 'fail') {
      const parsed = parseConstraintActionArgs(subRest, 'fail', 'reason', 'reason');
      if (parsed.error) {
        return exitWithError(parsed.error);
      }

      return handleVerifyFail(process.cwd(), parsed.constraintId, parsed.payload);
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
