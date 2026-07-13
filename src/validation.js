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

  if (!isString(document.metadata.summary)) {
    pushError(errors, 'missing-required-field', '/metadata/summary', 'metadata.summary is required and must be a non-empty string');
  }
}

function validateScope(document, errors) {
  if (!isObject(document.scope)) {
    pushError(errors, 'missing-required-section', '/scope', 'scope section is required and must be an object');
    return;
  }

  if (!Array.isArray(document.scope.included)) {
    pushError(errors, 'missing-required-field', '/scope/included', 'scope.included is required and must be an array');
  } else if (document.scope.included.length === 0) {
    pushError(errors, 'invalid-scope', '/scope/included', 'scope.included must contain at least one behavior string');
  } else if (!document.scope.included.every(isString)) {
    pushError(errors, 'invalid-scope', '/scope/included', 'scope.included entries must be non-empty strings');
  }

  if (!Array.isArray(document.scope.excluded)) {
    pushError(errors, 'missing-required-field', '/scope/excluded', 'scope.excluded is required and must be an array');
  } else if (document.scope.excluded.length === 0) {
    pushError(errors, 'invalid-scope', '/scope/excluded', 'scope.excluded must contain at least one behavior string');
  } else if (!document.scope.excluded.every(isString)) {
    pushError(errors, 'invalid-scope', '/scope/excluded', 'scope.excluded entries must be non-empty strings');
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

    if (!isString(entry.description)) {
      pushError(errors, 'missing-required-field', `${entryPath}/description`, 'verification description is required and must be a non-empty string');
    }

    if (!isString(entry.method)) {
      pushError(errors, 'missing-required-field', `${entryPath}/method`, 'verification method is required and must be a non-empty string');
    }

    if (!Array.isArray(entry.evidenceGuidance)) {
      pushError(errors, 'missing-required-field', `${entryPath}/evidenceGuidance`, 'verification evidenceGuidance is required and must be an array');
    } else if (!entry.evidenceGuidance.length) {
      pushError(errors, 'invalid-verification', `${entryPath}/evidenceGuidance`, 'verification evidenceGuidance is required and must be non-empty');
    } else if (!entry.evidenceGuidance.every(isString)) {
      pushError(errors, 'invalid-verification', `${entryPath}/evidenceGuidance`, 'verification evidenceGuidance entries must be non-empty strings');
    }

    if (entry.traceability !== undefined) {
      if (!Array.isArray(entry.traceability)) {
        pushError(errors, 'invalid-verification', `${entryPath}/traceability`, 'verification traceability must be an array when provided');
      } else if (!entry.traceability.every(isString)) {
        pushError(errors, 'invalid-verification', `${entryPath}/traceability`, 'verification traceability entries must be non-empty strings');
      }
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
