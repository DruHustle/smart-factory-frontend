const { StringDecoder } = require('node:string_decoder');

const PREFIX = 'INVENTORY_DIAGNOSTIC ';
const EXPECTED_TEST = 'whole journey at 1024px in dark';
const MAX_LINE = 65536;
const REQUEST_LABELS = new Set([
  'inventory-module', 'asset-dialog-module', 'device-dialog-module',
  'mapping-editor-module', 'mqtt-hint-module', 'react-hook-form',
  'form-resolver', 'radix-select', 'inventory-api',
]);
const PROFILE_CATEGORIES = [
  'webgl-cleanup', 'webgl-render-compile', 'module-evaluation', 'react',
  'garbage-collection', 'other',
];
const CASE_STATUSES = new Set(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']);
const STOP_REASONS = new Set(['not-started', 'running', 'status-visible', 'eight-second-limit', 'test-ended', 'unavailable']);
const NOTE = 'Best-effort categorized CPU samples; instrumentation adds overhead and does not change the existing gate.';
const SUMMARY_KEYS = [
  'schema', 'case', 'testStatus', 'navigationObserved', 'observedWindowMs',
  'headingVisibleMs', 'inventoryStatusVisibleMs', 'requestCounts',
  'requestStatusCounts', 'apiResponseMs', 'longTaskOverlapMs',
  'timerGapOverlapMs', 'animationGapOverlapMs', 'profileAttempted',
  'profileAvailable', 'profileStopReason', 'profile', 'note',
];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}
function number(value, maximum = 86400000) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum;
}
function nullableNumber(value) {
  return value === null || number(value);
}
function integer(value, maximum) {
  return Number.isInteger(value) && value >= 0 && value <= maximum;
}
function requestCounts(value, withStatus) {
  if (!isRecord(value) || Object.keys(value).length > 300) return null;
  const result = Object.create(null);
  for (const [key, count] of Object.entries(value)) {
    const parts = key.split(':');
    if (!REQUEST_LABELS.has(parts[0]) || !integer(count, 300)) return null;
    if (withStatus) {
      if (parts.length !== 2 || !/^(0|[1-5][0-9]{2})$/.test(parts[1])) return null;
    } else if (parts.length !== 1) return null;
    result[key] = count;
  }
  return result;
}

/** Validate the complete fixed schema; emit only reconstructed allowlisted values. */
function sanitizeDiagnostic(value) {
  if (!hasExactKeys(value, SUMMARY_KEYS) || value.schema !== 1 || value.case !== '1024-dark' ||
      !CASE_STATUSES.has(value.testStatus) || typeof value.navigationObserved !== 'boolean' ||
      typeof value.profileAttempted !== 'boolean' || typeof value.profileAvailable !== 'boolean' ||
      !STOP_REASONS.has(value.profileStopReason) || value.note !== NOTE ||
      !['observedWindowMs', 'headingVisibleMs', 'inventoryStatusVisibleMs', 'longTaskOverlapMs',
        'timerGapOverlapMs', 'animationGapOverlapMs'].every((key) => nullableNumber(value[key])) ||
      !Array.isArray(value.apiResponseMs) || value.apiResponseMs.length > 300 ||
      !value.apiResponseMs.every((entry) => number(entry))) return null;
  const counts = requestCounts(value.requestCounts, false);
  const statuses = requestCounts(value.requestStatusCounts, true);
  if (!counts || !statuses) return null;
  let profile = null;
  if (value.profile !== null) {
    if (!hasExactKeys(value.profile, ['sampleCount', 'sampledMs', 'categoryMs']) ||
        !integer(value.profile.sampleCount, 1000000) || !number(value.profile.sampledMs) ||
        !hasExactKeys(value.profile.categoryMs, PROFILE_CATEGORIES) ||
        !PROFILE_CATEGORIES.every((key) => number(value.profile.categoryMs[key]))) return null;
    const categoryMs = Object.create(null);
    for (const key of PROFILE_CATEGORIES) categoryMs[key] = value.profile.categoryMs[key];
    profile = { sampleCount: value.profile.sampleCount, sampledMs: value.profile.sampledMs, categoryMs };
  }
  return {
    schema: 1, case: '1024-dark', testStatus: value.testStatus,
    navigationObserved: value.navigationObserved, observedWindowMs: value.observedWindowMs,
    headingVisibleMs: value.headingVisibleMs, inventoryStatusVisibleMs: value.inventoryStatusVisibleMs,
    requestCounts: counts, requestStatusCounts: statuses, apiResponseMs: [...value.apiResponseMs],
    longTaskOverlapMs: value.longTaskOverlapMs, timerGapOverlapMs: value.timerGapOverlapMs,
    animationGapOverlapMs: value.animationGapOverlapMs, profileAttempted: value.profileAttempted,
    profileAvailable: value.profileAvailable, profileStopReason: value.profileStopReason, profile,
  };
}

class HostedInventoryReporter {
  constructor() {
    this.decoder = new StringDecoder('utf8');
    this.line = '';
    this.droppingLine = false;
    this.forwarded = false;
  }
  onBegin(_config, suite) {
    console.log('INVENTORY_DIAGNOSTIC_SELECTED ' + JSON.stringify({ count: suite.allTests().length }));
  }
  onStdOut(chunk, test) {
    // Ignore runner/browser output and all tests except the one explicitly selected.
    if (!test || test.title !== EXPECTED_TEST || this.forwarded) {
      this.line = '';
      this.droppingLine = false;
      this.decoder = new StringDecoder('utf8');
      return;
    }
    if (typeof chunk !== 'string' && !Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array)) {
      this.line = '';
      this.droppingLine = true;
      this.decoder = new StringDecoder('utf8');
      return;
    }
    if (chunk.length > 1048576) {
      // Fail closed until the next newline; do not retain unbounded worker output.
      this.line = '';
      this.droppingLine = true;
      this.decoder = new StringDecoder('utf8');
      return;
    }
    let text = this.decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    while (text.length) {
      const newline = text.indexOf('\n');
      const segment = newline < 0 ? text : text.slice(0, newline);
      if (!this.droppingLine) {
        if (this.line.length + segment.length > MAX_LINE) {
          this.line = '';
          this.droppingLine = true;
        } else {
          this.line += segment;
        }
      }
      if (newline < 0) break;
      if (!this.forwarded && !this.droppingLine && this.line.startsWith(PREFIX)) {
        try {
          const safe = sanitizeDiagnostic(JSON.parse(this.line.slice(PREFIX.length)));
          if (safe) {
            this.forwarded = true;
            console.log(PREFIX + JSON.stringify(safe));
          }
        } catch {
          // Ignore malformed worker output; never forward error text or raw data.
        }
      }
      this.line = '';
      this.droppingLine = false;
      text = text.slice(newline + 1);
    }
  }
  onTestEnd(_test, result) {
    this.line = '';
    this.droppingLine = false;
    this.decoder = new StringDecoder('utf8');
    console.log('INVENTORY_DIAGNOSTIC_CASE ' + JSON.stringify({
      status: CASE_STATUSES.has(result.status) ? result.status : 'unknown',
      durationMs: number(result.duration) ? Math.round(result.duration) : 0,
    }));
  }
  onError() {
    console.log('INVENTORY_DIAGNOSTIC_RUNNER_ERROR');
  }
  onEnd(result) {
    const allowed = ['passed', 'failed', 'timedout', 'interrupted'];
    console.log('INVENTORY_DIAGNOSTIC_COMPLETE ' + JSON.stringify({
      status: allowed.includes(result.status) ? result.status : 'unknown',
    }));
  }
}
module.exports = HostedInventoryReporter;
module.exports.sanitizeDiagnostic = sanitizeDiagnostic;
