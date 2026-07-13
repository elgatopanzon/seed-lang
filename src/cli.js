#!/usr/bin/env node
'use strict';

const path = require('node:path');
const {
  DEFAULT_SEED_PATH,
  initSeed,
  loadSeed,
} = require('./seed-file');
const { validateGenomeDocument, validateSeedDocument } = require('./validation');
const {
  applyLineWindow,
  compileBlueprint,
  pageOutput,
  renderMarkdown,
} = require('./blueprint');
const {
  compileGenomeDocument,
  initRepoGenome,
  listGenomeDefinitions,
  validateGenomeDefinitions,
} = require('./genomes');
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
    'seed init [--overwrite] [--genome ID] [--genomes ID[,ID...]]',
    'seed validate',
    'seed genome list [--builtin] [--user] [--repo]',
    'seed genome init <name> [--overwrite]',
    'seed genome validate [--builtin] [--user] [--repo]',
    'seed genome blueprint <name> [--json] [--section ID] [--filter @ADDRESS] [--limit N] [--offset N] [--head N] [--tail N] [--pager]',
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

function splitGenomeList(value) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseInitArgs(args) {
  const options = {
    overwrite: false,
    genomes: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--overwrite') {
      options.overwrite = true;
    } else if (['--genome', '--genomes'].includes(arg)) {
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        return { error: `${arg} requires a genome id or comma-separated genome list.` };
      }

      const genomes = splitGenomeList(value);
      if (genomes.length === 0) {
        return { error: `${arg} requires a genome id or comma-separated genome list.` };
      }

      options.genomes.push(...genomes);
      index += 1;
    } else if (arg.startsWith('-')) {
      return { error: `Unknown option for seed init: ${arg}` };
    } else {
      return { error: `seed init does not take positional arguments: ${arg}` };
    }
  }

  return { options };
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

function parseOriginFilters(args, command) {
  const origins = [];
  const rest = [];

  for (const arg of args) {
    if (arg === '--builtin' || arg === '--builtins') {
      origins.push('builtin');
    } else if (arg === '--user') {
      origins.push('user');
    } else if (arg === '--repo') {
      origins.push('repo');
    } else if (arg.startsWith('-')) {
      return { error: `Unknown option for ${command}: ${arg}` };
    } else {
      rest.push(arg);
    }
  }

  return {
    origins: [...new Set(origins)],
    rest,
  };
}

function formatGenomeEntry(entry) {
  return `${entry.origin}\t${entry.id}\t${entry.path}`;
}

function handleGenomeList(cwd, args) {
  const parsed = parseOriginFilters(args, 'seed genome list');
  if (parsed.error) {
    return exitWithError(parsed.error);
  }
  if (parsed.rest.length > 0) {
    return exitWithError(`seed genome list does not take positional arguments: ${parsed.rest[0]}`);
  }

  const entries = listGenomeDefinitions({ cwd, origins: parsed.origins });
  entries.forEach((entry) => console.log(formatGenomeEntry(entry)));
  return 0;
}

function handleGenomeInit(cwd, args) {
  let overwrite = false;
  const names = [];

  for (const arg of args) {
    if (arg === '--overwrite') {
      overwrite = true;
    } else if (arg.startsWith('-')) {
      return exitWithError(`Unknown option for seed genome init: ${arg}`);
    } else {
      names.push(arg);
    }
  }

  if (names.length !== 1) {
    return exitWithError('seed genome init requires exactly one <name>.');
  }

  try {
    const created = initRepoGenome({ cwd, id: names[0], overwrite });
    console.log(`Initialized repo genome ${created.id} at ${created.path}`);
    return 0;
  } catch (error) {
    return exitWithError(error.message);
  }
}

function handleGenomeValidate(cwd, args) {
  const parsed = parseOriginFilters(args, 'seed genome validate');
  if (parsed.error) {
    return exitWithError(parsed.error);
  }
  if (parsed.rest.length > 0) {
    return exitWithError(`seed genome validate does not take positional arguments: ${parsed.rest[0]}`);
  }

  const results = validateGenomeDefinitions({ cwd, origins: parsed.origins });
  const failed = results.filter((entry) => entry.errors.length > 0);

  if (failed.length === 0) {
    console.log(`All genomes valid (${results.length} checked).`);
    return 0;
  }

  console.log(`Failed genomes (${failed.length}/${results.length}):`);
  failed.forEach((entry) => {
    console.log(`- ${entry.origin}\t${entry.id}\t${entry.path ?? ''}`);
    printIssues('error', entry.errors);
  });
  return exitWithError('Genome validation failed.');
}

function handleGenomeBlueprint(cwd, args) {
  if (args.length === 0 || args[0].startsWith('-')) {
    return exitWithError('seed genome blueprint requires exactly one <name>.');
  }

  const [name, ...blueprintArgs] = args;
  const parsed = parseBlueprintArgs(blueprintArgs);
  if (parsed.error) {
    return exitWithError(parsed.error);
  }

  try {
    const genome = compileGenomeDocument({ id: name, cwd });
    const validation = validateGenomeDocument(genome.document);
    printValidationResult(validation);
    if (validation.errors.length > 0) {
      return exitWithError(`Genome validation failed with ${validation.errors.length} structural error(s).`);
    }

    const blueprint = compileBlueprint({
      document: genome.document,
      seedPath: genome.path,
      genomes: genome.genomes ?? [],
      provenance: genome.provenance ?? {},
      filters: parsed.options.filters,
      section: parsed.options.section,
      limit: parsed.options.limit,
      offset: parsed.options.offset,
      partial: true,
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

function handleGenome(cwd, args) {
  if (args.length === 0) {
    return exitWithError('seed genome requires a subcommand.');
  }

  const [subcommand, ...rest] = args;
  if (subcommand === 'list') {
    return handleGenomeList(cwd, rest);
  }
  if (subcommand === 'init') {
    return handleGenomeInit(cwd, rest);
  }
  if (subcommand === 'validate') {
    return handleGenomeValidate(cwd, rest);
  }
  if (subcommand === 'blueprint') {
    return handleGenomeBlueprint(cwd, rest);
  }

  return exitWithError(`Unknown genome subcommand ${subcommand}.`);
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
      provenance: seed.provenance ?? {},
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
    const parsed = parseInitArgs(rest);
    if (parsed.error) {
      return exitWithError(parsed.error);
    }

    try {
      const created = initSeed({
        cwd: process.cwd(),
        overwrite: parsed.options.overwrite,
        genomes: parsed.options.genomes,
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

  if (command === 'genome') {
    return handleGenome(process.cwd(), rest);
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
