'use strict';

const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { loadSeed } = require('./seed-file');

function snapshotPath(cwd) {
  return join(cwd ?? process.cwd(), '.seed', 'seed.snapshot.yml');
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
      changes.push({ kind: 'same', line: before[left] });
      left += 1;
      right += 1;
    } else if (table[left + 1][right] >= table[left][right + 1]) {
      changes.push({ kind: 'remove', line: before[left] });
      left += 1;
    } else {
      changes.push({ kind: 'add', line: after[right] });
      right += 1;
    }
  }

  while (left < before.length) {
    changes.push({ kind: 'remove', line: before[left] });
    left += 1;
  }

  while (right < after.length) {
    changes.push({ kind: 'add', line: after[right] });
    right += 1;
  }

  return changes;
}

function colorize(text, code, enabled) {
  return enabled ? `\u001b[${code}m${text}\u001b[0m` : text;
}

function renderDiff(changes, { color = process.stdout.isTTY } = {}) {
  const rendered = [
    colorize('--- .seed/seed.snapshot.yml', '31', color),
    colorize('+++ seed/seed.yml (compiled)', '32', color),
  ];

  changes.forEach((change) => {
    if (change.kind === 'same') {
      rendered.push(` ${change.line}`);
    } else if (change.kind === 'remove') {
      rendered.push(colorize(`-${change.line}`, '31', color));
    } else {
      rendered.push(colorize(`+${change.line}`, '32', color));
    }
  });

  return `${rendered.join('\n')}\n`;
}

function getSeedDiff({ cwd = process.cwd(), noColor = false } = {}) {
  const snapPath = snapshotPath(cwd);
  if (!existsSync(snapPath)) {
    throw new Error(`Seed snapshot missing at ${snapPath}. Run seed verify start first.`);
  }

  const snapshotText = readFileSync(snapPath, 'utf8');
  const seed = loadSeed({ cwd });
  const changes = buildLineDiff(snapshotText, seed.text);
  const changed = changes.some((entry) => entry.kind !== 'same');

  return {
    changed,
    text: changed ? renderDiff(changes, { color: !noColor && process.stdout.isTTY }) : 'No Seed diff.\n',
  };
}

module.exports = {
  buildLineDiff,
  getSeedDiff,
  renderDiff,
  snapshotPath,
};
