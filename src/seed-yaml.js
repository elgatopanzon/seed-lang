const { isSeq, parseDocument } = require('yaml');

const GENOME_EXCLUSION_TAG = /^![A-Za-z0-9][A-Za-z0-9_-]*$/;

function parseSeedYaml(text) {
  const document = parseDocument(text);
  if (document.errors.length > 0) {
    throw document.errors[0];
  }

  const acceptedTags = [];
  const genomes = document.get('genomes', true);
  if (isSeq(genomes)) {
    genomes.items.forEach((entry) => {
      if (entry?.value === '' && GENOME_EXCLUSION_TAG.test(entry.tag ?? '')) {
        acceptedTags.push({ tag: entry.tag, end: entry.range?.[0] });
        entry.value = entry.tag;
        entry.tag = undefined;
      }
    });
  }

  const unresolved = document.warnings.find((warning) => {
    if (warning.code !== 'TAG_RESOLVE_FAILED') {
      return false;
    }
    return !acceptedTags.some(({ tag, end }) => (
      warning.message.split(' at line')[0] === `Unresolved tag: ${tag}`
      && warning.pos?.[1] === end
    ));
  });
  if (unresolved) {
    throw unresolved;
  }

  return document.toJS();
}

module.exports = {
  parseSeedYaml,
};
