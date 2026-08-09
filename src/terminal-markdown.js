'use strict';

const { highlight } = require('cli-highlight');

function ansi(code) {
  return (text) => `\u001b[${code}m${text}\u001b[0m`;
}

const MARKDOWN_THEME = {
  bullet: ansi('36'),
  code: ansi('33'),
  emphasis: ansi('3'),
  link: ansi('34;4'),
  meta: ansi('90'),
  quote: ansi('90'),
  section: ansi('1;32'),
  string: ansi('31'),
  strong: ansi('1'),
};

function shouldColorMarkdown(color, { env = process.env, stdout = process.stdout } = {}) {
  if (color !== undefined) {
    return color;
  }

  return Boolean(stdout.isTTY)
    && !Object.hasOwn(env, 'NO_COLOR')
    && env.TERM !== 'dumb';
}

function colorMarkdown(markdown, options = {}) {
  if (!shouldColorMarkdown(options.color, options)) {
    return markdown;
  }

  return highlight(markdown, {
    language: 'markdown',
    ignoreIllegals: true,
    theme: MARKDOWN_THEME,
  });
}

module.exports = {
  colorMarkdown,
  shouldColorMarkdown,
};
