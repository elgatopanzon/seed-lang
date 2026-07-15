#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
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
const { getSeedDiff } = require('./diff');
const {
  compileGenomeDocument,
  initRepoGenome,
  listGenomeDefinitions,
  validateGenomeDefinitions,
} = require('./genomes');
const {
  checkSession,
  verificationAudit,
  verificationReport,
  claimNext,
  confirmItem,
  failItem,
  getPendingItems,
  getStatus,
  resetSession,
  startSession,
  syncSession,
} = require('./verification-store');

const DEFAULT_OWNER = 'seed-cli';

function usage() {
  return [
    'seed [--repo PATH] <command> [options]',
    '',
    'seed init [--overwrite] [--genome ID] [--genomes ID[,ID...]]',
    'seed validate',
    'seed diff [--no-color]',
    'seed genome list [--builtin] [--user] [--repo]',
    'seed genome init <name> [--overwrite]',
    'seed genome validate [--builtin] [--user] [--repo]',
    'seed genome blueprint <name> [--json] [--section ID] [--filter @ADDRESS] [--limit N] [--offset N] [--head N] [--tail N] [--pager]',
    'seed blueprint [--json] [--section ID] [--filter @ADDRESS] [--limit N] [--offset N] [--head N] [--tail N] [--pager]',
    'seed verify start',
    'seed verify reset',
    'seed verify sync',
    'seed verify next [--owner OWNER]',
    'seed verify pending',
    'seed verify check',
    'seed verify audit',
    'seed verify report',
    'seed verify confirm <constraint-id> --owner OWNER --file PATH [--file PATH...] --test-cmd CMD [--test-cmd CMD...] [--evidence TEXT]',
    'seed verify fail <constraint-id> --owner OWNER --file PATH [--file PATH...] --test-cmd CMD [--test-cmd CMD...] [--reason TEXT]',
    'seed verify status',
    '',
    `seed source defaults to ${DEFAULT_SEED_PATH} and current working directory unless --repo PATH is provided`,
    'default session id is \'default\'',
  ].join('\n');
}

function parseGlobalArgs(argv, invocationCwd = process.cwd()) {
  const rest = [...argv];
  let repoPath = invocationCwd;

  while (rest[0] === '--repo') {
    const value = rest[1];
    if (!value || value.startsWith('-')) {
      return { error: '--repo requires a repository path.' };
    }

    repoPath = path.resolve(invocationCwd, value);
    rest.splice(0, 2);
  }

  if (!fs.existsSync(repoPath)) {
    return { error: '--repo path does not exist: ' + repoPath };
  }

  if (!fs.statSync(repoPath).isDirectory()) {
    return { error: '--repo path is not a directory: ' + repoPath };
  }

  return { cwd: repoPath, argv: rest };
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

function readOptionValue(args, index, option, command) {
  const value = args[index + 1];
  if (value === undefined || value === '' || value.startsWith('--')) {
    return { error: `seed verify ${command} ${option} requires a value.` };
  }
  return { value };
}

function parseVerifyNextArgs(args) {
  const options = { owner: DEFAULT_OWNER };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--owner') {
      const parsed = readOptionValue(args, index, '--owner', 'next');
      if (parsed.error) {
        return parsed;
      }
      options.owner = parsed.value;
      index += 1;
    } else if (arg.startsWith('-')) {
      return { error: `Unknown option for seed verify next: ${arg}` };
    } else {
      return { error: `seed verify next does not take positional arguments: ${arg}` };
    }
  }

  return { options };
}

function parseConstraintActionArgs(args, command, optionName) {
  if (args.length === 0 || args[0].startsWith('-')) {
    return { error: `seed verify ${command} requires exactly one <constraint-id>.` };
  }

  const constraintId = args[0];
  const option = `--${optionName}`;
  const parsed = {
    constraintId,
    payload: undefined,
    owner: undefined,
    files: [],
    testCommands: [],
  };

  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === option) {
      const value = readOptionValue(args, index, option, command);
      if (value.error) {
        return value;
      }
      parsed.payload = value.value;
      index += 1;
    } else if (arg === '--file') {
      const value = readOptionValue(args, index, '--file', command);
      if (value.error) {
        return value;
      }
      parsed.files.push(value.value);
      index += 1;
    } else if (arg === '--test-cmd') {
      const value = readOptionValue(args, index, '--test-cmd', command);
      if (value.error) {
        return value;
      }
      parsed.testCommands.push(value.value);
      index += 1;
    } else if (arg === '--owner') {
      const value = readOptionValue(args, index, '--owner', command);
      if (value.error) {
        return value;
      }
      parsed.owner = value.value;
      index += 1;
    } else if (arg.startsWith('-')) {
      return { error: `Unknown option for seed verify ${command}: ${arg}` };
    } else {
      return { error: `seed verify ${command} requires exactly one <constraint-id>.` };
    }
  }

  if (!parsed.owner) {
    return { error: `owner invalid: seed verify ${command} requires --owner.` };
  }

  if (parsed.files.length === 0) {
    return { error: `seed verify ${command} requires at least one --file path.` };
  }

  if (parsed.testCommands.length === 0) {
    return { error: `seed verify ${command} requires at least one --test-cmd command.` };
  }

  return parsed;
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

function handleDiff(cwd, args) {
  let noColor = false;

  for (const arg of args) {
    if (arg === '--no-color') {
      noColor = true;
    } else {
      return exitWithError(`Unknown option for seed diff: ${arg}`);
    }
  }

  try {
    const diff = getSeedDiff({ cwd, noColor });
    process.stdout.write(diff.text);
    return 0;
  } catch (error) {
    return exitWithError(error.message);
  }
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

function padRight(value, width) {
  return String(value).padEnd(width, ' ');
}

function terminalWidth() {
  const envColumns = Number.parseInt(process.env.COLUMNS ?? '', 10);
  if (Number.isFinite(envColumns) && envColumns > 0) {
    return envColumns;
  }

  return process.stdout.columns || 80;
}

function wrapText(value, width) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length === 0) {
    return [''];
  }

  const lines = [];
  let line = '';
  text.split(' ').forEach((word) => {
    if (line.length === 0) {
      while (word.length > width) {
        lines.push(word.slice(0, width));
        word = word.slice(width);
      }
      line = word;
      return;
    }

    if (line.length + 1 + word.length <= width) {
      line += ' ' + word;
      return;
    }

    lines.push(line);
    while (word.length > width) {
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    line = word;
  });

  if (line.length > 0) {
    lines.push(line);
  }

  return lines;
}

function formatGenomeList(entries, columns = terminalWidth()) {
  if (entries.length === 0) {
    return 'No genomes found.';
  }

  const rows = entries.map((entry) => ({
    origin: entry.origin,
    id: entry.id,
    source: entry.path,
    description: entry.description ?? '',
  }));
  const headers = {
    origin: 'Origin',
    id: 'Genome',
    source: 'Source',
    description: 'Description',
  };
  const widths = {
    origin: Math.max(headers.origin.length, ...rows.map((row) => row.origin.length)),
    id: Math.max(headers.id.length, ...rows.map((row) => row.id.length)),
    source: Math.max(headers.source.length, ...rows.map((row) => row.source.length)),
  };
  const prefixWidth = widths.origin + widths.id + widths.source + 6;
  const descriptionWidth = Math.max(headers.description.length, columns - prefixWidth);
  const rowPrefix = (row) => [
    padRight(row.origin, widths.origin),
    padRight(row.id, widths.id),
    padRight(row.source, widths.source),
  ].join('  ');
  const formatWrappedRow = (row) => {
    const lines = wrapText(row.description, descriptionWidth);
    const continuationPrefix = ' '.repeat(prefixWidth);
    return lines.map((line, index) => {
      const prefix = index === 0 ? rowPrefix(row) + '  ' : continuationPrefix;
      return (prefix + line).replace(/\s+$/, '');
    });
  };
  const separator = [
    '-'.repeat(widths.origin),
    '-'.repeat(widths.id),
    '-'.repeat(widths.source),
    '-'.repeat(descriptionWidth),
  ].join('  ');

  return [
    rowPrefix(headers) + '  ' + headers.description,
    separator,
    ...rows.flatMap(formatWrappedRow),
  ].join('\n');
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
  console.log(formatGenomeList(entries));
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

function handleVerifyNext(cwd, owner = DEFAULT_OWNER) {
  const result = claimNext({
    cwd,
    owner,
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

  if (result.item.method) {
    console.log(`method: ${result.item.method}`);
  }

  if (Array.isArray(result.item.evidence_required) && result.item.evidence_required.length > 0) {
    console.log(`evidence required: ${result.item.evidence_required.join('; ')}`);
  }

  if (Array.isArray(result.item.globalPolicies) && result.item.globalPolicies.length > 0) {
    console.log('global policies:');
    result.item.globalPolicies.forEach((entry) => {
      const description = entry.description ? ' - ' + entry.description : '';
      console.log('- @' + entry.address + description);
    });
  }

  if (result.item.references?.addresses?.length > 0) {
    console.log('referenced addresses:');
    result.item.references.addresses.forEach((entry) => {
      const description = entry.description ? ` - ${entry.description}` : '';
      console.log(`- @${entry.address}${description}`);
    });
  }

  if (result.item.references?.artifacts?.length > 0) {
    console.log('referenced artifacts:');
    result.item.references.artifacts.forEach((entry) => {
      const location = entry.path ? ` path=${entry.path}` : '';
      const description = entry.description ? ` - ${entry.description}` : '';
      console.log(`- @${entry.id} (${entry.address})${location}${description}`);
    });
  }

  if (result.item.references?.unresolved?.length > 0) {
    console.log(`unresolved references: ${result.item.references.unresolved.map((entry) => `@${entry}`).join(', ')}`);
  }

  return 0;
}

function handleVerifyConfirm(cwd, constraintId, owner, evidence, files, testCommands) {
  try {
    const item = confirmItem({
      cwd,
      itemId: constraintId,
      owner,
      evidence,
      files,
      testCommands,
    });

    console.log(`Confirmed verification ${constraintId}`);
    console.log(`status: ${item.status}`);
    return 0;
  } catch (error) {
    return exitWithError(error.message);
  }
}

function handleVerifyFail(cwd, constraintId, owner, reason, files, testCommands) {
  try {
    const item = failItem({
      cwd,
      itemId: constraintId,
      owner,
      reason,
      files,
      testCommands,
    });

    console.log(`Marked verification ${constraintId} as failed`);
    console.log(`status: ${item.status}`);
    return 0;
  } catch (error) {
    return exitWithError(error.message);
  }
}

function handleVerifyCheck(cwd) {
  try {
    const result = checkSession({ cwd });
    console.log('Seed verification check: ' + result.passed + '/' + result.total + ' passed');
    result.items.forEach((item) => {
      const address = item.address ? ' @' + item.address : '';
      const state = item.ok ? 'ok' : 'failed';
      console.log('- ' + state + ' ' + item.id + address + ' status=' + item.status);
      if (item.error) {
        console.log('  error: ' + item.error);
      }
      item.commands.forEach((command) => {
        console.log('  [' + (command.passed ? 'ok' : 'failed') + '] exit=' + command.exitCode + ' cmd=' + command.command);
      });
    });
    return result.ok ? 0 : 1;
  } catch (error) {
    return exitWithError(error.message);
  }
}

function formatIssueCodes(issues) {
  if (!Array.isArray(issues) || issues.length === 0) {
    return '';
  }
  return issues.map((issue) => issue.code).join(', ');
}

function formatCommandResult(command) {
  const state = command.passed ? 'ok' : 'failed';
  const exit = command.exitCode === null || command.exitCode === undefined ? 'null' : command.exitCode;
  return '[' + state + '] exit=' + exit + ' cmd=' + command.command;
}

function handleVerifyAudit(cwd) {
  try {
    const result = verificationAudit({ cwd });
    console.log('Seed verification audit: ' + result.errors.length + ' errors, ' + result.warnings.length + ' warnings');
    console.log('Audited items: ' + result.audited + '/' + result.total);

    if (result.errors.length > 0) {
      console.log('Errors:');
      result.errors.forEach((issue) => {
        const id = issue.id ? ' ' + issue.id : '';
        const address = issue.address ? ' @' + issue.address : '';
        console.log('- ' + issue.code + id + address + ': ' + issue.message);
      });
    }

    if (result.warnings.length > 0) {
      console.log('Warnings:');
      result.warnings.forEach((issue) => {
        const id = issue.id ? ' ' + issue.id : '';
        const address = issue.address ? ' @' + issue.address : '';
        console.log('- ' + issue.code + id + address + ': ' + issue.message);
        if (issue.command) {
          console.log('  command: ' + issue.command);
        }
        if (Array.isArray(issue.ids) && issue.ids.length > 0) {
          console.log('  ids: ' + issue.ids.join(', '));
        }
      });
    }

    return result.ok ? 0 : 1;
  } catch (error) {
    return exitWithError(error.message);
  }
}

function handleVerifyReport(cwd) {
  try {
    const report = verificationReport({ cwd });
    const status = report.status;
    const audit = report.audit;

    console.log('Seed verification report');
    console.log('Session: ' + report.sessionId);
    console.log('Status: total=' + status.total + ' verified=' + status.verified + ' passed=' + status.passed + ' failed=' + status.failed + ' pending=' + status.pending + ' expired=' + status.expired);
    console.log('Completed: ' + status.completed + ' satisfied=' + status.satisfied);
    console.log('Audit: ' + audit.errors.length + ' errors, ' + audit.warnings.length + ' warnings');

    if (report.global_policies?.length > 0) {
      console.log('Global policies:');
      report.global_policies.forEach((policy) => {
        const description = policy.description ? ' - ' + policy.description : '';
        console.log('- @' + policy.address + description);
      });
    }

    if (report.global_errors.length > 0) {
      console.log('Global errors: ' + formatIssueCodes(report.global_errors));
    }
    if (report.global_warnings.length > 0) {
      console.log('Global warnings: ' + formatIssueCodes(report.global_warnings));
    }

    console.log('Items:');
    report.items.forEach((item) => {
      const address = item.address ? ' @' + item.address : '';
      const source = item.source ? ' source=' + item.source : '';
      console.log('- ' + item.status + ' ' + item.id + address + source);

      if (item.audit_errors.length > 0) {
        console.log('  audit errors: ' + formatIssueCodes(item.audit_errors));
      }
      if (item.audit_warnings.length > 0) {
        console.log('  audit warnings: ' + formatIssueCodes(item.audit_warnings));
      }
      if (item.expiration) {
        console.log('  expired: ' + item.expiration.kind);
      }
      if (item.evidence) {
        console.log('  evidence: ' + item.evidence);
      }
      if (item.reason) {
        console.log('  reason: ' + item.reason);
      }

      if (item.references?.addresses?.length > 0) {
        console.log('  addresses: ' + item.references.addresses.map((entry) => '@' + entry.address).join(', '));
      }
      if (item.references?.artifacts?.length > 0) {
        console.log('  artifacts: ' + item.references.artifacts.map((entry) => entry.id + (entry.path ? '(' + entry.path + ')' : '')).join(', '));
      }
      if (item.evidence_files.length > 0) {
        console.log('  files: ' + item.evidence_files.map((file) => file.path).join(', '));
      }
      if (item.test_commands.length > 0) {
        console.log('  commands:');
        item.test_commands.forEach((command) => console.log('    ' + formatCommandResult(command)));
      }
    });

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

function handleVerifyPending(cwd) {
  const items = getPendingItems({ cwd });

  if (items.length === 0) {
    console.log('No pending verification items.');
    return 0;
  }

  console.log('Pending verification items (' + items.length + '):');
  items.forEach((item) => {
    const address = item.address ? ' @' + item.address : '';
    const previousStatus = item.previousStatus ? ' previous=' + item.previousStatus : '';
    console.log('- ' + item.status + ' ' + item.id + address + previousStatus);

    if (item.expiration?.modifiedAddresses?.length > 0) {
      console.log('  modified addresses: ' + item.expiration.modifiedAddresses.map((entry) => '@' + entry).join(', '));
    }

    if (item.expiration?.files?.length > 0) {
      console.log('  evidence files: ' + item.expiration.files.map((entry) => entry.path + ':' + entry.status).join(', '));
    }
  });
  return 0;
}

function handleVerifyReset(cwd) {
  try {
    const result = resetSession({ cwd });
    console.log(`Reset verification session '${result.sessionId}'.`);
    console.log(`Items reset: ${result.reset}`);
    return 0;
  } catch (error) {
    return exitWithError(error.message);
  }
}

function handleVerifySync(cwd) {
  try {
    const result = syncSession({ cwd });
    console.log(`Synced verification session '${result.sessionId}'.`);
    console.log(`Preserved results: ${result.preserved}`);
    console.log(`Pending after sync: ${result.pending}`);
    if (result.modifiedSeedAddresses.length > 0) {
      console.log('Modified Seed addresses promoted:');
      result.modifiedSeedAddresses.forEach((address) => console.log(`- @${address}`));
    }
    return 0;
  } catch (error) {
    return exitWithError(error.message);
  }
}

function run(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    console.log(usage());
    return 0;
  }

  const parsedGlobals = parseGlobalArgs(argv);
  if (parsedGlobals.error) {
    return exitWithError(parsedGlobals.error);
  }

  const cwd = parsedGlobals.cwd;
  const [command, ...rest] = parsedGlobals.argv;

  if (!command) {
    return exitWithError('missing command after global options.');
  }

  if (command === 'init') {
    const parsed = parseInitArgs(rest);
    if (parsed.error) {
      return exitWithError(parsed.error);
    }

    try {
      const created = initSeed({
        cwd,
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

    return handleValidate(cwd);
  }

  if (command === 'diff') {
    return handleDiff(cwd, rest);
  }

  if (command === 'blueprint') {
    return handleBlueprint(cwd, rest);
  }

  if (command === 'genome') {
    return handleGenome(cwd, rest);
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
        return handleVerifyStart(cwd);
      } catch (error) {
        return exitWithError(error.message);
      }
    }

    if (subcommand === 'reset') {
      if (!ensureNoExtraArgs(subRest, 0)) {
        return exitWithError('seed verify reset does not take arguments.');
      }

      return handleVerifyReset(cwd);
    }

    if (subcommand === 'sync') {
      if (!ensureNoExtraArgs(subRest, 0)) {
        return exitWithError('seed verify sync does not take arguments.');
      }

      return handleVerifySync(cwd);
    }

    if (subcommand === 'pending') {
      if (!ensureNoExtraArgs(subRest, 0)) {
        return exitWithError('seed verify pending does not take arguments.');
      }

      try {
        return handleVerifyPending(cwd);
      } catch (error) {
        return exitWithError(error.message);
      }
    }

    if (subcommand === 'check') {
      if (!ensureNoExtraArgs(subRest, 0)) {
        return exitWithError('seed verify check does not take arguments.');
      }

      return handleVerifyCheck(cwd);
    }

    if (subcommand === 'audit') {
      if (!ensureNoExtraArgs(subRest, 0)) {
        return exitWithError('seed verify audit does not take arguments.');
      }

      return handleVerifyAudit(cwd);
    }

    if (subcommand === 'report') {
      if (!ensureNoExtraArgs(subRest, 0)) {
        return exitWithError('seed verify report does not take arguments.');
      }

      return handleVerifyReport(cwd);
    }

    if (subcommand === 'next') {
      const parsed = parseVerifyNextArgs(subRest);
      if (parsed.error) {
        return exitWithError(parsed.error);
      }

      try {
        return handleVerifyNext(cwd, parsed.options.owner);
      } catch (error) {
        return exitWithError(error.message);
      }
    }

    if (subcommand === 'confirm') {
      const parsed = parseConstraintActionArgs(subRest, 'confirm', 'evidence', 'evidence');
      if (parsed.error) {
        return exitWithError(parsed.error);
      }

      return handleVerifyConfirm(cwd, parsed.constraintId, parsed.owner, parsed.payload, parsed.files, parsed.testCommands);
    }

    if (subcommand === 'fail') {
      const parsed = parseConstraintActionArgs(subRest, 'fail', 'reason', 'reason');
      if (parsed.error) {
        return exitWithError(parsed.error);
      }

      return handleVerifyFail(cwd, parsed.constraintId, parsed.owner, parsed.payload, parsed.files, parsed.testCommands);
    }

    if (subcommand === 'status') {
      if (!ensureNoExtraArgs(subRest, 0)) {
        return exitWithError('seed verify status does not take arguments.');
      }

      try {
        return handleVerifyStatus(cwd);
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
