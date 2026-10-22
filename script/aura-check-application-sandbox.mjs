/** Local release check of the fixed harness against known good/broken fixtures in REAL Docker. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { sandboxArguments } from './aura-package-tests.mjs';
import { GRANT_NAV_PATH, GRANT_NAV_PROFILE } from '../shared/auraTestProfiles.mjs';
const image = process.argv[2];
const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, LANG: 'C.UTF-8' };
const docker = (args, timeout = 10_000) => execFileSync('docker', args, { env, timeout, maxBuffer: 64 * 1024,
  encoding: 'utf8', killSignal: 'SIGKILL', stdio: ['ignore', 'pipe', 'pipe'] });
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'aura-app-release-'));
fs.chmodSync(folder, 0o755);
try {
  sandboxArguments(image, folder, 'check', GRANT_NAV_PROFILE);
  docker(['image', 'inspect', image]);
  fs.mkdirSync(path.join(folder, path.dirname(GRANT_NAV_PATH)), { recursive: true, mode: 0o755 });
  fs.mkdirSync(path.join(folder, 'script'), { mode: 0o755 });
  fs.copyFileSync(new URL('./aura-grant-subnav-suite.mjs', import.meta.url), path.join(folder, 'script/aura-grant-subnav-suite.mjs'));
  fs.chmodSync(path.join(folder, 'script/aura-grant-subnav-suite.mjs'), 0o644);
  for (const broken of [false, true]) {
    const name = 'aura-release-' + crypto.randomUUID();
    fs.writeFileSync(path.join(folder, GRANT_NAV_PATH), broken
      ? 'import React from "react"; export const GrantSubNav = () => <nav><button>Broken</button></nav>;'
      : fs.readFileSync(new URL('../' + GRANT_NAV_PATH, import.meta.url), 'utf8'), { mode: 0o644 });
    let failure, output;
    try { output = docker(sandboxArguments(image, folder, name, GRANT_NAV_PROFILE), 60_000); }
    catch (error) { failure = error; }
    finally { docker(['rm', '--force', name], 5_000); }
    if (broken ? !failure || failure.status !== 1 : failure || !/# pass 4\r?\n/.test(output)) {
      console.error('Fixture:', broken ? 'broken navigation' : 'working navigation');
      console.error(String(failure?.stdout || output || '').slice(-16000));
      console.error(String(failure?.stderr || '').slice(-16000));
      throw new Error('Application sandbox release check failed.');
    }
    console.log(broken ? 'Real Docker: broken navigation was rejected.' : 'Real Docker: four navigation checks passed.');
  }
} finally { fs.rmSync(folder, { recursive: true, force: true }); }
