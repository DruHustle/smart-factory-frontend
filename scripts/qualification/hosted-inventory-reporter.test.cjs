const { test } = require('node:test');
const assert = require('node:assert/strict');
const Reporter = require('./hosted-inventory-reporter.cjs');

const prefix = 'INVENTORY_DIAGNOSTIC ';
const intended = { title: 'whole journey at 1024px in dark' };
const other = { title: 'some other test' };
const secret = 'SYNTHETIC-SECRET-DO-NOT-FORWARD';
function valid() {
  return {
    schema: 1, case: '1024-dark', testStatus: 'failed', navigationObserved: true,
    observedWindowMs: 5030, headingVisibleMs: 310, inventoryStatusVisibleMs: null,
    requestCounts: { 'inventory-module': 1, 'inventory-api': 1 },
    requestStatusCounts: { 'inventory-module:200': 1, 'inventory-api:200': 1 },
    apiResponseMs: [25.5], longTaskOverlapMs: 1900, timerGapOverlapMs: 1950,
    animationGapOverlapMs: 1980, profileAttempted: true, profileAvailable: true,
    profileStopReason: 'test-ended',
    profile: { sampleCount: 3, sampledMs: 30, categoryMs: {
      'webgl-cleanup': 10, 'webgl-render-compile': 5, 'module-evaluation': 5,
      react: 3, 'garbage-collection': 2, other: 5,
    } },
    note: 'Best-effort categorized CPU samples; instrumentation adds overhead and does not change the existing gate.',
  };
}
function capture(fn) {
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(String(line));
  try { fn(lines); } finally { console.log = original; }
  return lines;
}

test('forwards one complete valid summary across arbitrary stdout chunks', () => {
  const lines = capture(() => {
    const reporter = new Reporter();
    const line = prefix + JSON.stringify(valid()) + '\n';
    for (const byte of Buffer.from(line)) reporter.onStdOut(Buffer.from([byte]), intended);
    reporter.onStdOut(line, intended);
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].startsWith(prefix), true);
  const result = JSON.parse(lines[0].slice(prefix.length));
  assert.equal(result.inventoryStatusVisibleMs, null);
  assert.equal(result.profile.categoryMs['webgl-cleanup'], 10);
  assert.equal('note' in result, false);
});

test('forwards at most one summary when multiple lines share a chunk', () => {
  const lines = capture(() => {
    const reporter = new Reporter();
    const line = prefix + JSON.stringify(valid()) + '\n';
    reporter.onStdOut(line + line, intended);
  });
  assert.equal(lines.length, 1);
});

test('rejects arbitrary output, wrong-test output and forged schema data', () => {
  const invalid = [
    { ...valid(), extra: secret },
    { ...valid(), note: secret },
    { ...valid(), testStatus: secret },
    { ...valid(), requestCounts: { [secret]: 1 } },
    { ...valid(), requestStatusCounts: { ['inventory-api:200:' + secret]: 1 } },
    { ...valid(), apiResponseMs: [secret] },
    { ...valid(), profile: { ...valid().profile, categoryMs: { ...valid().profile.categoryMs, [secret]: 1 } } },
    { ...valid(), profile: { ...valid().profile, sampledMs: -1 } },
  ];
  const lines = capture(() => {
    const reporter = new Reporter();
    reporter.onStdOut(secret + '\n', intended);
    reporter.onStdOut(prefix + JSON.stringify(valid()) + '\n', other);
    reporter.onStdOut(prefix + JSON.stringify(valid()) + '\n', undefined);
    reporter.onStdOut('prefix ' + prefix + JSON.stringify(valid()) + '\n', intended);
    reporter.onStdOut(prefix + '{not-json:' + secret + '}\n', intended);
    for (const item of invalid) reporter.onStdOut(prefix + JSON.stringify(item) + '\n', intended);
  });
  assert.deepEqual(lines, []);
  assert.equal(lines.join('').includes(secret), false);
});

test('discards oversized or broken lines and accepts the next complete valid one', () => {
  const lines = capture(() => {
    const reporter = new Reporter();
    reporter.onStdOut('x'.repeat(70000) + prefix + JSON.stringify(valid()), intended);
    reporter.onStdOut('\n', intended);
    reporter.onStdOut(prefix.slice(0, 7), intended);
    reporter.onStdOut(secret, other);
    reporter.onStdOut(prefix.slice(7) + JSON.stringify(valid()) + '\n', intended);
    const line = prefix + JSON.stringify(valid()) + '\n';
    reporter.onStdOut(line.slice(0, 20), intended);
    reporter.onStdOut(Buffer.from(line.slice(20)), intended);
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].startsWith(prefix), true);
  assert.equal(lines[0].includes(secret), false);
});

test('accepts missing-profile diagnostics and rejects invalid categories', () => {
  const withoutProfile = { ...valid(), profileAvailable: false, profileStopReason: 'unavailable', profile: null };
  assert.ok(Reporter.sanitizeDiagnostic(withoutProfile));
  assert.equal(Reporter.sanitizeDiagnostic({ ...withoutProfile, observedWindowMs: -1 }), null);
  assert.equal(Reporter.sanitizeDiagnostic({ ...withoutProfile, profileStopReason: secret }), null);
  assert.equal(Reporter.sanitizeDiagnostic({ ...withoutProfile, apiResponseMs: Array(301).fill(1) }), null);
});
