const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parse } = require('yaml');

const {
  DEFAULT_SEED_PATH,
  DEFAULT_SEED_SCRIPTS_PATH,
  renderSeedTemplate,
  ensureGitignore,
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
    assert.equal(doc?.metadata?.summary, 'Bounded behavior contract for a local repository.');
    assert.equal(typeof doc?.scope?.included, 'object');
    assert.equal(Object.keys(doc.scope.included).length > 0, true);
    assert.equal(typeof doc?.scope?.excluded, 'object');
    assert.equal(Object.keys(doc.scope.excluded).length > 0, true);
    assert.equal(typeof doc.interfaces, 'object');
    assert.equal(typeof doc.artifacts, 'object');
    assert.equal(typeof doc.security, 'object');
    assert.equal(typeof doc.environment, 'object');
    assert.equal(typeof doc.observability, 'object');
    assert.equal(typeof doc.compatibility, 'object');
    assert.equal(Array.isArray(doc.verifications), true);
    assert.equal(Array.isArray(doc.verifications[0].evidence_required), true);
    assert.equal(doc.verifications[0].evidence_required.length > 0, true);
  });

  test('initSeed creates idempotent gitignore section for seed locks', () => {
    withTempDir((cwd) => {
      initSeed({ cwd });
      const gitignorePath = path.join(cwd, '.gitignore');
      const first = fs.readFileSync(gitignorePath, 'utf8');

      assert.ok(first.includes('# seed-lang'));
      assert.ok(first.includes('.seed/locks/'));
      assert.equal(first.includes('.seed/sessions/'), false);

      ensureGitignore(cwd);
      const second = fs.readFileSync(gitignorePath, 'utf8');
      assert.equal(second, first);
    });
  });

  test('initSeed appends seed gitignore section once to existing file', () => {
    withTempDir((cwd) => {
      const gitignorePath = path.join(cwd, '.gitignore');
      fs.writeFileSync(gitignorePath, 'dist/\n', 'utf8');

      initSeed({ cwd });
      initSeed({ cwd, overwrite: true });

      const content = fs.readFileSync(gitignorePath, 'utf8');
      assert.ok(content.startsWith('dist/\n'));
      assert.equal((content.match(/# seed-lang/g) ?? []).length, 1);
      assert.equal((content.match(/\.seed\/locks\//g) ?? []).length, 1);
    });
  });

  test('initSeed writes seed file and preserves template contract', () => {
    const cwd = tempDir();
    const result = initSeed({ cwd });

    assert.equal(result.path, path.join(cwd, DEFAULT_SEED_PATH));
    assert.equal(result.document.metadata.version, undefined);
    assert.equal(fs.existsSync(result.path), true);
    assert.equal(fs.existsSync(path.join(cwd, DEFAULT_SEED_SCRIPTS_PATH)), true);

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

  test('loadSeed parses unquoted genome exclusion tags', () => {
    withTempDir((cwd) => {
      const text = renderSeedTemplate().replace(
        'scope:',
        'genomes:\n  - cli-hello-world\n  - !cli-single-command\nscope:',
      );
      fs.mkdirSync(path.join(cwd, 'seed'), { recursive: true });
      fs.writeFileSync(path.join(cwd, DEFAULT_SEED_PATH), text, 'utf8');

      const loaded = loadSeed({ cwd });

      assert.deepEqual(loaded.rawDocument.genomes, ['cli-hello-world', '!cli-single-command']);
      assert.equal(loaded.document.behavior['hello-world-output'].includes('Hello, world!'), true);
      assert.equal(loaded.document.behavior['single-command-dispatch'], undefined);
    });
  });

  test('loadSeed rejects YAML tags outside genome exclusions', () => {
    withTempDir((cwd) => {
      const text = renderSeedTemplate().replace(
        'summary: Bounded behavior contract for a local repository.',
        'summary: !unexpected',
      );
      fs.mkdirSync(path.join(cwd, 'seed'), { recursive: true });
      fs.writeFileSync(path.join(cwd, DEFAULT_SEED_PATH), text, 'utf8');

      assert.throws(
        () => loadSeed({ cwd }),
        /Unresolved tag: !unexpected/,
      );
    });
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
