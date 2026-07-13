const { spawnSync } = require('node:child_process');
const { stringify } = require('yaml');
const { collectAddressableItems } = require('./validation');

const REFERENCE_PATTERN = /@([A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)*)/g;

const SECTION_DEFINITIONS = [
  { id: 'project-summary', title: 'Project Summary', source: 'metadata', singleton: true },
  { id: 'interfaces', title: 'Interfaces', source: 'interfaces' },
  { id: 'functional-behavior', title: 'Functional Behavior', source: 'behavior' },
  { id: 'error-semantics', title: 'Error Semantics', source: 'errors' },
  { id: 'data-semantics', title: 'Data Semantics', source: 'state' },
  { id: 'security', title: 'Security', source: 'security' },
  { id: 'environment', title: 'Environment', source: 'environment' },
  { id: 'observability', title: 'Observability', source: 'observability' },
  { id: 'compatibility', title: 'Compatibility', source: 'compatibility' },
  { id: 'constraints', title: 'Constraints', source: 'constraints' },
  { id: 'implementation-freedom', title: 'Implementation Freedom', source: 'freedom' },
  { id: 'artifacts', title: 'Artifacts', source: 'artifacts' },
  { id: 'verification-plan', title: 'Verification Plan', source: 'verifications' },
];

function normalizeFilter(value) {
  return value.startsWith('@') ? value.slice(1) : value;
}

function collectReferences(value) {
  const refs = [];
  const visit = (entry) => {
    if (typeof entry === 'string') {
      for (const match of entry.matchAll(REFERENCE_PATTERN)) {
        refs.push(match[1]);
      }
      return;
    }

    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }

    if (entry && typeof entry === 'object') {
      Object.values(entry).forEach(visit);
    }
  };

  visit(value);
  return refs;
}

function itemSource(seedPath) {
  return {
    type: 'seed',
    path: seedPath,
  };
}

function buildItems(document, seedPath) {
  const errors = [];
  const normalized = collectAddressableItems(document, errors);
  if (errors.length > 0) {
    throw new Error(`Cannot build blueprint from invalid addressable sections: ${errors.map((entry) => entry.message).join('; ')}`);
  }

  return normalized.map((item) => ({
    id: item.id,
    address: item.address,
    section: item.section,
    value: item.value,
    references: collectReferences(item.value),
    source: itemSource(seedPath),
  }));
}

function resolveFilterAddresses(filters, items) {
  if (filters.length === 0) {
    return null;
  }

  const selected = new Set(filters.map(normalizeFilter));
  let changed = true;

  while (changed) {
    changed = false;
    items.forEach((item) => {
      const itemSelected = selected.has(item.address) || selected.has(item.id);
      const referencesSelected = item.references.some((ref) => selected.has(ref));

      if (itemSelected) {
        item.references.forEach((ref) => {
          if (!selected.has(ref)) {
            selected.add(ref);
            changed = true;
          }
        });
      }

      if (referencesSelected && !selected.has(item.address)) {
        selected.add(item.address);
        changed = true;
      }
    });
  }

  return selected;
}

function itemMatchesSelection(item, selected) {
  if (!selected) {
    return true;
  }

  return selected.has(item.address) || selected.has(item.id);
}

function sectionItems(definition, items, selected, options) {
  if (definition.singleton) {
    return [];
  }

  let entries = items.filter((item) => item.section === definition.source && itemMatchesSelection(item, selected));

  if (options.offset !== undefined) {
    entries = entries.slice(options.offset);
  }

  if (options.limit !== undefined) {
    entries = entries.slice(0, options.limit);
  }

  return entries;
}

function compileBlueprint({ document, seedPath, genomes = [], filters = [], section, limit, offset } = {}) {
  const items = buildItems(document, seedPath);
  const selected = resolveFilterAddresses(filters, items);
  const options = { limit, offset };
  const sections = SECTION_DEFINITIONS
    .filter((definition) => !section || definition.id === section)
    .map((definition) => {
      if (definition.singleton) {
        return {
          id: definition.id,
          title: definition.title,
          sourceSection: definition.source,
          items: selected ? [] : [{
            id: 'metadata',
            address: null,
            section: 'metadata',
            value: document.metadata,
            references: [],
            source: itemSource(seedPath),
          }],
        };
      }

      return {
        id: definition.id,
        title: definition.title,
        sourceSection: definition.source,
        items: sectionItems(definition, items, selected, options),
      };
    })
    .filter((entry) => entry.items.length > 0 || section === entry.id);

  if (section && !SECTION_DEFINITIONS.some((definition) => definition.id === section)) {
    throw new Error(`Unknown blueprint section ${section}.`);
  }

  return {
    kind: 'seed-blueprint',
    source: {
      path: seedPath,
      genomes,
    },
    filters: filters.map(normalizeFilter),
    sections,
  };
}

function compactYaml(value) {
  return stringify(value).replace(/\n+$/, '');
}

function renderItem(item) {
  const lines = [];
  const sourceLabel = item.source?.path ? ` [${item.source.path}]` : '';
  const label = item.address ? `\`${item.address}\`` : `\`${item.id}\``;
  lines.push(`- ${label}${sourceLabel}`);

  const rendered = compactYaml(item.value)
    .split('\n')
    .map((line) => `  ${line}`);
  lines.push(...rendered);
  return lines.join('\n');
}

function renderMarkdown(blueprint) {
  const lines = [
    '# Seed Blueprint',
    '',
    `Source: ${blueprint.source.path}`,
  ];

  if (blueprint.source.genomes?.length > 0) {
    lines.push(`Genomes: ${blueprint.source.genomes.map((entry) => `${entry.id} [${entry.origin}]`).join(', ')}`);
  }

  if (blueprint.filters.length > 0) {
    lines.push(`Filters: ${blueprint.filters.map((entry) => `@${entry}`).join(', ')}`);
  }

  blueprint.sections.forEach((section) => {
    lines.push('', `## ${section.title}`, '');

    if (section.items.length === 0) {
      lines.push('_No entries._');
      return;
    }

    section.items.forEach((item) => {
      lines.push(renderItem(item), '');
    });
  });

  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

function applyLineWindow(text, { head, tail } = {}) {
  if (head === undefined && tail === undefined) {
    return text;
  }

  const lines = text.replace(/\n$/, '').split('\n');
  const output = [];

  if (head !== undefined) {
    output.push(...lines.slice(0, head));
  }

  if (tail !== undefined) {
    if (output.length > 0 && head !== undefined && head < lines.length - tail) {
      output.push('...');
    }
    output.push(...lines.slice(Math.max(0, lines.length - tail)));
  }

  return `${output.join('\n')}\n`;
}

function pageOutput(text) {
  const pager = process.env.PAGER || 'less';
  const result = spawnSync(pager, [], {
    input: text,
    stdio: ['pipe', 'inherit', 'inherit'],
    shell: true,
  });

  if (result.error) {
    throw new Error(`Failed to run pager ${pager}: ${result.error.message}`);
  }

  return result.status ?? 0;
}

module.exports = {
  SECTION_DEFINITIONS,
  applyLineWindow,
  compileBlueprint,
  pageOutput,
  renderMarkdown,
};
