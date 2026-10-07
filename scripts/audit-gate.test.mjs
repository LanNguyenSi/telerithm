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

// npm derives metadata.vulnerabilities from the same package map the gate walks, and the
// gate cross-checks the two, so a synthetic report needs its tally recomputed after
// its map is edited.
function withTally(report) {
  const copy = structuredClone(report);
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  for (const entry of Object.values(copy.vulnerabilities)) {
    if (entry.severity in counts && entry.severity !== 'total') counts[entry.severity] += 1;
    counts.total += 1;
  }
  copy.metadata = { ...copy.metadata, vulnerabilities: counts };
  return copy;
}

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
  return withTally(copy);
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

test('the repository allowlist parses today and holds only well-formed GHSA ids', () => {
  // Today, not a fixed date: a renewal or removing the entry must not turn this red.
  const file = path.join(HERE, '..', '.github', 'audit-allowlist.json');
  const entries = parseAllowlist(fs.readFileSync(file, 'utf8'), file, todayUtc());
  for (const entry of entries) assert.match(entry.id, /^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/);
});

// Hardened gate: metadata cross-check and sanitised npm stderr. These cases run the
// script as a child process like the ones above, on this tree's real npm output.
const HG_BASES = [['audit-report.json', REPORT]];
const HG_ID = 'GHSA-vfj7-8cjw-p6xm';

function hgRun({ report, stdout, stderr = '', status = 1, argv }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-gate-hardened-'));
  try {
    const review = new Date();
    review.setUTCDate(review.getUTCDate() + 30);
    fs.writeFileSync(
      path.join(dir, 'allow.json'),
      JSON.stringify({ entries: [{ id: HG_ID, reason: 'test entry', reviewBy: review.toISOString().slice(0, 10) }] }),
    );
    fs.writeFileSync(path.join(dir, 'out.json'), stdout ?? JSON.stringify(report));
    fs.writeFileSync(path.join(dir, 'err.txt'), stderr);
    const args = argv
      ? argv(dir)
      : [
          '--allowlist', path.join(dir, 'allow.json'),
          '--status', String(status),
          '--stdout', path.join(dir, 'out.json'),
          '--stderr', path.join(dir, 'err.txt'),
        ];
    const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
    return { code: result.status, text: `${result.stdout}${result.stderr}` };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function hgWithCounts(report, counts) {
  const copy = structuredClone(report);
  copy.metadata = { ...copy.metadata, vulnerabilities: { info: 0, low: 0, moderate: 0, ...counts } };
  return copy;
}

for (const [name, base] of HG_BASES) {
  test(`hardened gate: the real report's own metadata tally is not UNCLASSIFIED (${name})`, () => {
    const { code, text } = hgRun({ report: base });
    assert.equal(code, 0, text);
    assert.match(text, /^npm audit gate: CLEAN: /m);
  });
}

const [HG_NAME, HG_BASE] = HG_BASES[0];
const HG_TALLY = withTally(HG_BASE).metadata.vulnerabilities;

test(`hardened gate: a tally with criticals the map does not show is UNCLASSIFIED (${HG_NAME})`, () => {
  const { code, text } = hgRun({ report: hgWithCounts(HG_BASE, { high: HG_TALLY.high, critical: HG_TALLY.critical + 2 }) });
  assert.equal(code, 3, text);
  assert.match(text, /UNCLASSIFIED: inconsistent audit report/);
  assert.doesNotMatch(text, /CLEAN/);
});

test('hardened gate: a tally lower than the map is UNCLASSIFIED', () => {
  assert.ok(HG_TALLY.high > 0, 'fixture must carry a high advisory');
  const { code, text } = hgRun({ report: hgWithCounts(HG_BASE, { high: HG_TALLY.high - 1, critical: HG_TALLY.critical }) });
  assert.equal(code, 3, text);
  assert.doesNotMatch(text, /CLEAN/);
});

test('hardened gate: a report without a metadata tally is UNCLASSIFIED', () => {
  const copy = structuredClone(HG_BASE);
  delete copy.metadata;
  const { code, text } = hgRun({ report: copy });
  assert.equal(code, 3, text);
  assert.match(text, /no metadata\.vulnerabilities tally/);
});

test('hardened gate: a negative count that still sums to the map size is UNCLASSIFIED', () => {
  const { code, text } = hgRun({ report: hgWithCounts(HG_BASE, { high: HG_TALLY.high + HG_TALLY.critical + 1, critical: -1 }) });
  assert.equal(code, 3, text);
  assert.match(text, /not non-negative integers/);
});

test('hardened gate: non-integer counts are UNCLASSIFIED', () => {
  const { code, text } = hgRun({ report: hgWithCounts(HG_BASE, { high: String(HG_TALLY.high), critical: 0 }) });
  assert.equal(code, 3, text);
});

const HG_FORGED = [
  '::error::forged finding',
  'npm error ::set-output name=x::y',
  '::stop-commands::token',
  'npm error line\u2028::warning::split',
].join('\n');

test('hardened gate: no npm stderr line starts a workflow command', () => {
  const { text } = hgRun({ report: HG_BASE, stderr: HG_FORGED });
  for (const line of text.split('\n')) {
    assert.equal(/^::(?!(error|warning)::npm audit gate: )/.test(line), false, line);
  }
  assert.ok(!text.includes('::stop-commands::'));
  assert.ok(!text.includes('::set-output'));
  assert.ok(!text.includes('::error::forged'));
  assert.ok(!text.includes('::warning::split'));
  assert.ok(text.includes('npm stderr| '));
  assert.ok(text.includes('forged finding'));
});

test('hardened gate: the same holds when the stderr text decides an outage', () => {
  const { code, text } = hgRun({ stdout: '', stderr: '::error::forged\nnpm error code ENOTFOUND' });
  assert.equal(code, 2, text);
  assert.ok(!text.includes('\n::error::forged'));
  assert.ok(!text.startsWith('::error::forged'));
});

test('hardened gate: a long stderr is bounded', () => {
  const { text } = hgRun({ report: HG_BASE, stderr: 'x\n'.repeat(500) });
  assert.ok(text.split('\n').length < 80);
  assert.ok(text.includes('more line(s) omitted'));
});

test('hardened gate: an unreadable captured stderr is UNCLASSIFIED', () => {
  const { code, text } = hgRun({
    report: HG_BASE,
    argv: (dir) => [
      '--allowlist', path.join(dir, 'allow.json'),
      '--status', '1',
      '--stdout', path.join(dir, 'out.json'),
      '--stderr', path.join(dir, 'gone.txt'),
    ],
  });
  assert.equal(code, 3, text);
  assert.match(text, /captured npm audit output cannot be read/);
});

test('hardened gate: early exits still print the sanitised npm stderr', () => {
  const forged = '::error::forged\nnpm error ::stop-commands::tok';
  const cases = [
    // allowlist unreadable
    (dir) => ['--allowlist', path.join(dir, 'nope.json'), '--status', '1', '--stdout', path.join(dir, 'out.json'), '--stderr', path.join(dir, 'err.txt')],
    // captured stdout unreadable
    (dir) => ['--allowlist', path.join(dir, 'allow.json'), '--status', '1', '--stdout', path.join(dir, 'gone.json'), '--stderr', path.join(dir, 'err.txt')],
    // usage error (bad status) with a --stderr file given
    (dir) => ['--allowlist', 'a', '--status', 'x', '--stdout', 'b', '--stderr', path.join(dir, 'err.txt')],
  ];
  for (const argv of cases) {
    const { code, text } = hgRun({ report: HG_BASE, stderr: forged, argv });
    assert.equal(code, 3, text);
    assert.ok(text.includes('npm stderr| : :error: :forged'), text);
    assert.ok(text.includes('npm stderr| npm error : :stop-commands: :tok'), text);
    for (const line of text.split('\n')) {
      assert.equal(/^::(?!error::npm audit gate: )/.test(line), false, line);
      assert.equal(line.startsWith('::error::forged'), false, line);
    }
  }
});
