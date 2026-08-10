'use strict';

const REQUIREMENTS_WARNING = 'These requirements are not in the correct Seed contract shape yet. Convert them into the appropriate Seed sections, verifications, and required artifacts, then remove them from `requirements`. The Seed is not implementation-ready while any remain.';

function pointerSegment(segment) {
  return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
}

function inspectRequirements(value) {
  const requirements = [];
  const errors = [];

  if (value === undefined) {
    return { requirements, errors };
  }

  if (!Array.isArray(value) && (value === null || typeof value !== 'object')) {
    errors.push({
      path: '/requirements',
      message: 'requirements must be a list of strings or a nested object with string leaves',
    });
    return { requirements, errors };
  }

  function visit(entry, path) {
    if (typeof entry === 'string') {
      if (entry.trim() === '') {
        errors.push({ path, message: 'requirement text must be a non-empty string' });
      } else {
        requirements.push({ path, text: entry.trim() });
      }
      return;
    }

    if (Array.isArray(entry)) {
      entry.forEach((item, index) => {
        const itemPath = `${path}/${index}`;
        if (typeof item !== 'string') {
          errors.push({ path: itemPath, message: 'requirement list entries must be non-empty strings' });
          return;
        }
        visit(item, itemPath);
      });
      return;
    }

    if (entry !== null && typeof entry === 'object') {
      Object.entries(entry).forEach(([key, item]) => {
        visit(item, `${path}/${pointerSegment(key)}`);
      });
      return;
    }

    errors.push({ path, message: 'requirements must be a list of strings or a nested object with string leaves' });
  }

  visit(value, '/requirements');
  return { requirements, errors };
}

function renderRequirementsWarning(requirements) {
  if (!requirements || requirements.length === 0) {
    return '';
  }

  const lines = [
    '# ⚠ SEED NOT READY: UNRESOLVED REQUIREMENTS',
    '',
    `> ${REQUIREMENTS_WARNING}`,
    '',
    '## Requirements Awaiting Conversion',
    '',
    ...requirements.map((entry) => `- \`${entry.path}\`: ${entry.text.replace(/\s*\n\s*/g, ' ')}`),
    '',
    '---',
    '',
  ];

  return lines.join('\n');
}

module.exports = {
  REQUIREMENTS_WARNING,
  inspectRequirements,
  renderRequirementsWarning,
};
