'use strict';

const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { parse } = require('yaml');
const { compileBlueprint, renderMarkdown } = require('./blueprint');
const { loadSeed, seedPaths } = require('./seed-file');
const { inspectRequirements, renderRequirementsWarning } = require('./requirements');
const { resolveExternalReferences } = require('./external-references');

function snapshotPath(cwd, seedName) {
  return join(cwd ?? process.cwd(), seedPaths(seedName).statePath, 'seed.snapshot.yml');
}

function dependencySnapshotPath(cwd, seedName) {
  return join(cwd ?? process.cwd(), seedPaths(seedName).statePath, 'dependencies.snapshot.json');
}

function externalDependencyDiff(cwd, seedName, document, noColor) {
  const storedPath = dependencySnapshotPath(cwd, seedName);
  const before = existsSync(storedPath) ? readFileSync(storedPath, 'utf8') : '[]\n';
  const current = JSON.stringify(resolveExternalReferences({ cwd, seedName, document }), null, 2) + '\n';
  const changes = buildLineDiff(before, current);
  if (!changes.some((entry) => entry.kind !== 'same')) return '';
  return '\nExternal dependency changes:\n' + renderDiff(changes, {
    color: !noColor && process.stdout.isTTY,
    oldLabel: `${seedPaths(seedName).statePath}/dependencies.snapshot.json`,
    newLabel: 'resolved external dependencies',
  });
}

function splitLines(text) {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

function buildLineDiff(beforeText, afterText) {
  const before = splitLines(beforeText);
  const after = splitLines(afterText);
  const table = Array.from({ length: before.length + 1 }, () => Array(after.length + 1).fill(0));

  for (let left = before.length - 1; left >= 0; left -= 1) {
    for (let right = after.length - 1; right >= 0; right -= 1) {
      if (before[left] === after[right]) {
        table[left][right] = table[left + 1][right + 1] + 1;
      } else {
        table[left][right] = Math.max(table[left + 1][right], table[left][right + 1]);
      }
    }
  }

  const changes = [];
  let left = 0;
  let right = 0;

  while (left < before.length && right < after.length) {
    if (before[left] === after[right]) {
      changes.push({ kind: 'same', line: before[left], oldLine: left + 1, newLine: right + 1 });
      left += 1;
      right += 1;
    } else if (table[left + 1][right] >= table[left][right + 1]) {
      changes.push({ kind: 'remove', line: before[left], oldLine: left + 1, newLine: right + 1 });
      left += 1;
    } else {
      changes.push({ kind: 'add', line: after[right], oldLine: left + 1, newLine: right + 1 });
      right += 1;
    }
  }

  while (left < before.length) {
    changes.push({ kind: 'remove', line: before[left], oldLine: left + 1, newLine: right + 1 });
    left += 1;
  }

  while (right < after.length) {
    changes.push({ kind: 'add', line: after[right], oldLine: left + 1, newLine: right + 1 });
    right += 1;
  }

  return changes;
}

function colorize(text, code, enabled) {
  return enabled ? '\u001b[' + code + 'm' + text + '\u001b[0m' : text;
}

function hunkRanges(changes, context) {
  const ranges = [];

  changes.forEach((change, index) => {
    if (change.kind === 'same') {
      return;
    }

    const start = Math.max(0, index - context);
    const end = Math.min(changes.length - 1, index + context);
    const previous = ranges[ranges.length - 1];

    if (previous && start <= previous.end + 1) {
      previous.end = Math.max(previous.end, end);
    } else {
      ranges.push({ start, end });
    }
  });

  return ranges;
}

function hunkHeader(hunk) {
  const oldLines = hunk.filter((change) => change.kind !== 'add');
  const newLines = hunk.filter((change) => change.kind !== 'remove');
  const oldStart = oldLines[0]?.oldLine ?? hunk[0]?.oldLine ?? 1;
  const newStart = newLines[0]?.newLine ?? hunk[0]?.newLine ?? 1;
  const oldCount = oldLines.length;
  const newCount = newLines.length;

  return '@@ -' + oldStart + ',' + oldCount + ' +' + newStart + ',' + newCount + ' @@';
}

function renderDiff(changes, {
  color = process.stdout.isTTY,
  context = 3,
  oldLabel = '.seed/seed.snapshot.yml',
  newLabel = 'seed/seed.yml (compiled)',
} = {}) {
  const rendered = [
    colorize('--- ' + oldLabel, '31', color),
    colorize('+++ ' + newLabel, '32', color),
  ];

  hunkRanges(changes, context).forEach((range) => {
    const hunk = changes.slice(range.start, range.end + 1);
    rendered.push(hunkHeader(hunk));

    hunk.forEach((change) => {
      if (change.kind === 'same') {
        rendered.push(' ' + change.line);
      } else if (change.kind === 'remove') {
        rendered.push(colorize('-' + change.line, '31', color));
      } else {
        rendered.push(colorize('+' + change.line, '32', color));
      }
    });
  });

  return rendered.join('\n') + '\n';
}

function renderComparableBlueprint(document, seedPath) {
  const blueprint = compileBlueprint({
    document,
    seedPath,
  });
  return renderMarkdown(blueprint, {
    includeSource: false,
    includeGenomes: false,
    includeItemSources: false,
  });
}

function getBlueprintDiff({ cwd = process.cwd(), seedName, noColor = false } = {}) {
  const paths = seedPaths(seedName);
  const snapPath = snapshotPath(cwd, seedName);
  if (!existsSync(snapPath)) {
    throw new Error('Seed snapshot missing at ' + snapPath + '. Run seed verify start first.');
  }

  const snapshotText = readFileSync(snapPath, 'utf8');
  let snapshotDocument;
  try {
    snapshotDocument = parse(snapshotText);
  } catch (error) {
    throw new Error('Failed to parse Seed snapshot YAML at ' + snapPath + ': ' + error.message);
  }

  const seed = loadSeed({ cwd, seedName });
  const inspectedRequirements = inspectRequirements(seed.document.requirements);
  if (inspectedRequirements.errors.length > 0) {
    throw new Error('Cannot render diff from invalid requirements: ' + inspectedRequirements.errors.map((entry) => `${entry.path}: ${entry.message}`).join('; '));
  }
  const warning = renderRequirementsWarning(inspectedRequirements.requirements);
  const beforeText = renderComparableBlueprint(snapshotDocument, `${paths.statePath}/seed.snapshot.yml`);
  const afterText = renderComparableBlueprint(seed.document, paths.seedPath);
  const changes = buildLineDiff(beforeText, afterText);
  const changed = changes.some((entry) => entry.kind !== 'same');
  const dependencyDiff = externalDependencyDiff(cwd, seedName, seed.document, noColor);

  return {
    changed: changed || dependencyDiff.length > 0,
    text: warning + (changed
      ? renderDiff(changes, {
        color: !noColor && process.stdout.isTTY,
        oldLabel: `${paths.statePath}/seed.snapshot.yml (blueprint)`,
        newLabel: `${paths.seedPath} (blueprint)`,
      })
      : dependencyDiff ? 'No local Blueprint diff.\n' : 'No Blueprint diff.\n') + dependencyDiff,
  };
}

function getSeedDiff({ cwd = process.cwd(), seedName, noColor = false } = {}) {
  const paths = seedPaths(seedName);
  const snapPath = snapshotPath(cwd, seedName);
  if (!existsSync(snapPath)) {
    throw new Error('Seed snapshot missing at ' + snapPath + '. Run seed verify start first.');
  }

  const snapshotText = readFileSync(snapPath, 'utf8');
  const seed = loadSeed({ cwd, seedName });
  const inspectedRequirements = inspectRequirements(seed.document.requirements);
  if (inspectedRequirements.errors.length > 0) {
    throw new Error('Cannot render diff from invalid requirements: ' + inspectedRequirements.errors.map((entry) => `${entry.path}: ${entry.message}`).join('; '));
  }
  const warning = renderRequirementsWarning(inspectedRequirements.requirements);
  const changes = buildLineDiff(snapshotText, seed.text);
  const changed = changes.some((entry) => entry.kind !== 'same');
  const dependencyDiff = externalDependencyDiff(cwd, seedName, seed.document, noColor);

  return {
    changed: changed || dependencyDiff.length > 0,
    text: warning + (changed
      ? renderDiff(changes, {
        color: !noColor && process.stdout.isTTY,
        oldLabel: `${paths.statePath}/seed.snapshot.yml`,
        newLabel: `${paths.seedPath} (compiled)`,
      })
      : dependencyDiff ? 'No local Seed diff.\n' : 'No Seed diff.\n') + dependencyDiff,
  };
}

module.exports = {
  buildLineDiff,
  getBlueprintDiff,
  getSeedDiff,
  renderDiff,
  snapshotPath,
};
