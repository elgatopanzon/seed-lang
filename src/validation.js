const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const REFERENCE_PATTERN = /@([A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)*)/g;
const HTTP_URL_PATTERN = /^https?:\/\//i;
const URL_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;

const REQUIRED_SECTIONS = [
  'scope',
  'interfaces',
  'behavior',
  'errors',
  'constraints',
  'freedom',
  'verifications',
];

const OPTIONAL_ADDRESSABLE_SECTIONS = [
  'artifacts',
  'security',
  'environment',
  'observability',
  'compatibility',
  'state',
];

const ADDRESSABLE_SECTIONS = [
  ...REQUIRED_SECTIONS,
  ...OPTIONAL_ADDRESSABLE_SECTIONS,
];

const PROPERTY_FIELDS = new Set([
  'artifacts',
  'code',
  'command',
  'description',
  'evidence_required',
  'examples',
  'expected',
  'inputs',
  'invocation',
  'location',
  'method',
  'outputs',
  'path',
  'persistence',
  'policy',
  'purpose',
  'remediation',
  'semantics',
  'title',
  'when',
]);

const POLICY_VALUES = new Set(['local', 'global']);

function issue(code, path, message) {
  return { code, path, message };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function pushError(errors, code, path, message) {
  errors.push(issue(code, path, message));
}

function pushWarning(warnings, code, path, message) {
  warnings.push(issue(code, path, message));
}

function pointerSegment(segment) {
  return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
}

function joinPointer(path, segment) {
  return `${path}/${pointerSegment(segment)}`;
}

function validateId(id, path, errors, label = 'id') {
  if (!isString(id) || !ID_PATTERN.test(id)) {
    pushError(errors, 'malformed-id', path, `${label} must start with an alphanumeric character and contain only letters, numbers, underscores, or hyphens`);
    return false;
  }
  return true;
}

function validateMetadata(document, errors) {
  if (!isObject(document.metadata)) {
    pushError(errors, 'missing-required-section', '/metadata', 'metadata section is required and must be an object');
    return;
  }

  if (!isString(document.metadata.name)) {
    pushError(errors, 'missing-required-field', '/metadata/name', 'metadata.name is required and must be a non-empty string');
  }

  if (!isString(document.metadata.summary)) {
    pushError(errors, 'missing-required-field', '/metadata/summary', 'metadata.summary is required and must be a non-empty string');
  }
}

function shouldRecurseInto(key, value) {
  if (PROPERTY_FIELDS.has(key)) {
    return false;
  }

  return isObject(value) || Array.isArray(value);
}

function normalizeScalarTreeItem(section, key, value, address, pointer, errors) {
  if (!isString(value)) {
    pushError(errors, 'invalid-addressable-item', pointer, `${address} must be an object or non-empty string`);
    return null;
  }

  return {
    section,
    id: key,
    address,
    path: pointer,
    value: { description: value },
    source: 'tree-string',
  };
}

function normalizeObjectTreeItem(section, key, value, address, pointer) {
  return {
    section,
    id: key,
    address,
    path: pointer,
    value: { ...value, id: value.id ?? key },
    source: 'tree-object',
  };
}

function normalizeListItem(section, value, addressPrefix, pointer, index, errors) {
  const itemPath = joinPointer(pointer, index);
  if (!isObject(value)) {
    pushError(errors, 'invalid-addressable-item', itemPath, `${addressPrefix} entries must be objects with an id`);
    return null;
  }

  if (!validateId(value.id, joinPointer(itemPath, 'id'), errors)) {
    return null;
  }

  return {
    section,
    id: value.id,
    address: `${addressPrefix}.${value.id}`,
    path: itemPath,
    value,
    source: 'list-object',
  };
}

function normalizeTree(section, value, addressPrefix, pointer, errors, items) {
  Object.entries(value).forEach(([key, entry]) => {
    const entryPath = joinPointer(pointer, key);
    const address = `${addressPrefix}.${key}`;

    if (!validateId(key, entryPath, errors, 'tree key')) {
      return;
    }

    if (typeof entry === 'string') {
      const normalized = normalizeScalarTreeItem(section, key, entry, address, entryPath, errors);
      if (normalized) {
        items.push(normalized);
      }
      return;
    }

    if (Array.isArray(entry)) {
      if (entry.length === 0) {
        pushError(errors, 'empty-addressable-section', entryPath, `${address} must not be empty`);
        return;
      }
      entry.forEach((child, index) => {
        const normalized = normalizeListItem(section, child, address, entryPath, index, errors);
        if (normalized) {
          items.push(normalized);
        }
      });
      return;
    }

    if (!isObject(entry)) {
      pushError(errors, 'invalid-addressable-item', entryPath, `${address} must be an object or non-empty string`);
      return;
    }

    items.push(normalizeObjectTreeItem(section, key, entry, address, entryPath));

    Object.entries(entry).forEach(([childKey, childValue]) => {
      if (PROPERTY_FIELDS.has(childKey)) {
        return;
      }

      const childPath = joinPointer(entryPath, childKey);
      const childAddress = `${address}.${childKey}`;

      if (typeof childValue === 'string') {
        const normalized = normalizeScalarTreeItem(section, childKey, childValue, childAddress, childPath, errors);
        if (normalized) {
          items.push(normalized);
        }
        return;
      }

      if (shouldRecurseInto(childKey, childValue)) {
        if (Array.isArray(childValue)) {
          childValue.forEach((child, index) => {
            const normalized = normalizeListItem(section, child, childAddress, childPath, index, errors);
            if (normalized) {
              items.push(normalized);
            }
          });
        } else {
          normalizeTree(section, childValue, childAddress, childPath, errors, items);
        }
      }
    });
  });
}

function normalizeAddressableSection(section, value, errors = [], options = {}) {
  const items = [];
  const pointer = `/${section}`;

  if (Array.isArray(value)) {
    if (value.length === 0) {
      if (!options.allowEmpty) {
        pushError(errors, 'empty-addressable-section', pointer, `${section} must not be empty`);
      }
      return items;
    }

    value.forEach((entry, index) => {
      const normalized = normalizeListItem(section, entry, section, pointer, index, errors);
      if (normalized) {
        items.push(normalized);
      }
    });
    return items;
  }

  if (isObject(value)) {
    if (Object.keys(value).length === 0) {
      if (!options.allowEmpty) {
        pushError(errors, 'empty-addressable-section', pointer, `${section} must not be empty`);
      }
      return items;
    }

    normalizeTree(section, value, section, pointer, errors, items);
    return items;
  }

  pushError(errors, 'missing-required-section', pointer, `${section} section is required and must be an object tree or array of objects`);
  return items;
}

function collectAddressableItems(document, errors) {
  const items = [];

  REQUIRED_SECTIONS.forEach((section) => {
    items.push(...normalizeAddressableSection(section, document[section], errors, { allowEmpty: section === 'errors' }));
  });

  OPTIONAL_ADDRESSABLE_SECTIONS.forEach((section) => {
    if (document[section] !== undefined) {
      items.push(...normalizeAddressableSection(section, document[section], errors, { allowEmpty: section === 'errors' }));
    }
  });

  return items;
}

function collectPresentAddressableItems(document, errors) {
  const items = [];

  ADDRESSABLE_SECTIONS.forEach((section) => {
    if (document[section] !== undefined) {
      items.push(...normalizeAddressableSection(section, document[section], errors, { allowEmpty: section === 'errors' }));
    }
  });

  return items;
}

function validateDuplicateAddresses(items, errors) {
  const seen = new Map();
  items.forEach((item) => {
    if (seen.has(item.address)) {
      pushError(errors, 'duplicate-address', item.path, `address ${item.address} is duplicated`);
      return;
    }
    seen.set(item.address, item.path);
  });
}


function itemPolicy(item) {
  const explicit = item.value?.policy;
  if (explicit !== undefined) {
    return explicit;
  }

  return item.section === 'security' ? 'global' : 'local';
}

function validatePolicies(items, errors) {
  items.forEach((item) => {
    if (!isObject(item.value) || item.value.policy === undefined) {
      return;
    }

    if (!POLICY_VALUES.has(item.value.policy)) {
      pushError(errors, 'invalid-policy', joinPointer(item.path, 'policy'), item.address + ' policy must be local or global');
    }
  });
}

function collectGlobalPolicyItems(document, errors = []) {
  const items = collectPresentAddressableItems(document, errors);
  if (errors.length > 0) {
    return [];
  }

  return items
    .filter((item) => item.section !== 'metadata')
    .filter((item) => item.section !== 'artifacts')
    .filter((item) => item.section !== 'verifications')
    .filter((item) => itemPolicy(item) === 'global')
    .map((item) => ({
      id: item.id,
      address: item.address,
      section: item.section,
      path: item.path,
      value: item.value,
      policy: 'global',
      description: isString(item.value?.description) ? item.value.description : null,
    }));
}

function validateArtifacts(document, artifactItems, errors) {
  artifactItems.forEach((item) => {
    const artifact = item.value;
    const artifactPath = item.path;

    if (!isString(artifact.description)) {
      pushError(errors, 'missing-required-field', joinPointer(artifactPath, 'description'), `artifact ${item.id} requires a description`);
    }

    if (!isString(artifact.path)) {
      pushError(errors, 'missing-required-field', joinPointer(artifactPath, 'path'), `artifact ${item.id} requires a path`);
      return;
    }

    if (artifact.path.startsWith('/')) {
      pushError(errors, 'invalid-artifact-path', joinPointer(artifactPath, 'path'), `artifact ${item.id} path must not be absolute`);
      return;
    }

    if (URL_SCHEME_PATTERN.test(artifact.path) && !HTTP_URL_PATTERN.test(artifact.path)) {
      pushError(errors, 'invalid-artifact-path', joinPointer(artifactPath, 'path'), `artifact ${item.id} path must be relative or http/https`);
    }
  });

  if (document.artifacts !== undefined && artifactItems.length === 0 && errors.every((entry) => !entry.path.startsWith('/artifacts'))) {
    pushError(errors, 'empty-addressable-section', '/artifacts', 'artifacts must not be empty when provided');
  }
}

function collectReferences(value, path = '/') {
  const refs = [];

  if (typeof value === 'string') {
    for (const match of value.matchAll(REFERENCE_PATTERN)) {
      refs.push({ id: match[1], path });
    }
    return refs;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      refs.push(...collectReferences(entry, joinPointer(path, index)));
    });
    return refs;
  }

  if (isObject(value)) {
    Object.entries(value).forEach(([key, entry]) => {
      refs.push(...collectReferences(entry, joinPointer(path, key)));
    });
  }

  return refs;
}

function artifactDeclarations(value) {
  if (!isObject(value) || value.artifacts === undefined) {
    return [];
  }

  if (!Array.isArray(value.artifacts)) {
    return null;
  }

  return value.artifacts;
}

function validateBlockArtifactReferences(item, artifactIds, errors) {
  const refs = collectReferences(item.value, item.path);
  const artifactRefs = refs.filter((ref) => artifactIds.has(ref.id));

  if (item.source === 'tree-string' && artifactRefs.length > 0) {
    artifactRefs.forEach((ref) => {
      pushError(errors, 'missing-artifact-declaration', ref.path, `${item.address} mentions artifact @${ref.id} but string shorthand cannot declare artifacts; use object form with artifacts list`);
    });
    return;
  }

  const declarations = artifactDeclarations(item.value);
  if (declarations === null) {
    pushError(errors, 'invalid-artifact-declaration', joinPointer(item.path, 'artifacts'), `${item.address} artifacts must be an array of artifact ids`);
    return;
  }

  const declared = new Set(declarations ?? []);
  artifactRefs.forEach((ref) => {
    if (!declared.has(ref.id)) {
      pushError(errors, 'missing-artifact-declaration', ref.path, `${item.address} mentions artifact @${ref.id} but does not list it in artifacts`);
    }
  });

  if (declarations) {
    declarations.forEach((id, index) => {
      const declarationPath = joinPointer(joinPointer(item.path, 'artifacts'), index);
      if (!isString(id)) {
        pushError(errors, 'invalid-artifact-declaration', declarationPath, `${item.address} artifacts entries must be non-empty strings`);
      } else if (!artifactIds.has(id)) {
        pushError(errors, 'missing-artifact', declarationPath, `${item.address} references missing artifact ${id}`);
      }
    });
  }
}

function validateReferences(document, items, errors, warnings) {
  const addressSet = new Set(items.map((item) => item.address));
  const artifactItems = items.filter((item) => item.section === 'artifacts');
  const artifactIds = new Set(artifactItems.map((item) => item.id));
  const artifactRefs = new Set();
  const seenReferenceKeys = new Set();

  Object.entries(document).forEach(([section, value]) => {
    if (section === 'metadata' || section === 'artifacts') {
      return;
    }

    collectReferences(value, `/${section}`).forEach((ref) => {
      const isArtifactRef = artifactIds.has(ref.id);
      const isAddressRef = addressSet.has(ref.id);
      const referenceKey = `${ref.path}:${ref.id}`;

      if (isArtifactRef) {
        artifactRefs.add(ref.id);
      }

      if (!isArtifactRef && !isAddressRef) {
        pushError(errors, 'invalid-reference', ref.path, `reference @${ref.id} does not match an artifact id or addressable contract item`);
      } else if (!seenReferenceKeys.has(referenceKey)) {
        seenReferenceKeys.add(referenceKey);
      }
    });
  });

  items.forEach((item) => {
    if (item.section !== 'artifacts') {
      validateBlockArtifactReferences(item, artifactIds, errors);
    }
  });

  artifactItems.forEach((item) => {
    if (!artifactRefs.has(item.id)) {
      pushWarning(warnings, 'unreferenced-artifact', item.path, `artifact ${item.id} is defined but not referenced by any section`);
    }
  });
}

function validateInterfaces(items, warnings) {
  items.filter((item) => item.section === 'interfaces').forEach((item) => {
    if (!Array.isArray(item.value.examples) || item.value.examples.length === 0) {
      pushWarning(warnings, 'interface-without-examples', joinPointer(item.path, 'examples'), 'interface should include examples');
    }
  });
}

function validateBehavior(document, warnings) {
  const behaviorText = document.behavior === undefined ? '' : JSON.stringify(document.behavior);
  const errorsSection = document.errors;
  const hasUsableErrors = (Array.isArray(errorsSection) && errorsSection.length > 0)
    || (isObject(errorsSection) && Object.keys(errorsSection).length > 0);

  if (behaviorText.includes('outputs') && !hasUsableErrors) {
    pushWarning(warnings, 'outputs-without-errors', '/behavior', 'behavior outputs are declared but no concrete errors are defined');
  }
}

function validateState(document, warnings) {
  if (document.state === undefined) {
    return;
  }

  const stateText = JSON.stringify(document.state);
  if (stateText.includes('persistence') && !stateText.includes('semantics')) {
    pushWarning(warnings, 'persistence-without-semantics', '/state', 'state persistence is declared without state semantics');
  }
}

function validateVerifications(items, errors) {
  items.filter((item) => item.section === 'verifications').forEach((item) => {
    if (!isString(item.value.description)) {
      pushError(errors, 'missing-required-field', joinPointer(item.path, 'description'), 'verification description is required and must be a non-empty string');
    }

    if (!isString(item.value.method)) {
      pushError(errors, 'missing-required-field', joinPointer(item.path, 'method'), 'verification method is required and must be a non-empty string');
    }

    if (!Array.isArray(item.value.evidence_required)) {
      pushError(errors, 'missing-required-field', joinPointer(item.path, 'evidence_required'), 'verification evidence_required is required and must be an array');
    } else if (!item.value.evidence_required.length) {
      pushError(errors, 'invalid-verification', joinPointer(item.path, 'evidence_required'), 'verification evidence_required is required and must be non-empty');
    } else if (!item.value.evidence_required.every(isString)) {
      pushError(errors, 'invalid-verification', joinPointer(item.path, 'evidence_required'), 'verification evidence_required entries must be non-empty strings');
    }

    if (item.value.traceability !== undefined) {
      pushError(errors, 'manual-traceability', joinPointer(item.path, 'traceability'), 'verification traceability is agent-produced verification state, not Seed input');
    }
  });
}

function validateGenomeDocument(document) {
  const errors = [];
  const warnings = [];

  if (!isObject(document)) {
    return {
      errors: [issue('invalid-document', '/', 'Genome document must be a non-null object')],
      warnings,
    };
  }

  const items = collectPresentAddressableItems(document, errors);
  validateDuplicateAddresses(items, errors);
  validatePolicies(items, errors);
  validateArtifacts(document, items.filter((item) => item.section === 'artifacts'), errors);
  validateInterfaces(items, warnings);
  validateBehavior(document, warnings);
  validateState(document, warnings);
  validateVerifications(items, errors);
  validateReferences(document, items, errors, warnings);

  return { errors, warnings };
}

function validateSeedDocument(document) {
  const errors = [];
  const warnings = [];

  if (!isObject(document)) {
    return {
      errors: [issue('invalid-document', '/', 'Seed document must be a non-null object')],
      warnings,
    };
  }

  validateMetadata(document, errors);

  const items = collectAddressableItems(document, errors);
  validateDuplicateAddresses(items, errors);
  validatePolicies(items, errors);
  validateArtifacts(document, items.filter((item) => item.section === 'artifacts'), errors);
  validateInterfaces(items, warnings);
  validateBehavior(document, warnings);
  validateState(document, warnings);
  validateVerifications(items, errors);
  validateReferences(document, items, errors, warnings);

  return { errors, warnings };
}

module.exports = {
  collectAddressableItems,
  collectGlobalPolicyItems,
  collectPresentAddressableItems,
  itemPolicy,
  normalizeAddressableSection,
  validateGenomeDocument,
  validateSeedDocument,
};
