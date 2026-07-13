const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parse } = require('yaml');

const {
  DEFAULT_SEED_PATH,
  renderSeedTemplate,
  initSeed,
  loadSeed,
} = require('../src/seed-file');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'seed-file-test-'));
}

describe('seed file primitives', () => {
  function withTempDir(run) {
    const cwd = tempDir();

    try {
      return run(cwd);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  }

  test('renderSeedTemplate returns YAML with required sections and stable verification id', () => {
    const text = renderSeedTemplate();
    const doc = parse(text);

    assert.equal(typeof text, 'string');
    assert.ok(text.includes('verifications:'));
    assert.equal(doc?.verifications?.[0]?.id, 'seed-baseline-visibility');
    assert.equal(Array.isArray(doc.interfaces), true);
    assert.equal(Array.isArray(doc.verifications), true);
  });

  test('initSeed writes seed file and preserves template contract', () => {
    const cwd = tempDir();
    const result = initSeed({ cwd });

    assert.equal(result.path, path.join(cwd, DEFAULT_SEED_PATH));
    assert.equal(result.document.metadata.version, '0.1.0');
    assert.equal(fs.existsSync(result.path), true);

    fs.rmSync(cwd, { recursive: true, force: true });
  });

  test('initSeed refuses overwrite unless explicit', () => {
    withTempDir((cwd) => {
      initSeed({ cwd });
      assert.throws(() => initSeed({ cwd }));
      assert.doesNotThrow(() => initSeed({ cwd, overwrite: true }));
    });
  });

  test('loadSeed returns path, text, and document', () => {
    const cwd = tempDir();
    const created = initSeed({ cwd });
    const loaded = loadSeed({ cwd });

    assert.equal(loaded.path, path.join(cwd, DEFAULT_SEED_PATH));
    assert.equal(loaded.text, created.text);
    assert.equal(loaded.document.metadata.name, 'project-name');

    fs.rmSync(cwd, { recursive: true, force: true });
  });

  test('loadSeed fails with clear missing-file hint', () => {
    const err = withTempDir((cwd) => {
      try {
        loadSeed({ cwd });
      } catch (error) {
        return error;
      }

      return undefined;
    });

    assert.ok(err instanceof Error);
    assert.match(err.message, /Seed contract missing/);
    assert.match(err.message, /seed init/);
  });

  test('loadSeed surfaces parse errors clearly', () => {
    const err = withTempDir((cwd) => {
      const target = path.join(cwd, DEFAULT_SEED_PATH);
      fs.mkdirSync(path.join(cwd, 'seed'), { recursive: true });
      fs.writeFileSync(target, 'metadata:\n  - [invalid', 'utf8');

      try {
        loadSeed({ cwd });
      } catch (error) {
        return error;
      }

      return undefined;
    });

    assert.ok(err instanceof Error);
    assert.match(err.message, /Failed to parse Seed YAML/);
    assert.equal(err.cause?.name, 'YAMLParseError');
  });
});
