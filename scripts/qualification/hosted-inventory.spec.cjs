const path = require('node:path');
const { test } = require('@playwright/test');
const root = process.cwd();
const states = new WeakMap();

function requestLabel(request) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url()).pathname); }
  catch { return null; }
  if (pathname.endsWith('/src/pages/Inventory.tsx')) return 'inventory-module';
  if (pathname.endsWith('/src/components/CreateAssetDialog.tsx')) return 'asset-dialog-module';
  if (pathname.endsWith('/src/components/CreateDeviceDialog.tsx')) return 'device-dialog-module';
  if (pathname.endsWith('/src/components/workspace/MappingEditors.tsx')) return 'mapping-editor-module';
  if (pathname.endsWith('/src/components/workspace/MqttTopicHint.tsx')) return 'mqtt-hint-module';
  if (pathname.includes('/node_modules/.vite/deps/react-hook-form')) return 'react-hook-form';
  if (pathname.includes('/node_modules/.vite/deps/@hookform_resolvers_zod')) return 'form-resolver';
  if (pathname.includes('/node_modules/.vite/deps/@radix-ui_react-select')) return 'radix-select';
  if (pathname.includes('/api/trpc/') && pathname.split('/api/trpc/')[1].split(',').includes('inventory.list')) return 'inventory-api';
  return null;
}

// Classification is deliberately best effort: function names and source paths
// are inspected transiently and never written to logs, files or artifacts.
function classifyFrame(frame) {
  const name = String(frame?.functionName || '').toLowerCase();
  const url = String(frame?.url || '').toLowerCase();
  if (name.includes('garbage collector')) return 'garbage-collection';
  if (/disposefactoryscene|forcecontextloss|deletebuffer|deletetexture|deleteprogram|deleteframebuffer|deleterenderbuffer/.test(name) ||
      (name.includes('dispose') && (url.includes('three') || url.includes('factoryfloor'))))
    return 'webgl-cleanup';
  if (/compileasync|webglprogram|webglshader|renderbufferdirect|drawelements|drawarrays/.test(name) ||
      (name === 'render' && (url.includes('three') || url.includes('factoryfloor'))))
    return 'webgl-render-compile';
  if (/modulejob|moduleevaluation|evaluatemodule|modulewrap|importmoduledynamically/.test(name))
    return 'module-evaluation';
  if (/commitroot|performworkonroot|renderroot|performconcurrentworkonroot/.test(name) ||
      url.includes('react-dom')) return 'react';
  return 'other';
}

function summarizeProfile(profile) {
  const nodes = new Map((profile.nodes || []).map((node) => [node.id, node]));
  const parent = new Map();
  for (const node of profile.nodes || []) for (const child of node.children || []) parent.set(child, node.id);
  const categoryUs = {
    'webgl-cleanup': 0, 'webgl-render-compile': 0, 'module-evaluation': 0,
    react: 0, 'garbage-collection': 0, other: 0,
  };
  const priority = ['garbage-collection', 'webgl-cleanup', 'webgl-render-compile', 'module-evaluation', 'react', 'other'];
  const samples = profile.samples || [];
  const deltas = profile.timeDeltas || [];
  let sampledUs = 0;
  for (let i = 0; i < Math.min(samples.length, deltas.length); i++) {
    const duration = Number(deltas[i]);
    if (!Number.isFinite(duration) || duration < 0) continue;
    const found = new Set();
    let id = samples[i];
    for (let depth = 0; id !== undefined && depth < 256; depth++) {
      const node = nodes.get(id);
      if (!node) break;
      found.add(classifyFrame(node.callFrame));
      id = parent.get(id);
    }
    const category = priority.find((entry) => found.has(entry)) || 'other';
    categoryUs[category] += duration;
    sampledUs += duration;
  }
  return {
    sampleCount: Math.min(samples.length, deltas.length),
    sampledMs: Math.round(sampledUs / 100) / 10,
    categoryMs: Object.fromEntries(Object.entries(categoryUs).map(([key, value]) => [key, Math.round(value / 100) / 10])),
  };
}

async function bounded(operation, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('deadline')), Math.max(1, milliseconds)); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

test.beforeEach(async ({ page }) => {
  const state = { events: [], longTasks: [], timerGaps: [], animationGaps: [], requests: [],
    profileAttempted: false, profileAvailable: false, profileStopReason: 'not-started',
    profile: null, stopPromise: null, session: null, deadline: null, profileStopEpochMs: null };
  states.set(page, state);
  const pendingRequests = new WeakMap();
  page.on('request', (request) => {
    const label = requestLabel(request);
    if (!label || state.requests.length >= 300) return;
    const row = { label, startedEpochMs: Date.now(), responseEpochMs: null, status: null, failed: false };
    state.requests.push(row);
    pendingRequests.set(request, row);
  });
  page.on('response', (response) => {
    const row = pendingRequests.get(response.request());
    if (row) { row.responseEpochMs = Date.now(); row.status = response.status(); }
  });
  page.on('requestfailed', (request) => {
    const row = pendingRequests.get(request);
    if (row) { row.responseEpochMs = Date.now(); row.failed = true; }
  });
  const stopProfile = (reason) => {
    if (state.stopPromise) return state.stopPromise;
    state.stopPromise = (async () => {
      if (state.deadline) clearTimeout(state.deadline);
      if (state.profileAttempted && state.profileStopReason !== 'unavailable')
        state.profileStopReason = reason;
      if (state.profileAttempted) state.profileStopEpochMs = Date.now();
      if (!state.session || !state.profileAvailable) return;
      let limit;
      try {
        const stopped = await Promise.race([
          state.session.send('Profiler.stop'),
          new Promise((_, reject) => { limit = setTimeout(() => reject(new Error('deadline')), 3000); }),
        ]);
        state.profile = summarizeProfile(stopped.profile || {});
      } catch {
        state.profileAvailable = false;
      } finally {
        if (limit) clearTimeout(limit);
        try { await state.session.detach(); } catch {}
      }
    })();
    return state.stopPromise;
  };
  state.stopProfile = stopProfile;
  await page.exposeBinding('__hostedInventoryDiag', (_source, payload) => {
    if (!payload || !['events', 'longTasks', 'timerGaps', 'animationGaps'].includes(payload.collection)) return;
    const entry = payload.entry;
    if (!entry || !Number.isFinite(entry.origin)) return;
    if (payload.collection === 'events') {
      if (!['inventory-navigation', 'inventory-heading-visible', 'inventory-status-visible'].includes(entry.kind) ||
          !Number.isFinite(entry.at)) return;
      if (state.events.length < 20) state.events.push({ kind: entry.kind, origin: entry.origin, at: entry.at });
      if (entry.kind === 'inventory-status-visible' && state.profileAttempted) void stopProfile('status-visible');
    } else {
      if (!Number.isFinite(entry.start) || !Number.isFinite(entry.duration) || entry.duration < 0) return;
      if (state[payload.collection].length < 500)
        state[payload.collection].push({ origin: entry.origin, start: entry.start, duration: entry.duration });
    }
  });
  await page.addInitScript(() => {
    const origin = performance.timeOrigin;
    let active = false, headingSeen = false, statusSeen = false, observer;
    const emit = (collection, entry) => {
      void window.__hostedInventoryDiag({ collection, entry: { origin, ...entry } }).catch(() => {});
    };
    const event = (kind) => emit('events', { kind, at: performance.now() });
    const visible = (element) => {
      if (!element) return false;
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const inspect = () => {
      if (!active) return;
      if (!headingSeen) {
        const heading = [...document.querySelectorAll('h1,h2,h3')]
          .find((node) => node.textContent?.trim() === 'Assets & devices');
        if (visible(heading)) { headingSeen = true; event('inventory-heading-visible'); }
      }
      if (!statusSeen) {
        const status = document.querySelector('[role="status"][aria-label="Inventory results"]');
        if (visible(status)) { statusSeen = true; event('inventory-status-visible'); }
      }
      if (headingSeen && statusSeen) { active = false; observer?.disconnect(); }
    };
    const route = () => {
      if (location.hash.split('?')[0] !== '#/inventory') return;
      headingSeen = false; statusSeen = false; active = true;
      event('inventory-navigation');
      observer?.disconnect();
      observer = new MutationObserver(inspect);
      observer.observe(document, { subtree: true, childList: true, attributes: true,
        attributeFilter: ['style', 'hidden', 'aria-hidden', 'aria-label', 'role'] });
      inspect();
    };
    window.addEventListener('hashchange', route);
    document.addEventListener('DOMContentLoaded', route);
    try {
      new PerformanceObserver((list) => {
        for (const task of list.getEntries()) emit('longTasks', { start: task.startTime, duration: task.duration });
      }).observe({ type: 'longtask', buffered: true });
    } catch {}
    let previousFrame = performance.now();
    const frame = (at) => {
      if (at - previousFrame > 100) emit('animationGaps', { start: previousFrame, duration: at - previousFrame });
      previousFrame = at; requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    let previousTimer = performance.now();
    setInterval(() => {
      const now = performance.now();
      if (now - previousTimer > 200) emit('timerGaps', { start: previousTimer, duration: now - previousTimer });
      previousTimer = now;
    }, 100);
  });

  const originalGoto = page.goto.bind(page);
  page.goto = async (url, ...args) => {
    let inventory = false;
    try { inventory = new URL(String(url), 'http://synthetic.invalid').hash.split('?')[0] === '#/inventory'; }
    catch {}
    if (inventory && !state.profileAttempted) {
      state.profileAttempted = true;
      let cancelled = false;
      const startedAt = Date.now();
      const remaining = () => Math.max(1, 2000 - (Date.now() - startedAt));
      const pendingSession = page.context().newCDPSession(page);
      void pendingSession.then((session) => {
        if (cancelled) void session.detach().catch(() => {});
      }).catch(() => {});
      try {
        state.session = await bounded(pendingSession, remaining());
        await bounded(state.session.send('Profiler.enable'), remaining());
        await bounded(state.session.send('Profiler.setSamplingInterval', { interval: 1000 }), remaining());
        await bounded(state.session.send('Profiler.start'), remaining());
        state.profileAvailable = true;
        state.profileStopReason = 'running';
        state.deadline = setTimeout(() => { void stopProfile('eight-second-limit'); }, 8000);
      } catch {
        cancelled = true;
        state.profileAvailable = false;
        state.profileStopReason = 'unavailable';
        if (state.session) {
          try { await bounded(state.session.detach(), 1000); } catch {}
          state.session = null;
        }
      }
    }
    return originalGoto(url, ...args);
  };
});

function overlapMs(entries, startEpoch, endEpoch) {
  if (startEpoch === null || endEpoch === null) return null;
  return Math.round(entries.reduce((total, entry) => {
    const start = entry.origin + entry.start;
    return total + Math.max(0, Math.min(start + entry.duration, endEpoch) - Math.max(start, startEpoch));
  }, 0) * 10) / 10;
}

test.afterEach(async ({ page }, info) => {
  const state = states.get(page);
  if (!state) return;
  await state.stopProfile('test-ended');
  const start = state.events.find((event) => event.kind === 'inventory-navigation');
  const inSameDocument = (kind) => start && state.events.find((event) =>
    event.origin === start.origin && event.kind === kind && event.at >= start.at);
  const heading = inSameDocument('inventory-heading-visible');
  const status = inSameDocument('inventory-status-visible');
  const startEpoch = start ? start.origin + start.at : null;
  const endEpoch = status ? status.origin + status.at : state.profileStopEpochMs;
  const requests = state.requests.filter((row) => startEpoch !== null &&
    row.startedEpochMs >= startEpoch && (endEpoch === null || row.startedEpochMs <= endEpoch));
  const requestCounts = {}, requestStatusCounts = {};
  for (const row of requests) {
    requestCounts[row.label] = (requestCounts[row.label] || 0) + 1;
    if (row.status !== null) {
      const key = row.label + ':' + row.status;
      requestStatusCounts[key] = (requestStatusCounts[key] || 0) + 1;
    }
  }
  const api = requests.filter((row) => row.label === 'inventory-api' && row.responseEpochMs !== null);
  const apiResponseMs = api.map((row) => Math.max(0, row.responseEpochMs - row.startedEpochMs));
  const summary = {
    schema: 1, case: '1024-dark',
    testStatus: ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'].includes(info.status) ? info.status : 'unknown',
    navigationObserved: Boolean(start),
    observedWindowMs: startEpoch !== null && endEpoch !== null ? Math.max(0, Math.round(endEpoch - startEpoch)) : null,
    headingVisibleMs: heading ? Math.round((heading.at - start.at) * 10) / 10 : null,
    inventoryStatusVisibleMs: status ? Math.round((status.at - start.at) * 10) / 10 : null,
    requestCounts, requestStatusCounts, apiResponseMs,
    longTaskOverlapMs: overlapMs(state.longTasks, startEpoch, endEpoch),
    timerGapOverlapMs: overlapMs(state.timerGaps, startEpoch, endEpoch),
    animationGapOverlapMs: overlapMs(state.animationGaps, startEpoch, endEpoch),
    profileAttempted: state.profileAttempted,
    profileAvailable: state.profileAvailable,
    profileStopReason: state.profileStopReason,
    profile: state.profile,
    note: 'Best-effort categorized CPU samples; instrumentation adds overhead and does not change the existing gate.',
  };
  console.log('INVENTORY_DIAGNOSTIC ' + JSON.stringify(summary));
});

require(path.join(root, 'e2e/experience.spec.ts'));
