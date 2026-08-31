#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_SEED_PATH,
  assertSeedName,
  initSeed,
  listSeeds,
  loadSeed,
  seedPaths,
} = require('./seed-file');
const { validateGenomeDocument, validateSeedDocument } = require('./validation');
const {
  applyLineWindow,
  compileBlueprint,
  pageOutput,
  renderMarkdown,
} = require('./blueprint');
const { getBlueprintDiff, getSeedDiff } = require('./diff');
const { colorMarkdown } = require('./terminal-markdown');
const {
  compileGenomeDocument,
  initRepoGenome,
  listGenomeDefinitions,
  searchGenomeDefinitions,
  validateGenomeDefinitions,
} = require('./genomes');
const {
  INJECTION_AUTHORIZATION,
  checkSession,
  refreshExpiredEvidence,
  verificationAudit,
  verificationReport,
  claimNext,
  claimItem,
  reopenEvidence,
  confirmItem,
  failItem,
  injectItem,
  getPendingItems,
  getStatus,
  resetSession,
  startSession,
  syncSession,
} = require('./verification-store');
const { installBundledSkill } = require('./skill-installer');
const { resolveExternalReferences } = require('./external-references');

const DEFAULT_OWNER = 'seed-cli';

function usage() {
  return [
    'seed [--repo PATH] <command> [options] [--seed NAME]',
    '',
    'seed init [--overwrite] [--genome ID] [--genomes ID[,ID...]]',
    'seed install-skill (--codex | --claude)',
    'seed list',
    'seed validate',
    'seed diff [--no-color]',
    'seed genome list [--builtin] [--user] [--repo]',
    'seed genome search QUERY [--full-text] [--builtin] [--user] [--repo]',
    'seed genome init <name> [--overwrite]',
    'seed genome validate [--builtin] [--user] [--repo]',
    'seed genome blueprint <name> [--json] [--color | --no-color] [--section ID] [--filter @ADDRESS] [--limit N] [--offset N] [--head N] [--tail N] [--pager]',
    'seed blueprint [--json] [--color | --no-color] [--section ID] [--filter @ADDRESS] [--limit N] [--offset N] [--head N] [--tail N] [--pager]',
    'seed blueprint diff [--no-color]',
    'seed verify start',
    'seed verify reset',
    'seed verify sync',
    'seed verify next [--owner OWNER]',
    'seed verify claim <constraint-id> [--owner OWNER]',
    'seed verify reopen <constraint-id> [<constraint-id>...] --owner OWNER --reason TEXT',
    'seed verify reopen --evidence-file PATH --owner OWNER --reason TEXT [--apply]',
    'seed verify pending',
    'seed verify check',
    'seed verify refresh-expired --owner OWNER [--json]',
    'seed verify audit',
    'seed verify report',
    'seed verify confirm <constraint-id> --owner OWNER --file PATH [--file PATH...] --test-cmd CMD [--test-cmd CMD...] [--evidence TEXT]',
    'seed verify fail <constraint-id> --owner OWNER --file PATH [--file PATH...] --test-cmd CMD [--test-cmd CMD...] [--reason TEXT]',
    `seed verify inject <constraint-id> --owner OWNER --authorization ${INJECTION_AUTHORIZATION} --file PATH [--file PATH...] (--pass-cmd CMD | --fail-cmd CMD)... (--evidence TEXT | --reason TEXT)`,
    'seed verify status',
    '',
    `seed source defaults to ${DEFAULT_SEED_PATH}; --seed NAME uses seed/NAME/seed.yml and .seed/NAME`,
    'default session id is \'default\'',
  ].join('\n');
}

function parseGlobalArgs(argv, invocationCwd = process.cwd()) {
  const rest = [...argv];
  let repoPath = invocationCwd;
  let seedName;

  while (rest[0] === '--repo') {
    const value = rest[1];
    if (!value || value.startsWith('-')) {
      return { error: '--repo requires a repository path.' };
    }

    repoPath = path.resolve(invocationCwd, value);
    rest.splice(0, 2);
  }

  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] !== '--seed') {
      continue;
    }

    const value = rest[index + 1];
    if (!value || value.startsWith('-')) {
      return { error: '--seed requires a seed name.' };
    }
    if (seedName !== undefined) {
      return { error: '--seed may be specified only once.' };
    }
    try {
      assertSeedName(value);
    } catch (error) {
      return { error: error.message };
    }
    seedName = value;
    rest.splice(index, 2);
    index -= 1;
  }

  if (!fs.existsSync(repoPath)) {
    return { error: '--repo path does not exist: ' + repoPath };
  }

  if (!fs.statSync(repoPath).isDirectory()) {
    return { error: '--repo path is not a directory: ' + repoPath };
  }

  return { cwd: repoPath, seedName, argv: rest };
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

function parseInstallSkillArgs(args) {
  let platform;

  for (const arg of args) {
    if (arg === '--codex' || arg === '--claude') {
      const selected = arg.slice(2);
      if (platform) {
        return { error: 'seed install-skill requires exactly one of --codex or --claude.' };
      }
      platform = selected;
    } else if (arg.startsWith('-')) {
      return { error: `Unknown option for seed install-skill: ${arg}` };
    } else {
      return { error: `seed install-skill does not take positional arguments: ${arg}` };
    }
  }

  if (!platform) {
    return { error: 'seed install-skill requires exactly one of --codex or --claude.' };
  }

  return { options: { platform } };
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

function parseVerifyClaimArgs(args) {
  if (args.length === 0 || args[0].startsWith('-')) {
    return { error: 'seed verify claim requires exactly one <constraint-id>.' };
  }
  const options = { itemId: args[0], owner: DEFAULT_OWNER };
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--owner') {
      const parsed = readOptionValue(args, index, '--owner', 'claim');
      if (parsed.error) {
        return parsed;
      }
      options.owner = parsed.value;
      index += 1;
    } else if (arg.startsWith('-')) {
      return { error: `Unknown option for seed verify claim: ${arg}` };
    } else {
      return { error: `seed verify claim does not take positional arguments: ${arg}` };
    }
  }
  return { options };
}

function parseVerifyReopenArgs(args) {
  const options = {
    itemIds: [],
    evidenceFile: undefined,
    owner: undefined,
    reason: undefined,
    apply: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (['--owner', '--reason', '--evidence-file'].includes(arg)) {
      const parsed = readOptionValue(args, index, arg, 'reopen');
      if (parsed.error) {
        return parsed;
      }
      if (arg === '--owner') {
        options.owner = parsed.value;
      } else if (arg === '--reason') {
        options.reason = parsed.value;
      } else if (options.evidenceFile !== undefined) {
        return { error: 'seed verify reopen accepts exactly one --evidence-file.' };
      } else {
        options.evidenceFile = parsed.value;
      }
      index += 1;
    } else if (arg === '--apply') {
      options.apply = true;
    } else if (arg.startsWith('-')) {
      return { error: `Unknown option for seed verify reopen: ${arg}` };
    } else {
      options.itemIds.push(arg);
    }
  }

  if ((options.itemIds.length > 0) === (options.evidenceFile !== undefined)) {
    return { error: 'seed verify reopen requires either item IDs or --evidence-file, not both.' };
  }
  if (options.itemIds.length > 0 && options.apply) {
    return { error: 'seed verify reopen --apply is only valid with --evidence-file.' };
  }
  if (!options.owner) {
    return { error: 'owner invalid: seed verify reopen requires --owner.' };
  }
  if (!options.reason) {
    return { error: 'seed verify reopen requires --reason.' };
  }
  return { options };
}

function parseVerifyRefreshArgs(args) {
  const options = { owner: undefined, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--owner') {
      const parsed = readOptionValue(args, index, '--owner', 'refresh-expired');
      if (parsed.error) {
        return parsed;
      }
      options.owner = parsed.value;
      index += 1;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg.startsWith('-')) {
      return { error: `Unknown option for seed verify refresh-expired: ${arg}` };
    } else {
      return { error: `seed verify refresh-expired does not take positional arguments: ${arg}` };
    }
  }
  if (!options.owner) {
    return { error: 'owner invalid: seed verify refresh-expired requires --owner.' };
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

function parseVerifyInjectArgs(args) {
  if (args.length === 0 || args[0].startsWith('-')) {
    return { error: 'seed verify inject requires exactly one <constraint-id>.' };
  }

  const parsed = {
    itemId: args[0],
    owner: undefined,
    authorization: undefined,
    files: [],
    commandAttestations: [],
    evidence: undefined,
    reason: undefined,
  };
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (['--owner', '--authorization', '--file', '--pass-cmd', '--fail-cmd', '--evidence', '--reason'].includes(arg)) {
      const value = readOptionValue(args, index, arg, 'inject');
      if (value.error) {
        return value;
      }
      if (arg === '--owner') {
        parsed.owner = value.value;
      } else if (arg === '--authorization') {
        parsed.authorization = value.value;
      } else if (arg === '--file') {
        parsed.files.push(value.value);
      } else if (arg === '--pass-cmd' || arg === '--fail-cmd') {
        parsed.commandAttestations.push({ command: value.value, passed: arg === '--pass-cmd' });
      } else if (arg === '--evidence') {
        parsed.evidence = value.value;
      } else {
        parsed.reason = value.value;
      }
      index += 1;
    } else if (arg.startsWith('-')) {
      return { error: `Unknown option for seed verify inject: ${arg}` };
    } else {
      return { error: 'seed verify inject requires exactly one <constraint-id>.' };
    }
  }

  if (!parsed.owner) {
    return { error: 'owner invalid: seed verify inject requires --owner.' };
  }
  if (parsed.authorization !== INJECTION_AUTHORIZATION) {
    return { error: `seed verify inject requires --authorization ${INJECTION_AUTHORIZATION}.` };
  }
  if (parsed.files.length === 0) {
    return { error: 'seed verify inject requires at least one --file path.' };
  }
  if (parsed.commandAttestations.length === 0) {
    return { error: 'seed verify inject requires at least one --pass-cmd or --fail-cmd attestation.' };
  }

  const failed = parsed.commandAttestations.some((entry) => !entry.passed);
  if (failed && !parsed.reason) {
    return { error: 'seed verify inject requires --reason when any command is attested as failed.' };
  }
  if (failed && parsed.evidence !== undefined) {
    return { error: 'seed verify inject accepts --evidence only when every command is attested as passing.' };
  }
  if (!failed && parsed.reason !== undefined) {
    return { error: 'seed verify inject accepts --reason only when at least one command is attested as failed.' };
  }
  if (!failed && !parsed.evidence) {
    return { error: 'seed verify inject requires --evidence when every command is attested as passing.' };
  }
  return parsed;
}

function handleValidate(cwd, seedName) {
  let seed;

  try {
    seed = loadSeed({ cwd, seedName });
  } catch (error) {
    return exitWithError(error.message);
  }

  const result = validateSeedDocument(seed.document);
  printValidationResult(result);

  if (result.errors.length > 0) {
    return exitWithError('Seed validation failed with structural errors.');
  }

  try {
    resolveExternalReferences({ cwd, seedName, document: seed.document });
  } catch (error) {
    return exitWithError(error.message);
  }

  console.log(`Seed contract valid at ${seed.path}`);
  return 0;
}

function handleDiff(cwd, seedName, args) {
  let noColor = false;

  for (const arg of args) {
    if (arg === '--no-color') {
      noColor = true;
    } else {
      return exitWithError(`Unknown option for seed diff: ${arg}`);
    }
  }

  try {
    const diff = getSeedDiff({ cwd, seedName, noColor });
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
  const originWidth = Math.max(headers.origin.length, ...rows.map((row) => row.origin.length));
  const available = Math.max(20, columns - originWidth - 6);
  const idWidth = Math.min(
    Math.max(headers.id.length, ...rows.map((row) => row.id.length)),
    Math.max(12, Math.floor(available * 0.32)),
  );
  const sourceWidth = Math.min(
    Math.max(headers.source.length, ...rows.map((row) => row.source.length)),
    Math.max(18, Math.floor(available * 0.38)),
  );
  const descriptionWidth = Math.max(1, columns - originWidth - idWidth - sourceWidth - 6);
  const widths = {
    origin: originWidth,
    id: idWidth,
    source: sourceWidth,
    description: descriptionWidth,
  };
  const cellsForRow = (row) => ({
    origin: wrapText(row.origin, widths.origin),
    id: wrapText(row.id, widths.id),
    source: wrapText(row.source, widths.source),
    description: wrapText(row.description, widths.description),
  });
  const formatWrappedRow = (row) => {
    const cells = cellsForRow(row);
    const count = Math.max(cells.origin.length, cells.id.length, cells.source.length, cells.description.length);
    const lines = [];
    for (let index = 0; index < count; index += 1) {
      lines.push([
        padRight(cells.origin[index] ?? '', widths.origin),
        padRight(cells.id[index] ?? '', widths.id),
        padRight(cells.source[index] ?? '', widths.source),
        cells.description[index] ?? '',
      ].join('  ').replace(/\s+$/, ''));
    }
    return lines;
  };
  const separator = [
    '-'.repeat(widths.origin),
    '-'.repeat(widths.id),
    '-'.repeat(widths.source),
    '-'.repeat(widths.description),
  ].join('  ');

  return [
    ...formatWrappedRow(headers),
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

function handleGenomeSearch(cwd, args) {
  let fullText = false;
  const filteredArgs = [];

  args.forEach((arg) => {
    if (arg === '--full-text') {
      fullText = true;
    } else {
      filteredArgs.push(arg);
    }
  });

  const parsed = parseOriginFilters(filteredArgs, 'seed genome search');
  if (parsed.error) {
    return exitWithError(parsed.error);
  }

  const query = parsed.rest.join(' ').trim();
  if (query.length === 0) {
    return exitWithError('seed genome search requires a query.');
  }

  const results = searchGenomeDefinitions({
    cwd,
    origins: parsed.origins,
    query,
    fullText,
  });

  if (results.length === 0) {
    console.log(`No genomes matched "${query}".`);
    return 0;
  }

  console.log(`Genome search results for "${query}" (${results.length}):`);
  results.forEach((result) => {
    const tags = result.tags.length > 0 ? ` tags=[${result.tags.join(', ')}]` : ' tags=[]';
    console.log(`- ${result.origin} ${result.id}${tags}`);
    result.matches.forEach((match) => {
      if (match.address) {
        console.log(`  - ${match.type}: @${match.address}`);
      } else if (match.value !== undefined) {
        console.log(`  - ${match.type}: ${match.value}`);
      } else {
        console.log(`  - ${match.type}`);
      }
    });
  });
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

    const markdown = applyLineWindow(renderMarkdown(blueprint), {
      head: parsed.options.head,
      tail: parsed.options.tail,
    });
    const rendered = colorMarkdown(markdown, { color: parsed.options.color });

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
  if (subcommand === 'search') {
    return handleGenomeSearch(cwd, rest);
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

function handleInstallSkill(args) {
  const parsed = parseInstallSkillArgs(args);
  if (parsed.error) {
    return exitWithError(parsed.error);
  }

  try {
    const installed = installBundledSkill({ platform: parsed.options.platform });
    console.log(`${installed.replaced ? 'Updated' : 'Installed'} ${installed.platform} skill at ${installed.path}`);
    return 0;
  } catch (error) {
    return exitWithError(error.message);
  }
}

function handleSeedList(cwd, args) {
  if (args.length !== 0) {
    return exitWithError(`seed list does not take arguments: ${args[0]}`);
  }

  const seeds = listSeeds({ cwd });
  if (seeds.length === 0) {
    console.log('No Seeds found.');
    return 0;
  }

  const nameWidth = Math.max('Name'.length, ...seeds.map((seed) => seed.name.length));
  console.log('Name'.padEnd(nameWidth) + '  Path');
  seeds.forEach((seed) => console.log(seed.name.padEnd(nameWidth) + '  ' + seed.path));
  return 0;
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
    } else if (arg === '--color' || arg === '--no-color') {
      const color = arg === '--color';
      if (options.color !== undefined && options.color !== color) {
        return { error: '--color and --no-color cannot be used together.' };
      }
      options.color = color;
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

function handleBlueprint(cwd, seedName, args) {
  if (args[0] === 'diff') {
    return handleBlueprintDiff(cwd, seedName, args.slice(1));
  }

  const parsed = parseBlueprintArgs(args);
  if (parsed.error) {
    return exitWithError(parsed.error);
  }

  let seed;
  try {
    seed = ensureSeedReady(cwd, seedName, { allowUnresolvedRequirements: true });
  } catch (error) {
    return exitWithError(error.message);
  }

  try {
    const externalReferences = resolveExternalReferences({ cwd, seedName, document: seed.document });
    const blueprint = compileBlueprint({
      document: seed.document,
      seedPath: seedPaths(seedName).seedPath,
      genomes: seed.genomes ?? [],
      provenance: seed.provenance ?? {},
      filters: parsed.options.filters,
      section: parsed.options.section,
      limit: parsed.options.limit,
      offset: parsed.options.offset,
      externalReferences,
    });

    if (parsed.options.json) {
      console.log(JSON.stringify(blueprint, null, 2));
      return 0;
    }

    const markdown = applyLineWindow(renderMarkdown(blueprint), {
      head: parsed.options.head,
      tail: parsed.options.tail,
    });
    const rendered = colorMarkdown(markdown, { color: parsed.options.color });

    if (parsed.options.pager) {
      return pageOutput(rendered);
    }

    process.stdout.write(rendered);
    return 0;
  } catch (error) {
    return exitWithError(error.message);
  }
}

function handleBlueprintDiff(cwd, seedName, args) {
  let noColor = false;

  for (const arg of args) {
    if (arg === '--no-color') {
      noColor = true;
    } else {
      return exitWithError(`Unknown option for seed blueprint diff: ${arg}`);
    }
  }

  try {
    const diff = getBlueprintDiff({ cwd, seedName, noColor });
    process.stdout.write(diff.text);
    return 0;
  } catch (error) {
    return exitWithError(error.message);
  }
}

function ensureSeedReady(cwd, seedName, { allowUnresolvedRequirements = false } = {}) {
  let seed;

  try {
    seed = loadSeed({ cwd, seedName });
  } catch (error) {
    throw error;
  }

  const validation = validateSeedDocument(seed.document);
  const blockingErrors = allowUnresolvedRequirements
    ? validation.errors.filter((entry) => entry.code !== 'unresolved-requirement')
    : validation.errors;

  if (blockingErrors.length > 0) {
    printValidationResult(validation);
    throw new Error(`Seed validation failed with ${blockingErrors.length} structural error(s).`);
  }

  if (!allowUnresolvedRequirements || validation.errors.length === 0) {
    printValidationResult(validation);
  }

  resolveExternalReferences({ cwd, seedName, document: seed.document });

  return seed;
}

function handleVerifyStart(cwd, seedName) {
  const seed = ensureSeedReady(cwd, seedName);
  const externalReferences = resolveExternalReferences({ cwd, seedName, document: seed.document });
  const started = startSession({
    cwd,
    seedName,
    seedDocument: seed.document,
    seedText: seed.text,
    externalReferences,
  });

  console.log(`Started verification session '${started.session.sessionId}'.`);
  console.log(`Session file: ${path.join(cwd, seedPaths(seedName).statePath, 'sessions', `${started.session.sessionId}.json`)}`);
  return 0;
}

function handleVerifyNext(cwd, seedName, owner = DEFAULT_OWNER) {
  const result = claimNext({
    cwd,
    seedName,
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

function handleVerifyClaim(cwd, seedName, itemId, owner = DEFAULT_OWNER) {
  const result = claimItem({ cwd, seedName, itemId, owner });
  console.log(`Claimed verification ${result.item.id}`);
  return 0;
}

function handleVerifyReopen(cwd, seedName, options) {
  try {
    const result = reopenEvidence({ cwd, seedName, ...options });
    if (!result.applied) {
      console.log(`Evidence repair preview: ${result.ids.length} terminal verification item(s) cite ${result.evidenceFile}`);
      result.ids.forEach((id) => console.log('- ' + id));
      console.log('No session state changed; rerun with --apply to reopen these items.');
      return 0;
    }
    const itemLabel = result.reopened === 1 ? 'item' : 'items';
    console.log(`Reopened ${result.reopened} verification ${itemLabel} for focused evidence replacement.`);
    result.ids.forEach((id) => console.log('- ' + id));
    return 0;
  } catch (error) {
    return exitWithError(error.message);
  }
}

function handleVerifyConfirm(cwd, seedName, constraintId, owner, evidence, files, testCommands) {
  try {
    const item = confirmItem({
      cwd,
      seedName,
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

function handleVerifyFail(cwd, seedName, constraintId, owner, reason, files, testCommands) {
  try {
    const item = failItem({
      cwd,
      seedName,
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

function handleVerifyInject(cwd, seedName, options) {
  try {
    const item = injectItem({ cwd, seedName, ...options });
    console.log(`Injected verification ${options.itemId}`);
    console.log(`status: ${item.status}`);
    console.log('provenance: operator-authorized-agent-attestation; commands not executed');
    return 0;
  } catch (error) {
    return exitWithError(error.message);
  }
}

function handleVerifyCheck(cwd, seedName) {
  try {
    const result = checkSession({ cwd, seedName });
    console.log('Seed verification check: ' + result.passed + '/' + result.total + ' passed (commands: ' + result.uniqueCommandTotal + ' unique / ' + result.recordedCommandTotal + ' recorded)');
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

function handleVerifyRefreshExpired(cwd, seedName, owner, json) {
  try {
    const result = refreshExpiredEvidence({ cwd, seedName, owner });
    if (json) {
      console.log(JSON.stringify(result));
    } else if (result.ok) {
      console.log(
        `Refreshed ${result.refreshed} expired verification records `
        + `(${result.uniqueCommandTotal} unique / ${result.recordedCommandTotal} recorded commands).`,
      );
    } else {
      console.log(
        `Seed evidence refresh failed: ${result.failedCommands.length} proof commands failed.`,
      );
      result.failedCommands.forEach((command) => {
        console.log(`[failed] exit=${command.exitCode} cmd=${command.command}`);
      });
    }
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
  if (command.injected === true) {
    const state = command.passed ? 'injected-ok' : 'injected-failed';
    const owner = command.injectionOwner ? ' owner=' + command.injectionOwner : '';
    const authorization = command.injectionAuthorization
      ? ' authorization=' + command.injectionAuthorization
      : '';
    const revision = command.productRevision ? ' revision=' + command.productRevision.slice(0, 12) : '';
    return '[' + state + ']' + owner + authorization + revision + ' cmd=' + command.command;
  }
  const state = command.passed ? 'ok' : 'failed';
  const exit = command.exitCode === null || command.exitCode === undefined ? 'null' : command.exitCode;
  const producer = command.producerItemId
    ? ' producer=' + command.producerItemId + ' reused=' + Boolean(command.reused)
    : '';
  const revision = command.productRevision ? ' revision=' + command.productRevision.slice(0, 12) : '';
  return '[' + state + '] exit=' + exit + producer + revision + ' cmd=' + command.command;
}

function handleVerifyAudit(cwd, seedName) {
  try {
    const result = verificationAudit({ cwd, seedName });
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
        if (issue.file) {
          console.log('  file: ' + issue.file);
        }
        if (Array.isArray(issue.files) && issue.files.length > 0) {
          console.log('  files: ' + issue.files.join(', '));
        }
        if (Array.isArray(issue.ids) && issue.ids.length > 0) {
          console.log('  ids: ' + issue.ids.join(', '));
        }
        if (issue.omittedIds > 0) {
          console.log('  omitted ids: ' + issue.omittedIds);
        }
      });
    }

    return result.ok ? 0 : 1;
  } catch (error) {
    return exitWithError(error.message);
  }
}

function handleVerifyReport(cwd, seedName) {
  try {
    const report = verificationReport({ cwd, seedName });
    const status = report.status;
    const audit = report.audit;

    console.log('Seed verification report');
    console.log('Session: ' + report.sessionId);
    console.log('Status: total=' + status.total + ' verified=' + status.verified + ' passed=' + status.passed + ' failed=' + status.failed + ' pending=' + status.pending + ' expired=' + status.expired + ' injected=' + status.injected);
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
      console.log('Global warnings:');
      report.global_warnings.forEach((issue) => {
        console.log('- ' + issue.code + ': ' + issue.message);
        if (issue.file) {
          console.log('  file: ' + issue.file);
        }
        if (Array.isArray(issue.files) && issue.files.length > 0) {
          console.log('  files: ' + issue.files.join(', '));
        }
        if (issue.command) {
          console.log('  command: ' + issue.command);
        }
        if (Array.isArray(issue.ids) && issue.ids.length > 0) {
          console.log('  ids: ' + issue.ids.join(', '));
        }
        if (issue.omittedIds > 0) {
          console.log('  omitted ids: ' + issue.omittedIds);
        }
      });
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
      if (item.reopen_history.length > 0) {
        console.log('  reopen history: ' + item.reopen_history.length);
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

function handleVerifyStatus(cwd, seedName) {
  const status = getStatus({ cwd, seedName });
  const output = JSON.stringify(status, null, 2) + '\n';
  process.stdout.write(output);
  return 0;
}

function handleVerifyPending(cwd, seedName) {
  const items = getPendingItems({ cwd, seedName });

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

function handleVerifyReset(cwd, seedName) {
  try {
    const result = resetSession({ cwd, seedName });
    console.log(`Reset verification session '${result.sessionId}'.`);
    console.log(`Items reset: ${result.reset}`);
    return 0;
  } catch (error) {
    return exitWithError(error.message);
  }
}

function handleVerifySync(cwd, seedName) {
  try {
    const seed = loadSeed({ cwd, seedName });
    const externalReferences = resolveExternalReferences({ cwd, seedName, document: seed.document });
    const result = syncSession({ cwd, seedName, externalReferences });
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
  const seedName = parsedGlobals.seedName;
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
        seedName,
        overwrite: parsed.options.overwrite,
        genomes: parsed.options.genomes,
      });
      console.log(`Initialized seed contract at ${created.path}`);
      return 0;
    } catch (error) {
      return exitWithError(error.message);
    }
  }

  if (command === 'install-skill') {
    return handleInstallSkill(rest);
  }

  if (command === 'list') {
    return handleSeedList(cwd, rest);
  }

  if (command === 'validate') {
    if (rest.length !== 0) {
      return exitWithError('seed validate does not take positional arguments.');
    }

    return handleValidate(cwd, seedName);
  }

  if (command === 'diff') {
    return handleDiff(cwd, seedName, rest);
  }

  if (command === 'blueprint') {
    return handleBlueprint(cwd, seedName, rest);
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
        return handleVerifyStart(cwd, seedName);
      } catch (error) {
        return exitWithError(error.message);
      }
    }

    if (subcommand === 'reset') {
      if (!ensureNoExtraArgs(subRest, 0)) {
        return exitWithError('seed verify reset does not take arguments.');
      }

      return handleVerifyReset(cwd, seedName);
    }

    if (subcommand === 'sync') {
      if (!ensureNoExtraArgs(subRest, 0)) {
        return exitWithError('seed verify sync does not take arguments.');
      }

      return handleVerifySync(cwd, seedName);
    }

    if (subcommand === 'pending') {
      if (!ensureNoExtraArgs(subRest, 0)) {
        return exitWithError('seed verify pending does not take arguments.');
      }

      try {
        return handleVerifyPending(cwd, seedName);
      } catch (error) {
        return exitWithError(error.message);
      }
    }

    if (subcommand === 'check') {
      if (!ensureNoExtraArgs(subRest, 0)) {
        return exitWithError('seed verify check does not take arguments.');
      }

      return handleVerifyCheck(cwd, seedName);
    }

    if (subcommand === 'refresh-expired') {
      const parsed = parseVerifyRefreshArgs(subRest);
      if (parsed.error) {
        return exitWithError(parsed.error);
      }
      return handleVerifyRefreshExpired(cwd, seedName, parsed.options.owner, parsed.options.json);
    }

    if (subcommand === 'audit') {
      if (!ensureNoExtraArgs(subRest, 0)) {
        return exitWithError('seed verify audit does not take arguments.');
      }

      return handleVerifyAudit(cwd, seedName);
    }

    if (subcommand === 'report') {
      if (!ensureNoExtraArgs(subRest, 0)) {
        return exitWithError('seed verify report does not take arguments.');
      }

      return handleVerifyReport(cwd, seedName);
    }

    if (subcommand === 'next') {
      const parsed = parseVerifyNextArgs(subRest);
      if (parsed.error) {
        return exitWithError(parsed.error);
      }

      try {
        return handleVerifyNext(cwd, seedName, parsed.options.owner);
      } catch (error) {
        return exitWithError(error.message);
      }
    }
    if (subcommand === 'claim') {
      const parsed = parseVerifyClaimArgs(subRest);
      if (parsed.error) {
        return exitWithError(parsed.error);
      }
      try {
        return handleVerifyClaim(cwd, seedName, parsed.options.itemId, parsed.options.owner);
      } catch (error) {
        return exitWithError(error.message);
      }
    }

    if (subcommand === 'reopen') {
      const parsed = parseVerifyReopenArgs(subRest);
      if (parsed.error) {
        return exitWithError(parsed.error);
      }
      return handleVerifyReopen(cwd, seedName, parsed.options);
    }

    if (subcommand === 'confirm') {
      const parsed = parseConstraintActionArgs(subRest, 'confirm', 'evidence', 'evidence');
      if (parsed.error) {
        return exitWithError(parsed.error);
      }

      return handleVerifyConfirm(cwd, seedName, parsed.constraintId, parsed.owner, parsed.payload, parsed.files, parsed.testCommands);
    }

    if (subcommand === 'fail') {
      const parsed = parseConstraintActionArgs(subRest, 'fail', 'reason', 'reason');
      if (parsed.error) {
        return exitWithError(parsed.error);
      }

      return handleVerifyFail(cwd, seedName, parsed.constraintId, parsed.owner, parsed.payload, parsed.files, parsed.testCommands);
    }

    if (subcommand === 'inject') {
      const parsed = parseVerifyInjectArgs(subRest);
      if (parsed.error) {
        return exitWithError(parsed.error);
      }
      return handleVerifyInject(cwd, seedName, parsed);
    }

    if (subcommand === 'status') {
      if (!ensureNoExtraArgs(subRest, 0)) {
        return exitWithError('seed verify status does not take arguments.');
      }

      try {
        return handleVerifyStatus(cwd, seedName);
      } catch (error) {
        return exitWithError(error.message);
      }
    }

    return exitWithError(`Unknown verify subcommand ${subcommand}.`);
  }

  return exitWithError(`Unknown command ${command}.`);
}

if (require.main === module) {
  process.exitCode = run();
}

module.exports = { run };
