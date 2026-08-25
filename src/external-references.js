'use strict';

const { collectPresentAddressableItems } = require('./validation');
const { isAbsolute, relative, sep } = require('node:path');
const { DEFAULT_SEED_NAME, loadSeed, seedPaths } = require('./seed-file');

const EXTERNAL_REFERENCE_PATTERN = /@([A-Za-z0-9][A-Za-z0-9_-]*):(?!genome\/)([A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)*)|@([A-Za-z0-9][A-Za-z0-9_-]*):genome\/([A-Za-z0-9][A-Za-z0-9_-]*):([A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)*)/g;

function collectExternalReferences(value) {
  const references = [];
  const visit = (entry) => {
    if (typeof entry === 'string') {
      for (const match of entry.matchAll(EXTERNAL_REFERENCE_PATTERN)) {
        references.push({
          seedName: match[1] ?? match[3],
          genomeId: match[4] ?? null,
          address: match[2] ?? match[5],
          raw: match[0],
        });
      }
    } else if (Array.isArray(entry)) {
      entry.forEach(visit);
    } else if (entry && typeof entry === 'object') {
      Object.values(entry).forEach(visit);
    }
  };
  visit(value);
  return references;
}

function resolveExternalReferences({ cwd, seedName, document }) {
  const selectedName = seedName ?? DEFAULT_SEED_NAME;
  const seen = new Set();
  return collectExternalReferences(document)
    .filter((reference) => {
      if (seen.has(reference.raw)) return false;
      seen.add(reference.raw);
      return true;
    })
    .map((reference) => {
      if (reference.seedName === selectedName) {
        throw new Error(`External reference ${reference.raw} points to the selected Seed itself.`);
      }
      const sourceSeedName = reference.seedName === DEFAULT_SEED_NAME ? undefined : reference.seedName;
      const source = loadSeed({ cwd, seedName: sourceSeedName });
      const errors = [];
      const items = collectPresentAddressableItems(source.document, errors);
      if (errors.length > 0) {
        throw new Error(`Cannot resolve ${reference.raw}: Seed ${reference.seedName} has invalid addressable sections.`);
      }
      const item = items.find((entry) => (
        entry.address === reference.address
        || (entry.section === 'artifacts' && entry.id === reference.address)
      ));
      if (!item) {
        throw new Error(`External reference ${reference.raw} does not exist in Seed ${reference.seedName}.`);
      }
      const provenance = source.provenance?.[item.address] ?? {
        origin: 'seed',
        path: seedPaths(sourceSeedName).seedPath,
      };
      if (reference.genomeId && (provenance.origin === 'seed' || provenance.id !== reference.genomeId)) {
        throw new Error(`External reference ${reference.raw} is not provided by genome ${reference.genomeId}.`);
      }
      const provenancePath = isAbsolute(provenance.path ?? '')
        ? relative(cwd, provenance.path).split(sep).join('/')
        : provenance.path;
      return {
        ...reference,
        resolvedAddress: item.address,
        section: item.section,
        value: item.value,
        sourcePath: seedPaths(sourceSeedName).seedPath,
        provenance: { ...provenance, path: provenancePath },
      };
    });
}

module.exports = {
  EXTERNAL_REFERENCE_PATTERN,
  collectExternalReferences,
  resolveExternalReferences,
};
