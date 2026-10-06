// Self-test for scripts/audit-gate.mjs. Dependency-free (node:test and
// node:assert only), so the audit workflow can run it without `npm ci`:
//   node --test scripts/audit-gate.test.mjs
//
// Fixtures under scripts/fixtures/audit-gate/ are real `npm audit
// --audit-level=high --json` output captured on 2026-10-06 (npm 11.18) in the
// tree this repo allowlists: audit-report.json is the report, the
// registry-unreachable pair is npm's failure shape when the registry refuses
// the connection (the local npm log path in the stderr text is replaced by a
// placeholder). Variants for the other cases are built from the same shapes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { addDays, parseAllowlist, todayUtc } from './audit-gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, 'audit-gate.mjs');
const FIXTURES = path.join(HERE, 'fixtures', 'audit-gate');
const ALLOWED_ID = 'GHSA-vfj7-8cjw-p6xm';

const readFixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');
const REPORT = JSON.parse(readFixture('audit-report.json'));

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'audit-gate-'));
}

function allowlist(reviewBy, id = ALLOWED_ID) {
  return JSON.stringify({
    entries: [{ id, reason: 'fixture entry for the gate self-test', reviewBy }],
  });
}

// Runs the gate as a child process; returns { status, out }.
function runGate({ report, status = 1, stdoutText, stderrText = '', allowlistText, script = SCRIPT }) {
  const dir = tmpDir();
  try {
    const stdoutFile = path.join(dir, 'out.json');
    const stderrFile = path.join(dir, 'err.txt');
    const allowFile = path.join(dir, 'allow.json');
    fs.writeFileSync(stdoutFile, stdoutText ?? JSON.stringify(report));
    fs.writeFileSync(stderrFile, stderrText);
    fs.writeFileSync(allowFile, allowlistText);
    const result = spawnSync(
      process.execPath,
      [script, '--allowlist', allowFile, '--status', String(status), '--stdout', stdoutFile, '--stderr', stderrFile],
      { encoding: 'utf8' },
    );
    return { status: result.status, out: `${result.stdout}${result.stderr}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const futureDate = () => addDays(todayUtc(), 30);
const yesterday = () => addDays(todayUtc(), -1);

// The real report plus one more HIGH advisory on an unrelated package.
function reportWithOtherHigh() {
  const copy = structuredClone(REPORT);
  copy.vulnerabilities['other-package'] = {
    name: 'other-package',
    severity: 'high',
    isDirect: false,
    via: [
      {
        source: 1,
        name: 'other-package',
        dependency: 'other-package',
        title: 'unrelated high advisory',
        url: 'https://github.com/advisories/GHSA-2222-3333-4444',
        severity: 'high',
        range: '*',
      },
    ],
    effects: [],
    range: '*',
    nodes: ['node_modules/other-package'],
    fixAvailable: false,
  };
  return copy;
}

test('real report with only the allowlisted advisory exits 0 and prints the entry used', () => {
  const { status, out } = runGate({ report: REPORT, allowlistText: allowlist(futureDate()) });
  assert.equal(status, 0, out);
  assert.match(out, /excepted by allowlist: GHSA-vfj7-8cjw-p6xm/);
  assert.match(out, /CLEAN/);
});

test('the allowlisted advisory plus another high advisory exits 1', () => {
  const { status, out } = runGate({ report: reportWithOtherHigh(), allowlistText: allowlist(futureDate()) });
  assert.equal(status, 1, out);
  assert.match(out, /FINDINGS/);
  assert.match(out, /other-package/);
  assert.doesNotMatch(out, /CLEAN/);
});

test('an expired allowlist entry exits 1 even though the advisory is allowlisted', () => {
  const { status, out } = runGate({ report: REPORT, allowlistText: allowlist(yesterday()) });
  assert.equal(status, 1, out);
  assert.match(out, /expired/);
  assert.doesNotMatch(out, /CLEAN/);
});

test('a malformed allowlist exits 3', () => {
  const { status, out } = runGate({ report: REPORT, allowlistText: '{ "entries": "nope" }' });
  assert.equal(status, 3, out);
  assert.match(out, /UNCLASSIFIED/);
});

test('a reviewBy more than 90 days away is a malformed allowlist (exit 3)', () => {
  const { status, out } = runGate({ report: REPORT, allowlistText: allowlist(addDays(todayUtc(), 120)) });
  assert.equal(status, 3, out);
});

test('npm error JSON without a report (registry unreachable) exits 2', () => {
  const { status, out } = runGate({
    stdoutText: readFixture('registry-unreachable.stdout.json'),
    stderrText: readFixture('registry-unreachable.stderr.txt'),
    allowlistText: allowlist(futureDate()),
  });
  assert.equal(status, 2, out);
  assert.match(out, /OUTAGE/);
});

test('a script spawned through a symlink still runs main and reports FINDINGS (exit 1)', () => {
  const dir = tmpDir();
  try {
    const link = path.join(dir, 'gate-link.mjs');
    fs.symlinkSync(SCRIPT, link);
    const { status, out } = runGate({
      report: reportWithOtherHigh(),
      allowlistText: allowlist(futureDate()),
      script: link,
    });
    assert.equal(status, 1, out);
    assert.match(out, /FINDINGS/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the repository allowlist parses and holds exactly the braces entry', () => {
  const file = path.join(HERE, '..', '.github', 'audit-allowlist.json');
  const entries = parseAllowlist(fs.readFileSync(file, 'utf8'), file, '2026-10-06');
  assert.deepEqual(
    entries.map((entry) => entry.id),
    [ALLOWED_ID],
  );
});
