'use strict';

function canonicalizeJson(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizeJson);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalizeJson(value[key])]),
    );
  }

  return value;
}

function canonicalJson(value, space) {
  return JSON.stringify(canonicalizeJson(value), null, space);
}

module.exports = {
  canonicalizeJson,
  canonicalJson,
};
