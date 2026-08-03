'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const SKILL_NAME = 'seed-lang';
const SUPPORTED_PLATFORMS = new Set(['codex', 'claude']);

function skillHome(platform, env = process.env) {
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error(`Unsupported skill platform ${platform}.`);
  }

  const configured = platform === 'codex' ? env.CODEX_HOME : env.CLAUDE_HOME;
  if (configured) {
    return path.resolve(configured);
  }

  const home = env.HOME || os.homedir();
  return path.resolve(home, platform === 'codex' ? '.codex' : '.claude');
}

function temporaryPath(parent, label) {
  return path.join(parent, `.${SKILL_NAME}.${label}-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
}

function pathExists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function installBundledSkill({
  platform,
  env = process.env,
  packageRoot = path.resolve(__dirname, '..'),
} = {}) {
  if (!SUPPORTED_PLATFORMS.has(platform)) {
    throw new Error('Skill platform must be codex or claude.');
  }

  const source = path.join(packageRoot, 'resources', 'skills', SKILL_NAME);
  const sourceSkill = path.join(source, 'SKILL.md');
  if (!fs.existsSync(sourceSkill)) {
    throw new Error(`Bundled ${SKILL_NAME} skill missing at ${source}.`);
  }

  const skillsRoot = path.join(skillHome(platform, env), 'skills');
  const target = path.join(skillsRoot, SKILL_NAME);
  fs.mkdirSync(skillsRoot, { recursive: true });

  const staged = temporaryPath(skillsRoot, 'install');
  const backup = temporaryPath(skillsRoot, 'backup');
  const replacing = pathExists(target);
  let backedUp = false;

  try {
    fs.cpSync(source, staged, { recursive: true, errorOnExist: true });
    if (platform === 'claude') {
      fs.rmSync(path.join(staged, 'agents'), { recursive: true, force: true });
    }

    if (replacing) {
      fs.renameSync(target, backup);
      backedUp = true;
    }
    fs.renameSync(staged, target);
  } catch (error) {
    fs.rmSync(staged, { recursive: true, force: true });
    if (backedUp && !fs.existsSync(target) && fs.existsSync(backup)) {
      fs.renameSync(backup, target);
    }
    throw new Error(`Failed to install ${SKILL_NAME} for ${platform}: ${error.message}`);
  }

  if (backedUp) {
    fs.rmSync(backup, { recursive: true, force: true });
  }

  return {
    platform,
    path: target,
    replaced: replacing,
  };
}

module.exports = {
  installBundledSkill,
  skillHome,
};
