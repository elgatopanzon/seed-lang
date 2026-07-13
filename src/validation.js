const VERIFICATION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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

function validateMetadata(document, errors) {
  if (!isObject(document.metadata)) {
    pushError(errors, 'missing-required-section', '/metadata', 'metadata section is required and must be an object');
    return;
  }

  if (!isString(document.metadata.name)) {
    pushError(errors, 'missing-required-field', '/metadata/name', 'metadata.name is required and must be a non-empty string');
  }

  if (!isString(document.metadata.version)) {
    pushError(errors, 'missing-required-field', '/metadata/version', 'metadata.version is required and must be a non-empty string');
  }
}

function validateScope(document, errors) {
  if (!isObject(document.scope)) {
    pushError(errors, 'missing-required-section', '/scope', 'scope section is required and must be an object');
    return;
  }

  if (!isString(document.scope.boundary)) {
    pushError(errors, 'missing-required-field', '/scope/boundary', 'scope.boundary is required and must be a non-empty string');
  }
}

function validateInterfaces(document, errors, warnings) {
  const path = '/interfaces';
  if (!Array.isArray(document.interfaces) || document.interfaces.length === 0) {
    pushError(errors, 'missing-required-section', path, 'interfaces is required and must be a non-empty array');
    return;
  }

  document.interfaces.forEach((entry, index) => {
    const entryPath = `${path}/${index}`;

    if (!isObject(entry)) {
      pushError(errors, 'invalid-interface', entryPath, 'each interface entry must be an object');
      return;
    }

    if (!isString(entry.id)) {
      pushError(errors, 'missing-required-field', `${entryPath}/id`, `interface id is required and must be a non-empty string`);
    }

    if (!('examples' in entry) || !Array.isArray(entry.examples) || entry.examples.length === 0) {
      pushWarning(warnings, 'interface-without-examples', `${entryPath}/examples`, 'interface should include examples');
    }
  });
}

function validateBehavior(document, errors, warnings) {
  if (!isObject(document.behavior)) {
    pushError(errors, 'missing-required-section', '/behavior', 'behavior is required and must be an object');
    return;
  }

  if (!Array.isArray(document.behavior.summary)) {
    pushError(errors, 'missing-required-field', '/behavior/summary', 'behavior.summary is required and must be an array');
  }

  if (Array.isArray(document.behavior.outputs) && document.behavior.outputs.length > 0) {
    const errorsSection = document.errors;
    const hasUsableErrors = Array.isArray(errorsSection) && errorsSection.length > 0;
    if (!hasUsableErrors) {
      pushWarning(warnings, 'outputs-without-errors', '/behavior/outputs', 'behavior.outputs is declared but no concrete errors are defined');
    }
  }
}

function validateState(document, errors, warnings) {
  if (document.state === undefined) {
    return;
  }

  if (!isObject(document.state)) {
    pushError(errors, 'invalid-optional-section', '/state', 'state must be an object when provided');
    return;
  }

  if (!isString(document.state.location)) {
    pushError(errors, 'missing-required-field', '/state/location', 'state.location is required and must be a non-empty string');
  }

  if (!isString(document.state.persistence)) {
    pushError(errors, 'missing-required-field', '/state/persistence', 'state.persistence is required and must be a non-empty string');
  }

  if (isString(document.state.persistence) && (!isString(document.state.semantics))) {
    pushWarning(warnings, 'persistence-without-semantics', '/state/semantics', 'state.persistence is declared without state semantics');
  }
}

function validateErrorsSection(document, errors) {
  const path = '/errors';
  if (!Array.isArray(document.errors)) {
    pushError(errors, 'missing-required-section', path, 'errors section is required and must be an array');
  }
}

function validateRequiredArraySection(document, errors, section) {
  const path = `/${section}`;
  if (!Array.isArray(document[section])) {
    pushError(errors, 'missing-required-section', path, `${section} section is required and must be an array`);
  }
}

function validateVerifications(document, errors, warnings) {
  const path = '/verifications';
  if (!Array.isArray(document.verifications) || document.verifications.length === 0) {
    pushError(errors, 'missing-required-section', path, 'verifications is required and must be a non-empty array');
    return;
  }

  const seenIds = new Set();
  document.verifications.forEach((entry, index) => {
    const entryPath = `${path}/${index}`;
    if (!isObject(entry)) {
      pushError(errors, 'invalid-verification', entryPath, 'each verification entry must be an object');
      return;
    }

    const { id } = entry;
    if (!isString(id) || !VERIFICATION_ID_PATTERN.test(id)) {
      pushError(errors, 'malformed-verification-id', `${entryPath}/id`, 'verification id must be lowercase alphanumeric with dashes');
      return;
    }

    if (seenIds.has(id)) {
      pushError(errors, 'duplicate-verification-id', `${entryPath}/id`, `verification id ${id} is duplicated`);
    }
    seenIds.add(id);

    if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) {
      pushWarning(warnings, 'verification-without-evidence', `${entryPath}/evidence`, 'verification should provide evidence guidance');
    }
  });
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
  validateScope(document, errors);
  validateErrorsSection(document, errors);
  validateRequiredArraySection(document, errors, 'constraints');
  validateRequiredArraySection(document, errors, 'freedom');
  validateState(document, errors, warnings);
  validateBehavior(document, errors, warnings);
  validateInterfaces(document, errors, warnings);
  validateVerifications(document, errors, warnings);

  return { errors, warnings };
}

module.exports = {
  validateSeedDocument,
};
