const { spawnSync } = require('node:child_process');
const { stringify } = require('yaml');
const { collectAddressableItems, collectGlobalPolicyItems, collectPresentAddressableItems } = require('./validation');

const REFERENCE_PATTERN = /@([A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)*)/g;

const SECTION_DEFINITIONS = [
  { id: 'project-summary', title: 'Project Summary', source: 'metadata', singleton: true },
  { id: 'global-policies', title: 'Global Policies', source: 'global-policies', virtual: true },
  { id: 'scope', title: 'Scope', source: 'scope' },
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
    origin: 'seed',
    path: seedPath,
  };
}

function sourceLabel(source) {
  if (!source) {
    return '';
  }

  if (source.origin === 'builtin' && source.id) {
    return `builtin:${source.id}`;
  }

  return source.path ?? '';
}

function buildItems(document, seedPath, provenance = {}, partial = false) {
  const errors = [];
  const normalized = partial
    ? collectPresentAddressableItems(document, errors)
    : collectAddressableItems(document, errors);
  if (errors.length > 0) {
    throw new Error(`Cannot build blueprint from invalid addressable sections: ${errors.map((entry) => entry.message).join('; ')}`);
  }

  return normalized.map((item) => ({
    id: item.id,
    address: item.address,
    section: item.section,
    value: item.value,
    references: collectReferences(item.value),
    source: provenance[item.address] ?? itemSource(seedPath),
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

function buildGlobalPolicyItems(document, seedPath, provenance = {}, selected = null) {
  const errors = [];
  const policies = collectGlobalPolicyItems(document, errors);
  if (errors.length > 0) {
    throw new Error('Cannot build global policies from invalid addressable sections: ' + errors.map((entry) => entry.message).join('; '));
  }

  return policies
    .filter((item) => itemMatchesSelection(item, selected))
    .map((item) => ({
      id: item.id,
      address: item.address,
      section: 'global-policies',
      value: item.value,
      references: collectReferences(item.value),
      source: provenance[item.address] ?? itemSource(seedPath),
    }));
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

function compileBlueprint({ document, seedPath, genomes = [], provenance = {}, filters = [], section, limit, offset, partial = false } = {}) {
  const items = buildItems(document, seedPath, provenance, partial);
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
            source: provenance.metadata ?? itemSource(seedPath),
          }],
        };
      }

      if (definition.virtual && definition.id === 'global-policies') {
        return {
          id: definition.id,
          title: definition.title,
          sourceSection: definition.source,
          items: buildGlobalPolicyItems(document, seedPath, provenance, selected),
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

const HEADING_TERMS = new Map([
  ['api', 'API'],
  ['cli', 'CLI'],
  ['csv', 'CSV'],
  ['ecs', 'ECS'],
  ['grpc', 'gRPC'],
  ['http', 'HTTP'],
  ['https', 'HTTPS'],
  ['id', 'ID'],
  ['io', 'I/O'],
  ['json', 'JSON'],
  ['jsonl', 'JSONL'],
  ['nodejs', 'Node.js'],
  ['npm', 'npm'],
  ['pty', 'PTY'],
  ['rbac', 'RBAC'],
  ['sdd', 'SDD'],
  ['sql', 'SQL'],
  ['ssh', 'SSH'],
  ['tui', 'TUI'],
  ['ui', 'UI'],
  ['url', 'URL'],
  ['uuid', 'UUID'],
  ['yaml', 'YAML'],
]);

function headingName(value) {
  return String(value)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => HEADING_TERMS.get(part.toLowerCase()) ?? `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function itemHeading(item) {
  if (item.value && typeof item.value === 'object' && !Array.isArray(item.value) && typeof item.value.title === 'string') {
    return item.value.title.trim().replace(/\s+/g, ' ');
  }

  return headingName(item.address?.split('.').at(-1) ?? item.id);
}

function itemHeadingLevel(item) {
  if (!item.address) {
    return 3;
  }

  const addressDepth = Math.max(1, item.address.split('.').length - 1);
  return Math.min(6, 2 + addressDepth);
}

function directChildKeys(item, sectionItems) {
  if (!item.address || !item.value || typeof item.value !== 'object' || Array.isArray(item.value)) {
    return new Set();
  }

  const prefix = `${item.address}.`;
  return new Set(sectionItems
    .map((candidate) => candidate.address)
    .filter((address) => address?.startsWith(prefix))
    .map((address) => address.slice(prefix.length))
    .filter((remainder) => remainder.length > 0 && !remainder.includes('.')));
}

function renderField(name, value) {
  const label = headingName(name);

  if (Array.isArray(value)) {
    const lines = [`**${label}:**`];
    value.forEach((entry) => {
      if (entry && typeof entry === 'object') {
        lines.push('', '```yaml', compactYaml(entry), '```');
      } else {
        lines.push(`- ${entry}`);
      }
    });
    return lines.join('\n');
  }

  if (value && typeof value === 'object') {
    return `**${label}:**\n\n\`\`\`yaml\n${compactYaml(value)}\n\`\`\``;
  }

  return `**${label}:** ${value}`;
}

function renderItemValue(item, sectionItems) {
  if (!item.value || typeof item.value !== 'object' || Array.isArray(item.value)) {
    return item.value === undefined || item.value === null ? '' : String(item.value);
  }

  const childKeys = directChildKeys(item, sectionItems);
  const fields = Object.entries(item.value)
    .filter(([key]) => key !== 'id' && key !== 'title' && !childKeys.has(key));
  const description = fields.find(([key, value]) => key === 'description' && typeof value === 'string');
  const remaining = fields.filter(([key]) => key !== 'description');
  const blocks = [];

  if (description) {
    blocks.push(description[1]);
  }

  remaining.forEach(([key, value]) => blocks.push(renderField(key, value)));
  return blocks.join('\n\n');
}

function renderItem(item, sectionItems, { includeSource = true } = {}) {
  const lines = [];
  const renderedSource = sourceLabel(item.source);
  const details = [];
  lines.push(`${'#'.repeat(itemHeadingLevel(item))} ${itemHeading(item)}`, '');

  if (item.address) {
    details.push(`Address: \`${item.address}\``);
  }
  if (includeSource && renderedSource) {
    details.push(`Source: \`${renderedSource}\``);
  }
  if (details.length > 0) {
    lines.push(`_${details.join(' · ')}_`, '');
  }

  const rendered = renderItemValue(item, sectionItems);
  if (rendered) {
    lines.push(rendered);
  } else if (lines.at(-1) === '') {
    lines.pop();
  }
  return lines.join('\n');
}

function missingAncestorHeadings(item, renderedAddresses) {
  if (!item.address) {
    return [];
  }

  const segments = item.address.split('.');
  const lines = [];
  for (let length = 2; length < segments.length; length += 1) {
    const address = segments.slice(0, length).join('.');
    if (renderedAddresses.has(address)) {
      continue;
    }

    const level = Math.min(6, length + 1);
    lines.push(`${'#'.repeat(level)} ${headingName(segments[length - 1])}`, '', `_Address: \`${address}\`_`, '');
    renderedAddresses.add(address);
  }
  return lines;
}

function renderMarkdown(blueprint, { includeSource = true, includeGenomes = true, includeItemSources = true } = {}) {
  const lines = [
    '# Seed Blueprint',
  ];

  if (includeSource) {
    lines.push('', `Source: ${blueprint.source.path}`);
  }

  if (includeGenomes && blueprint.source.genomes?.length > 0) {
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

    const renderedAddresses = new Set();
    section.items.forEach((item) => {
      lines.push(...missingAncestorHeadings(item, renderedAddresses));
      lines.push(renderItem(item, section.items, { includeSource: includeItemSources }), '');
      if (item.address) {
        renderedAddresses.add(item.address);
      }
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
