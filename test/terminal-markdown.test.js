const { describe, test } = require('node:test');
const assert = require('node:assert/strict');

const { colorMarkdown, shouldColorMarkdown } = require('../src/terminal-markdown');

describe('terminal Markdown', () => {
  test('automatic color requires an interactive capable terminal', () => {
    assert.equal(shouldColorMarkdown(undefined, { env: {}, stdout: { isTTY: true } }), true);
    assert.equal(shouldColorMarkdown(undefined, { env: {}, stdout: { isTTY: false } }), false);
    assert.equal(shouldColorMarkdown(undefined, { env: { NO_COLOR: '' }, stdout: { isTTY: true } }), false);
    assert.equal(shouldColorMarkdown(undefined, { env: { TERM: 'dumb' }, stdout: { isTTY: true } }), false);
  });

  test('coloring preserves Markdown while adding ANSI styles', () => {
    const markdown = '# Seed Blueprint\n\n`behavior.output`\n';
    const colored = colorMarkdown(markdown, { color: true });

    assert.match(colored, /\u001b\[/);
    assert.ok(colored.includes('# Seed Blueprint'));
    assert.ok(colored.includes('behavior.output'));
    assert.equal(colorMarkdown(markdown, { color: false }), markdown);
  });
});
