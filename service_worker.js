import { ACTIVITY_LOG_TASK_LIMIT, retainRecentActivityTasks } from './activity_log.js';
import { parse as parseJavaScript } from './vendor/acorn.mjs';
import { generate as generateJavaScript } from './vendor/astring.mjs';

const DEBUGGER_VERSION = '1.3';
const OFFSCREEN_PATH = 'offscreen.html';
const SECRET_KEY = /pass(?:word|wd)?|secret|token|api[-_]?key|auth(?:orization)?|cookie|session|csrf|xsrf|private[-_]?key/i;
const SECRET_HEADER = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-api-key|x-auth-token)$/i;
const BEARER = /\b(?:bearer|basic)\s+[a-z0-9._~+\/-]+=*/gi;
const MAX_TOTAL_BODY_BYTES = 200 * 1024 * 1024;
const MAX_CONCURRENT_BODY_READS = 4;
const MAX_TOTAL_SCRIPT_SOURCE_BYTES = 250 * 1024 * 1024;
const MESSAGE_CHUNK_BYTES = 256 * 1024;
const MAX_SECRET_HEADER_FINGERPRINTS = 20_000;
const MAX_WEBSOCKET_EVENTS = 10_000;
const MAX_WEBSOCKET_BYTES = 32 * 1024 * 1024;
const MAX_EVENTSOURCE_EVENTS = 5_000;
const MAX_EVENTSOURCE_BYTES = 10 * 1024 * 1024;
const MAX_STREAM_EVENT_CHARACTERS = 4 * 1024 * 1024;
const MAX_CONSOLE_EVENTS = 5_000;
const MAX_EXCEPTION_EVENTS = 2_000;
const MAX_LOG_EVENTS = 5_000;
const MAX_EXECUTION_CONTEXTS = 20_000;
const MAX_OPFS_FILE_BYTES = 4 * 1024 * 1024;
const MAX_OPFS_ORIGIN_BYTES = 16 * 1024 * 1024;
const MAX_OPFS_FILES = 500;
const MAX_WEBSQL_ROWS_PER_TABLE = 5_000;
const MAX_WEBSQL_DATABASE_BYTES = 10 * 1024 * 1024;
const MAX_SOURCE_ANALYSIS_FILES = 120;
const MAX_SOURCE_ANALYSIS_INPUT_BYTES = 24 * 1024 * 1024;
const MAX_SOURCE_ANALYSIS_FILE_BYTES = 2 * 1024 * 1024;
const MAX_RECONSTRUCTED_SOURCE_FILES = 5_000;
const MAX_RECONSTRUCTED_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_WASM_WAT_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_WASM_WAT_TOTAL_BYTES = 20 * 1024 * 1024;
const PSEUDO_STATE_NODE_LIMIT = 16;
const PSEUDO_STATE_FAST_BUDGET_MS = 30_000;
const PSEUDO_STATE_MAX_ENTRY_BUDGET_MS = 20_000;
const PSEUDO_STATE_MAX_CRAWL_BUDGET_MS = 12_000;
const PSEUDO_STATE_COMMAND_TIMEOUT_MS = 5_000;
const RESPONSIVE_FAST_BUDGET_MS = 75_000;
const RESPONSIVE_MAX_ENTRY_BUDGET_MS = 50_000;
const RESPONSIVE_MAX_CRAWL_BUDGET_MS = 30_000;
const RESPONSIVE_COMMAND_TIMEOUT_MS = 20_000;
const PAGE_SCRIPT_CHECKPOINT_BUDGET_MS = 60_000;
const FINAL_SCRIPT_CAPTURE_BUDGET_MS = 120_000;
const SCRIPT_SOURCE_COMMAND_TIMEOUT_MS = 10_000;
const SOURCE_MAP_CAPTURE_BUDGET_MS = 60_000;
const ANIMATION_FAST_BUDGET_MS = 65_000;
const ANIMATION_MAX_ENTRY_BUDGET_MS = 72_000;
const ANIMATION_MAX_CRAWL_BUDGET_MS = 45_000;
const ANIMATION_DETECTED_LIMIT = 500;
const ANIMATION_SAMPLED_LIMIT = 90;
const ANIMATION_VISUAL_FRAMES = 5;
const DYNAMIC_FAST_SCENE_FRAMES = 7;
const DYNAMIC_MAX_ENTRY_SCENE_FRAMES = 11;
const DYNAMIC_MAX_CRAWL_SCENE_FRAMES = 7;
const DYNAMIC_FAST_SCROLL_TILE_LIMIT = 32;
const DYNAMIC_MAX_SCROLL_TILE_LIMIT = 96;
const DYNAMIC_FAST_HOVER_LIMIT = 4;
const DYNAMIC_MAX_HOVER_LIMIT = 10;
const DYNAMIC_CANVAS_LIMIT = 4;
const DYNAMIC_FAST_SURFACE_LIMIT = 3;
const DYNAMIC_MAX_SURFACE_LIMIT = 6;
const DYNAMIC_SECONDARY_SCENE_LIMIT = 5;
const DYNAMIC_VIDEO_LIMIT = 6;
const DYNAMIC_CANVAS_INTERACTION_LIMIT = 2;
const DYNAMIC_MIN_SCROLL_RANGE = 32;
const DYNAMIC_CANVAS_SAMPLE_MAX_PIXELS = 1_500_000;
const DEFAULT_MAX_RUNTIME_MINUTES = 20;
// "Unlimited" remains bounded internally so a lost tab, renderer, or extension
// worker can never create a literally immortal capture. The boundary is not
// presented in the UI and is deliberately far beyond an ordinary run.
const MAX_UNLIMITED_RUNTIME_MINUTES = 30 * 60;
const COMPUTED_SNAPSHOT_STYLES = [
  'display', 'position', 'inset', 'z-index', 'overflow', 'opacity', 'visibility',
  'box-sizing', 'width', 'height', 'margin', 'padding', 'border', 'border-radius',
  'background', 'color', 'font', 'line-height', 'letter-spacing', 'text-align',
  'white-space', 'flex', 'flex-direction', 'justify-content', 'align-items', 'gap',
  'grid-template-columns', 'grid-template-rows', 'transform', 'filter', 'box-shadow'
];

let currentCapture = null;
let creatingOffscreenDocument = null;
let activityLogQueue = Promise.resolve();
const pendingDownloadUrls = new Map();

function resolveMaxRuntimeSafetyMinutes(selectedMinutes) {
  return Number(selectedMinutes) === 0 ? MAX_UNLIMITED_RUNTIME_MINUTES : Number(selectedMinutes);
}

chrome.downloads?.onChanged?.addListener((delta) => {
  if (!delta?.id || !delta.state || !['complete', 'interrupted'].includes(delta.state.current)) return;
  const blobUrl = pendingDownloadUrls.get(delta.id);
  if (!blobUrl) return;
  pendingDownloadUrls.delete(delta.id);
  chrome.runtime.sendMessage({ target: 'offscreen', action: 'REVOKE', blobUrl }).catch(() => {});
});

function publicCaptureState(capture, overrides = {}) {
  if (!capture) return { running: false, state: 'idle' };
  const terminalState = capture.terminalState || null;
  return {
    running: terminalState ? false : !capture.targetTabClosed,
    state: terminalState || (capture.targetTabClosed ? 'stopped' : capture.cancelRequested ? 'cancelling' : capture.paused ? 'paused' : capture.pauseRequested ? 'pausing' : 'running'),
    captureId: capture.captureId,
    targetTabId: capture.tabId,
    targetTitle: capture.originalTitle,
    targetUrl: sanitizedUrl(capture.originalUrl),
    mode: capture.options?.mode,
    label: capture.statusLabel || 'Preparing capture…',
    percent: Math.max(0, Math.min(100, Math.round(capture.lastProgress || 0))),
    elapsedSeconds: capture.startedAt ? Math.round((Date.now() - capture.startedAt) / 1000) : 0,
    paused: Boolean(capture.paused),
    pauseRequested: Boolean(capture.pauseRequested),
    startedAt: capture.startedAt ? new Date(capture.startedAt).toISOString() : null,
    error: terminalState === 'failed' ? capture.terminalError || null : null,
    finishedAt: terminalState ? capture.terminalFinishedAt || null : null,
    filename: terminalState === 'completed' ? capture.completedFilename || null : null,
    actualSeconds: terminalState === 'completed' ? capture.completedActualSeconds || null : null,
    capturedPages: terminalState === 'completed' ? capture.completedPages || null : null,
    ...overrides
  };
}

function persistCaptureState(state) {
  chrome.storage.local.set({ activeCaptureState: state }).catch(() => {});
}

function throwIfCancelled(capture) {
  if (capture?.targetTabClosed) throw new Error('Capture stopped because the target tab was closed.');
  if (capture?.cancelRequested) throw new Error('Capture cancelled by the user.');
  // A debugger detach for any other reason (e.g. `canceled_by_user`, fired when
  // something other than this extension takes over the Chrome DevTools Protocol
  // session for the tab — including another CDP client such as a remote
  // automation/orchestration tool driving the same browser — or
  // `replaced_with_devtools`) leaves every subsequent chrome.debugger.sendCommand
  // call rejecting immediately. Previously only waitForSettled() checked this, so
  // every other loop in the file (deep DOM inspection, storage sweep, tiled
  // screenshots, the crawl loop, staged file writes) kept mechanically iterating
  // through already-invalid CDP calls, silently counting failures instead of
  // stopping — producing a capture that races through remaining work doing
  // nothing, without ever surfacing a clear error. throwIfCancelled() already has
  // call sites in all of those loops, so this one change gives them a fast,
  // clean abort for free.
  if (capture?.detachedReason) throw new Error(`Chrome debugger detached (${capture.detachedReason}); the capture session is no longer valid and was stopped instead of continuing to produce incomplete data.`);
}

async function awaitPauseCheckpoint(capture) {
  throwIfCancelled(capture);
  if (!capture?.pauseRequested) return 0;
  if (!capture.paused) {
    capture.paused = true;
    capture.pausedStartedAt = Date.now();
    sendProgress('Capture paused at a safe checkpoint', capture.lastProgress || 1);
  }
  while (capture.pauseRequested) {
    throwIfCancelled(capture);
    await sleep(250);
  }
  const pausedForMs = Math.max(0, Date.now() - (capture.pausedStartedAt || Date.now()));
  capture.totalPausedMs = (capture.totalPausedMs || 0) + pausedForMs;
  if (Number.isFinite(capture.captureDeadlineAt)) capture.captureDeadlineAt += pausedForMs;
  capture.paused = false;
  capture.pausedStartedAt = null;
  sendProgress('Resuming capture…', capture.lastProgress || 1);
  return pausedForMs;
}

async function runWithBodyReadSlot(capture, operation) {
  if ((capture.activeBodyReads || 0) >= MAX_CONCURRENT_BODY_READS) {
    await new Promise((resolve) => { capture.bodyReadWaiters.push(resolve); });
  } else {
    capture.activeBodyReads = (capture.activeBodyReads || 0) + 1;
  }
  try {
    throwIfCancelled(capture);
    return await operation();
  } finally {
    const next = capture.bodyReadWaiters.shift();
    if (next) next();
    else capture.activeBodyReads = Math.max(0, (capture.activeBodyReads || 1) - 1);
  }
}

function stopForClosedTarget(capture) {
  if (!capture || capture.targetTabClosed) return;
  capture.targetTabClosed = true;
  capture.cancelRequested = true;
  capture.detachedReason = 'target_tab_closed';
  capture.statusLabel = 'Capture stopped because the target tab was closed.';
  capture.terminalState = 'stopped';
  capture.terminalFinishedAt = new Date().toISOString();
  appendActivityLog(capture.statusLabel, capture.lastProgress || null, 'error', capture);
  persistCaptureState(publicCaptureState(capture, {
    running: false,
    state: 'stopped',
    label: capture.statusLabel,
    error: null,
    finishedAt: new Date().toISOString()
  }));
  void safeDebuggerDetach(capture.tabId, capture, 'Closed-tab debugger cleanup');
}

function appendActivityLog(label, percent = null, level = 'info', capture = currentCapture) {
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    label: String(label),
    percent,
    level,
    taskId: capture?.captureId || null,
    taskStartedAt: capture?.startedAt ? new Date(capture.startedAt).toISOString() : timestamp,
    taskTitle: capture?.originalTitle || null,
    taskMode: capture?.options?.mode || null
  };
  activityLogQueue = activityLogQueue.then(async () => {
    const saved = await chrome.storage.local.get({
      activityLogEnabled: true,
      captureActivityLogs: []
    });
    if (!saved.activityLogEnabled) return;
    const logs = Array.isArray(saved.captureActivityLogs) ? saved.captureActivityLogs : [];
    logs.push(entry);
    await chrome.storage.local.set({
      captureActivityLogs: retainRecentActivityTasks(logs, ACTIVITY_LOG_TASK_LIMIT)
    });
  }).catch(() => {});
}

function sendProgress(label, percent, extra = {}) {
  if (currentCapture?.targetTabClosed) return;
  if (currentCapture) {
    percent = Math.max(Number(currentCapture.lastProgress) || 0, Number(percent) || 0);
    currentCapture.lastProgress = percent;
  }
  const roundedLogPercent = Math.round(Number(percent) || 0);
  if (currentCapture && currentCapture.currentStageLabel && currentCapture.currentStageLabel !== label && currentCapture.currentStageStartedAt) {
    const stageSeconds = Math.max(0, Math.round((Date.now() - currentCapture.currentStageStartedAt) / 1000));
    if (stageSeconds >= 1) {
      appendActivityLog(`Stage timing: “${currentCapture.currentStageLabel}” ran for ${stageSeconds}s before the next checkpoint.`, currentCapture.lastProgress || roundedLogPercent, 'info', currentCapture);
    }
  }
  if (currentCapture && currentCapture.currentStageLabel !== label) {
    currentCapture.currentStageLabel = label;
    currentCapture.currentStageStartedAt = Date.now();
  }
  const shouldLog = !currentCapture
    || currentCapture.lastLoggedLabel !== label
    || currentCapture.lastLoggedPercent !== roundedLogPercent;
  if (shouldLog) {
    appendActivityLog(label, roundedLogPercent, 'info', currentCapture);
    if (currentCapture) {
      currentCapture.lastLoggedLabel = label;
      currentCapture.lastLoggedPercent = roundedLogPercent;
    }
  }
  const elapsedSeconds = currentCapture?.startedAt
    ? Math.max(0, (Date.now() - currentCapture.startedAt) / 1000)
    : 0;
  if (currentCapture) {
    currentCapture.statusLabel = label;
    persistCaptureState(publicCaptureState(currentCapture, extra));
  }
  chrome.runtime.sendMessage({
    type: 'CAPTURE_PROGRESS',
    label,
    percent,
    elapsedSeconds: Math.round(elapsedSeconds),
    mode: currentCapture?.options?.mode || null,
    paused: Boolean(currentCapture?.paused),
    pauseRequested: Boolean(currentCapture?.pauseRequested),
    ...extra
  }).catch(() => {});
}

function sleep(milliseconds) {
  return new Promise((resolve) => { setTimeout(resolve, milliseconds); });
}

function sanitizedUrl(raw) {
  if (!raw || typeof raw !== 'string') return raw;
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_KEY.test(key)) url.searchParams.set(key, '[REDACTED]');
    }
    return url.href;
  } catch {
    return raw.replace(BEARER, '[REDACTED_AUTH]');
  }
}

function isInjectedExtensionRuntimeUrl(raw) {
  const value = String(raw || '').trim().toLowerCase();
  return value.startsWith('chrome-extension://')
    || value.startsWith('moz-extension://')
    || value.startsWith('safari-web-extension://')
    || value.startsWith('devtools://')
    || value.startsWith('let-me-see-code://');
}

function sanitizeHeaders(headers) {
  if (!headers) return [];
  const entries = Array.isArray(headers)
    ? headers.map((item) => [item.name, item.value])
    : Object.entries(headers);
  return entries.map(([name, value]) => ({
    name,
    value: SECRET_HEADER.test(name) || SECRET_KEY.test(name)
      ? '[REDACTED]'
      : String(value ?? '').replace(BEARER, '[REDACTED_AUTH]')
  }));
}

function redactJson(value, key = '') {
  if (SECRET_KEY.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redactJson(item));
  if (value && typeof value === 'object') {
    const namedSecret = typeof value.name === 'string' && SECRET_KEY.test(value.name);
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      namedSecret && /value|text|content|body/i.test(childKey) ? '[REDACTED]' : redactJson(childValue, childKey)
    ]));
  }
  if (typeof value === 'string' && /url|uri|href|src/i.test(key)) return sanitizedUrl(value);
  return typeof value === 'string' ? value.replace(BEARER, '[REDACTED_AUTH]') : value;
}

function sanitizeTextBody(text, mimeType = '') {
  let output = String(text ?? '');
  if (/json|graphql/i.test(mimeType) || /^[\s\r\n]*[\[{]/.test(output)) {
    try {
      return JSON.stringify(redactJson(JSON.parse(output)), null, 2);
    } catch {
      // Fall through to best-effort text redaction.
    }
  }
  output = output.replace(BEARER, '[REDACTED_AUTH]');
  output = output.replace(/(["']?(?:access[_-]?token|refresh[_-]?token|token|csrf|xsrf|api[_-]?key|auth(?:orization)?|cookie|session|password|secret)["']?\s*[:=]\s*)([^,;\r\n}]+)/gi, '$1[REDACTED]');
  output = output.replace(/(["']?(?:access[_-]?token|refresh[_-]?token|token|csrf|xsrf|api[_-]?key|auth(?:orization)?|cookie|session|password|secret)["']?\s*[:=]\s*["']?)([^"'\s&,;}<]+)/gi, '$1[REDACTED]');
  output = output.replace(
    /(\b(?:localStorage|sessionStorage)\s*\.\s*setItem\s*\(\s*(["'])([^"']+)\2\s*,\s*)(["'`])([\s\S]*?)\4(\s*\))/gi,
    (match, prefix, quote, key, valueQuote, value, suffix) => SECRET_KEY.test(key)
      ? `${prefix}${valueQuote}[REDACTED]${valueQuote}${suffix}`
      : match
  );
  output = output.replace(
    /(\bdocument\s*\.\s*cookie\s*=\s*)(["'`])([\s\S]*?)\2/g,
    (match, prefix, quote) => `${prefix}${quote}[REDACTED]${quote}`
  );
  return output;
}

function sanitizeRequestPayload(text, headers = {}) {
  if (text === undefined || text === null) return null;
  const contentTypeEntry = Object.entries(headers).find(([name]) => name.toLowerCase() === 'content-type');
  const mimeType = String(contentTypeEntry?.[1] || 'text/plain');
  if (/application\/x-www-form-urlencoded/i.test(mimeType)) {
    try {
      const parameters = new URLSearchParams(String(text));
      for (const key of [...parameters.keys()]) {
        if (SECRET_KEY.test(key)) parameters.set(key, '[REDACTED]');
      }
      return { mimeType, text: parameters.toString() };
    } catch {}
  }
  if (/multipart\/form-data/i.test(mimeType)) {
    const sanitized = String(text).replace(
      /(content-disposition:[^\r\n]*\bname="([^"]+)"[^\r\n]*\r?\n(?:[^\r\n]*\r?\n)*\r?\n)([\s\S]*?)(?=\r?\n--)/gi,
      (match, prefix, fieldName, value) => `${prefix}${SECRET_KEY.test(fieldName) ? '[REDACTED]' : sanitizeTextBody(value, 'text/plain')}`
    );
    return { mimeType, text: sanitized };
  }
  return { mimeType, text: sanitizeTextBody(String(text), mimeType) };
}

function safeJson(value) {
  return JSON.stringify(value, null, 2);
}

function addText(files, path, value) {
  files.set(path, { kind: 'text', data: String(value ?? '') });
}

function addJson(files, path, value) {
  addText(files, path, safeJson(value));
}

async function addDeduplicatedJson(files, path, value, category) {
  const source = safeJson(value);
  files.exactJsonDedup ||= new Map();
  files.deduplicationRecords ||= [];
  const sha256 = await sha256HexString(source);
  const key = `${category}:${source.length}:${sha256}`;
  const existing = files.exactJsonDedup.get(key);
  if (existing) {
    addJson(files, path, {
      deduplicated: true,
      referencePath: existing.path,
      category,
      sha256,
      originalCharacters: source.length
    });
    files.deduplicationRecords.push({ path, referencePath: existing.path, category, sha256, originalCharacters: source.length });
    return;
  }
  files.exactJsonDedup.set(key, { path, sha256, originalCharacters: source.length });
  addText(files, path, source);
}

async function exactJsonValueOrReference(files, value, category, referencePath) {
  const source = safeJson(value);
  files.exactEmbeddedJsonDedup ||= new Map();
  files.deduplicationRecords ||= [];
  const sha256 = await sha256HexString(source);
  const key = `${category}:${source.length}:${sha256}`;
  const existing = files.exactEmbeddedJsonDedup.get(key);
  if (existing) {
    files.deduplicationRecords.push({ path: referencePath, referencePath: existing.referencePath, category, sha256, originalCharacters: source.length });
    return { deduplicated: true, referencePath: existing.referencePath, category, sha256, originalCharacters: source.length };
  }
  files.exactEmbeddedJsonDedup.set(key, { referencePath, sha256, originalCharacters: source.length });
  return value;
}

function addBase64(files, path, base64) {
  if (base64) files.set(path, { kind: 'base64', data: base64 });
}

async function sha256HexString(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value ?? '')));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function boundedPush(capture, collectionName, value, maximumEntries, maximumBytes = Infinity) {
  const collection = capture[collectionName];
  const stats = capture.eventLimits[collectionName] ||= { retained: 0, retainedBytes: 0, dropped: 0, droppedBytes: 0 };
  let estimatedBytes = 0;
  try { estimatedBytes = new TextEncoder().encode(JSON.stringify(value)).length; } catch { estimatedBytes = 1000; }
  if (collection.length >= maximumEntries || stats.retainedBytes + estimatedBytes > maximumBytes) {
    stats.dropped += 1;
    stats.droppedBytes += estimatedBytes;
    return false;
  }
  collection.push(value);
  stats.retained += 1;
  stats.retainedBytes += estimatedBytes;
  return true;
}

function boundedStreamText(capture, value, mimeType) {
  const text = String(value ?? '');
  if (text.length > MAX_STREAM_EVENT_CHARACTERS) {
    capture.streamPayloadOmissions += 1;
    capture.streamPayloadOmittedCharacters += text.length;
    return { data: null, characters: text.length, omittedReason: `Event payload exceeded ${MAX_STREAM_EVENT_CHARACTERS} characters.` };
  }
  return { data: sanitizeTextBody(text, mimeType), characters: text.length, omittedReason: null };
}

function secretHeaderKind(name, rawValue) {
  const lower = String(name || '').toLowerCase();
  const value = String(rawValue ?? '');
  if (lower === 'authorization' || lower === 'proxy-authorization') {
    const scheme = value.trim().split(/\s+/, 1)[0]?.toLowerCase() || 'unknown';
    return { type: 'authorization', scheme };
  }
  if (/csrf|xsrf/.test(lower)) return { type: 'csrf-header', scheme: null };
  if (/api[-_]?key/.test(lower)) return { type: 'api-key-header', scheme: null };
  if (/token|auth/.test(lower)) return { type: 'token-header', scheme: null };
  return null;
}

function scheduleSecretHeaderFingerprints(capture, requestKey, direction, headers) {
  if (!headers) return;
  const entries = Array.isArray(headers)
    ? headers.map((item) => [item?.name, item?.value])
    : Object.entries(headers);
  for (const [name, rawValue] of entries) {
    const kind = secretHeaderKind(name, rawValue);
    if (!kind) continue;
    capture.secretHeaderFingerprintReserved ||= 0;
    if (capture.secretHeaderFingerprintReserved >= MAX_SECRET_HEADER_FINGERPRINTS) {
      capture.secretHeaderFingerprintDrops += 1;
      continue;
    }
    capture.secretHeaderFingerprintReserved += 1;
    capture.secretHeaderFingerprintQueue ||= [];
    capture.secretHeaderFingerprintQueue.push({
      requestKey,
      direction,
      name: String(name || '').toLowerCase(),
      kind,
      value: String(rawValue ?? '')
    });
  }
  pumpSecretHeaderFingerprintQueue(capture);
}

function pumpSecretHeaderFingerprintQueue(capture) {
  const queue = capture.secretHeaderFingerprintQueue ||= [];
  capture.secretHeaderFingerprintQueueHead ||= 0;
  capture.secretHeaderFingerprintActive ||= 0;
  if (capture.secretHeaderFingerprintQueueHead < queue.length && !capture.secretHeaderFingerprintDrain) {
    let resolveDrain;
    const promise = new Promise((resolve) => { resolveDrain = resolve; });
    capture.secretHeaderFingerprintDrain = { promise, resolve: resolveDrain };
    capture.pendingMetadata.add(promise);
    promise.finally(() => capture.pendingMetadata.delete(promise));
  }

  while (capture.secretHeaderFingerprintActive < 4 && capture.secretHeaderFingerprintQueueHead < queue.length) {
    const task = queue[capture.secretHeaderFingerprintQueueHead];
    capture.secretHeaderFingerprintQueueHead += 1;
    capture.secretHeaderFingerprintActive += 1;
    sha256HexString(task.value).then((sha256) => {
      capture.secretHeaderFingerprints.push({
        requestKey: task.requestKey,
        direction: task.direction,
        name: task.name,
        type: task.kind.type,
        scheme: task.kind.scheme,
        length: task.value.length,
        sha256
      });
    }).catch((error) => {
      capture.secretHeaderFingerprintReserved -= 1;
      capture.warnings.push(`Secret-header fingerprint: ${error?.message || String(error)}`);
    }).finally(() => {
      capture.secretHeaderFingerprintActive -= 1;
      if (capture.secretHeaderFingerprintQueueHead >= queue.length && capture.secretHeaderFingerprintActive === 0) {
        queue.length = 0;
        capture.secretHeaderFingerprintQueueHead = 0;
        const drain = capture.secretHeaderFingerprintDrain;
        capture.secretHeaderFingerprintDrain = null;
        drain?.resolve();
      } else {
        pumpSecretHeaderFingerprintQueue(capture);
      }
    });
  }
}

function cleanFilePart(value, fallback = 'page') {
  const cleaned = String(value || fallback)
    .normalize('NFKD')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function siteArchivePart(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const visibleUrl = `${url.hostname}${url.pathname === '/' ? '' : url.pathname}${url.search}${url.hash}`;
    const decoded = decodeURIComponent(visibleUrl).normalize('NFKD').toLowerCase();
    const dotted = decoded
      .replace(/[^a-z0-9.]+/g, '.')
      .replace(/\.{2,}/g, '.')
      .replace(/^\.+|\.+$/g, '')
      .slice(0, 120)
      .replace(/\.+$/g, '');
    return dotted || 'site';
  } catch {
    return cleanFilePart(rawUrl, 'site').toLowerCase().replace(/[^a-z0-9.]+/g, '.');
  }
}

function extensionFor(mimeType, url = '') {
  const mime = String(mimeType || '').toLowerCase();
  const known = [
    ['text/html', 'html'], ['text/css', 'css'], ['javascript', 'js'], ['json', 'json'],
    ['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'], ['image/gif', 'gif'],
    ['image/svg', 'svg'], ['font/woff2', 'woff2'], ['font/woff', 'woff'], ['application/pdf', 'pdf'],
    ['audio/mpeg', 'mp3'], ['audio/ogg', 'ogg'], ['audio/wav', 'wav'], ['audio/x-wav', 'wav'],
    ['audio/flac', 'flac'], ['audio/mp4', 'm4a'], ['audio/webm', 'webm'], ['audio/opus', 'opus'],
    ['video/mp4', 'mp4'], ['video/webm', 'webm'], ['text/plain', 'txt'], ['xml', 'xml']
  ];
  const match = known.find(([needle]) => mime.includes(needle));
  if (match) return match[1];
  try {
    const suffix = new URL(url).pathname.split('/').pop()?.match(/\.([a-z0-9]{1,8})$/i)?.[1];
    if (suffix) return suffix.toLowerCase();
  } catch {}
  return 'bin';
}

function fileStemWithoutRepeatedExtension(value, extension, fallback = 'response') {
  const stem = cleanFilePart(value, fallback);
  const suffix = `.${String(extension || '').toLowerCase()}`;
  return suffix.length > 1 && stem.toLowerCase().endsWith(suffix)
    ? stem.slice(0, -suffix.length) || fallback
    : stem;
}

// Generous on purpose: most CDP commands resolve in well under a second, but a
// few (MHTML/DOM snapshots on very large pages, full-page tiled screenshots,
// large IndexedDB/response-body reads) can legitimately take tens of seconds.
// This is a safety net against a command that never settles at all — e.g. the
// debugger session breaking in a way that neither resolves nor cleanly rejects
// — not a performance budget. If real-world runs show it clipping legitimate
// slow commands, or taking too long to catch a genuine hang, it's a one-line
// constant to retune; it hasn't been measured against a live capture yet.
const CDP_COMMAND_TIMEOUT_MS = 60_000;
const SCRIPTING_COMMAND_TIMEOUT_MS = 60_000;
const DEBUGGER_ATTACH_TIMEOUT_MS = 12_000;
const DEBUGGER_DETACH_TIMEOUT_MS = 5_000;
const DEBUGGER_STARTUP_TIMEOUT_MS = 50_000;
const DEBUGGER_ATTACH_ATTEMPTS = 2;

function withOperationTimeout(promise, label, timeoutMs) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
  });
  // Attach a no-op handler directly to the real command promise so that, if it
  // eventually settles (possibly with an error) after the timeout has already
  // won the race below, it doesn't surface as an unhandled rejection.
  promise.catch(() => {});
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function withCdpTimeout(promise, method, timeoutMs) {
  return withOperationTimeout(promise, `CDP command ${method}`, timeoutMs);
}

function remainingStageTimeout(deadline, maximumMs) {
  return Math.max(1, Math.min(maximumMs, deadline - Date.now()));
}

function pseudoStateBudget(capture) {
  if (capture.options.mode !== 'entire') return PSEUDO_STATE_FAST_BUDGET_MS;
  const configured = (capture.currentPageIndex || 0) > 0 ? PSEUDO_STATE_MAX_CRAWL_BUDGET_MS : PSEUDO_STATE_MAX_ENTRY_BUDGET_MS;
  return unlimitedAwareStageBudget(capture, configured);
}

function responsiveBudget(capture) {
  if (capture.options.mode !== 'entire') return RESPONSIVE_FAST_BUDGET_MS;
  const configured = (capture.currentPageIndex || 0) > 0 ? RESPONSIVE_MAX_CRAWL_BUDGET_MS : RESPONSIVE_MAX_ENTRY_BUDGET_MS;
  return unlimitedAwareStageBudget(capture, configured);
}

function cdp(tabId, method, params = {}, timeoutMs = CDP_COMMAND_TIMEOUT_MS) {
  return withCdpTimeout(chrome.debugger.sendCommand({ tabId }, method, params), method, timeoutMs);
}

function cdpSession(tabId, sessionId, method, params = {}, timeoutMs = CDP_COMMAND_TIMEOUT_MS) {
  return withCdpTimeout(chrome.debugger.sendCommand(sessionId ? { tabId, sessionId } : { tabId }, method, params), method, timeoutMs);
}

function executeScript(details, label = 'page script', timeoutMs = SCRIPTING_COMMAND_TIMEOUT_MS) {
  return withOperationTimeout(chrome.scripting.executeScript(details), label, timeoutMs);
}

async function safeDebuggerDetach(tabId, capture = currentCapture, label = 'Chrome debugger cleanup') {
  if (capture) {
    capture.intentionalDetachCount = (capture.intentionalDetachCount || 0) + 1;
    capture.intentionalDetach = true;
  }
  try {
    await withOperationTimeout(chrome.debugger.detach({ tabId }), label, DEBUGGER_DETACH_TIMEOUT_MS);
    if (capture) capture.debuggerAttached = false;
    return { detached: true, error: null };
  } catch (error) {
    return { detached: false, error: error?.message || String(error) };
  } finally {
    if (capture) {
      capture.intentionalDetachCount = Math.max(0, (capture.intentionalDetachCount || 1) - 1);
      capture.intentionalDetach = capture.intentionalDetachCount > 0;
    }
  }
}

function debuggerConflictMessage(message) {
  return /another debugger|devtools|replaced_with_devtools|cannot attach to this target/i.test(String(message || ''));
}

async function debuggerHealthProbe(capture, timeoutMs = 8_000) {
  await cdp(capture.tabId, 'Runtime.enable', {}, timeoutMs);
  await cdp(capture.tabId, 'Runtime.evaluate', { expression: '1', returnByValue: true }, timeoutMs);
  const tab = await withOperationTimeout(chrome.tabs.get(capture.tabId), 'Target-tab health check', 5_000);
  if (!tab?.id || !/^(?:https?:|file:)/i.test(tab.url || '')) throw new Error('The selected tab stopped being a capturable webpage during startup.');
  return tab;
}

async function probeTargetRenderer(capture, timeoutMs = 5_000) {
  try {
    const tab = await withOperationTimeout(chrome.tabs.get(capture.tabId), 'Renderer target lookup', timeoutMs);
    if (!tab?.id) return { healthy: false, reason: 'the target tab no longer exists' };
    if (tab.discarded) return { healthy: false, reason: 'Chrome discarded the target renderer' };
    if (/^(?:chrome-error|chrome):\/\//i.test(tab.url || '')) return { healthy: false, reason: `Chrome replaced the page with ${tab.url}` };
    const evaluation = await cdp(capture.tabId, 'Runtime.evaluate', { expression: '({href: location.href, readyState: document.readyState})', returnByValue: true }, timeoutMs);
    const value = evaluation?.result?.value;
    if (!value?.href || /^(?:chrome-error|chrome):\/\//i.test(value.href)) return { healthy: false, reason: 'the renderer returned an error-page state' };
    return { healthy: true, reason: null, tab, page: value };
  } catch (error) {
    return { healthy: false, reason: error?.message || String(error) };
  }
}

async function attachDebuggerReliably(capture, policy = {}) {
  const attempts = Math.max(1, Number(policy.attempts) || DEBUGGER_ATTACH_ATTEMPTS);
  const attachTimeoutMs = Math.max(1, Number(policy.attachTimeoutMs) || DEBUGGER_ATTACH_TIMEOUT_MS);
  const startupTimeoutMs = Math.max(attachTimeoutMs, Number(policy.startupTimeoutMs) || DEBUGGER_STARTUP_TIMEOUT_MS);
  const retryDelayMs = Math.max(0, Number(policy.retryDelayMs) || 500);
  const healthTimeoutMs = Math.max(1, Number(policy.healthTimeoutMs) || 8_000);
  const startedAt = Date.now();
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    throwIfCancelled(capture);
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs >= startupTimeoutMs) break;
    sendProgress(`Chrome connection attempt ${attempt}/${attempts}…`, 4, { startupAttempt: attempt, startupAttempts: attempts });
    appendActivityLog(`Startup detail: debugger handshake attempt ${attempt} began for tab ${capture.tabId} (${sanitizedUrl(capture.currentPageUrl)}).`, 4, 'info', capture);
    try {
      let expired = false;
      const attachPromise = chrome.debugger.attach({ tabId: capture.tabId }, DEBUGGER_VERSION);
      attachPromise.then(() => {
        if (expired || currentCapture !== capture || capture.cancelRequested || capture.targetTabClosed) {
          void safeDebuggerDetach(capture.tabId, capture, `Late attachment attempt ${attempt} cleanup`);
        }
      }).catch(() => {});
      try {
        await withOperationTimeout(attachPromise, `Chrome debugger attachment attempt ${attempt}`, attachTimeoutMs);
      } catch (error) {
        expired = true;
        throw error;
      }
      capture.debuggerAttached = true;
    } catch (error) {
      lastError = error;
      const message = error?.message || String(error);
      appendActivityLog(`Startup detail: attachment attempt ${attempt} failed: ${message}`, 4, 'error', capture);
      if (/already attached/i.test(message) && !debuggerConflictMessage(message)) {
        try {
          await debuggerHealthProbe(capture, healthTimeoutMs);
          capture.debuggerAttached = true;
          appendActivityLog('Startup recovery: an existing extension-owned debugger channel was healthy and was reused.', 5, 'info', capture);
          return { attempt, recoveredExistingSession: true };
        } catch {}
      }
      if (debuggerConflictMessage(message)) {
        throw new Error('Chrome refused the capture connection because DevTools or another browser-debugging tool controls this tab. Close DevTools and disconnect automation from this tab, then retry. No partial archive was created.');
      }
      const cleanup = await safeDebuggerDetach(capture.tabId, capture, `Attachment attempt ${attempt} cleanup`);
      if (!capture.cancelRequested && !capture.targetTabClosed) capture.detachedReason = null;
      appendActivityLog(`Startup cleanup after attempt ${attempt}: ${cleanup.detached ? 'stale debugger state detached' : `nothing detached (${cleanup.error || 'not attached'})`}.`, 4, cleanup.detached ? 'info' : 'error', capture);
      if (attempt < attempts) {
        sendProgress('Chrome did not answer; cleaned the stale connection and retrying once…', 4, { startupAttempt: attempt, startupAttempts: attempts });
        await sleep(retryDelayMs);
      }
      continue;
    }

    try {
      await debuggerHealthProbe(capture, healthTimeoutMs);
      appendActivityLog(`Startup detail: debugger channel passed Runtime and target-tab health checks on attempt ${attempt} in ${Date.now() - startedAt}ms.`, 5, 'info', capture);
      return { attempt, recoveredExistingSession: false };
    } catch (error) {
      lastError = error;
      appendActivityLog(`Startup detail: attachment attempt ${attempt} connected but failed its health probe: ${error?.message || String(error)}`, 4, 'error', capture);
      await safeDebuggerDetach(capture.tabId, capture, `Unhealthy attachment attempt ${attempt} cleanup`);
      if (!capture.cancelRequested && !capture.targetTabClosed) capture.detachedReason = null;
      if (attempt < attempts) await sleep(retryDelayMs);
    }
  }
  throw new Error(`Chrome did not establish a healthy capture connection after ${attempts} attempts and ${Math.round((Date.now() - startedAt) / 1000)}s. ${lastError?.message || lastError || 'The browser did not answer.'} The startup was cleaned up and no partial archive was created.`);
}

async function bestEffort(command, warnings, label) {
  try {
    return await command();
  } catch (error) {
    warnings.push(`${label}: ${error?.message || String(error)}`);
    return null;
  }
}

function isUnsupportedCdpMethod(error) {
  const code = Number(error?.code);
  const message = String(error?.message || error || '');
  return code === -32601 || /method (?:was not|wasn't|not) found|wasn't found|not supported/i.test(message);
}

async function optionalCdp(capture, capability, method, params = {}, timeoutMs = 10_000) {
  capture.optionalCapabilities ||= {};
  try {
    const value = await cdp(capture.tabId, method, params, timeoutMs);
    capture.optionalCapabilities[capability] = { supported: true };
    return value;
  } catch (error) {
    if (isUnsupportedCdpMethod(error)) {
      const unavailable = { supported: false, reason: `${method} is not exposed by this Chrome build.` };
      capture.optionalCapabilities[capability] = unavailable;
      return unavailable;
    }
    capture.warnings.push(`${capability}: ${error?.message || String(error)}`);
    capture.optionalCapabilities[capability] = { supported: null, error: error?.message || String(error) };
    return null;
  }
}

function sanitizeDomSnapshot(snapshot) {
  if (!snapshot?.strings || !snapshot?.documents) return snapshot;
  const strings = snapshot.strings;
  for (const document of snapshot.documents) {
    const nodes = document?.nodes;
    if (!nodes?.attributes || !nodes?.nodeName) continue;
    for (let index = 0; index < nodes.attributes.length; index += 1) {
      const attributeIndexes = nodes.attributes[index];
      if (!attributeIndexes?.length) continue;
      const attributes = [];
      for (let position = 0; position < attributeIndexes.length; position += 2) {
        attributes.push({
          nameIndex: attributeIndexes[position],
          valueIndex: attributeIndexes[position + 1],
          name: strings[attributeIndexes[position]],
          value: strings[attributeIndexes[position + 1]]
        });
      }
      const map = Object.fromEntries(attributes.map((item) => [String(item.name).toLowerCase(), item.value]));
      const nodeName = String(strings[nodes.nodeName[index]] || '').toLowerCase();
      const sensitiveFieldKey = map.name || map.id || map['http-equiv'] || '';
      const isSensitiveInput = nodeName === 'input' && map.type === 'password';
      const isSensitiveElement = isSensitiveInput || SECRET_KEY.test(sensitiveFieldKey);
      for (const attribute of attributes) {
        if (SECRET_KEY.test(attribute.name) || (isSensitiveElement && /^(?:value|content)$/i.test(attribute.name))) {
          strings[attribute.valueIndex] = '[REDACTED]';
        } else if (/^(?:href|src|action|formaction|poster)$/i.test(attribute.name)) {
          strings[attribute.valueIndex] = sanitizedUrl(attribute.value);
        }
      }
    }
  }
  return snapshot;
}

function sanitizeAccessibilityTree(tree) {
  if (!tree?.nodes) return tree;
  for (const node of tree.nodes) {
    const protectedProperty = node.properties?.find((item) => item.name === 'protected' && item.value?.value === true);
    const name = String(node.name?.value || '');
    if (protectedProperty || /password/i.test(name)) {
      if (node.value) node.value.value = '[REDACTED]';
      node.description = node.description ? { ...node.description, value: '[REDACTED]' } : node.description;
    }
  }
  return tree;
}

function recordNetworkEvent(capture, source, method, params) {
  capture.lastNetworkActivity = Date.now();
  const requests = capture.requests;
  const requestKey = `${source.sessionId || 'root'}:${params.requestId || 'none'}`;

  if (method === 'Network.requestWillBeSent') {
    scheduleSecretHeaderFingerprints(capture, requestKey, 'request', params.request?.headers);
    scheduleSecretHeaderFingerprints(capture, requestKey, 'redirect-response', params.redirectResponse?.headers);
    capture.activeRequests.add(requestKey);
    const previous = requests.get(requestKey) || {};
    requests.set(requestKey, {
      ...previous,
      requestId: params.requestId,
      sessionId: source.sessionId || null,
      loaderId: params.loaderId,
      pageIndex: capture.currentPageIndex || 0,
      pageUrl: sanitizedUrl(capture.currentPageUrl || capture.originalUrl),
      documentURL: sanitizedUrl(params.documentURL),
      type: params.type,
      frameId: params.frameId,
      initiator: redactJson(params.initiator),
      wallTime: params.wallTime,
      timestamp: params.timestamp,
      request: {
        url: sanitizedUrl(params.request?.url),
        method: params.request?.method,
        headers: sanitizeHeaders(params.request?.headers),
        hasPostData: Boolean(params.request?.hasPostData),
        postData: capture.options.forensicMode ? sanitizeRequestPayload(params.request?.postData, params.request?.headers) : null,
        postDataOmittedForPrivacy: Boolean(params.request?.hasPostData && !capture.options.forensicMode),
        mixedContentType: params.request?.mixedContentType,
        initialPriority: params.request?.initialPriority,
        referrerPolicy: params.request?.referrerPolicy
      },
      redirectResponse: params.redirectResponse ? {
        url: sanitizedUrl(params.redirectResponse.url),
        status: params.redirectResponse.status,
        statusText: params.redirectResponse.statusText,
        headers: sanitizeHeaders(params.redirectResponse.headers),
        mimeType: params.redirectResponse.mimeType
      } : previous.redirectResponse
    });
    if (capture.options.forensicMode && params.request?.hasPostData && !params.request?.postData) {
      const postPromise = runWithBodyReadSlot(capture, async () => {
        const result = await cdpSession(capture.tabId, source.sessionId, 'Network.getRequestPostData', { requestId: params.requestId });
          const record = requests.get(requestKey);
          if (!record?.request || !result?.postData) return;
          const headers = Object.fromEntries((record.request.headers || []).map((header) => [header.name, header.value]));
          record.request.postData = sanitizeRequestPayload(result.postData, headers);
          record.request.postDataOmittedForPrivacy = false;
        })
        .catch((error) => {
          const record = requests.get(requestKey);
          if (record?.request) record.request.postDataUnavailable = error?.message || String(error);
        });
      capture.pendingBodies.add(postPromise);
      postPromise.finally(() => capture.pendingBodies.delete(postPromise));
    }
  } else if (method === 'Network.requestWillBeSentExtraInfo') {
    scheduleSecretHeaderFingerprints(capture, requestKey, 'request-extra-info', params.headers);
    const previous = requests.get(requestKey) || { requestId: params.requestId, sessionId: source.sessionId || null };
    requests.set(requestKey, {
      ...previous,
      requestExtraInfo: {
        headers: sanitizeHeaders(params.headers),
        associatedCookiesCount: params.associatedCookies?.length || 0,
        connectTiming: params.connectTiming || null,
        clientSecurityState: params.clientSecurityState || null
      }
    });
  } else if (method === 'Network.responseReceived') {
    scheduleSecretHeaderFingerprints(capture, requestKey, 'response', params.response?.headers);
    const previous = requests.get(requestKey) || { requestId: params.requestId, sessionId: source.sessionId || null };
    requests.set(requestKey, {
      ...previous,
      type: params.type || previous.type,
      response: {
        url: sanitizedUrl(params.response.url),
        status: params.response.status,
        statusText: params.response.statusText,
        headers: sanitizeHeaders(params.response.headers),
        mimeType: params.response.mimeType,
        charset: params.response.charset,
        connectionReused: params.response.connectionReused,
        connectionId: params.response.connectionId,
        remoteIPAddress: params.response.remoteIPAddress,
        remotePort: params.response.remotePort,
        fromDiskCache: params.response.fromDiskCache,
        fromServiceWorker: params.response.fromServiceWorker,
        fromPrefetchCache: params.response.fromPrefetchCache,
        encodedDataLength: params.response.encodedDataLength,
        protocol: params.response.protocol,
        securityState: params.response.securityState,
        timing: params.response.timing || null
      }
    });
  } else if (method === 'Network.responseReceivedExtraInfo') {
    scheduleSecretHeaderFingerprints(capture, requestKey, 'response-extra-info', params.headers);
    const previous = requests.get(requestKey) || { requestId: params.requestId, sessionId: source.sessionId || null };
    requests.set(requestKey, {
      ...previous,
      responseExtraInfo: {
        blockedCookiesCount: params.blockedCookies?.length || 0,
        headers: sanitizeHeaders(params.headers),
        statusCode: params.statusCode,
        cookiePartitionKeyOpaque: params.cookiePartitionKeyOpaque
      }
    });
  } else if (method === 'Network.loadingFinished') {
    capture.activeRequests.delete(requestKey);
    const previous = requests.get(requestKey) || { requestId: params.requestId, sessionId: source.sessionId || null };
    requests.set(requestKey, { ...previous, finishedAt: params.timestamp, encodedDataLength: params.encodedDataLength });
    const bodyPromise = captureResponseBody(capture, requestKey, params.encodedDataLength);
    capture.pendingBodies.add(bodyPromise);
    bodyPromise.finally(() => capture.pendingBodies.delete(bodyPromise));
  } else if (method === 'Network.loadingFailed') {
    capture.activeRequests.delete(requestKey);
    const previous = requests.get(requestKey) || { requestId: params.requestId, sessionId: source.sessionId || null };
    requests.set(requestKey, {
      ...previous,
      failedAt: params.timestamp,
      failure: { errorText: params.errorText, canceled: params.canceled, blockedReason: params.blockedReason, corsErrorStatus: params.corsErrorStatus }
    });
  }
}

async function captureResponseBody(capture, requestKey, encodedLength) {
  const record = capture.requests.get(requestKey);
  if (!record?.response || record.response.status === 204 || record.response.status === 304) return;
  if (record.body?.body !== undefined || record.body?.file) return;
  if (encodedLength > capture.options.maxBodyBytes) {
    record.body = { omitted: true, reason: `Encoded body exceeds ${capture.options.maxBodyBytes} bytes.` };
    return;
  }
  if (capture.totalBodyBytes >= MAX_TOTAL_BODY_BYTES) {
    record.body = { omitted: true, reason: `Capture reached the ${MAX_TOTAL_BODY_BYTES}-byte total response-body limit.` };
    return;
  }
  try {
    await runWithBodyReadSlot(capture, async () => {
      if (record.body?.body !== undefined || record.body?.file) return;
      const body = await cdpSession(capture.tabId, record.sessionId, 'Network.getResponseBody', { requestId: record.requestId });
      const estimatedBytes = body.base64Encoded
        ? Math.floor(body.body.length * 0.75)
        : new TextEncoder().encode(body.body).length;
      if (estimatedBytes > capture.options.maxBodyBytes || capture.totalBodyBytes + estimatedBytes > MAX_TOTAL_BODY_BYTES) {
        record.body = { omitted: true, reason: 'Decoded body exceeds the configured per-response or total capture limit.' };
        return;
      }
      capture.totalBodyBytes += estimatedBytes;
      stageCapturedResponseBody(capture, record, body.body, body.base64Encoded, estimatedBytes, false);
      await capture.files?.waitForBackpressure?.();
    });
  } catch (error) {
    record.body = { omitted: true, reason: error?.message || String(error) };
  }
}

function stageCapturedResponseBody(capture, record, rawBody, base64Encoded, byteLength, preservedAtResponsePause) {
  if (!capture.files) {
    record.body = { body: rawBody, base64Encoded, byteLength, preservedAtResponsePause };
    return;
  }
  const mimeType = record.response?.mimeType || '';
  const url = record.response?.url || record.request?.url || '';
  let urlLeaf = 'response';
  try { urlLeaf = new URL(url || 'https://invalid/').pathname.split('/').pop() || 'response'; } catch {}
  const index = capture.nextNetworkBodyFileIndex || 0;
  capture.nextNetworkBodyFileIndex = index + 1;
  const extension = extensionFor(mimeType, url);
  const file = `network/bodies/${String(index).padStart(6, '0')}_${fileStemWithoutRepeatedExtension(urlLeaf, extension)}.${extension}`;
  if (base64Encoded) addBase64(capture.files, file, rawBody);
  else addText(capture.files, file, sanitizeTextBody(rawBody, mimeType));
  record.body = {
    file,
    base64Encoded,
    byteLength,
    preservedAtResponsePause,
    stagedIncrementally: true
  };
}

async function capturePausedResponse(capture, source, params) {
  const sessionId = source.sessionId || null;
  const requestId = params.networkId || params.requestId;
  const requestKey = `${sessionId || 'root'}:${requestId}`;
  scheduleSecretHeaderFingerprints(capture, requestKey, 'paused-request', params.request?.headers);
  scheduleSecretHeaderFingerprints(capture, requestKey, 'paused-response', params.responseHeaders);
  let record = capture.requests.get(requestKey);
  if (!record) {
    record = {
      requestId,
      sessionId,
      pageIndex: capture.currentPageIndex || 0,
      pageUrl: sanitizedUrl(capture.currentPageUrl || capture.originalUrl),
      request: { url: sanitizedUrl(params.request?.url), method: params.request?.method, headers: sanitizeHeaders(params.request?.headers) },
      response: {
        url: sanitizedUrl(params.request?.url),
        status: params.responseStatusCode || 0,
        statusText: params.responseStatusText || '',
        headers: sanitizeHeaders(params.responseHeaders),
        mimeType: (params.responseHeaders || []).find((header) => header.name.toLowerCase() === 'content-type')?.value || ''
      }
    };
    capture.requests.set(requestKey, record);
  }
  try {
    await runWithBodyReadSlot(capture, async () => {
      const lengthHeader = (params.responseHeaders || []).find((header) => header.name.toLowerCase() === 'content-length')?.value;
      const announcedLength = Number(lengthHeader) || 0;
      if (announcedLength > capture.options.maxBodyBytes || capture.totalBodyBytes >= MAX_TOTAL_BODY_BYTES) return;
      const body = await cdpSession(capture.tabId, sessionId, 'Fetch.getResponseBody', { requestId: params.requestId });
      const estimatedBytes = body.base64Encoded ? Math.floor(body.body.length * 0.75) : new TextEncoder().encode(body.body).length;
      if (estimatedBytes <= capture.options.maxBodyBytes && capture.totalBodyBytes + estimatedBytes <= MAX_TOTAL_BODY_BYTES) {
        capture.totalBodyBytes += estimatedBytes;
        stageCapturedResponseBody(capture, record, body.body, body.base64Encoded, estimatedBytes, true);
        capture.interceptedBodies += 1;
        await capture.files?.waitForBackpressure?.();
      } else if (!record.body) {
        record.body = { omitted: true, reason: 'Intercepted response exceeded the configured per-response or total capture limit.' };
      }
    });
  } catch (error) {
    if (!record.body) record.interceptionError = error?.message || String(error);
  } finally {
    await cdpSession(capture.tabId, sessionId, 'Fetch.continueRequest', { requestId: params.requestId }).catch(() => {});
  }
}

async function configureChildTarget(capture, source, params) {
  const sessionId = params.sessionId;
  if (!sessionId) return;
  capture.childTargets.set(sessionId, { ...redactJson(params.targetInfo), sessionId, attached: true });
  const enable = (method, commandParams = {}) => cdpSession(capture.tabId, sessionId, method, commandParams).catch((error) => {
    capture.warnings.push(`Child target ${params.targetInfo?.type || 'unknown'} ${method}: ${error?.message || String(error)}`);
  });
  await enable('Runtime.enable');
  await enable('Log.enable');
  if (['iframe', 'page'].includes(params.targetInfo?.type)) await enable('Page.enable');
  await enable('Network.enable', {
    maxTotalBufferSize: MAX_TOTAL_BODY_BYTES,
    maxResourceBufferSize: capture.options.maxBodyBytes,
    maxPostDataSize: capture.options.forensicMode ? capture.options.maxBodyBytes : 0
  });
  if (capture.options.forensicMode) await enable('Fetch.enable', {
    patterns: ['Document', 'Stylesheet', 'Script', 'XHR', 'Fetch'].map((resourceType) => ({ urlPattern: '*', resourceType, requestStage: 'Response' }))
  });
  if (capture.options.forensicMode) await enable('Debugger.enable');
  if (capture.options.forensicMode && capture.webSqlSupported && ['iframe', 'page'].includes(params.targetInfo?.type)) await enable('Database.enable');
  if (['iframe', 'page'].includes(params.targetInfo?.type) && capture.instrumentationSource) {
    await enable('Page.addScriptToEvaluateOnNewDocument', { source: capture.instrumentationSource });
    await enable('Runtime.evaluate', { expression: capture.instrumentationSource, returnByValue: false });
  }
  if (capture.options.forensicMode && ['iframe', 'page'].includes(params.targetInfo?.type)) {
    await enable('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
      filter: [
        { type: 'iframe', exclude: false },
        { type: 'worker', exclude: false },
        { type: 'shared_worker', exclude: false },
        { type: 'service_worker', exclude: false }
      ]
    });
  }
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  const capture = currentCapture;
  if (!capture || source.tabId !== capture.tabId) return;

  if (method === 'Target.attachedToTarget') {
    void configureChildTarget(capture, source, params);
  } else if (method === 'Target.detachedFromTarget') {
    const target = capture.childTargets.get(params.sessionId);
    if (target) target.attached = false;
  } else if (method === 'Fetch.requestPaused') {
    const promise = capturePausedResponse(capture, source, params);
    capture.pendingBodies.add(promise);
    promise.finally(() => capture.pendingBodies.delete(promise));
  } else if (method.startsWith('Network.')) {
    recordNetworkEvent(capture, source, method, params);
    if (method === 'Network.webSocketCreated') {
      boundedPush(capture, 'webSockets', { event: 'created', at: params.timestamp || null, requestId: params.requestId, url: sanitizedUrl(params.url), initiator: redactJson(params.initiator) }, MAX_WEBSOCKET_EVENTS, MAX_WEBSOCKET_BYTES);
    } else if (method === 'Network.webSocketFrameReceived' || method === 'Network.webSocketFrameSent') {
      const payload = boundedStreamText(capture, params.response?.payloadData || '', 'websocket');
      boundedPush(capture, 'webSockets', {
        event: method.endsWith('Received') ? 'received' : 'sent',
        at: params.timestamp,
        requestId: params.requestId,
        opcode: params.response?.opcode,
        mask: params.response?.mask,
        payloadData: payload.data,
        payloadCharacters: payload.characters,
        payloadOmittedReason: payload.omittedReason
      }, MAX_WEBSOCKET_EVENTS, MAX_WEBSOCKET_BYTES);
    } else if (method === 'Network.webSocketClosed') {
      boundedPush(capture, 'webSockets', { event: 'closed', at: params.timestamp, requestId: params.requestId }, MAX_WEBSOCKET_EVENTS, MAX_WEBSOCKET_BYTES);
    } else if (method === 'Network.eventSourceMessageReceived') {
      const payload = boundedStreamText(capture, params.data || '', 'text/event-stream');
      boundedPush(capture, 'eventSourceMessages', {
        at: params.timestamp,
        requestId: params.requestId,
        eventName: String(params.eventName || '').slice(0, 1000),
        eventId: String(params.eventId || '').slice(0, 1000),
        data: payload.data,
        dataCharacters: payload.characters,
        dataOmittedReason: payload.omittedReason
      }, MAX_EVENTSOURCE_EVENTS, MAX_EVENTSOURCE_BYTES);
    }
  } else if (method === 'Page.loadEventFired' && !source.sessionId) {
    capture.loadSeen = true;
    capture.lastNetworkActivity = Date.now();
  } else if (method === 'Runtime.consoleAPICalled') {
    if (capture.ignoredExecutionContextIds.has(params.executionContextId)) return;
    boundedPush(capture, 'console', {
      type: params.type,
      timestamp: params.timestamp,
      executionContextId: params.executionContextId,
      values: params.args?.map((arg) => ({ type: arg.type, subtype: arg.subtype, value: redactJson(arg.value), description: sanitizeTextBody(arg.description || '', 'text') })),
      stackTrace: params.stackTrace || null
    }, MAX_CONSOLE_EVENTS);
  } else if (method === 'Runtime.exceptionThrown') {
    if (capture.ignoredExecutionContextIds.has(params.exceptionDetails?.executionContextId)) return;
    boundedPush(capture, 'exceptions', redactJson(params.exceptionDetails), MAX_EXCEPTION_EVENTS);
  } else if (method === 'Runtime.executionContextCreated') {
    const contextOrigin = params.context?.origin || params.context?.auxData?.origin || '';
    const contextName = params.context?.name || '';
    if (isInjectedExtensionRuntimeUrl(contextOrigin) || isInjectedExtensionRuntimeUrl(contextName)) {
      if (params.context?.id != null) capture.ignoredExecutionContextIds.add(params.context.id);
      capture.ignoredInjectedExecutionContexts += 1;
      return;
    }
    boundedPush(capture, 'executionContexts', { ...redactJson(params.context), pageIndex: capture.currentPageIndex || 0, pageUrl: sanitizedUrl(capture.currentPageUrl || capture.originalUrl) }, MAX_EXECUTION_CONTEXTS);
  } else if (method === 'Debugger.scriptParsed') {
    if (isInjectedExtensionRuntimeUrl(params.url) || capture.ignoredExecutionContextIds.has(params.executionContextId)) {
      capture.ignoredInjectedScripts += 1;
      return;
    }
    capture.totalObservedScripts += 1;
    const epoch = capture.runtimeEpoch || 0;
    const epochCount = capture.scriptCountsByEpoch.get(epoch) || 0;
    if (epochCount >= 5000) {
      capture.scriptMetadataDrops += 1;
      return;
    }
    capture.scriptCountsByEpoch.set(epoch, epochCount + 1);
    const scriptMeta = redactJson({
      scriptId: params.scriptId,
      url: sanitizedUrl(params.url),
      startLine: params.startLine,
      startColumn: params.startColumn,
      endLine: params.endLine,
      endColumn: params.endColumn,
      executionContextId: params.executionContextId,
      hash: params.hash,
      sourceMapURL: sanitizedUrl(params.sourceMapURL),
      hasSourceURL: params.hasSourceURL,
      isModule: params.isModule,
      scriptLanguage: params.scriptLanguage || 'JavaScript',
      length: params.length,
      pageIndex: capture.currentPageIndex || 0,
      pageUrl: sanitizedUrl(capture.currentPageUrl || capture.originalUrl),
      runtimeEpoch: epoch,
      stackTrace: params.stackTrace || null
    });
    scriptMeta.sessionId = source.sessionId || null;
    capture.scripts.set(`${source.sessionId || 'root'}:${params.scriptId}`, scriptMeta);
  } else if (method === 'Log.entryAdded') {
    boundedPush(capture, 'logs', redactJson(params.entry), MAX_LOG_EVENTS);
  } else if (method === 'Database.addDatabase') {
    const database = redactJson(params.database || {});
    const key = `${source.sessionId || 'root'}:${database.id || database.name || capture.webSqlDatabases.size}`;
    capture.webSqlDatabases.set(key, {
      database,
      sessionId: source.sessionId || null,
      pageIndex: capture.currentPageIndex || 0,
      pageUrl: sanitizedUrl(capture.currentPageUrl || capture.originalUrl),
      runtimeEpoch: capture.runtimeEpoch || 0
    });
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (currentCapture && source.tabId === currentCapture.tabId) {
    if (currentCapture.intentionalDetach || (currentCapture.intentionalDetachCount || 0) > 0) return;
    currentCapture.detachedReason = reason;
    appendActivityLog(`Debugger channel detached unexpectedly: ${reason || 'unknown reason'}. The capture will stop instead of producing incomplete evidence.`, currentCapture.lastProgress || 1, 'error', currentCapture);
    if (/target_closed|tab_closed/i.test(String(reason))) stopForClosedTarget(currentCapture);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (currentCapture && tabId === currentCapture.tabId) stopForClosedTarget(currentCapture);
});

async function waitForSettled(capture) {
  // Network activity can remain open forever because of analytics, streaming or
  // long polling. Wait at most 20s for load/quiet, then apply the user's separate
  // dynamic-settle delay below.
  const maximumWait = 20_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < maximumWait) {
    await awaitPauseCheckpoint(capture);
    const quietFor = Date.now() - capture.lastNetworkActivity;
    if (capture.loadSeen && capture.activeRequests.size === 0 && quietFor >= 1_500) break;
    await sleep(250);
  }
  await awaitPauseCheckpoint(capture);
  if (!capture.loadSeen) capture.warnings.push('Timed out before Chrome reported a full load event; the available state was captured anyway.');
  if (capture.activeRequests.size > 0) capture.warnings.push(`${capture.activeRequests.size} request(s) were still active when the snapshot was taken.`);
  if (capture.options.settleSeconds > 0) {
    const settleUntil = Date.now() + capture.options.settleSeconds * 1_000;
    while (Date.now() < settleUntil) {
      await awaitPauseCheckpoint(capture);
      await sleep(Math.min(250, settleUntil - Date.now()));
    }
  }
}

async function captureFrameworkState(capture, prefix, files) {
  if (!capture.options.forensicMode) return;
  const evaluated = await bestEffort(
    () => cdp(capture.tabId, 'Runtime.evaluate', {
      expression: `(() => {
        const SECRET = /pass(?:word|wd)?|secret|token|api[-_]?key|auth(?:orization)?|cookie|session|csrf|xsrf|private[-_]?key/i;
        const safe = (value, key = '', depth = 0, seen = new WeakSet()) => {
          if (SECRET.test(String(key))) return '[REDACTED]';
          if (value == null || ['boolean','number'].includes(typeof value)) return value;
          if (typeof value === 'string') return value.replace(/\\b(?:bearer|basic)\\s+[a-z0-9._~+\\/-]+=*/gi, '[REDACTED_AUTH]').slice(0, 200000);
          if (typeof value === 'bigint') return String(value) + 'n';
          if (typeof value === 'function') return '[Function ' + (value.name || 'anonymous') + ']';
          if (typeof value !== 'object') return String(value);
          if (depth > 6) return '[MAX_DEPTH]';
          if (seen.has(value)) return '[CIRCULAR]';
          seen.add(value);
          if (value instanceof Element) return { _element: value.localName, id: value.id || null, className: String(value.className || '').slice(0, 500) };
          if (Array.isArray(value)) return value.slice(0, 500).map((item, index) => safe(item, String(index), depth + 1, seen));
          const output = {};
          for (const childKey of Object.keys(value).slice(0, 500)) {
            try { output[childKey] = safe(value[childKey], childKey, depth + 1, seen); }
            catch (error) { output[childKey] = '[UNREADABLE]'; }
          }
          return output;
        };
        const result = { detected: [], bootstrapGlobals: {}, react: null, vue: null, angular: null, redux: [], zustand: [], mobx: [], svelte: null };
        for (const name of ['__NEXT_DATA__','__NUXT__','__INITIAL_STATE__','__PRELOADED_STATE__','__APOLLO_STATE__','__PINIA__']) {
          if (name in window) result.bootstrapGlobals[name] = safe(window[name], name);
        }
        const elements = [...document.querySelectorAll('*')];
        const reactHost = elements.find((element) => Object.keys(element).some((key) => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$')));
        if (reactHost) {
          result.detected.push('React');
          const fiberKey = Object.keys(reactHost).find((key) => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'));
          let root = reactHost[fiberKey];
          while (root?.return) root = root.return;
          const components = [];
          const stack = root ? [root] : [];
          const fiberSeen = new Set();
          while (stack.length && components.length < 5000) {
            const fiber = stack.pop();
            if (!fiber || fiberSeen.has(fiber)) continue;
            fiberSeen.add(fiber);
            const type = fiber.elementType || fiber.type;
            const name = typeof type === 'string' ? type : (type?.displayName || type?.name || null);
            components.push({ name, key: fiber.key, tag: fiber.tag, memoizedProps: safe(fiber.memoizedProps, 'props'), memoizedState: safe(fiber.memoizedState, 'state') });
            if (fiber.sibling) stack.push(fiber.sibling);
            if (fiber.child) stack.push(fiber.child);
          }
          result.react = { components, truncated: stack.length > 0 };
        }
        const vueHost = elements.find((element) => element.__vueParentComponent || element.__vue_app__);
        if (vueHost) {
          result.detected.push('Vue');
          const instance = vueHost.__vueParentComponent || vueHost.__vue_app__?._instance;
          result.vue = instance ? {
            name: instance.type?.name || instance.type?.__name || null,
            props: safe(instance.props, 'props'),
            data: safe(instance.data, 'data'),
            setupState: safe(instance.setupState, 'setupState'),
            provides: safe(instance.provides, 'provides')
          } : { detected: true };
        }
        const angularRoot = document.querySelector('[ng-version]');
        if (angularRoot) {
          result.detected.push('Angular');
          result.angular = { version: angularRoot.getAttribute('ng-version'), component: window.ng?.getComponent ? safe(window.ng.getComponent(angularRoot), 'component') : null };
        }
        const globalNames = Object.getOwnPropertyNames(window).slice(0, 3000);
        for (const globalName of globalNames) {
          if (result.redux.length + result.zustand.length + result.mobx.length >= 20) break;
          let value;
          try {
            const descriptor = Object.getOwnPropertyDescriptor(window, globalName);
            if (!descriptor || !('value' in descriptor)) continue;
            value = descriptor.value;
          } catch { continue; }
          if (!value || !['object','function'].includes(typeof value)) continue;
          try {
            if (typeof value.getState === 'function' && typeof value.subscribe === 'function') {
              const record = { globalName, state: safe(value.getState(), 'state') };
              if (typeof value.dispatch === 'function') result.redux.push(record);
              else if (typeof value.setState === 'function') result.zustand.push(record);
            }
          } catch {}
          try {
            const symbols = Object.getOwnPropertySymbols(value).map(String).join(' ');
            const looksMobx = Boolean(value.$mobx) || /mobx/i.test(symbols) || /mobx/i.test(globalName);
            if (looksMobx && result.mobx.length < 10) {
              const converted = typeof window.mobx?.toJS === 'function' ? window.mobx.toJS(value) : value;
              result.mobx.push({ globalName, state: safe(converted, 'state') });
            }
          } catch {}
        }
        if (result.redux.length) result.detected.push('Redux');
        if (result.zustand.length) result.detected.push('Zustand');
        if (result.mobx.length) result.detected.push('MobX');
        const svelteNodes = elements.filter((element) => Object.keys(element).some((key) => key.startsWith('__svelte'))).slice(0, 500);
        const svelteGlobals = globalNames.filter((name) => /svelte/i.test(name)).slice(0, 100);
        if (svelteNodes.length || svelteGlobals.length || document.querySelector('[data-svelte-h]')) {
          result.detected.push('Svelte');
          result.svelte = {
            nodeCount: svelteNodes.length,
            nodes: svelteNodes.map((element) => ({ tag: element.localName, id: element.id || null, keys: Object.keys(element).filter((key) => key.startsWith('__svelte')).slice(0, 20) })),
            globals: svelteGlobals,
            hydrationMarkers: document.querySelectorAll('[data-svelte-h]').length
          };
        }
        result.detected = [...new Set(result.detected)];
        return result;
      })()`,
      returnByValue: true,
      awaitPromise: false
    }),
    capture.warnings,
    `${prefix} framework state`
  );
  if (evaluated?.result?.value) addJson(files, `${prefix}/forensics/framework_state.json`, redactJson(evaluated.result.value));
  if (evaluated?.exceptionDetails) capture.warnings.push(`${prefix} framework state: ${evaluated.exceptionDetails.text || 'evaluation failed'}`);
}

async function analyzeJavaScriptSource(capture, files, source, rawFile, scriptMeta) {
  if (!rawFile || capture.capturedSourceAnalysisKeys.has(rawFile)) return;
  capture.capturedSourceAnalysisKeys.add(rawFile);
  const byteLength = new TextEncoder().encode(source).length;
  const entry = { rawFile, byteLength, scriptUrl: scriptMeta?.url || null, beautifiedFile: null, astFile: null, omittedReason: null };
  if (capture.sourceAnalysisManifest.length >= MAX_SOURCE_ANALYSIS_FILES) entry.omittedReason = 'Source-analysis file-count stability boundary reached.';
  else if (byteLength > MAX_SOURCE_ANALYSIS_FILE_BYTES) entry.omittedReason = 'Script exceeded the per-file source-analysis boundary; the captured raw script remains available.';
  else if (capture.sourceAnalysisInputBytes + byteLength > MAX_SOURCE_ANALYSIS_INPUT_BYTES) entry.omittedReason = 'Source-analysis total-input stability boundary reached; the captured raw script remains available.';
  if (entry.omittedReason) {
    capture.sourceAnalysisManifest.push(entry);
    return;
  }

  let ast;
  let sourceType = 'module';
  const comments = [];
  const parseOptions = {
    ecmaVersion: 'latest',
    allowHashBang: true,
    allowAwaitOutsideFunction: true,
    locations: true,
    onComment: (block, text, start, end, startLoc, endLoc) => comments.push({ block, length: text.length, start, end, startLoc, endLoc })
  };
  try {
    ast = parseJavaScript(source, { ...parseOptions, sourceType: 'module' });
  } catch (moduleError) {
    comments.length = 0;
    sourceType = 'script';
    try {
      ast = parseJavaScript(source, { ...parseOptions, sourceType: 'script' });
    } catch (scriptError) {
      entry.omittedReason = `Parser rejected the script: ${scriptError?.message || moduleError?.message || String(scriptError)}`;
      capture.sourceAnalysisManifest.push(entry);
      return;
    }
  }

  capture.sourceAnalysisInputBytes += byteLength;
  const nodeTypes = {};
  const functions = [];
  const classes = [];
  const imports = [];
  const exports = [];
  const routeCandidates = new Set();
  const safeRoute = (value) => {
    try {
      const absolute = /^https?:\/\//i.test(value);
      const url = new URL(value, capture.currentPageUrl || capture.originalUrl);
      for (const key of [...url.searchParams.keys()]) if (SECRET_KEY.test(key)) url.searchParams.set(key, '[REDACTED]');
      return absolute ? url.href : `${url.pathname}${url.search}${url.hash}`;
    } catch { return sanitizeTextBody(value, 'text/plain'); }
  };
  const stack = [ast];
  let nodeCount = 0;
  let traversalTruncated = false;
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (typeof node.type === 'string') {
      nodeCount += 1;
      nodeTypes[node.type] = (nodeTypes[node.type] || 0) + 1;
      if (nodeCount > 500_000) { traversalTruncated = true; break; }
      if (/^(?:FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type) && functions.length < 5000) {
        functions.push({ type: node.type, name: node.id?.name || null, async: Boolean(node.async), generator: Boolean(node.generator), parameters: node.params?.length || 0, line: node.loc?.start?.line || null });
      } else if (/^(?:ClassDeclaration|ClassExpression)$/.test(node.type) && classes.length < 2000) {
        classes.push({ name: node.id?.name || null, methods: node.body?.body?.length || 0, line: node.loc?.start?.line || null });
      } else if (node.type === 'ImportDeclaration' && imports.length < 5000) {
        imports.push({ source: node.source?.value ? safeRoute(String(node.source.value)) : null, specifiers: node.specifiers?.map((specifier) => specifier.local?.name).filter(Boolean).slice(0, 100) || [] });
      } else if (node.type.startsWith('Export') && exports.length < 5000) {
        exports.push({ type: node.type, source: node.source?.value ? safeRoute(String(node.source.value)) : null, names: node.specifiers?.map((specifier) => specifier.exported?.name || specifier.local?.name).filter(Boolean).slice(0, 100) || [] });
      }
      let stringValue = null;
      if (node.type === 'Literal' && typeof node.value === 'string') stringValue = node.value;
      if (node.type === 'TemplateLiteral' && !node.expressions?.length) stringValue = node.quasis?.map((item) => item.value?.cooked || '').join('');
      if (stringValue && /^(?:https?:\/\/|\/(?:api|graphql|rpc|v\d+|rest)(?:\/|$))/i.test(stringValue) && routeCandidates.size < 5000) {
        routeCandidates.add(safeRoute(stringValue));
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index -= 1) {
          if (value[index] && typeof value[index] === 'object') stack.push(value[index]);
        }
      } else if (value && typeof value === 'object') stack.push(value);
    }
  }

  const leaf = rawFile.split('/').pop() || 'script.js';
  const analysisIndex = capture.sourceAnalysisManifest.length;
  const astFile = `forensics/ast/${String(analysisIndex).padStart(4, '0')}_${cleanFilePart(leaf, 'script')}.json`;
  addJson(files, astFile, {
    rawFile,
    sourceType,
    byteLength,
    nodeCount,
    traversalTruncated,
    nodeTypes,
    functions,
    classes,
    imports,
    exports,
    routeCandidates: [...routeCandidates],
    comments: { count: comments.length, block: comments.filter((comment) => comment.block).length, line: comments.filter((comment) => !comment.block).length, metadata: comments.slice(0, 10_000) }
  });
  entry.astFile = astFile;
  try {
    const beautified = generateJavaScript(ast, { indent: '  ', lineEnd: '\n' });
    const beautifiedFile = `forensics/beautified/${String(analysisIndex).padStart(4, '0')}_${cleanFilePart(leaf, 'script.js')}`;
    addText(files, beautifiedFile, sanitizeTextBody(beautified, 'application/javascript'));
    entry.beautifiedFile = beautifiedFile;
  } catch (error) {
    entry.beautifyError = error?.message || String(error);
  }
  capture.sourceAnalysisManifest.push(entry);
  await sleep(0);
}

async function convertWasmToWat(capture, files, base64, wasmFile, scriptMeta) {
  if (!base64 || !wasmFile) return;
  const inputBytes = Math.floor(base64.length * 0.75);
  const entry = { wasmFile, scriptUrl: scriptMeta?.url || null, inputBytes, watFile: null, omittedReason: null };
  if (inputBytes > MAX_WASM_WAT_INPUT_BYTES) entry.omittedReason = 'Wasm module exceeded the per-module WAT conversion boundary; the raw .wasm remains available.';
  else if (capture.wasmWatInputBytes + inputBytes > MAX_WASM_WAT_TOTAL_BYTES) entry.omittedReason = 'WAT conversion total-input stability boundary reached; the raw .wasm remains available.';
  if (!entry.omittedReason) {
    try {
      await ensureOffscreenDocument();
      const response = await withOperationTimeout(chrome.runtime.sendMessage({
        target: 'offscreen',
        action: 'WASM_TO_WAT',
        base64,
        maxInputBytes: MAX_WASM_WAT_INPUT_BYTES,
        maxOutputCharacters: 16 * 1024 * 1024
      }), 'Wasm-to-WAT conversion', 30_000);
      if (!response?.ok) throw new Error(response?.error || 'WABT conversion failed.');
      const watFile = wasmFile.replace(/\.wasm$/i, '.wat');
      addText(files, watFile, response.wat);
      entry.watFile = watFile;
      entry.outputCharacters = response.outputCharacters;
      capture.wasmWatInputBytes += inputBytes;
    } catch (error) {
      entry.omittedReason = error?.message || String(error);
    }
  }
  capture.wasmWatManifest.push(entry);
  await sleep(0);
}

async function checkpointPageRuntime(capture, files, prefix) {
  if (!capture.options.forensicMode || capture.options.mode !== 'entire') return;
  const scriptStageStartedAt = Date.now();
  const scriptBudgetMs = unlimitedAwareStageBudget(capture, PAGE_SCRIPT_CHECKPOINT_BUDGET_MS);
  const scriptDeadline = scriptStageStartedAt + scriptBudgetMs;
  const pageNumber = (capture.currentPageIndex || 0) + 1;
  sendProgress(`Page ${pageNumber}: preserving scripts, coverage and performance…`, capture.liveProgress || 70);

  const cssCoverage = await bestEffort(
    () => cdp(capture.tabId, 'CSS.stopRuleUsageTracking'),
    capture.warnings,
    `${prefix} CSS rule usage coverage`
  );
  if (cssCoverage) addJson(files, `${prefix}/forensics/css_rule_usage.json`, cssCoverage);

  const jsCoverage = await bestEffort(
    () => cdp(capture.tabId, 'Profiler.takePreciseCoverage'),
    capture.warnings,
    `${prefix} JavaScript precise coverage`
  );
  if (jsCoverage) addJson(files, `${prefix}/forensics/javascript_coverage.json`, redactJson(jsCoverage));
  await cdp(capture.tabId, 'Profiler.stopPreciseCoverage').catch(() => {});

  const performance = await bestEffort(
    () => cdp(capture.tabId, 'Performance.getMetrics'),
    capture.warnings,
    `${prefix} performance metrics`
  );
  addJson(files, `${prefix}/forensics/performance_metrics.json`, {
    metrics: performance,
    executionContexts: capture.executionContexts.filter((context) => context.pageIndex === capture.currentPageIndex)
  });

  const epoch = capture.runtimeEpoch || 0;
  const pageScriptEntries = [...capture.scripts.entries()].filter(([, script]) => script.runtimeEpoch === epoch && !script.checkpointed);
  const pageScripts = pageScriptEntries.slice(0, 2000).map(([, script]) => script);
  const pageManifest = [];
  let processedScripts = 0;
  let scriptStopReason = null;
  for (let scriptIndex = 0; scriptIndex < pageScripts.length; scriptIndex += 1) {
    if (Date.now() >= scriptDeadline) {
      scriptStopReason = 'time-budget-reached';
      break;
    }
    const script = pageScripts[scriptIndex];
    let file = null;
    let omittedReason = null;
    const dedupeKey = script.hash
      ? `hash:${script.hash}:${script.length || 0}`
      : `url:${script.url || `inline-${script.scriptId}`}:${script.length || 0}`;
    const existing = capture.scriptSourceIndex.get(dedupeKey);
    if (existing) {
      file = existing.file;
    } else {
      try {
        if (script.scriptLanguage === 'WebAssembly') {
          const wasm = await cdpSession(capture.tabId, script.sessionId, 'Debugger.getWasmBytecode', { scriptId: script.scriptId }, remainingStageTimeout(scriptDeadline, SCRIPT_SOURCE_COMMAND_TIMEOUT_MS));
          const byteLength = Math.floor((wasm?.bytecode?.length || 0) * 0.75);
          if (byteLength > capture.options.maxBodyBytes) {
            omittedReason = 'Wasm module exceeded the configured per-file limit.';
          } else if (capture.totalScriptSourceBytes + byteLength > MAX_TOTAL_SCRIPT_SOURCE_BYTES) {
            omittedReason = 'Capture reached the total unique script-source safety limit.';
          } else {
            const index = capture.scriptSourceIndex.size;
            const leaf = cleanFilePart(script.url?.split('/').pop() || `module-${script.scriptId}`, `module-${index}`);
            file = `forensics/wasm/${String(index).padStart(5, '0')}_${leaf}.wasm`;
            addBase64(files, file, wasm.bytecode);
            capture.totalScriptSourceBytes += byteLength;
            capture.scriptSourceIndex.set(dedupeKey, { file, byteLength });
            await convertWasmToWat(capture, files, wasm.bytecode, file, script);
          }
          script.checkpointed = true;
          const entry = { ...script, file, omittedReason, reusedUniqueSource: false };
          pageManifest.push(entry);
          capture.scriptSourceManifest.push(entry);
          processedScripts = scriptIndex + 1;
          continue;
        }
        const source = await cdpSession(capture.tabId, script.sessionId, 'Debugger.getScriptSource', { scriptId: script.scriptId }, remainingStageTimeout(scriptDeadline, SCRIPT_SOURCE_COMMAND_TIMEOUT_MS));
        const text = source?.scriptSource || '';
        const byteLength = new TextEncoder().encode(text).length;
        if (byteLength > capture.options.maxBodyBytes) {
          omittedReason = 'Script exceeded the configured per-file limit.';
        } else if (capture.totalScriptSourceBytes + byteLength > MAX_TOTAL_SCRIPT_SOURCE_BYTES) {
          omittedReason = 'Capture reached the total unique script-source safety limit.';
        } else {
          const index = capture.scriptSourceIndex.size;
          const leaf = cleanFilePart(script.url?.split('/').pop() || `inline-${script.scriptId}`, `script-${index}`);
          file = `forensics/scripts/${String(index).padStart(5, '0')}_${leaf.endsWith('.js') ? leaf : `${leaf}.js`}`;
          addText(files, file, sanitizeTextBody(text, 'application/javascript'));
          capture.totalScriptSourceBytes += byteLength;
          capture.scriptSourceIndex.set(dedupeKey, { file, byteLength });
          await analyzeJavaScriptSource(capture, files, text, file, script);
        }
      } catch (error) {
        omittedReason = error?.message || String(error);
      }
    }
    script.checkpointed = true;
    const entry = { ...script, file, omittedReason, reusedUniqueSource: Boolean(existing) };
    pageManifest.push(entry);
    capture.scriptSourceManifest.push(entry);
    processedScripts = scriptIndex + 1;
  }
  for (const script of pageScripts.slice(processedScripts)) {
    script.checkpointed = true;
    const entry = { ...script, file: null, omittedReason: 'Per-page script-source time budget reached; metadata was retained.', reusedUniqueSource: false };
    pageManifest.push(entry);
    capture.scriptSourceManifest.push(entry);
  }
  for (const [, script] of pageScriptEntries.slice(2000)) {
    const entry = { ...script, file: null, omittedReason: 'Per-page script-source boundary reached; metadata was retained.', reusedUniqueSource: false };
    pageManifest.push(entry);
    capture.scriptSourceManifest.push(entry);
  }
  for (const [scriptKey] of pageScriptEntries) capture.scripts.delete(scriptKey);

  addJson(files, `${prefix}/forensics/scripts_manifest.json`, {
    pageIndex: capture.currentPageIndex,
    pageUrl: sanitizedUrl(capture.currentPageUrl),
    runtimeEpoch: epoch,
    observedScripts: pageScriptEntries.length,
    capturedOrReusedScripts: pageManifest.filter((script) => script.file).length,
    omittedScripts: pageManifest.filter((script) => !script.file).length,
    complete: !scriptStopReason && pageScriptEntries.length <= 2000,
    stopReason: scriptStopReason || (pageScriptEntries.length > 2000 ? 'script-limit-reached' : null),
    timeBudgetMs: scriptBudgetMs,
    elapsedMs: Date.now() - scriptStageStartedAt,
    scripts: pageManifest
  });
  capture.runtimeCheckpoints.push({
    pageIndex: capture.currentPageIndex,
    prefix,
    observedScripts: pageScriptEntries.length,
    capturedOrReusedScripts: pageManifest.filter((script) => script.file).length,
    omittedScripts: pageManifest.filter((script) => !script.file).length,
    stopReason: scriptStopReason || (pageScriptEntries.length > 2000 ? 'script-limit-reached' : null)
  });

  if (scriptStopReason === 'time-budget-reached') {
    capture.warnings.push(`${prefix} script preservation: ${Math.round(scriptBudgetMs / 1000)}s time budget reached after ${processedScripts}/${pageScripts.length} selected scripts; metadata for the rest was retained.`);
  }

  await cdp(capture.tabId, 'CSS.startRuleUsageTracking').catch((error) => capture.warnings.push(`${prefix} CSS coverage restart: ${error?.message || String(error)}`));
  await cdp(capture.tabId, 'Profiler.startPreciseCoverage', { callCount: true, detailed: true, allowTriggeredUpdates: false }).catch((error) => capture.warnings.push(`${prefix} JavaScript coverage restart: ${error?.message || String(error)}`));
  await files.flush?.();
}

async function finalizeForensicArtifacts(capture, files) {
  if (!capture.options.forensicMode) return;
  const scriptStageStartedAt = Date.now();
  const scriptDeadline = scriptStageStartedAt + FINAL_SCRIPT_CAPTURE_BUDGET_MS;
  sendProgress('Collecting JavaScript, CSS coverage, and performance evidence…', 71);
  const cssCoverage = await bestEffort(() => cdp(capture.tabId, 'CSS.stopRuleUsageTracking'), capture.warnings, 'CSS rule usage coverage');
  if (cssCoverage) addJson(files, 'forensics/css_rule_usage.json', cssCoverage);
  const jsCoverage = await bestEffort(() => cdp(capture.tabId, 'Profiler.takePreciseCoverage'), capture.warnings, 'JavaScript precise coverage');
  if (jsCoverage) addJson(files, 'forensics/javascript_coverage.json', redactJson(jsCoverage));
  await cdp(capture.tabId, 'Profiler.stopPreciseCoverage').catch(() => {});
  const performance = await bestEffort(() => cdp(capture.tabId, 'Performance.getMetrics'), capture.warnings, 'performance metrics');
  addJson(files, 'forensics/performance_metrics.json', { beforeReload: capture.initialPerformance, afterCapture: performance, executionContexts: capture.executionContexts });

  const scriptManifest = capture.options.mode === 'entire' ? [...capture.scriptSourceManifest] : [];
  let totalScriptBytes = capture.options.mode === 'entire' ? capture.totalScriptSourceBytes : 0;
  const allCurrentScriptEntries = capture.options.mode === 'entire' ? [] : [...capture.scripts.values()];
  const scriptEntries = allCurrentScriptEntries.slice(0, 1000);
  let processedScripts = 0;
  let scriptStopReason = null;
  for (let index = 0; index < scriptEntries.length; index += 1) {
    if (Date.now() >= scriptDeadline) {
      scriptStopReason = 'time-budget-reached';
      break;
    }
    const script = scriptEntries[index];
    let file = null;
    let omittedReason = null;
    try {
      if (script.scriptLanguage === 'WebAssembly') {
        const wasm = await cdpSession(capture.tabId, script.sessionId, 'Debugger.getWasmBytecode', { scriptId: script.scriptId }, remainingStageTimeout(scriptDeadline, SCRIPT_SOURCE_COMMAND_TIMEOUT_MS));
        const byteLength = Math.floor((wasm?.bytecode?.length || 0) * 0.75);
        if (byteLength <= capture.options.maxBodyBytes && totalScriptBytes + byteLength <= 100 * 1024 * 1024) {
          file = `forensics/wasm/${String(index).padStart(4, '0')}_${cleanFilePart(script.url?.split('/').pop() || `module-${script.scriptId}`)}.wasm`;
          addBase64(files, file, wasm.bytecode);
          totalScriptBytes += byteLength;
          await convertWasmToWat(capture, files, wasm.bytecode, file, script);
        } else omittedReason = 'Wasm module exceeded the per-file or total script-source limit.';
        scriptManifest.push({ ...script, file, omittedReason });
        processedScripts = index + 1;
        continue;
      }
      const source = await cdpSession(capture.tabId, script.sessionId, 'Debugger.getScriptSource', { scriptId: script.scriptId }, remainingStageTimeout(scriptDeadline, SCRIPT_SOURCE_COMMAND_TIMEOUT_MS));
      const text = source?.scriptSource || '';
      const byteLength = new TextEncoder().encode(text).length;
      if (byteLength <= capture.options.maxBodyBytes && totalScriptBytes + byteLength <= 100 * 1024 * 1024) {
        const leaf = cleanFilePart(script.url?.split('/').pop() || `inline-${script.scriptId}`, `script-${index}`);
        file = `forensics/scripts/${String(index).padStart(4, '0')}_${leaf.endsWith('.js') ? leaf : `${leaf}.js`}`;
        addText(files, file, sanitizeTextBody(text, 'application/javascript'));
        totalScriptBytes += byteLength;
        await analyzeJavaScriptSource(capture, files, text, file, script);
      } else omittedReason = 'Script exceeded the per-file or total script-source limit.';
    } catch (error) {
      omittedReason = error?.message || String(error);
    }
    scriptManifest.push({ ...script, file, omittedReason });
    processedScripts = index + 1;
  }
  for (const script of scriptEntries.slice(processedScripts)) {
    scriptManifest.push({ ...script, file: null, omittedReason: 'Script-source time budget reached; metadata was retained.' });
  }
  for (const script of allCurrentScriptEntries.slice(1000)) {
    scriptManifest.push({ ...script, file: null, omittedReason: 'Single-page script-source boundary reached; metadata was retained.' });
  }
  const maxScriptCheckpointsComplete = capture.options.mode !== 'entire' || (
    capture.runtimeCheckpoints.length > 0 &&
    capture.runtimeCheckpoints.every((checkpoint) => !checkpoint.stopReason && checkpoint.omittedScripts === 0) &&
    capture.scriptSourceManifest.every((script) => Boolean(script.file) && !script.omittedReason)
  );
  addJson(files, 'forensics/scripts/manifest.json', {
    scripts: scriptManifest,
    totalCapturedBytes: totalScriptBytes,
    totalObservedScripts: capture.totalObservedScripts,
    scriptMetadataDrops: capture.scriptMetadataDrops,
    uniqueCapturedSources: capture.options.mode === 'entire' ? capture.scriptSourceIndex.size : scriptManifest.filter((script) => script.file).length,
    runtimeCheckpoints: capture.options.mode === 'entire' ? capture.runtimeCheckpoints : undefined,
    omittedScripts: scriptManifest.filter((script) => !script.file || script.omittedReason).length,
    complete: capture.options.mode === 'entire' ? maxScriptCheckpointsComplete : !scriptStopReason && allCurrentScriptEntries.length <= 1000 && scriptManifest.every((script) => Boolean(script.file) && !script.omittedReason),
    stopReason: capture.options.mode === 'entire'
      ? (maxScriptCheckpointsComplete ? null : 'one-or-more-runtime-checkpoints-incomplete')
      : scriptStopReason || (allCurrentScriptEntries.length > 1000 ? 'script-limit-reached' : null),
    timeBudgetMs: capture.options.mode === 'entire' ? undefined : FINAL_SCRIPT_CAPTURE_BUDGET_MS,
    elapsedMs: capture.options.mode === 'entire' ? undefined : Date.now() - scriptStageStartedAt
  });
  if (scriptStopReason === 'time-budget-reached') {
    capture.warnings.push(`Script-source collection: ${Math.round(FINAL_SCRIPT_CAPTURE_BUDGET_MS / 1000)}s time budget reached after ${processedScripts}/${scriptEntries.length} selected scripts; metadata for the rest was retained.`);
    sendProgress(`Script-source time limit reached at ${processedScripts}/${scriptEntries.length}; continuing…`, 72);
  }
  addJson(files, 'forensics/source_analysis_manifest.json', {
    limits: { maxFiles: MAX_SOURCE_ANALYSIS_FILES, maxFileBytes: MAX_SOURCE_ANALYSIS_FILE_BYTES, maxTotalInputBytes: MAX_SOURCE_ANALYSIS_INPUT_BYTES },
    analyzedInputBytes: capture.sourceAnalysisInputBytes,
    entries: capture.sourceAnalysisManifest
  });
  addJson(files, 'forensics/wasm/manifest.json', {
    limits: { maxModuleBytes: MAX_WASM_WAT_INPUT_BYTES, maxTotalInputBytes: MAX_WASM_WAT_TOTAL_BYTES },
    convertedInputBytes: capture.wasmWatInputBytes,
    entries: capture.wasmWatManifest
  });
  await captureSourceMaps(capture, files, scriptManifest);

  const targetManifest = [];
  for (const [sessionId, target] of capture.childTargets) {
    const targetPath = `forensics/targets/${cleanFilePart(target.type || 'target')}_${cleanFilePart(target.targetId || sessionId)}`;
    const entry = { ...target, files: [] };
    if (target.attached && ['iframe', 'page'].includes(target.type)) {
      const snapshot = await bestEffort(
        () => cdpSession(capture.tabId, sessionId, 'DOMSnapshot.captureSnapshot', { computedStyles: COMPUTED_SNAPSHOT_STYLES, includePaintOrder: true, includeDOMRects: true }),
        capture.warnings,
        `child target ${target.targetId} DOM snapshot`
      );
      if (snapshot) {
        addJson(files, `${targetPath}/dom_snapshot.json`, sanitizeDomSnapshot(snapshot));
        entry.files.push(`${targetPath}/dom_snapshot.json`);
      }
      const accessibility = await bestEffort(
        () => cdpSession(capture.tabId, sessionId, 'Accessibility.getFullAXTree'),
        capture.warnings,
        `child target ${target.targetId} accessibility`
      );
      if (accessibility) {
        addJson(files, `${targetPath}/accessibility_tree.json`, sanitizeAccessibilityTree(accessibility));
        entry.files.push(`${targetPath}/accessibility_tree.json`);
      }
    }
    targetManifest.push(entry);
  }
  addJson(files, 'forensics/targets/manifest.json', targetManifest);
  await files.flush?.();
}

async function captureSourceMaps(capture, files, scriptManifest) {
  const startedAt = Date.now();
  const sourceMapBudgetMs = unlimitedAwareStageBudget(capture, SOURCE_MAP_CAPTURE_BUDGET_MS);
  const deadline = startedAt + sourceMapBudgetMs;
  const candidates = [...new Map(scriptManifest
    .filter((script) => script.sourceMapURL)
    .map((script) => [`${script.url || ''}|${script.sourceMapURL}`, {
      scriptUrl: script.url || capture.originalUrl,
      sourceMapURL: script.sourceMapURL
    }])).values()].slice(0, 40);
  if (!candidates.length) {
    addJson(files, 'forensics/source_maps/manifest.json', {
      advertised: 0,
      captured: 0,
      reconstructedFiles: 0,
      reconstructedBytes: 0,
      limits: { maxFiles: MAX_RECONSTRUCTED_SOURCE_FILES, maxBytes: MAX_RECONSTRUCTED_SOURCE_BYTES },
      entries: []
    });
    return;
  }
  const entries = [];
  let retrievedBytes = 0;
  let processedCandidates = 0;
  let stopReason = null;
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
    if (Date.now() >= deadline) {
      stopReason = 'time-budget-reached';
      break;
    }
    const candidate = candidates[candidateIndex];
    let item = null;
    const remainingBytes = 50 * 1024 * 1024 - retrievedBytes;
    if (remainingBytes <= 0) item = { ...candidate, omitted: true, reason: 'Source-map total-byte stability boundary reached.' };
    else {
      const results = await bestEffort(
        () => withOperationTimeout(chrome.scripting.executeScript({
          target: { tabId: capture.tabId },
          func: async (sourceMap, maximumBytes) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 8_000);
            try {
              const url = new URL(sourceMap.sourceMapURL, sourceMap.scriptUrl || location.href).href;
              const response = await fetch(url, { credentials: 'include', cache: 'force-cache', signal: controller.signal });
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              const announced = Number(response.headers.get('content-length'));
              if (Number.isFinite(announced) && announced > maximumBytes) return { ...sourceMap, url, omitted: true, reason: `Source map declared ${announced} bytes; ${maximumBytes} bytes remained.` };
              const reader = response.body?.getReader?.();
              let bytes;
              if (reader) {
                const chunks = [];
                let total = 0;
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  if (total + value.byteLength > maximumBytes) {
                    await reader.cancel('Source-map byte boundary reached.').catch(() => {});
                    return { ...sourceMap, url, omitted: true, reason: `Source map exceeded the remaining ${maximumBytes}-byte boundary.` };
                  }
                  chunks.push(value);
                  total += value.byteLength;
                }
                bytes = new Uint8Array(total);
                let offset = 0;
                for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
              } else {
                bytes = new Uint8Array(await response.arrayBuffer());
                if (bytes.byteLength > maximumBytes) return { ...sourceMap, url, omitted: true, reason: `Source map exceeded the remaining ${maximumBytes}-byte boundary.` };
              }
              return { ...sourceMap, url, text: new TextDecoder().decode(bytes), byteLength: bytes.byteLength };
            } catch (error) {
              return { ...sourceMap, omitted: true, reason: error?.message || String(error) };
            } finally {
              clearTimeout(timer);
            }
          },
          args: [candidate, Math.min(10 * 1024 * 1024, remainingBytes)]
        }), 'Source-map retrieval', remainingStageTimeout(deadline, 10_000)),
        capture.warnings,
        'source-map retrieval'
      );
      item = results?.[0]?.result || { ...candidate, omitted: true, reason: 'Chrome returned no source-map result.' };
    }
    if (item.byteLength) retrievedBytes += item.byteLength;
    const entry = { ...item };
    delete entry.text;
    if (item.text !== undefined) {
      const file = `forensics/source_maps/${String(entries.length).padStart(3, '0')}_${cleanFilePart(item.url?.split('/').pop() || 'source.map')}.map`;
      addText(files, file, sanitizeTextBody(item.text, 'application/json'));
      entry.file = file;
      entry.reconstructedSources = [];
      try {
        const mapText = item.text.replace(/^\)\]\}'[^\n]*\n?/, '');
        const parsed = JSON.parse(mapText);
        const sources = Array.isArray(parsed.sources) ? parsed.sources : [];
        const sourcesContent = Array.isArray(parsed.sourcesContent) ? parsed.sourcesContent : [];
        entry.parsed = {
          version: parsed.version,
          file: parsed.file || null,
          sourceRoot: parsed.sourceRoot || null,
          sourceCount: sources.length,
          embeddedSourceCount: sourcesContent.filter((content) => typeof content === 'string').length,
          nameCount: Array.isArray(parsed.names) ? parsed.names.length : 0,
          mappingsCharacters: typeof parsed.mappings === 'string' ? parsed.mappings.length : 0
        };
        for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
          const sourceName = String(sources[sourceIndex] || `source-${sourceIndex}.js`);
          const content = sourcesContent[sourceIndex];
          const sourceEntry = { sourceIndex, source: sanitizeTextBody(sourceName, 'text/plain'), file: null, omittedReason: null };
          if (typeof content !== 'string') sourceEntry.omittedReason = 'The source map did not embed sourcesContent for this source.';
          else {
            const sourceBytes = new TextEncoder().encode(content).length;
            sourceEntry.byteLength = sourceBytes;
            if (capture.reconstructedSourceFiles >= MAX_RECONSTRUCTED_SOURCE_FILES) sourceEntry.omittedReason = 'Reconstructed-source file-count stability boundary reached.';
            else if (capture.reconstructedSourceBytes + sourceBytes > MAX_RECONSTRUCTED_SOURCE_BYTES) sourceEntry.omittedReason = 'Reconstructed-source byte stability boundary reached.';
            else {
              const safeSegments = sourceName.replace(/^[a-z]+:\/\//i, '').split(/[\\/]+/).filter((segment) => segment && segment !== '.' && segment !== '..').map((segment) => cleanFilePart(segment, 'source'));
              const leafPath = safeSegments.join('/') || `source-${sourceIndex}.js`;
              const reconstructedFile = `forensics/reconstructed_sources/map_${String(entries.length).padStart(3, '0')}/${String(sourceIndex).padStart(5, '0')}_${leafPath}`;
              addText(files, reconstructedFile, sanitizeTextBody(content, 'application/javascript'));
              sourceEntry.file = reconstructedFile;
              capture.reconstructedSourceFiles += 1;
              capture.reconstructedSourceBytes += sourceBytes;
            }
          }
          entry.reconstructedSources.push(sourceEntry);
        }
      } catch (error) {
        entry.parseError = error?.message || String(error);
      }
    }
    entries.push(entry);
    processedCandidates = candidateIndex + 1;
    await sleep(0);
  }
  for (const candidate of candidates.slice(processedCandidates)) {
    entries.push({ ...candidate, omitted: true, reason: 'Source-map time budget reached.' });
  }
  if (processedCandidates < candidates.length) {
    stopReason = 'time-budget-reached';
    capture.warnings.push(`Source-map capture: ${Math.round(sourceMapBudgetMs / 1000)}s time budget reached after ${processedCandidates}/${candidates.length} maps; continuing.`);
  }
  addJson(files, 'forensics/source_maps/manifest.json', {
    advertised: candidates.length,
    captured: entries.filter((entry) => entry.file).length,
    reconstructedFiles: capture.reconstructedSourceFiles,
    reconstructedBytes: capture.reconstructedSourceBytes,
    complete: processedCandidates === candidates.length,
    stopReason,
    timeBudgetMs: sourceMapBudgetMs,
    elapsedMs: Date.now() - startedAt,
    limits: { maxFiles: MAX_RECONSTRUCTED_SOURCE_FILES, maxBytes: MAX_RECONSTRUCTED_SOURCE_BYTES },
    entries
  });
}

async function captureScriptedPage(capture, prefix, files, warnings) {
  const tabId = capture.tabId;
  const elementChunkSize = capture.options.mode === 'quick' ? 2000 : 750;
  const baseOptions = {
    forensicMode: capture.options.forensicMode,
    quickStyleMode: capture.options.mode === 'quick',
    includeApplicationContents: !(capture.options.mode === 'entire' && (capture.currentPageIndex || 0) > 0),
    maxAppRecords: 5000,
    maxAppBytes: Math.min(25 * 1024 * 1024, capture.options.maxBodyBytes * 3),
    maxCanvasSnapshotPixels: 4_000_000,
    maxCanvasSnapshotCharacters: 12_000_000
  };
  const discoveredFrames = await bestEffort(
    () => withOperationTimeout(chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => true }), `${prefix} frame discovery`, 15_000),
    warnings,
    `${prefix} frame discovery`
  );
  const frameIds = [...new Set((discoveredFrames || []).map((frame) => frame.frameId).filter(Number.isInteger))];
  if (!frameIds.includes(0)) frameIds.unshift(0);
  const frameTarget = (frameId) => ({ tabId, frameIds: [frameId] });
  const setExtractorOptions = async (options, label, frameId) => bestEffort(
    () => withOperationTimeout(chrome.scripting.executeScript({
      target: frameTarget(frameId),
      func: (captureOptions) => { globalThis.__PAGE_MIRROR_OPTIONS__ = captureOptions; },
      args: [{ ...baseOptions, ...options }]
    }), label, 20_000),
    warnings,
    label
  );
  const runExtractor = async (label, timeoutMs, frameId) => bestEffort(
    () => withOperationTimeout(
      chrome.scripting.executeScript({ target: frameTarget(frameId), files: ['page_extractor.js'] }),
      label,
      timeoutMs
    ),
    warnings,
    label
  );
  const frameStates = new Map();
  let elementStart = 0;
  let maximumElementCount = Number.POSITIVE_INFINITY;
  let elementChunkIndex = 0;

  // Complete element geometry and computed styles used to be returned as one
  // renderer-sized object for every frame. Complex animated pages could exhaust
  // the renderer while Chrome copied that value to the extension. Read bounded
  // chunks instead, stage each one immediately, then release it before continuing.
  while (elementStart < maximumElementCount) {
    throwIfCancelled(capture);
    let observedMaximum = 0;
    let mainFrameChunkCaptured = false;
    for (const frameId of frameIds) {
      await setExtractorOptions({ extractorPhase: 'elements', elementChunkStart: elementStart, elementChunkLimit: elementChunkSize }, `${prefix} frame ${frameId} element chunk ${elementChunkIndex + 1} setup`, frameId);
      let chunkResults = await runExtractor(`${prefix} frame ${frameId} element/computed-style chunk ${elementChunkIndex + 1}`, 90_000, frameId);
      if (!chunkResults) {
        const health = await probeTargetRenderer(capture);
        if (!health.healthy) throw new Error(`The target page renderer stopped responding during bounded element extraction (${health.reason}).`);
        if (frameId === 0) throw new Error(`${prefix} main-frame element chunk ${elementChunkIndex + 1} was unavailable even though the renderer remained reachable; the page was rejected instead of being marked as a shallow capture.`);
        warnings.push(`${prefix} child frame ${frameId} element chunk ${elementChunkIndex + 1} was unavailable; continuing with the complete main frame.`);
        continue;
      }
      for (const frame of chunkResults) {
      const snapshot = frame.result;
      if (!snapshot || snapshot.extractorPhase !== 'elements') {
        warnings.push(`${prefix} frame ${frame.frameId}: element chunk ${elementChunkIndex + 1} returned no usable result.`);
        continue;
      }
      const framePath = frame.frameId === 0 ? `${prefix}/main_frame` : `${prefix}/frames/frame_${frame.frameId}`;
      const state = frameStates.get(frame.frameId) || {
        frameId: frame.frameId,
        framePath,
        totalElements: 0,
        capturedElements: 0,
        chunks: [],
        shadowRootChunks: [],
        complete: false,
        textParts: [],
        designTokenCounts: { colors: new Map(), typography: new Map(), borderRadii: new Map(), shadows: new Map() }
      };
      state.totalElements = Math.max(state.totalElements, Number(snapshot.totalElements) || 0);
      observedMaximum = Math.max(observedMaximum, state.totalElements);
      const recordsPath = `${framePath}/elements_computed/chunk_${String(elementChunkIndex).padStart(4, '0')}.jsonl`;
      const stylesPath = `${framePath}/computed_styles/chunk_${String(elementChunkIndex).padStart(4, '0')}.json`;
      for (const record of snapshot.elements || []) record.computedStyleDictionary = stylesPath;
      if ((snapshot.elements || []).length) {
        await files.stageJsonLines(recordsPath, snapshot.elements);
        addJson(files, stylesPath, snapshot.computedStyles || []);
        state.textParts.push(...snapshot.elements.map((item) => item.directText).filter(Boolean));
        state.capturedElements += snapshot.elements.length;
        state.chunks.push({ index: elementChunkIndex, records: recordsPath, computedStyles: stylesPath, entries: snapshot.elements.length, rangeStart: snapshot.rangeStart, rangeEnd: snapshot.rangeEnd });
      }
      if ((snapshot.openShadowRoots || []).length) {
        const shadowRootsPath = `${framePath}/open_shadow_roots/chunk_${String(elementChunkIndex).padStart(4, '0')}.json`;
        addJson(files, shadowRootsPath, snapshot.openShadowRoots);
        state.shadowRootChunks.push({ file: shadowRootsPath, entries: snapshot.openShadowRoots.length });
      }
      for (const category of Object.keys(state.designTokenCounts)) {
        for (const item of snapshot.designTokens?.[category] || []) {
          state.designTokenCounts[category].set(item.value, (state.designTokenCounts[category].get(item.value) || 0) + (Number(item.count) || 0));
        }
      }
      state.complete = Boolean(snapshot.complete);
      frameStates.set(frame.frameId, state);
      if (frame.frameId === 0) mainFrameChunkCaptured = true;
      frame.result = null;
      }
      chunkResults.length = 0;
      chunkResults = null;
      await files.flush?.();
    }
    if (!mainFrameChunkCaptured) throw new Error(`${prefix} main-frame element chunk ${elementChunkIndex + 1} returned no usable result.`);
    maximumElementCount = Math.max(0, observedMaximum);
    elementStart += elementChunkSize;
    elementChunkIndex += 1;
    if (maximumElementCount > elementChunkSize && elementStart < maximumElementCount) {
      sendProgress(`Reading elements and computed stylesâ€¦ ${Math.min(elementStart, maximumElementCount)}/${maximumElementCount}`, capture.lastProgress || null);
    }
    if (observedMaximum === 0 || elementStart >= maximumElementCount) break;
    if (elementChunkIndex % 5 === 0) {
      appendActivityLog(`Memory checkpoint: staged ${elementStart}/${maximumElementCount} element records in bounded chunks; released renderer results before continuing.`, capture.lastProgress || null, 'info', capture);
      await sleep(0);
    }
  }

  for (const state of frameStates.values()) {
    addJson(files, `${state.framePath}/elements_computed_manifest.json`, {
      format: 'chunked-jsonl-with-per-chunk-computed-style-dictionaries',
      totalElements: state.totalElements,
      capturedElements: state.capturedElements,
      complete: state.complete && state.capturedElements >= state.totalElements,
      computedStyleScope: capture.options.mode === 'quick' ? 'layout-and-visual-critical-properties' : 'all-browser-exposed-properties',
      chunkSize: elementChunkSize,
      chunks: state.chunks,
      shadowRoots: { format: 'chunked-json', chunks: state.shadowRootChunks, entries: state.shadowRootChunks.reduce((sum, chunk) => sum + chunk.entries, 0) }
    });
    addText(files, `${state.framePath}/visible_text.txt`, state.textParts.join('\n'));
    addJson(files, `${state.framePath}/design_tokens.json`, Object.fromEntries(Object.entries(state.designTokenCounts).map(([category, counts]) => [
      category,
      [...counts.entries()].sort((left, right) => right[1] - left[1]).map(([value, count]) => ({ value, count }))
    ])));
    state.textParts.length = 0;
    state.designTokenCounts = null;
  }
  await files.flush?.();
  const mainFrameState = frameStates.get(0);
  if (!mainFrameState || !mainFrameState.complete || mainFrameState.capturedElements < mainFrameState.totalElements) {
    throw new Error(`${prefix} main-frame element/style extraction was incomplete; the page was rejected instead of being emitted as a shallow capture.`);
  }

  let mainFrameDocumentCaptured = false;
  for (const frameId of frameIds) {
    await setExtractorOptions({ extractorPhase: 'document' }, `${prefix} frame ${frameId} document evidence setup`, frameId);
    let results = await runExtractor(`${prefix} frame ${frameId} bounded document evidence`, 120_000, frameId);
    if (!results) {
      const health = await probeTargetRenderer(capture);
      if (!health.healthy) throw new Error(`The target page renderer stopped responding during document evidence extraction (${health.reason}).`);
      if (frameId === 0) throw new Error(`${prefix} main-frame document evidence was unavailable even though the renderer remained reachable; the page was rejected instead of being marked as a shallow capture.`);
      warnings.push(`${prefix} child frame ${frameId} document evidence was unavailable; continuing with the complete main frame.`);
      continue;
    }
    for (const frame of results) {
    let snapshot = frame.result;
    if (!snapshot) {
      warnings.push(`${prefix} frame ${frame.frameId}: no document snapshot was returned.`);
      continue;
    }
    const framePath = frame.frameId === 0 ? `${prefix}/main_frame` : `${prefix}/frames/frame_${frame.frameId}`;
    addText(files, `${framePath}/rendered_dom.html`, snapshot.renderedHtml);
    snapshot.renderedHtml = null;
    await files.flush?.();
    await addDeduplicatedJson(files, `${framePath}/stylesheets.json`, snapshot.styleSheets, 'stylesheets');
    snapshot.styleSheets = null;
    await files.flush?.();
    addJson(files, `${framePath}/css_intelligence.json`, snapshot.cssIntelligence || null);
    addJson(files, `${framePath}/open_shadow_roots_document.json`, snapshot.openShadowRoots || []);
    const storageEvidence = await exactJsonValueOrReference(files, snapshot.storage, 'web-storage-snapshot', `${framePath}/state.json#/storage`);
    addJson(files, `${framePath}/state.json`, {
      meta: snapshot.meta,
      formState: snapshot.formState,
      mediaState: snapshot.mediaState,
      animationState: snapshot.animationState,
      storage: storageEvidence,
      applicationState: snapshot.applicationState,
      documentStructure: snapshot.documentStructure
    });
    snapshot.applicationState = null;
    snapshot.storage = null;
    await files.flush?.();
    addJson(files, `${framePath}/security_metadata.json`, snapshot.securityMetadata || { policy: { csrfValuesIncluded: false, passwordValuesIncluded: false }, csrfFields: [], passwordFields: [] });
    addJson(files, `${framePath}/hardware_profile.json`, snapshot.hardwareProfile || null);
    addJson(files, `${framePath}/extractor_diagnostics.json`, { ...(snapshot.extractorDiagnostics || {}), elementCapture: frameStates.get(frame.frameId) || null, rendererSafePhases: true });
    addJson(files, `${framePath}/resource_timing.json`, snapshot.resources);
    addJson(files, `${framePath}/document_intelligence.json`, snapshot.documentIntelligence || null);
    addJson(files, `${framePath}/performance_intelligence.json`, snapshot.performanceIntelligence || null);
    addJson(files, `${framePath}/navigation_intelligence.json`, snapshot.navigationIntelligence || null);
    addJson(files, `${framePath}/policy_intelligence.json`, snapshot.policyIntelligence || null);
    addJson(files, `${framePath}/framework_bootstrap_intelligence.json`, snapshot.frameworkBootstrapIntelligence || null);
    if (!files.has(`${framePath}/design_tokens.json`)) addJson(files, `${framePath}/design_tokens.json`, snapshot.designTokens || null);
    const canvasManifest = [];
    for (let index = 0; index < (snapshot.canvasState || []).length; index += 1) {
      const canvas = snapshot.canvasState[index];
      if (canvas.dataUrl?.startsWith('data:image/png;base64,')) {
        const path = `${framePath}/canvas/canvas_${String(index).padStart(3, '0')}.png`;
        addBase64(files, path, canvas.dataUrl.slice('data:image/png;base64,'.length));
        canvasManifest.push({ ...canvas, dataUrl: undefined, file: path });
      } else {
        canvasManifest.push({ ...canvas, dataUrl: undefined });
      }
    }
    snapshot.canvasState = null;
    addJson(files, `${framePath}/canvas/manifest.json`, canvasManifest);
    await files.flush?.();
    frame.result = null;
    snapshot = null;
    if (frame.frameId === 0) mainFrameDocumentCaptured = true;
    }
    results.length = 0;
    results = null;
  }
  if (!mainFrameDocumentCaptured) {
    throw new Error(`${prefix} main-frame document evidence was unavailable; the page was rejected instead of being emitted as a shallow capture.`);
  }
}

let cachedPageInstrumentationSource = null;

async function loadPageInstrumentationSource() {
  if (cachedPageInstrumentationSource) return cachedPageInstrumentationSource;
  const response = await fetch(chrome.runtime.getURL('page_instrumentation.js'));
  if (!response.ok) throw new Error(`Instrumentation source returned HTTP ${response.status}.`);
  cachedPageInstrumentationSource = `${await response.text()}\n//# sourceURL=let-me-see-code://page-instrumentation.js`;
  return cachedPageInstrumentationSource;
}

async function installPageInstrumentation(capture) {
  const source = await loadPageInstrumentationSource();
  capture.instrumentationSource = source;
  const installed = await cdp(capture.tabId, 'Page.addScriptToEvaluateOnNewDocument', { source }).catch((error) => {
    capture.warnings.push(`Early page instrumentation unavailable: ${error?.message || String(error)}`);
    return null;
  });
  capture.instrumentationIdentifier = installed?.identifier || null;
  await executeScript({
    target: { tabId: capture.tabId, allFrames: true },
    world: 'MAIN',
    files: ['page_instrumentation.js']
  }, 'Current-state page instrumentation', 30_000).catch((error) => capture.warnings.push(`Current-state page instrumentation unavailable: ${error?.message || String(error)}`));
}

async function captureLiveInstrumentation(capture, files, prefix) {
  if (capture.instrumentationCapturedPrefixes.has(prefix)) return;
  capture.instrumentationCapturedPrefixes.add(prefix);
  const results = await bestEffort(
    () => executeScript({
      target: { tabId: capture.tabId, allFrames: true },
      world: 'MAIN',
      func: () => {
        const value = globalThis.__LET_ME_SEE_CODE_INSTRUMENTATION__;
        return value ? JSON.parse(JSON.stringify(value)) : null;
      }
    }, `${prefix} live instrumentation script`),
    capture.warnings,
    `${prefix} live instrumentation`
  );
  if (!results) return;
  for (const frame of results) {
    if (!frame.result) continue;
    const state = frame.result;
    const cursorKey = `${frame.frameId}:${state.startedAt || 'unknown'}`;
    const previousCursor = capture.instrumentationCursors.get(cursorKey) || { rtc: 0, graphics: 0, audio: 0, audioConnections: 0, audioParameters: 0, performance: {} };
    const allRtcEvents = state.webrtc?.events || [];
    const allGraphicsEvents = state.graphics?.events || [];
    const allAudioEvents = state.audio?.events || [];
    const allAudioConnections = state.audio?.connections || [];
    const allAudioParameterEvents = state.audio?.parameterEvents || [];
    if (state.webrtc) state.webrtc.events = allRtcEvents.slice(previousCursor.rtc);
    if (state.graphics) state.graphics.events = allGraphicsEvents.slice(previousCursor.graphics);
    if (state.audio) {
      state.audio.events = allAudioEvents.slice(previousCursor.audio);
      state.audio.connections = allAudioConnections.slice(previousCursor.audioConnections);
      state.audio.parameterEvents = allAudioParameterEvents.slice(previousCursor.audioParameters);
    }
    const performanceTotals = {};
    for (const [type, entries] of Object.entries(state.performance?.entries || {})) {
      const previous = previousCursor.performance?.[type] || 0;
      performanceTotals[type] = entries.length;
      state.performance.entries[type] = entries.slice(previous);
    }
    state.snapshot = {
      mode: previousCursor.rtc || previousCursor.graphics || previousCursor.audio || previousCursor.audioConnections || previousCursor.audioParameters || Object.values(previousCursor.performance || {}).some(Boolean) ? 'delta-events-with-current-aggregates' : 'initial',
      previousRtcEventCount: previousCursor.rtc,
      previousGraphicsEventCount: previousCursor.graphics,
      totalRtcEventCount: allRtcEvents.length,
      totalGraphicsEventCount: allGraphicsEvents.length,
      previousAudioEventCount: previousCursor.audio,
      totalAudioEventCount: allAudioEvents.length,
      previousAudioConnectionCount: previousCursor.audioConnections,
      totalAudioConnectionCount: allAudioConnections.length,
      previousAudioParameterEventCount: previousCursor.audioParameters,
      totalAudioParameterEventCount: allAudioParameterEvents.length,
      previousPerformanceEntryCounts: previousCursor.performance || {},
      totalPerformanceEntryCounts: performanceTotals
    };
    capture.instrumentationCursors.set(cursorKey, {
      rtc: allRtcEvents.length,
      graphics: allGraphicsEvents.length,
      audio: allAudioEvents.length,
      audioConnections: allAudioConnections.length,
      audioParameters: allAudioParameterEvents.length,
      performance: performanceTotals
    });
    for (const event of state.webrtc?.events || []) {
      if (event.payload?.text !== undefined) event.payload.text = sanitizeTextBody(event.payload.text, 'webrtc-datachannel');
      if (event.label !== undefined) event.label = sanitizeTextBody(event.label, 'text/plain');
      if (event.protocol !== undefined) event.protocol = sanitizeTextBody(event.protocol, 'text/plain');
    }
    const instrumentationFile = `${prefix}/forensics/live_instrumentation_frame_${frame.frameId}.json`;
    addJson(files, instrumentationFile, state);
    if (state.audio) {
      capture.audioEvidenceSummary ||= { snapshots: 0, mediaElementSnapshots: 0, webAudioGraphSnapshots: 0 };
      capture.audioEvidenceSummary.snapshots += 1;
      if (Object.keys(state.audio.mediaElements || {}).length > 0) capture.audioEvidenceSummary.mediaElementSnapshots += 1;
      if (
        (state.audio.contexts?.length || 0) > 0 ||
        (state.audio.nodes?.length || 0) > 0 ||
        (state.audio.connections?.length || 0) > 0 ||
        (state.audio.parameterEvents?.length || 0) > 0 ||
        Object.keys(state.audio.analyserReads || {}).length > 0
      ) capture.audioEvidenceSummary.webAudioGraphSnapshots += 1;
      addJson(files, `${prefix}/forensics/audio/frame_${frame.frameId}.json`, {
        schemaVersion: 1,
        source: instrumentationFile,
        privacy: state.audio.privacy,
        webAudioAvailable: state.audio.webAudioAvailable,
        contexts: state.audio.contexts,
        nodes: state.audio.nodes,
        newConnections: state.audio.connections,
        newParameterEvents: state.audio.parameterEvents,
        newEvents: state.audio.events,
        analyserReads: state.audio.analyserReads,
        workletModules: state.audio.workletModules,
        mediaElements: state.audio.mediaElements,
        dropped: {
          events: state.audio.droppedEvents,
          connections: state.audio.droppedConnections,
          parameterEvents: state.audio.droppedParameterEvents
        },
        rawAudioSamplesCaptured: false,
        microphoneInputCaptured: false
      });
    }
  }
}

async function captureCookieMetadata(capture, files, prefix) {
  if (capture.cookieMetadataPrefixes.has(prefix)) return;
  capture.cookieMetadataPrefixes.add(prefix);
  const currentUrl = capture.currentPageUrl || capture.originalUrl;
  const result = await bestEffort(
    () => cdp(capture.tabId, 'Network.getCookies', { urls: [currentUrl] }),
    capture.warnings,
    `${prefix} cookie metadata`
  );
  const cookies = (result?.cookies || []).map((cookie) => ({
    name: cookie.name,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expires,
    size: cookie.size,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    session: cookie.session,
    sameSite: cookie.sameSite || null,
    priority: cookie.priority || null,
    sameParty: cookie.sameParty ?? null,
    sourceScheme: cookie.sourceScheme || null,
    sourcePort: cookie.sourcePort ?? null,
    partitionKey: cookie.partitionKey || null
  }));
  addJson(files, `${prefix}/forensics/cookie_metadata.json`, {
    url: sanitizedUrl(currentUrl),
    valuesIncluded: false,
    count: cookies.length,
    cookies
  });
}

async function listOpfsFiles(capture, prefix) {
  const results = await executeScript({
    target: { tabId: capture.tabId },
    func: async () => {
      const output = { available: false, entries: [], truncated: false, error: null };
      try {
        const root = await navigator.storage?.getDirectory?.();
        if (!root) return output;
        output.available = true;
        const walk = async (directory, path = '', depth = 0) => {
          if (depth > 12 || output.entries.length >= 5000) { output.truncated = true; return; }
          for await (const [name, handle] of directory.entries()) {
            if (output.entries.length >= 5000) { output.truncated = true; break; }
            const entryPath = path ? `${path}/${name}` : name;
            if (handle.kind === 'file') {
              try {
                const file = await handle.getFile();
                output.entries.push({ path: entryPath, kind: 'file', size: file.size, type: file.type, lastModified: file.lastModified });
              } catch (error) {
                output.entries.push({ path: entryPath, kind: 'file', unreadable: true, error: error?.message || String(error) });
              }
            } else {
              output.entries.push({ path: entryPath, kind: 'directory' });
              await walk(handle, entryPath, depth + 1);
            }
          }
        };
        await walk(root);
      } catch (error) { output.error = error?.message || String(error); }
      return output;
    }
  }, `${prefix} OPFS listing script`, 30_000);
  return results?.[0]?.result || { available: false, entries: [], truncated: false, error: 'No main-frame result.' };
}

async function readOpfsBatch(capture, paths, prefix) {
  const results = await executeScript({
    target: { tabId: capture.tabId },
    func: async (requestedPaths, perFileLimit) => {
      const bytesToBase64 = (bytes) => {
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 0x8000)));
        }
        return btoa(binary);
      };
      const output = [];
      try {
        const root = await navigator.storage.getDirectory();
        for (const path of requestedPaths) {
          try {
            const segments = path.split('/').filter(Boolean);
            let directory = root;
            for (const segment of segments.slice(0, -1)) directory = await directory.getDirectoryHandle(segment);
            const handle = await directory.getFileHandle(segments.at(-1));
            const file = await handle.getFile();
            if (file.size > perFileLimit) {
              output.push({ path, omitted: true, reason: `File exceeded ${perFileLimit} bytes.` });
              continue;
            }
            const bytes = new Uint8Array(await file.arrayBuffer());
            output.push({ path, size: bytes.byteLength, type: file.type, lastModified: file.lastModified, base64: bytesToBase64(bytes) });
          } catch (error) {
            output.push({ path, omitted: true, reason: error?.message || String(error) });
          }
        }
      } catch (error) {
        return requestedPaths.map((path) => ({ path, omitted: true, reason: error?.message || String(error) }));
      }
      return output;
    },
    args: [paths, MAX_OPFS_FILE_BYTES]
  }, `${prefix} OPFS content script`, 30_000);
  return results?.[0]?.result || [];
}

async function captureOpfsContents(capture, files, prefix) {
  if (!capture.options.forensicMode) return;
  const startedAt = Date.now();
  const opfsBudgetMs = unlimitedAwareStageBudget(capture, 30_000);
  const deadline = startedAt + opfsBudgetMs;
  let origin;
  try { origin = new URL(capture.currentPageUrl || capture.originalUrl).origin; } catch { return; }
  const existing = capture.opfsOrigins.get(origin);
  if (existing) {
    addJson(files, `${prefix}/forensics/opfs/manifest.json`, { origin, reusedFrom: existing, valuesStoredAtOriginalPath: true });
    return;
  }
  const manifestPath = `${prefix}/forensics/opfs/manifest.json`;
  capture.opfsOrigins.set(origin, manifestPath);
  const listing = await bestEffort(() => withOperationTimeout(listOpfsFiles(capture, prefix), `${prefix} OPFS listing`, 10_000), capture.warnings, `${prefix} OPFS listing`);
  if (!listing) {
    addJson(files, manifestPath, { origin, available: false, error: 'OPFS listing failed; see WARNINGS.json.', entries: [] });
    return;
  }
  const candidates = listing.entries.filter((entry) => entry.kind === 'file');
  const selected = [];
  const entries = listing.entries.map((entry) => ({ ...entry }));
  let plannedBytes = 0;
  let plannedFiles = 0;
  for (const entry of entries) {
    if (entry.kind !== 'file' || entry.unreadable) continue;
    if (plannedFiles >= MAX_OPFS_FILES) { entry.contentOmitted = 'OPFS file-count stability boundary reached.'; continue; }
    if (entry.size > MAX_OPFS_FILE_BYTES) { entry.contentOmitted = 'File exceeded the per-file OPFS content limit.'; continue; }
    if (plannedBytes + entry.size > MAX_OPFS_ORIGIN_BYTES) { entry.contentOmitted = 'Origin OPFS content-byte stability boundary reached.'; continue; }
    selected.push(entry);
    plannedFiles += 1;
    plannedBytes += entry.size;
  }

  const batches = [];
  let batch = [];
  let batchBytes = 0;
  for (const entry of selected) {
    if (batch.length && batchBytes + entry.size > 2 * 1024 * 1024) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(entry);
    batchBytes += entry.size;
  }
  if (batch.length) batches.push(batch);

  let capturedBytes = 0;
  let capturedFiles = 0;
  let stopReason = null;
  for (const group of batches) {
    throwIfCancelled(capture);
    if (Date.now() >= deadline) { stopReason = 'time-budget-reached'; break; }
    const captured = await bestEffort(
      () => withOperationTimeout(readOpfsBatch(capture, group.map((entry) => entry.path), prefix), `${prefix} OPFS content batch`, remainingStageTimeout(deadline, 10_000)),
      capture.warnings,
      `${prefix} OPFS content batch`
    );
    for (const item of captured || []) {
      const metadata = entries.find((entry) => entry.path === item.path);
      if (!metadata) continue;
      if (item.omitted || !item.base64) { metadata.contentOmitted = item.reason || 'No bytes returned.'; continue; }
      const extension = item.path.split('.').pop()?.toLowerCase() || '';
      const textual = /text|json|javascript|xml|svg|css|html|graphql/i.test(item.type || '') || /^(?:txt|json|js|mjs|cjs|ts|tsx|jsx|css|html|htm|xml|svg|md|csv|yaml|yml|toml|ini|log)$/i.test(extension);
      const archiveLeaf = item.path.split('/').slice(-6).map((segment) => cleanFilePart(segment, 'entry').slice(0, 40)).join('/');
      const filePath = `${prefix}/forensics/opfs/files/${String(capturedFiles).padStart(4, '0')}_${archiveLeaf}`;
      if (textual) {
        const text = new TextDecoder().decode(base64ToBytes(item.base64));
        addText(files, filePath, sanitizeTextBody(text, item.type || 'text/plain'));
        metadata.encoding = 'utf8-redacted';
      } else {
        addBase64(files, filePath, item.base64);
        metadata.encoding = 'binary';
      }
      metadata.file = filePath;
      capturedBytes += item.size || 0;
      capturedFiles += 1;
    }
    await sleep(0);
  }
  if (stopReason) {
    for (const entry of selected) {
      if (!entry.file && !entry.contentOmitted) entry.contentOmitted = 'OPFS content time budget reached.';
    }
    capture.warnings.push(`${prefix} OPFS capture: ${Math.round(opfsBudgetMs / 1000)}s time budget reached; continuing.`);
  }
  addJson(files, manifestPath, {
    origin,
    available: listing.available,
    listingTruncated: listing.truncated,
    listingError: listing.error,
    discoveredFiles: candidates.length,
    capturedFiles,
    capturedBytes,
    complete: !stopReason,
    stopReason,
    timeBudgetMs: opfsBudgetMs,
    elapsedMs: Date.now() - startedAt,
    limits: { maxFiles: MAX_OPFS_FILES, maxFileBytes: MAX_OPFS_FILE_BYTES, maxOriginBytes: MAX_OPFS_ORIGIN_BYTES },
    entries
  });
}

async function captureWebSql(capture, files, prefix) {
  if (!capture.options.forensicMode || capture.webSqlPrefixes.has(prefix)) return;
  const startedAt = Date.now();
  const webSqlBudgetMs = unlimitedAwareStageBudget(capture, 30_000);
  const deadline = startedAt + webSqlBudgetMs;
  capture.webSqlPrefixes.add(prefix);
  const candidates = [...capture.webSqlDatabases.values()].filter((entry) => entry.runtimeEpoch === (capture.runtimeEpoch || 0));
  const manifest = { supported: capture.webSqlSupported, databasesObserved: candidates.length, limits: { rowsPerTable: MAX_WEBSQL_ROWS_PER_TABLE, bytesPerDatabase: MAX_WEBSQL_DATABASE_BYTES }, timeBudgetMs: webSqlBudgetMs, databases: [] };
  if (!capture.webSqlSupported) {
    manifest.reason = 'The Chrome Database domain is unavailable in this browser build or target.';
    addJson(files, `${prefix}/forensics/websql/manifest.json`, manifest);
    return;
  }
  for (let databaseIndex = 0; databaseIndex < candidates.length; databaseIndex += 1) {
    if (Date.now() >= deadline) { manifest.stopReason = 'time-budget-reached'; break; }
    const candidate = candidates[databaseIndex];
    const databaseId = candidate.database?.id;
    if (!databaseId) continue;
    const dbEntry = { database: candidate.database, tables: [], capturedBytes: 0 };
    const names = await bestEffort(() => cdpSession(capture.tabId, candidate.sessionId, 'Database.getDatabaseTableNames', { databaseId }, remainingStageTimeout(deadline, 5_000)), capture.warnings, `${prefix} WebSQL table names`);
    for (const tableName of names?.tableNames || []) {
      if (Date.now() >= deadline) { manifest.stopReason = 'time-budget-reached'; break; }
      const tableEntry = { name: tableName, rows: 0, truncated: false, chunks: [] };
      const escapedIdentifier = String(tableName).replace(/"/g, '""');
      const escapedLiteral = String(tableName).replace(/'/g, "''");
      const schemaResult = await cdpSession(capture.tabId, candidate.sessionId, 'Database.executeSQL', { databaseId, query: `SELECT sql FROM sqlite_master WHERE type='table' AND name='${escapedLiteral}'` }, remainingStageTimeout(deadline, 5_000)).catch(() => null);
      tableEntry.schema = schemaResult?.values?.[0] ? sanitizeTextBody(schemaResult.values[0], 'text/sql') : null;
      for (let offset = 0; offset < MAX_WEBSQL_ROWS_PER_TABLE && dbEntry.capturedBytes < MAX_WEBSQL_DATABASE_BYTES; offset += 200) {
        if (Date.now() >= deadline) { manifest.stopReason = 'time-budget-reached'; tableEntry.truncated = true; break; }
        const page = await cdpSession(capture.tabId, candidate.sessionId, 'Database.executeSQL', { databaseId, query: `SELECT * FROM "${escapedIdentifier}" LIMIT 200 OFFSET ${offset}` }, remainingStageTimeout(deadline, 5_000)).catch((error) => ({ sqlError: { message: error?.message || String(error) } }));
        if (page?.sqlError) { tableEntry.error = page.sqlError; break; }
        const columns = page?.columnNames || [];
        const values = page?.values || [];
        const rows = [];
        for (let valueIndex = 0; columns.length && valueIndex < values.length; valueIndex += columns.length) {
          const row = {};
          for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) row[columns[columnIndex]] = values[valueIndex + columnIndex];
          const redacted = redactJson(row);
          const estimated = new TextEncoder().encode(JSON.stringify(redacted)).length;
          if (dbEntry.capturedBytes + estimated > MAX_WEBSQL_DATABASE_BYTES) { tableEntry.truncated = true; break; }
          rows.push(redacted);
          dbEntry.capturedBytes += estimated;
        }
        if (rows.length) {
          const chunkPath = `${prefix}/forensics/websql/db_${String(databaseIndex).padStart(3, '0')}/${cleanFilePart(tableName, 'table')}_${String(tableEntry.chunks.length).padStart(3, '0')}.json`;
          addJson(files, chunkPath, { columns, rows });
          tableEntry.chunks.push(chunkPath);
          tableEntry.rows += rows.length;
        }
        if (rows.length < 200 || tableEntry.truncated) break;
        await sleep(0);
      }
      if (tableEntry.rows >= MAX_WEBSQL_ROWS_PER_TABLE || dbEntry.capturedBytes >= MAX_WEBSQL_DATABASE_BYTES) tableEntry.truncated = true;
      dbEntry.tables.push(tableEntry);
    }
    manifest.databases.push(dbEntry);
  }
  manifest.complete = !manifest.stopReason;
  manifest.elapsedMs = Date.now() - startedAt;
  if (manifest.stopReason) capture.warnings.push(`${prefix} WebSQL capture: 30s time budget reached; continuing.`);
  addJson(files, `${prefix}/forensics/websql/manifest.json`, manifest);
}

async function captureDynamicSurfaceProfile(capture, files, prefix) {
  capture.dynamicSurfaceProfiles ||= new Map();
  if (capture.dynamicSurfaceProfiles.has(prefix)) return capture.dynamicSurfaceProfiles.get(prefix);
  const results = await bestEffort(
    () => executeScript({
      target: { tabId: capture.tabId },
      world: 'MAIN',
      args: [DYNAMIC_MIN_SCROLL_RANGE],
      func: (minimumScrollRange) => {
        const pathFor = (element) => {
          if (!(element instanceof Element)) return null;
          const segments = [];
          let current = element;
          while (current && current !== document.documentElement && segments.length < 16) {
            let segment = current.localName || 'element';
            if (current.id) {
              segment += `#${CSS.escape(current.id)}`;
              segments.unshift(segment);
              break;
            }
            const parent = current.parentElement;
            if (parent) {
              const peers = [...parent.children].filter((node) => node.localName === current.localName);
              if (peers.length > 1) segment += `:nth-of-type(${peers.indexOf(current) + 1})`;
            }
            segments.unshift(segment);
            current = parent;
          }
          return segments.join(' > ');
        };
        const describe = (element, kind = 'element') => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          const verticalRange = Math.max(0, element.scrollHeight - element.clientHeight);
          const horizontalRange = Math.max(0, element.scrollWidth - element.clientWidth);
          const markerText = `${element.id || ''} ${typeof element.className === 'string' ? element.className : ''} ${[...element.attributes].map((attribute) => attribute.name).join(' ')}`;
          const marker = /lenis|locomotive|smooth|scroll-root|scroll-container|virtual-scroll|scrollable/i.test(markerText);
          const viewportCoverage = Math.min(1, Math.max(0, rect.width * rect.height) / Math.max(1, innerWidth * innerHeight));
          const verticalOverflow = /auto|scroll|overlay/.test(style.overflowY) || /auto|scroll|overlay/.test(style.overflow);
          const horizontalOverflow = /auto|scroll|overlay/.test(style.overflowX) || /auto|scroll|overlay/.test(style.overflow);
          const row = {
            kind,
            selector: kind === 'document' ? null : pathFor(element),
            tag: element.localName,
            id: element.id || null,
            className: typeof element.className === 'string' ? element.className.slice(0, 1000) : null,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            clientWidth: element.clientWidth,
            clientHeight: element.clientHeight,
            scrollWidth: element.scrollWidth,
            scrollHeight: element.scrollHeight,
            scrollLeft: element.scrollLeft,
            scrollTop: element.scrollTop,
            verticalRange,
            horizontalRange,
            overflowX: style.overflowX,
            overflowY: style.overflowY,
            position: style.position,
            marker,
            viewportCoverage,
            score: verticalRange + horizontalRange * 0.35 + viewportCoverage * 2500 + (marker ? 6000 : 0) + (verticalOverflow ? 1200 : 0) + (horizontalOverflow ? 600 : 0)
          };
          Object.defineProperty(row, '__element', { value: element, enumerable: false });
          return row;
        };
        const verifyAxis = (entry, axis) => {
          const element = entry.__element;
          const range = axis === 'horizontal' ? entry.horizontalRange : entry.verticalRange;
          if (!element || range < minimumScrollRange) return { scrollable: false, delta: 0 };
          if (entry.kind === 'document') return { scrollable: true, delta: range };
          const property = axis === 'horizontal' ? 'scrollLeft' : 'scrollTop';
          const original = Number(element[property]) || 0;
          const probe = original < range - 2
            ? Math.min(range, original + Math.max(4, Math.min(64, range)))
            : Math.max(0, original - Math.max(4, Math.min(64, range)));
          try {
            if (axis === 'horizontal') element.scrollTo({ left: probe, top: element.scrollTop, behavior: 'instant' });
            else element.scrollTo({ top: probe, left: element.scrollLeft, behavior: 'instant' });
          } catch { element[property] = probe; }
          const actual = Number(element[property]) || 0;
          try {
            if (axis === 'horizontal') element.scrollTo({ left: original, top: element.scrollTop, behavior: 'instant' });
            else element.scrollTo({ top: original, left: element.scrollLeft, behavior: 'instant' });
          } catch { element[property] = original; }
          return { scrollable: Math.abs(actual - original) >= 1, delta: actual - original };
        };
        const scrollingElement = document.scrollingElement || document.documentElement;
        const documentSurface = describe(scrollingElement, 'document');
        const candidates = [documentSurface];
        for (const element of [...document.querySelectorAll('*')].slice(0, 20000)) {
          if (!(element instanceof HTMLElement || element instanceof SVGElement)) continue;
          const verticalRange = element.scrollHeight - element.clientHeight;
          const horizontalRange = element.scrollWidth - element.clientWidth;
          if (verticalRange < minimumScrollRange && horizontalRange < minimumScrollRange) continue;
          const row = describe(element);
          if (row.rect.width <= 1 || row.rect.height <= 1) continue;
          const overflowRelevant = /auto|scroll|overlay/.test(`${row.overflowX} ${row.overflowY}`);
          const substantialRange = Math.max(row.verticalRange, row.horizontalRange) >= Math.max(96, Math.min(row.clientWidth || 0, row.clientHeight || 0) * 0.2);
          if (!row.marker && !overflowRelevant && !substantialRange) continue;
          candidates.push(row);
        }
        candidates.sort((a, b) => b.score - a.score || b.verticalRange - a.verticalRange || b.horizontalRange - a.horizontalRange);
        const verifiedCandidates = [];
        for (const entry of candidates.slice(0, 60)) {
          const verticalProbe = verifyAxis(entry, 'vertical');
          const horizontalProbe = verifyAxis(entry, 'horizontal');
          entry.canScrollVertical = verticalProbe.scrollable;
          entry.canScrollHorizontal = horizontalProbe.scrollable;
          entry.verifiedVerticalDelta = verticalProbe.delta;
          entry.verifiedHorizontalDelta = horizontalProbe.delta;
          if (entry.kind === 'document' || entry.canScrollVertical || entry.canScrollHorizontal) verifiedCandidates.push(entry);
        }
        candidates.length = 0;
        candidates.push(...verifiedCandidates);
        const verifiedRange = (entry) => Math.max(entry?.canScrollVertical ? entry.verticalRange : 0, entry?.canScrollHorizontal ? entry.horizontalRange : 0);
        // A long horizontal carousel can have a larger numeric range than the page
        // without being the page's real scroll driver. Keep small carousels as
        // secondary surfaces, but do not let one steal the main animation timeline.
        const strongestCandidate = candidates
          .filter((entry) => entry.kind !== 'document')
          .filter((entry) => documentSurface.range < minimumScrollRange || entry.viewportCoverage >= 0.45 || (entry.marker && entry.viewportCoverage >= 0.3))
          .sort((left, right) => verifiedRange(right) - verifiedRange(left) || right.score - left.score)[0];
        const documentRange = Math.max(documentSurface.verticalRange, documentSurface.horizontalRange);
        const strongestRange = verifiedRange(strongestCandidate);
        const primary = strongestCandidate && (documentRange < minimumScrollRange || strongestRange > documentRange * 1.15)
          ? strongestCandidate
          : documentSurface;
        primary.axis = primary.canScrollVertical ? 'vertical' : primary.canScrollHorizontal ? 'horizontal' : 'none';
        primary.range = primary.axis === 'horizontal' ? primary.horizontalRange : primary.verticalRange;
        const surfaces = [];
        const surfaceKeys = new Set();
        const surfaceSignatures = new Map();
        const surfaceRegistry = globalThis.__LET_ME_SEE_CODE_SCROLL_SURFACES__ instanceof Map
          ? globalThis.__LET_ME_SEE_CODE_SCROLL_SURFACES__
          : (globalThis.__LET_ME_SEE_CODE_SCROLL_SURFACES__ = new Map());
        const addSurface = (entry, axis) => {
          const range = axis === 'horizontal' ? entry.horizontalRange : entry.verticalRange;
          if (range < minimumScrollRange) return;
          if (entry.kind !== 'document' && axis === 'vertical' && !entry.canScrollVertical) return;
          if (entry.kind !== 'document' && axis === 'horizontal' && !entry.canScrollHorizontal) return;
          const primaryRange = primary.axis === 'horizontal' ? primary.horizontalRange : primary.verticalRange;
          const sameAxisAsPrimary = axis === primary.axis;
          const sameRangeAsPrimary = Math.abs(range - primaryRange) <= Math.max(8, primaryRange * 0.02);
          const rootAlias = entry.kind === 'document' || primary.kind === 'document' || ['body', 'html'].includes(entry.tag) || ['body', 'html'].includes(primary.tag);
          const sameViewportGeometry = Math.abs((entry.clientWidth || 0) - (primary.clientWidth || 0)) <= 2 && Math.abs((entry.clientHeight || 0) - (primary.clientHeight || 0)) <= 2;
          if (surfaces.length && sameAxisAsPrimary && sameRangeAsPrimary && rootAlias && sameViewportGeometry) return;
          const key = `${entry.kind}:${entry.selector || 'document'}:${axis}`;
          if (surfaceKeys.has(key)) return;
          const signature = `${axis}:${Math.round(range / 4)}:${Math.round((entry.clientWidth || 0) / 4)}:${Math.round((entry.clientHeight || 0) / 4)}:${Math.round((entry.scrollWidth || 0) / 4)}:${Math.round((entry.scrollHeight || 0) / 4)}`;
          const equivalentSources = surfaceSignatures.get(signature) || [];
          const equivalentAlias = entry.kind !== 'document' && equivalentSources.some((source) => {
            const sourceElement = source.__element;
            const entryElement = entry.__element;
            if (!sourceElement || !entryElement) return false;
            const sourceRect = source.rect || {};
            const entryRect = entry.rect || {};
            const sameRect = Math.abs((sourceRect.x || 0) - (entryRect.x || 0)) <= 2 && Math.abs((sourceRect.y || 0) - (entryRect.y || 0)) <= 2 && Math.abs((sourceRect.width || 0) - (entryRect.width || 0)) <= 2 && Math.abs((sourceRect.height || 0) - (entryRect.height || 0)) <= 2;
            return sameRect && (sourceElement.contains(entryElement) || entryElement.contains(sourceElement));
          });
          if (equivalentAlias) return;
          if (entry.kind !== 'document' && entry.__element) {
            let stableKey = entry.__element.__LET_ME_SEE_CODE_SCROLL_SURFACE_KEY__ || null;
            if (!stableKey) {
              stableKey = `surface-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
              try { Object.defineProperty(entry.__element, '__LET_ME_SEE_CODE_SCROLL_SURFACE_KEY__', { value: stableKey, configurable: true }); }
              catch { entry.__element.__LET_ME_SEE_CODE_SCROLL_SURFACE_KEY__ = stableKey; }
            }
            entry.surfaceKey = stableKey;
            surfaceRegistry.set(stableKey, entry.__element);
          }
          surfaceKeys.add(key);
          surfaceSignatures.set(signature, [...equivalentSources, entry]);
          surfaces.push({ ...entry, axis, range });
        };
        addSurface(primary, primary.axis);
        for (const entry of candidates) {
          addSurface(entry, 'vertical');
          addSurface(entry, 'horizontal');
          if (surfaces.length >= 12) break;
        }
        const canvases = [...document.querySelectorAll('canvas')].slice(0, 100).map((canvas) => {
          const rect = canvas.getBoundingClientRect();
          const style = getComputedStyle(canvas);
          return {
            selector: pathFor(canvas), width: canvas.width, height: canvas.height,
            clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            position: style.position, opacity: style.opacity, pointerEvents: style.pointerEvents,
            viewportCoverage: Math.min(1, Math.max(0, rect.width * rect.height) / Math.max(1, innerWidth * innerHeight))
          };
        });
        const sourceText = [...document.scripts].map((script) => script.src || script.textContent?.slice(0, 1000) || '').join('\n');
        const instrumentation = globalThis.__LET_ME_SEE_CODE_INSTRUMENTATION__;
        const graphicsCalls = instrumentation?.graphics?.callCounts || {};
        const audio = instrumentation?.audio || null;
        return {
          capturedAt: new Date().toISOString(),
          viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
          documentSurface,
          primary,
          surfaces,
          secondarySurfaces: surfaces.slice(1),
          candidates: candidates.slice(0, 30),
          alternatePrimary: primary.kind !== 'document' && primary.range > (primary.axis === 'horizontal' ? documentSurface.horizontalRange : documentSurface.verticalRange) + 4,
          documentScrollAuthoritative: primary.kind === 'document' || (primary.axis === 'horizontal' ? documentSurface.horizontalRange : documentSurface.verticalRange) >= primary.range * 0.8,
          canvases,
          dynamicCanvasLikely: canvases.some((canvas) => canvas.viewportCoverage >= 0.3) || Object.keys(graphicsCalls).some((name) => /draw|useProgram|writeBuffer|writeTexture/i.test(name)),
          graphicsCallCounts: graphicsCalls,
          audioSummary: audio ? {
            webAudioAvailable: audio.webAudioAvailable,
            contexts: audio.contexts?.length || 0,
            nodes: audio.nodes?.length || 0,
            connections: audio.connections?.length || 0,
            events: audio.events?.length || 0,
            analyserReadKinds: Object.keys(audio.analyserReads || {}).length,
            mediaElements: Object.keys(audio.mediaElements || {}).length
          } : null,
          mediaElements: [...document.querySelectorAll('audio,video')].slice(0, 100).map((media) => ({
            tag: media.localName,
            src: (() => { try { const url = new URL(media.currentSrc || media.src || '', location.href); url.search = ''; url.hash = ''; return url.href; } catch { return ''; } })(),
            paused: media.paused, muted: media.muted, volume: media.volume,
            currentTime: media.currentTime, duration: Number.isFinite(media.duration) ? media.duration : null,
            autoplay: media.autoplay, loop: media.loop, playbackRate: media.playbackRate
          })),
          motionMarkers: {
            lenis: Boolean(globalThis.Lenis || document.querySelector('[data-lenis-prevent], .lenis')),
            locomotive: Boolean(globalThis.LocomotiveScroll || document.documentElement.classList.contains('has-scroll-smooth')),
            gsap: Boolean(globalThis.gsap),
            scrollTrigger: Boolean(globalThis.ScrollTrigger || globalThis.gsap?.plugins?.ScrollTrigger),
            lottie: Boolean(globalThis.lottie || globalThis.bodymovin),
            threeResourceMarkers: /three|\.gltf(?:\?|$)|\.glb(?:\?|$)|draco|ktx2|basis/i.test(sourceText) || canvases.length > 0,
            next: /\/_next\//.test(sourceText),
            activeWebAnimations: typeof document.getAnimations === 'function' ? document.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running').length : 0,
            stickyElements: [...document.querySelectorAll('*')].slice(0, 10000).filter((element) => getComputedStyle(element).position === 'sticky').length,
            fixedElements: [...document.querySelectorAll('*')].slice(0, 10000).filter((element) => getComputedStyle(element).position === 'fixed').length
          }
        };
      }
    }, `${prefix} dynamic-surface profile script`),
    capture.warnings,
    `${prefix} dynamic-surface profile`
  );
  const profile = results?.[0]?.result || null;
  if (profile) addJson(files, `${prefix}/forensics/dynamic_surfaces/profile.json`, redactJson(profile));
  capture.dynamicSurfaceProfiles.set(prefix, profile);
  return profile;
}

async function positionDynamicSurfaceOnly(capture, profile, targetTop, options = {}) {
  const primary = options.surface || profile?.primary;
  if (!primary) return null;
  const results = await bestEffort(() => executeScript({
    target: { tabId: capture.tabId },
    world: 'MAIN',
    args: [{ selector: primary.selector, surfaceKey: primary.surfaceKey, kind: primary.kind, axis: primary.axis || 'vertical', tag: primary.tag, range: primary.range, clientWidth: primary.clientWidth, clientHeight: primary.clientHeight, scrollWidth: primary.scrollWidth, scrollHeight: primary.scrollHeight, className: primary.className }, Math.max(0, Number(targetTop) || 0), Math.max(40, Number(options.waitMs) || 120)],
    func: async (surface, top, waitMs) => {
      const { selector, surfaceKey, kind, axis } = surface;
      const resolveSurface = () => {
        if (kind === 'document') return document.scrollingElement || document.documentElement;
        const registered = globalThis.__LET_ME_SEE_CODE_SCROLL_SURFACES__?.get?.(surfaceKey);
        if (registered?.isConnected) return registered;
        try {
          const selected = selector ? document.querySelector(selector) : null;
          if (selected) return selected;
        } catch {}
        const candidates = [...document.querySelectorAll(surface.tag || '*')].slice(0, 12_000);
        const desiredRange = Math.max(0, Number(surface.range) || 0);
        const classTokens = new Set(String(surface.className || '').split(/\s+/).filter(Boolean));
        let best = null;
        let bestScore = Number.NEGATIVE_INFINITY;
        for (const candidate of candidates) {
          const range = Math.max(0, axis === 'horizontal' ? candidate.scrollWidth - candidate.clientWidth : candidate.scrollHeight - candidate.clientHeight);
          if (range < 1) continue;
          const candidateTokens = new Set(typeof candidate.className === 'string' ? candidate.className.split(/\s+/).filter(Boolean) : []);
          const classMatches = [...classTokens].filter((token) => candidateTokens.has(token)).length;
          const score = -Math.abs(range - desiredRange) * 4
            - Math.abs(candidate.clientWidth - (Number(surface.clientWidth) || 0))
            - Math.abs(candidate.clientHeight - (Number(surface.clientHeight) || 0))
            - Math.abs(candidate.scrollWidth - (Number(surface.scrollWidth) || 0)) * 0.25
            - Math.abs(candidate.scrollHeight - (Number(surface.scrollHeight) || 0)) * 0.25
            + classMatches * 1000;
          if (score > bestScore) { best = candidate; bestScore = score; }
        }
        if (best && surfaceKey) {
          globalThis.__LET_ME_SEE_CODE_SCROLL_SURFACES__ ||= new Map();
          globalThis.__LET_ME_SEE_CODE_SCROLL_SURFACES__.set(surfaceKey, best);
        }
        return best;
      };
      const root = resolveSurface();
      if (!root) return { error: 'scroll-surface-not-found', selector, surfaceKey, kind, axis, requestedTop: top, actualTop: null, stable: false };
      const horizontal = axis === 'horizontal';
      const start = horizontal ? root.scrollLeft : root.scrollTop;
      const read = () => horizontal ? root.scrollLeft : root.scrollTop;
      try { root.scrollTo({ top: horizontal ? root.scrollTop : top, left: horizontal ? top : root.scrollLeft, behavior: 'instant' }); }
      catch { if (horizontal) root.scrollLeft = top; else root.scrollTop = top; }
      const deadline = performance.now() + Math.min(1_500, Math.max(240, waitMs + 700));
      let stableFrames = 0;
      let previous = read();
      while (performance.now() < deadline && stableFrames < 2) {
        await Promise.race([
          new Promise((resolve) => requestAnimationFrame(resolve)),
          new Promise((resolve) => setTimeout(resolve, 80))
        ]);
        const current = read();
        if (Math.abs(current - previous) <= 0.75) stableFrames += 1;
        else stableFrames = 0;
        previous = current;
      }
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(350, waitMs)));
      return {
        selector, surfaceKey, kind, axis, requestedTop: top, startTop: start, actualTop: read(),
        maximumTop: Math.max(0, horizontal ? root.scrollWidth - root.clientWidth : root.scrollHeight - root.clientHeight),
        stable: stableFrames >= 2,
        timestamp: performance.now()
      };
    }
  }, `${options.label || 'dynamic surface position'} script`, 5_000), capture.warnings, `${options.label || 'dynamic surface position'}`);
  return results?.[0]?.result || null;
}

async function positionDynamicSurface(capture, profile, targetTop, options = {}) {
  const primary = options.surface || profile?.primary;
  if (!primary) return null;
  const results = await bestEffort(() => executeScript({
    target: { tabId: capture.tabId },
    world: 'MAIN',
    args: [{ selector: primary.selector, surfaceKey: primary.surfaceKey, kind: primary.kind, axis: primary.axis || 'vertical', tag: primary.tag, range: primary.range, clientWidth: primary.clientWidth, clientHeight: primary.clientHeight, scrollWidth: primary.scrollWidth, scrollHeight: primary.scrollHeight, className: primary.className }, Math.max(0, Number(targetTop) || 0), Math.max(80, Number(options.waitMs) || 180), Math.max(0, Number(options.canvasLimit) || 0), Math.max(0, Number(options.stateLimit) || 0), DYNAMIC_CANVAS_SAMPLE_MAX_PIXELS],
    func: async (surface, top, waitMs, canvasLimit, stateLimit, maximumCanvasPixels) => {
      const { selector, surfaceKey, kind, axis } = surface;
      const pathFor = (element) => {
        if (!(element instanceof Element)) return null;
        const segments = [];
        let current = element;
        while (current && current !== document.documentElement && segments.length < 16) {
          let segment = current.localName || 'element';
          if (current.id) { segment += `#${CSS.escape(current.id)}`; segments.unshift(segment); break; }
          const parent = current.parentElement;
          if (parent) {
            const peers = [...parent.children].filter((node) => node.localName === current.localName);
            if (peers.length > 1) segment += `:nth-of-type(${peers.indexOf(current) + 1})`;
          }
          segments.unshift(segment);
          current = parent;
        }
        return segments.join(' > ');
      };
      const registered = globalThis.__LET_ME_SEE_CODE_SCROLL_SURFACES__?.get?.(surfaceKey);
      let root = kind === 'document' ? (document.scrollingElement || document.documentElement) : registered?.isConnected ? registered : null;
      if (!root) { try { root = selector ? document.querySelector(selector) : null; } catch {} }
      if (!root) return { error: 'scroll-surface-not-found', selector, surfaceKey, kind };
      const horizontal = axis === 'horizontal';
      const start = horizontal ? root.scrollLeft : root.scrollTop;
      try { root.scrollTo({ top: horizontal ? root.scrollTop : top, left: horizontal ? top : root.scrollLeft, behavior: 'instant' }); } catch { if (horizontal) root.scrollLeft = top; else root.scrollTop = top; }
      const deadline = performance.now() + Math.min(1800, Math.max(250, waitMs + 900));
      let stableFrames = 0;
      let previous = horizontal ? root.scrollLeft : root.scrollTop;
      while (performance.now() < deadline && stableFrames < 3) {
        await Promise.race([
          new Promise((resolve) => requestAnimationFrame(resolve)),
          new Promise((resolve) => setTimeout(resolve, 80))
        ]);
        const current = horizontal ? root.scrollLeft : root.scrollTop;
        if (Math.abs(current - previous) <= 0.75) stableFrames += 1;
        else stableFrames = 0;
        previous = current;
      }
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(600, waitMs)));
      const visibleStates = [];
      const hoverCandidates = [];
      const candidateElements = new Set();
      const addWithAncestors = (element) => {
        let current = element;
        for (let depth = 0; current instanceof Element && depth < 5; depth += 1, current = current.parentElement) candidateElements.add(current);
      };
      for (let row = 0; row <= 5; row += 1) {
        for (let column = 0; column <= 7; column += 1) {
          const x = Math.max(1, Math.min(innerWidth - 2, Math.round(innerWidth * column / 7)));
          const y = Math.max(1, Math.min(innerHeight - 2, Math.round(innerHeight * row / 5)));
          for (const element of document.elementsFromPoint(x, y).slice(0, 8)) addWithAncestors(element);
        }
      }
      for (const element of [...document.querySelectorAll('a[href],button,[role="button"],[role="tab"],[role="switch"],summary,canvas,video,audio,[data-framer-name],[data-motion-id],[data-projection-id]')].slice(0, 1600)) addWithAncestors(element);
      const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
      for (let scanned = 0, element = walker.currentNode; element && scanned < 6000; element = walker.nextNode(), scanned += 1) {
        const rect = element.getBoundingClientRect();
        if (rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth && rect.width > 1 && rect.height > 1) candidateElements.add(element);
      }
      for (const element of candidateElements) {
        const rect = element.getBoundingClientRect();
        if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth || rect.width <= 1 || rect.height <= 1) continue;
        const style = getComputedStyle(element);
        const interesting = style.transform !== 'none' || style.opacity !== '1' || style.filter !== 'none' || style.position === 'sticky' || style.position === 'fixed' || style.animationName !== 'none' || style.willChange !== 'auto';
        if (stateLimit > 0 && interesting && visibleStates.length < stateLimit) {
          visibleStates.push({
            path: pathFor(element), tag: element.localName,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            style: { opacity: style.opacity, transform: style.transform, filter: style.filter, position: style.position, color: style.color, backgroundColor: style.backgroundColor, clipPath: style.clipPath, willChange: style.willChange },
            text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 300)
          });
        }
        if (element.matches('a[href],button,[role="button"],[role="tab"],[role="switch"],summary,canvas') && style.pointerEvents !== 'none' && !element.matches(':disabled,[aria-disabled="true"]')) {
          const label = `${element.getAttribute('aria-label') || ''} ${element.textContent || ''}`.trim().replace(/\s+/g, ' ').slice(0, 300);
          if (!/delete|remove|erase|buy|pay|checkout|purchase|order|book|logout|sign\s*out|submit|save|send|upload|download|install|subscribe/i.test(label)) {
            hoverCandidates.push({ path: pathFor(element), tag: element.localName, label, x: Math.max(1, Math.min(innerWidth - 2, rect.left + rect.width / 2)), y: Math.max(1, Math.min(innerHeight - 2, rect.top + rect.height / 2)), area: rect.width * rect.height });
          }
        }
      }
      hoverCandidates.sort((a, b) => b.area - a.area);
      const canvases = [];
      for (const canvas of [...document.querySelectorAll('canvas')].slice(0, canvasLimit)) {
        let dataUrl = null, error = null;
        const sourcePixels = Math.max(0, Number(canvas.width) || 0) * Math.max(0, Number(canvas.height) || 0);
        let sampledWidth = canvas.width;
        let sampledHeight = canvas.height;
        let sampleScale = 1;
        try {
          let serializationTarget = canvas;
          if (sourcePixels > maximumCanvasPixels && canvas.width > 0 && canvas.height > 0) {
            sampleScale = Math.sqrt(maximumCanvasPixels / sourcePixels);
            sampledWidth = Math.max(1, Math.round(canvas.width * sampleScale));
            sampledHeight = Math.max(1, Math.round(canvas.height * sampleScale));
            const sampleCanvas = document.createElement('canvas');
            sampleCanvas.width = sampledWidth;
            sampleCanvas.height = sampledHeight;
            const sampleContext = sampleCanvas.getContext('2d');
            if (!sampleContext) throw new Error('Canvas sampling context was unavailable.');
            sampleContext.drawImage(canvas, 0, 0, sampledWidth, sampledHeight);
            serializationTarget = sampleCanvas;
          }
          dataUrl = serializationTarget.toDataURL('image/png');
        } catch (reason) { error = reason?.message || String(reason); }
        let pixelHealth = null;
        if (dataUrl) {
          try {
            const image = new Image();
            image.src = dataUrl;
            await image.decode();
            const sample = document.createElement('canvas');
            sample.width = 32;
            sample.height = 32;
            const context = sample.getContext('2d', { willReadFrequently: true });
            context.drawImage(image, 0, 0, sample.width, sample.height);
            const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
            let nonTransparent = 0;
            let nonBlack = 0;
            let minimum = 255;
            let maximum = 0;
            for (let offset = 0; offset < pixels.length; offset += 4) {
              const red = pixels[offset];
              const green = pixels[offset + 1];
              const blue = pixels[offset + 2];
              const alpha = pixels[offset + 3];
              if (alpha > 8) nonTransparent += 1;
              if (alpha > 8 && (red > 8 || green > 8 || blue > 8)) nonBlack += 1;
              minimum = Math.min(minimum, red, green, blue);
              maximum = Math.max(maximum, red, green, blue);
            }
            const samples = pixels.length / 4;
            pixelHealth = {
              decoded: true,
              nonTransparentFraction: nonTransparent / samples,
              nonBlackFraction: nonBlack / samples,
              channelRange: maximum - minimum,
              looksBlank: nonTransparent === 0 || (nonBlack === 0 && maximum - minimum === 0)
            };
          } catch (reason) {
            pixelHealth = { decoded: false, error: reason?.message || String(reason) };
          }
        }
        const rect = canvas.getBoundingClientRect();
        canvases.push({ path: pathFor(canvas), width: canvas.width, height: canvas.height, sourcePixels, sampledWidth, sampledHeight, sampleScale, samplePixelLimit: maximumCanvasPixels, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, dataUrl, error, pixelHealth });
      }
      const instrumentation = globalThis.__LET_ME_SEE_CODE_INSTRUMENTATION__;
      return {
        selector, surfaceKey, kind, axis, requestedTop: top, startTop: start, actualTop: horizontal ? root.scrollLeft : root.scrollTop,
        maximumTop: Math.max(0, horizontal ? root.scrollWidth - root.clientWidth : root.scrollHeight - root.clientHeight), stable: stableFrames >= 3,
        activeAnimations: typeof document.getAnimations === 'function' ? document.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running').length : 0,
        visibleStates, hoverCandidates: hoverCandidates.slice(0, 12), canvases,
        graphicsCallCounts: instrumentation?.graphics?.callCounts || {},
        audioSummary: instrumentation?.audio ? {
          contexts: instrumentation.audio.contexts?.length || 0,
          nodes: instrumentation.audio.nodes?.length || 0,
          connections: instrumentation.audio.connections?.length || 0,
          events: instrumentation.audio.events?.length || 0,
          analyserReadKinds: Object.keys(instrumentation.audio.analyserReads || {}).length
        } : null,
        timestamp: performance.now()
      };
    }
  }, `${options.label || 'dynamic surface position'} script`, 12_000), capture.warnings, `${options.label || 'dynamic surface position'}`);
  return results?.[0]?.result || null;
}

async function captureQuickDynamicProbe(capture, files, prefix, profile) {
  if (capture.options.mode !== 'quick' || !profile) return null;
  const relevant = profile.canvases?.length || profile.alternatePrimary || profile.mediaElements?.length || (profile.audioSummary?.contexts || 0) > 0 || (profile.audioSummary?.events || 0) > 0;
  if (!relevant) return null;
  const first = await bestEffort(
    () => cdp(capture.tabId, 'Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }),
    capture.warnings,
    `${prefix} quick dynamic probe frame 1`
  );
  await sleep(180);
  const second = await bestEffort(
    () => cdp(capture.tabId, 'Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }),
    capture.warnings,
    `${prefix} quick dynamic probe frame 2`
  );
  const firstHash = first?.data ? await sha256HexString(first.data) : null;
  const secondHash = second?.data ? await sha256HexString(second.data) : null;
  if (first?.data) addBase64(files, `${prefix}/forensics/dynamic_surfaces/quick_idle_00.png`, first.data);
  if (second?.data && secondHash !== firstHash) addBase64(files, `${prefix}/forensics/dynamic_surfaces/quick_idle_01.png`, second.data);
  const manifest = {
    strategy: 'Low-cost current-state motion probe. Quick does not scroll or exercise controls.',
    alternateScrollSurfaceDetected: Boolean(profile.alternatePrimary),
    canvasesDetected: profile.canvases?.length || 0,
    mediaElementsDetected: profile.mediaElements?.length || 0,
    webAudioActivityDetected: (profile.audioSummary?.contexts || 0) > 0 || (profile.audioSummary?.events || 0) > 0,
    frameIntervalMs: 180,
    firstHash,
    secondHash,
    visualChanged: Boolean(firstHash && secondHash && firstHash !== secondHash),
    complete: Boolean(first?.data && second?.data)
  };
  addJson(files, `${prefix}/forensics/dynamic_surfaces/quick_probe_manifest.json`, manifest);
  return manifest;
}

function animationCaptureBudget(capture, prefix) {
  const configured = capture.options.mode !== 'entire'
    ? ANIMATION_FAST_BUDGET_MS
    : /pages\/000_|\/reloaded$/.test(prefix)
      ? ANIMATION_MAX_ENTRY_BUDGET_MS
      : ANIMATION_MAX_CRAWL_BUDGET_MS;
  if (capture.unlimitedRuntimeSelected) return unlimitedAwareStageBudget(capture, configured);
  if (!Number.isFinite(capture.captureDeadlineAt)) return configured;
  return Math.max(1, Math.min(configured, capture.captureDeadlineAt - Date.now() - MAX_FINALIZATION_RESERVE_MS));
}

function prioritizedScrollFractions(sceneCount) {
  const count = Math.max(1, Math.floor(Number(sceneCount) || 1));
  const priority = [0, 1, 0.5, 0.25, 0.75, 0.125, 0.875, 0.375, 0.625];
  const linear = Array.from({ length: count }, (_value, index) => index / Math.max(1, count - 1));
  return [...new Map([...priority, ...linear].map((fraction) => [fraction.toFixed(6), fraction])).values()].slice(0, count);
}

async function captureAnimationStateMatrix(capture, files, prefix) {
  if (!capture.options.forensicMode) return null;
  const budgetMs = animationCaptureBudget(capture, prefix);
  const startedAt = Date.now();
  sendProgress('Capturing idle, scroll, pointer, canvas and audio-linked motion states…', capture.options.mode === 'entire' ? 62 : 55);
  const results = await bestEffort(
    () => withOperationTimeout(chrome.scripting.executeScript({
      target: { tabId: capture.tabId, allFrames: true },
      world: 'MAIN',
      args: [Math.max(1, budgetMs - 2_000), ANIMATION_DETECTED_LIMIT, ANIMATION_SAMPLED_LIMIT, DYNAMIC_MIN_SCROLL_RANGE],
      func: async (maximumDurationMs, detectedLimit, sampledLimit, minimumScrollRange) => {
        const startedAt = performance.now();
        const deadline = startedAt + maximumDurationMs;
        const animationDeadline = deadline - Math.min(8_000, Math.max(3_000, maximumDurationMs * 0.12));
        const sleepBounded = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
        const safeValue = (value) => {
          if (value == null || typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
          try { return String(value); } catch { return null; }
        };
        const safeRecord = (record) => record && typeof record === 'object'
          ? Object.fromEntries(Object.entries(record).map(([key, value]) => [key, safeValue(value)]))
          : null;
        const pathFor = (element) => {
          if (!(element instanceof Element)) return null;
          const segments = [];
          let current = element;
          while (current && segments.length < 12) {
            let segment = current.localName || 'element';
            if (current.id) { segment += `#${CSS.escape(current.id)}`; segments.unshift(segment); break; }
            const parent = current.parentElement;
            if (parent) {
              const peers = [...parent.children].filter((node) => node.localName === current.localName);
              if (peers.length > 1) segment += `:nth-of-type(${peers.indexOf(current) + 1})`;
            }
            segments.unshift(segment);
            current = parent;
          }
          return segments.join(' > ');
        };
        const secretName = /pass(?:word|wd)?|secret|token|api[-_]?key|auth|cookie|session|csrf|xsrf/i;
        const targetAttributes = (element) => Object.fromEntries([...element.attributes]
          .filter((attribute) => attribute.name !== 'value' && !secretName.test(attribute.name))
          .slice(0, 80)
          .map((attribute) => [attribute.name, attribute.value]));
        const baseProperties = [
          'display','visibility','opacity','transform','translate','rotate','scale','transform-origin',
          'filter','backdrop-filter','clip-path','mask','mask-image','offset-path','offset-distance',
          'color','background-color','border-color','box-shadow','text-shadow','width','height',
          'left','right','top','bottom','inset','margin','padding','z-index','overflow'
        ];
        const snapshot = (target, keyframes = []) => {
          const style = getComputedStyle(target);
          const animatedProperties = new Set(baseProperties);
          for (const keyframe of keyframes || []) {
            for (const property of Object.keys(keyframe || {})) {
              if (!['offset', 'easing', 'composite', 'computedOffset'].includes(property)) animatedProperties.add(property);
            }
          }
          const rect = target.getBoundingClientRect();
          return {
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            attributes: targetAttributes(target),
            style: Object.fromEntries([...animatedProperties].slice(0, 80).map((property) => [property, style.getPropertyValue(property)]))
          };
        };
        const libraryMarkers = {
          gsap: Boolean(globalThis.gsap),
          gsapScrollTrigger: Boolean(globalThis.ScrollTrigger || globalThis.gsap?.plugins?.ScrollTrigger),
          lottie: Boolean(globalThis.lottie || globalThis.bodymovin),
          lenis: Boolean(globalThis.Lenis || document.querySelector('[data-lenis-prevent], .lenis')),
          locomotiveScroll: Boolean(globalThis.LocomotiveScroll || document.documentElement.classList.contains('has-scroll-smooth')),
          barba: Boolean(globalThis.barba),
          animeJs: Boolean(globalThis.anime),
          motionMarkers: document.querySelectorAll('[data-framer-name], [data-motion-id], [data-projection-id]').length,
          animatedCanvases: document.querySelectorAll('canvas').length,
          animatedSvgCandidates: document.querySelectorAll('svg animate, svg animateTransform, svg animateMotion').length
        };
        const libraryState = { gsapTimelines: [], scrollTriggers: [], lottieAnimations: [] };
        try {
          libraryState.gsapTimelines = (globalThis.gsap?.globalTimeline?.getChildren?.(true, true, true) || []).slice(0, 250).map((item, index) => ({
            index,
            id: item.vars?.id || item.data || null,
            type: item.constructor?.name || null,
            duration: safeValue(item.duration?.()),
            totalDuration: safeValue(item.totalDuration?.()),
            time: safeValue(item.time?.()),
            progress: safeValue(item.progress?.()),
            totalProgress: safeValue(item.totalProgress?.()),
            paused: safeValue(item.paused?.()),
            reversed: safeValue(item.reversed?.()),
            repeat: safeValue(item.repeat?.()),
            yoyo: safeValue(item.yoyo?.()),
            targets: (item.targets?.() || []).filter((target) => target instanceof Element).slice(0, 30).map(pathFor)
          }));
        } catch (error) { libraryState.gsapError = error?.message || String(error); }
        try {
          const scrollTrigger = globalThis.ScrollTrigger || globalThis.gsap?.plugins?.ScrollTrigger;
          libraryState.scrollTriggers = (scrollTrigger?.getAll?.() || []).slice(0, 250).map((trigger, index) => ({
            index,
            id: trigger.vars?.id || null,
            trigger: pathFor(trigger.trigger),
            pin: pathFor(trigger.pin),
            start: safeValue(trigger.start),
            end: safeValue(trigger.end),
            progress: safeValue(trigger.progress),
            direction: safeValue(trigger.direction),
            isActive: Boolean(trigger.isActive),
            scrub: safeValue(trigger.vars?.scrub),
            horizontal: Boolean(trigger.horizontal),
            animationId: trigger.animation?.vars?.id || trigger.animation?.data || null
          }));
        } catch (error) { libraryState.scrollTriggerError = error?.message || String(error); }
        try {
          const lottieApi = globalThis.lottie || globalThis.bodymovin;
          libraryState.lottieAnimations = (lottieApi?.getRegisteredAnimations?.() || []).slice(0, 120).map((item, index) => ({
            index,
            name: item.name || item.animationID || null,
            container: pathFor(item.wrapper),
            currentFrame: safeValue(item.currentFrame),
            totalFrames: safeValue(item.totalFrames),
            frameRate: safeValue(item.frameRate),
            frameModifier: safeValue(item.frameModifier),
            loop: safeValue(item.loop),
            playSpeed: safeValue(item.playSpeed),
            playDirection: safeValue(item.playDirection),
            paused: Boolean(item.isPaused)
          }));
        } catch (error) { libraryState.lottieError = error?.message || String(error); }
        const allAnimations = document.getAnimations({ subtree: true });
        const detected = [];
        const candidates = [];
        for (let index = 0; index < Math.min(allAnimations.length, detectedLimit); index += 1) {
          const animation = allAnimations[index];
          const effect = animation.effect;
          const target = effect?.target;
          let timing = null;
          let computedTiming = null;
          let keyframes = null;
          try { timing = effect?.getTiming?.() || null; } catch {}
          try { computedTiming = effect?.getComputedTiming?.() || null; } catch {}
          try { keyframes = effect?.getKeyframes?.() || []; } catch { keyframes = []; }
          timing = safeRecord(timing);
          computedTiming = safeRecord(computedTiming);
          keyframes = (keyframes || []).map(safeRecord);
          const duration = Number(computedTiming?.duration);
          const targetPath = pathFor(target);
          const timelineType = animation.timeline?.constructor?.name || null;
          const isScrollDriven = /scroll|view/i.test(timelineType || '');
          const properties = [...new Set((keyframes || []).flatMap((keyframe) => Object.keys(keyframe || {})).filter((property) => !['offset','easing','composite','computedOffset'].includes(property)))];
          const metadata = {
            index,
            id: animation.id || null,
            type: animation.constructor?.name || null,
            target: targetPath,
            targetTag: target instanceof Element ? target.localName : null,
            playState: animation.playState,
            replaceState: animation.replaceState,
            pending: animation.pending,
            currentTime: safeValue(animation.currentTime),
            startTime: safeValue(animation.startTime),
            playbackRate: animation.playbackRate,
            timelineType,
            scrollDriven: isScrollDriven,
            timing,
            computedTiming,
            animatedProperties: properties,
            keyframes
          };
          detected.push(metadata);
          const fingerprint = `${targetPath || 'no-target'}|${timelineType || ''}|${JSON.stringify(keyframes || [])}`;
          const eligible = target instanceof Element && Number.isFinite(duration) && duration >= 0 && duration <= 120_000 && !isScrollDriven;
          candidates.push({ animation, target, metadata, duration, keyframes, fingerprint, eligible, priority: (isScrollDriven ? 8 : 0) + (animation.playState === 'running' ? 4 : 0) + (target instanceof Element ? 2 : 0) + (properties.length ? 1 : 0) });
        }
        candidates.sort((a, b) => b.priority - a.priority || a.metadata.index - b.metadata.index);
        const animations = [];
        const fingerprints = new Set();
        let duplicateStatesSkipped = 0;
        let eligibleDetected = 0;
        let fullySampled = 0;
        let partiallySampled = 0;
        for (const candidate of candidates) {
          if (candidate.eligible) eligibleDetected += 1;
          if (!candidate.eligible) continue;
          if (fingerprints.has(candidate.fingerprint)) { duplicateStatesSkipped += 1; continue; }
          fingerprints.add(candidate.fingerprint);
          if (animations.length >= sampledLimit || performance.now() >= animationDeadline) break;
          const { animation, target, metadata, duration, keyframes } = candidate;
          const entry = { animationIndex: metadata.index, target: metadata.target, duration, animatedProperties: metadata.animatedProperties, samples: [], complete: false };
          const originalTime = animation.currentTime;
          const originalRate = animation.playbackRate;
          const originalPlayState = animation.playState;
          try {
            animation.pause();
            for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
              if (performance.now() >= animationDeadline) break;
              animation.currentTime = duration * fraction;
              // Reading computed style below forces the new animation time to resolve. A short
              // timer fallback avoids background-tab rAF throttling turning every sample into 80ms.
              await sleepBounded(12);
              entry.samples.push({ fraction, currentTime: safeValue(animation.currentTime), ...snapshot(target, keyframes) });
            }
            entry.complete = entry.samples.length === 5;
          } catch (error) {
            entry.error = error?.message || String(error);
          } finally {
            try {
              animation.playbackRate = originalRate;
              animation.currentTime = originalTime;
              if (originalPlayState === 'running') animation.play();
              else if (originalPlayState === 'paused') animation.pause();
              else if (originalPlayState === 'finished') animation.finish();
              else if (originalPlayState === 'idle') animation.cancel();
            } catch {}
          }
          if (entry.complete) fullySampled += 1;
          else partiallySampled += 1;
          animations.push(entry);
        }

        const scrollSnapshots = [];
        const documentRoot = document.scrollingElement || document.documentElement;
        const scrollScore = (element) => {
          const style = getComputedStyle(element);
          const marker = /lenis|locomotive|smooth|scroll-root|scroll-container|virtual-scroll/i.test(`${element.id || ''} ${typeof element.className === 'string' ? element.className : ''}`);
          const rect = element.getBoundingClientRect();
          const coverage = Math.min(1, Math.max(0, rect.width * rect.height) / Math.max(1, innerWidth * innerHeight));
          return Math.max(0, element.scrollHeight - element.clientHeight, (element.scrollWidth - element.clientWidth) * 0.8) + coverage * 2500 + (marker ? 6000 : 0) + (/auto|scroll|overlay/.test(`${style.overflowX} ${style.overflowY}`) ? 1200 : 0);
        };
        const scrollCandidates = [documentRoot, ...document.querySelectorAll('*')]
          .filter((element) => (element.scrollHeight - element.clientHeight >= minimumScrollRange || element.scrollWidth - element.clientWidth >= minimumScrollRange) && element.clientHeight > 1 && element.clientWidth > 1)
          .sort((a, b) => scrollScore(b) - scrollScore(a));
        const strongestScrollCandidate = scrollCandidates.find((element) => element !== documentRoot);
        const documentRange = Math.max(0, documentRoot.scrollHeight - documentRoot.clientHeight, documentRoot.scrollWidth - documentRoot.clientWidth);
        const strongestRange = strongestScrollCandidate ? Math.max(0, strongestScrollCandidate.scrollHeight - strongestScrollCandidate.clientHeight, strongestScrollCandidate.scrollWidth - strongestScrollCandidate.clientWidth) : 0;
        const scrollRoot = strongestScrollCandidate && (documentRange < minimumScrollRange || strongestRange > documentRange * 1.15) ? strongestScrollCandidate : documentRoot;
        const scrollAxis = scrollRoot.scrollHeight - scrollRoot.clientHeight >= minimumScrollRange ? 'vertical' : 'horizontal';
        const startX = scrollRoot.scrollLeft;
        const startY = scrollRoot.scrollTop;
        const scrollRange = Math.max(0, scrollAxis === 'horizontal' ? scrollRoot.scrollWidth - scrollRoot.clientWidth : scrollRoot.scrollHeight - scrollRoot.clientHeight);
        const scrollTargets = [...new Set(candidates.filter((entry) => entry.target instanceof Element).map((entry) => entry.target))].slice(0, 40);
        if (scrollRange > 0) {
          for (const fraction of [0, 1, 0.5, 0.25, 0.75, 0.125, 0.875]) {
            if (performance.now() >= deadline) break;
            const requestedTop = Math.round(scrollRange * fraction);
            try { scrollRoot.scrollTo({ top: scrollAxis === 'horizontal' ? startY : requestedTop, left: scrollAxis === 'horizontal' ? requestedTop : startX, behavior: 'instant' }); } catch { if (scrollAxis === 'horizontal') scrollRoot.scrollLeft = requestedTop; else scrollRoot.scrollTop = requestedTop; }
            await sleepBounded(90);
            scrollSnapshots.push({
              fraction,
              requestedTop,
              actualTop: scrollAxis === 'horizontal' ? scrollRoot.scrollLeft : scrollRoot.scrollTop,
              activeAnimations: document.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running').length,
              targets: scrollTargets.map((target) => ({ path: pathFor(target), ...snapshot(target) }))
            });
          }
        }
        try { scrollRoot.scrollTo({ top: startY, left: startX, behavior: 'instant' }); } catch { scrollRoot.scrollTop = startY; scrollRoot.scrollLeft = startX; }
        const elapsedMs = Math.round(performance.now() - startedAt);
        const timeBudgetReached = elapsedMs >= maximumDurationMs;
        const scrollSurfaceTraversed = scrollRange === 0 || (
          scrollSnapshots.some((entry) => Math.abs(entry.actualTop) <= Math.max(4, scrollRange * 0.01)) &&
          scrollSnapshots.some((entry) => Math.abs(entry.actualTop - scrollRange) <= Math.max(4, scrollRange * 0.01))
        );
        return {
          schemaVersion: 2,
          libraryMarkers,
          libraryState,
          observed: allAnimations.length,
          detected: detected.length,
          detectedTruncated: allAnimations.length > detected.length,
          eligibleDetected,
          sampled: animations.length,
          fullySampled,
          partiallySampled,
          duplicateStatesSkipped,
          configuredLimits: { detected: detectedLimit, sampled: sampledLimit, maximumDurationMs },
          scrollSurface: { kind: scrollRoot === documentRoot ? 'document' : 'element', selector: scrollRoot === documentRoot ? null : pathFor(scrollRoot), axis: scrollAxis, range: scrollRange, clientHeight: scrollRoot.clientHeight, clientWidth: scrollRoot.clientWidth, scrollHeight: scrollRoot.scrollHeight, scrollWidth: scrollRoot.scrollWidth },
          scrollSnapshotsCaptured: scrollSnapshots.length,
          timeBudgetReached,
          elapsedMs,
          completeness: {
            definitionsCaptured: detected.length === Math.min(allAnimations.length, detectedLimit),
            scrollSurfaceTraversed,
            eligibleStatesFullySampled: fullySampled,
            eligibleStatesPartialOrMissing: Math.max(0, eligibleDetected - fullySampled),
            complete: !timeBudgetReached && scrollSurfaceTraversed && !partiallySampled && eligibleDetected <= fullySampled + duplicateStatesSkipped
          },
          detectedAnimations: detected,
          animations,
          scrollSnapshots
        };
      }
    }), `${prefix} animation evidence`, budgetMs + 5_000),
    capture.warnings,
    `${prefix} animation evidence`
  );
  const summaries = [];
  for (const frame of results || []) {
    if (!frame.result) continue;
    addJson(files, `${prefix}/forensics/animation_evidence/frame_${frame.frameId}.json`, redactJson(frame.result));
    summaries.push({
      frameId: frame.frameId,
      observed: frame.result.observed,
      detected: frame.result.detected,
      fullySampled: frame.result.fullySampled,
      partiallySampled: frame.result.partiallySampled,
      scrollSnapshotsCaptured: frame.result.scrollSnapshotsCaptured,
      completeness: frame.result.completeness,
      file: `${prefix}/forensics/animation_evidence/frame_${frame.frameId}.json`
    });
  }
  const manifest = {
    schemaVersion: 2,
    strategy: 'Animation definitions first, then deduplicated finite timeline samples, scroll-driven state checkpoints, and viewport visual frames.',
    budgetMs,
    elapsedMs: Date.now() - startedAt,
    frames: summaries,
    observed: summaries.reduce((sum, frame) => sum + (frame.observed || 0), 0),
    fullySampled: summaries.reduce((sum, frame) => sum + (frame.fullySampled || 0), 0),
    partiallySampled: summaries.reduce((sum, frame) => sum + (frame.partiallySampled || 0), 0),
    complete: summaries.length > 0 && summaries.every((frame) => frame.completeness?.complete === true)
  };
  addJson(files, `${prefix}/forensics/animation_evidence/manifest.json`, manifest);
  (capture.animationAudits ||= []).push({ prefix, ...manifest });
  return manifest;
}

async function captureVideoPlaybackStates(capture, files, prefix, profile, deadline) {
  if (!(profile?.mediaElements || []).some((entry) => entry.tag === 'video') || Date.now() >= deadline) return [];
  const frames = [];
  for (const fraction of [0.25, 0.75]) {
    if (Date.now() >= deadline) break;
    throwIfCancelled(capture);
    const result = await bestEffort(() => executeScript({
      target: { tabId: capture.tabId },
      world: 'MAIN',
      args: [fraction, DYNAMIC_VIDEO_LIMIT],
      func: async (targetFraction, limit) => {
        const videos = [...document.querySelectorAll('video')]
          .filter((video) => video.readyState >= 1 || Number.isFinite(video.duration))
          .sort((left, right) => {
            const visible = (video) => { const rect = video.getBoundingClientRect(); return rect.width > 1 && rect.height > 1 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth ? 1 : 0; };
            return visible(right) - visible(left) || (right.videoWidth * right.videoHeight) - (left.videoWidth * left.videoHeight);
          })
          .slice(0, limit);
        globalThis.__LET_ME_SEE_CODE_VIDEO_RESTORE__ ||= new Map();
        const states = [];
        for (const video of videos) {
          if (!globalThis.__LET_ME_SEE_CODE_VIDEO_RESTORE__.has(video)) {
            globalThis.__LET_ME_SEE_CODE_VIDEO_RESTORE__.set(video, { currentTime: video.currentTime, paused: video.paused, muted: video.muted, playbackRate: video.playbackRate });
          }
          const duration = Number.isFinite(video.duration) ? video.duration : null;
          if (!duration || duration <= 0) {
            states.push({ src: video.currentSrc || video.src || '', sampled: false, reason: 'finite-duration-unavailable' });
            continue;
          }
          video.muted = true;
          video.pause();
          const requestedTime = Math.min(Math.max(0, duration * targetFraction), Math.max(0, duration - 0.05));
          try {
            video.currentTime = requestedTime;
            await Promise.race([
              new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true })),
              new Promise((resolve) => setTimeout(resolve, 900))
            ]);
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            let frameDataUrl = null;
            let frameError = null;
            try {
              const naturalWidth = Math.max(1, video.videoWidth || video.clientWidth || 1);
              const naturalHeight = Math.max(1, video.videoHeight || video.clientHeight || 1);
              const scale = Math.min(1, 640 / naturalWidth, 360 / naturalHeight);
              const sample = document.createElement('canvas');
              sample.width = Math.max(1, Math.round(naturalWidth * scale));
              sample.height = Math.max(1, Math.round(naturalHeight * scale));
              sample.getContext('2d').drawImage(video, 0, 0, sample.width, sample.height);
              frameDataUrl = sample.toDataURL('image/png');
            } catch (error) {
              frameError = error?.message || String(error);
            }
            const rect = video.getBoundingClientRect();
            states.push({
              src: video.currentSrc || video.src || '',
              sampled: true,
              requestedTime,
              actualTime: video.currentTime,
              duration,
              readyState: video.readyState,
              visible: rect.width > 1 && rect.height > 1 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth,
              intrinsicSize: { width: video.videoWidth, height: video.videoHeight },
              frameDataUrl,
              frameError
            });
          } catch (error) {
            states.push({ src: video.currentSrc || video.src || '', sampled: false, requestedTime, duration, reason: error?.message || String(error) });
          }
        }
        return states;
      }
    }, `${prefix} video playback checkpoint script`, 30_000), capture.warnings, `${prefix} video playback checkpoint ${Math.round(fraction * 100)}%`);
    const states = result?.[0]?.result || [];
    for (let stateIndex = 0; stateIndex < states.length; stateIndex += 1) {
      const state = states[stateIndex];
      const frameFile = state.frameDataUrl?.startsWith('data:image/png;base64,')
        ? `${prefix}/forensics/animation_evidence/video_${String(stateIndex).padStart(2, '0')}_${Math.round(fraction * 100)}pct.png`
        : null;
      if (frameFile) addBase64(files, frameFile, state.frameDataUrl.slice('data:image/png;base64,'.length));
      state.frameDataUrl = undefined;
      state.frameFile = frameFile;
    }
    const screenshot = await bestEffort(
      () => withOperationTimeout(cdp(capture.tabId, 'Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }), `${prefix} video checkpoint screenshot`, 8_000),
      capture.warnings,
      `${prefix} video checkpoint screenshot`
    );
    const file = screenshot?.data ? `${prefix}/forensics/animation_evidence/video_state_${String(frames.length).padStart(2, '0')}.png` : null;
    if (file) addBase64(files, file, screenshot.data);
    frames.push({ fraction, states, file, captured: Boolean(file), screenshotHash: screenshot?.data ? await sha256HexString(screenshot.data) : null });
  }
  await bestEffort(() => executeScript({
    target: { tabId: capture.tabId },
    world: 'MAIN',
    func: () => {
      const restore = globalThis.__LET_ME_SEE_CODE_VIDEO_RESTORE__;
      if (!(restore instanceof Map)) return 0;
      let restored = 0;
      for (const [video, state] of restore) {
        if (!video?.isConnected) continue;
        try {
          video.currentTime = state.currentTime;
          video.muted = state.muted;
          video.playbackRate = state.playbackRate;
          if (!state.paused) video.play().catch(() => {});
          restored += 1;
        } catch {}
      }
      restore.clear();
      return restored;
    }
  }, `${prefix} video playback restore script`, 20_000), capture.warnings, `${prefix} video playback restore`);
  return frames;
}

async function captureCanvasInteractionStates(capture, files, prefix, profile, deadline, isMax) {
  const candidates = (profile?.canvases || [])
    .filter((canvas) => canvas.rect?.width >= 80 && canvas.rect?.height >= 80 && canvas.pointerEvents !== 'none')
    .sort((left, right) => (right.viewportCoverage || 0) - (left.viewportCoverage || 0))
    .slice(0, DYNAMIC_CANVAS_INTERACTION_LIMIT);
  const states = [];
  const safety = await bestEffort(() => executeScript({
    target: { tabId: capture.tabId },
    world: 'MAIN',
    func: () => {
      const text = (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 200_000);
      const blockedText = /\b(?:checkout|place order|purchase|buy now|pay now|delete account|close account|unsubscribe|sign out|log out)\b/i.test(text);
      const visibleStatefulForm = [...document.forms].some((form) => {
        const rect = form.getBoundingClientRect();
        return rect.width > 1 && rect.height > 1 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth && !/^(?:get|dialog)$/i.test(form.method || 'get');
      });
      return { allowed: !blockedText && !visibleStatefulForm, blockedText, visibleStatefulForm };
    }
  }, `${prefix} canvas interaction safety script`, 20_000), capture.warnings, `${prefix} canvas interaction safety check`);
  const safetyResult = safety?.[0]?.result || { allowed: false, reason: 'safety-check-unavailable' };
  if (!safetyResult.allowed) return [{ operation: 'skipped', reason: 'Canvas interaction probes were skipped because the page exposed purchase/account/session language, a visible stateful form, or the safety check was unavailable.', safety: safetyResult }];
  for (let index = 0; index < candidates.length && Date.now() < deadline; index += 1) {
    const canvas = candidates[index];
    const x = Math.max(2, Math.min((profile.viewport?.width || 800) - 3, canvas.rect.x + canvas.rect.width / 2));
    const y = Math.max(2, Math.min((profile.viewport?.height || 600) - 3, canvas.rect.y + canvas.rect.height / 2));
    const operations = [
      { kind: 'click', run: async () => {
        await cdp(capture.tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        await cdp(capture.tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
        await cdp(capture.tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
      } },
      { kind: 'drag', run: async () => {
        const endX = Math.max(2, Math.min((profile.viewport?.width || 800) - 3, x + Math.min(120, canvas.rect.width * 0.18)));
        const endY = Math.max(2, Math.min((profile.viewport?.height || 600) - 3, y + Math.min(80, canvas.rect.height * 0.12)));
        await cdp(capture.tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
        await cdp(capture.tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: endX, y: endY, button: 'left', buttons: 1 });
        await cdp(capture.tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: endX, y: endY, button: 'left', buttons: 0, clickCount: 1 });
      } },
      { kind: 'keyboard-arrows', run: async () => {
        for (const key of [{ key: 'ArrowUp', code: 'ArrowUp', value: 38 }, { key: 'ArrowRight', code: 'ArrowRight', value: 39 }]) {
          await cdp(capture.tabId, 'Input.dispatchKeyEvent', { type: 'rawKeyDown', key: key.key, code: key.code, windowsVirtualKeyCode: key.value, nativeVirtualKeyCode: key.value });
          await sleep(180);
          await cdp(capture.tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: key.key, code: key.code, windowsVirtualKeyCode: key.value, nativeVirtualKeyCode: key.value });
        }
      } }
    ];
    if (isMax) operations.push({ kind: 'touch-swipe', run: async () => {
      const endX = Math.max(2, Math.min((profile.viewport?.width || 800) - 3, x - Math.min(100, canvas.rect.width * 0.15)));
      await cdp(capture.tabId, 'Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 3, radiusY: 3, force: 1, id: 1 }] });
      await cdp(capture.tabId, 'Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: endX, y, radiusX: 3, radiusY: 3, force: 1, id: 1 }] });
      await cdp(capture.tabId, 'Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } });
    let previousHash = null;
    for (const operation of operations) {
      if (Date.now() >= deadline) break;
      throwIfCancelled(capture);
      const before = await bestEffort(() => cdp(capture.tabId, 'Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, 8_000), capture.warnings, `${prefix} ${operation.kind} before`);
      const beforeHash = before?.data ? await sha256HexString(before.data) : previousHash;
      await bestEffort(operation.run, capture.warnings, `${prefix} safe canvas ${operation.kind}`);
      await sleep(operation.kind === 'keyboard-arrows' ? 420 : 280);
      const after = await bestEffort(() => cdp(capture.tabId, 'Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, 8_000), capture.warnings, `${prefix} ${operation.kind} after`);
      const afterHash = after?.data ? await sha256HexString(after.data) : null;
      const visuallyChanged = Boolean(beforeHash && afterHash && beforeHash !== afterHash);
      const file = after?.data && visuallyChanged ? `${prefix}/forensics/animation_evidence/canvas_interaction_${String(index).padStart(2, '0')}_${operation.kind}.png` : null;
      if (file) addBase64(files, file, after.data);
      states.push({ canvas: canvas.selector, operation: operation.kind, beforeHash, afterHash, visuallyChanged, file, captured: Boolean(after?.data) });
      previousHash = afterHash;
    }
  }
  return states;
}

async function captureAnimationVisualTimeline(capture, files, prefix) {
  if (!capture.options.forensicMode) return null;
  const startedAt = Date.now();
  const profile = await captureDynamicSurfaceProfile(capture, files, prefix);
  if (!profile?.primary) return null;
  const primary = profile.primary;
  const startTop = primary.axis === 'horizontal' ? (primary.scrollLeft || 0) : (primary.scrollTop || 0);
  const scrollRange = Math.max(0, primary.range || primary.verticalRange || primary.horizontalRange || 0);
  const isMax = capture.options.mode === 'entire';
  const isEntry = /pages\/000_|\/reloaded$/.test(prefix);
  const sceneCount = !isMax ? DYNAMIC_FAST_SCENE_FRAMES : isEntry ? DYNAMIC_MAX_ENTRY_SCENE_FRAMES : DYNAMIC_MAX_CRAWL_SCENE_FRAMES;
  const fractions = scrollRange > 0
    ? prioritizedScrollFractions(sceneCount)
    : Array.from({ length: Math.min(sceneCount, 5) }, () => 0);
  const hoverLimit = isMax ? DYNAMIC_MAX_HOVER_LIMIT : DYNAMIC_FAST_HOVER_LIMIT;
  const canvasLimit = Math.min(DYNAMIC_CANVAS_LIMIT, isMax ? 4 : 2);
  const stateLimit = isMax ? 160 : 100;
  const budgetMs = Math.max(2_000, animationCaptureBudget(capture, prefix));
  const deadline = Date.now() + budgetMs;
  const surfaceLimit = isMax ? DYNAMIC_MAX_SURFACE_LIMIT : DYNAMIC_FAST_SURFACE_LIMIT;
  const sameSurfaceAxis = (left, right) => left?.kind === right?.kind && left?.axis === right?.axis && (
    left?.kind === 'document' ||
    (left?.surfaceKey && right?.surfaceKey && left.surfaceKey === right.surfaceKey) ||
    (left?.selector && right?.selector && left.selector === right.selector)
  );
  // Derive the reported count and sampled list from one deduplicated collection.
  // Dynamic pages can replace an element while retaining its logical surface key;
  // mixing counts across those states previously produced impossible "4/3" logs.
  const uniqueSurfaceAxes = [...new Map((profile.surfaces || []).map((surface) => {
    const identity = surface.kind === 'document'
      ? 'document'
      : surface.surfaceKey || surface.selector || `${surface.tag || 'element'}:${surface.id || ''}`;
    return [`${surface.kind}:${identity}:${surface.axis}`, surface];
  })).values()];
  const detectedSecondarySurfaces = uniqueSurfaceAxes.filter((surface) => !sameSurfaceAxis(surface, primary));
  const secondarySurfaces = detectedSecondarySurfaces.slice(0, Math.max(0, surfaceLimit - 1));
  const allSecondarySurfacesWithinLimit = detectedSecondarySurfaces.length <= Math.max(0, surfaceLimit - 1);
  const primaryDeadline = secondarySurfaces.length ? startedAt + Math.floor(budgetMs * 0.8) : startedAt + Math.floor(budgetMs * 0.9);

  const idleFrames = [];
  const idleSampleCount = profile.canvases?.length ? (isMax ? 4 : 3) : 2;
  let previousIdleHash = null;
  for (let index = 0; index < idleSampleCount && Date.now() < deadline; index += 1) {
    throwIfCancelled(capture);
    const screenshot = await bestEffort(
      () => withOperationTimeout(cdp(capture.tabId, 'Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }), `${prefix} idle motion frame ${index + 1}`, 12_000),
      capture.warnings,
      `${prefix} idle motion frame ${index + 1}`
    );
    const hash = screenshot?.data ? await sha256HexString(screenshot.data) : null;
    const changedFromPrevious = Boolean(previousIdleHash && hash && previousIdleHash !== hash);
    const file = screenshot?.data && (index === 0 || changedFromPrevious)
      ? `${prefix}/forensics/animation_evidence/idle_frame_${String(index).padStart(2, '0')}.png`
      : null;
    if (file) addBase64(files, file, screenshot.data);
    idleFrames.push({ index, hash, changedFromPrevious, file, captured: Boolean(screenshot?.data) });
    previousIdleHash = hash;
    if (index + 1 < idleSampleCount) await sleep(240);
  }

  const frames = [];
  const previousCanvasHashes = new Map();
  const capturedHoverPaths = new Set();
  const hoverFrames = [];
  for (let index = 0; index < fractions.length && Date.now() < primaryDeadline; index += 1) {
    throwIfCancelled(capture);
    const fraction = fractions[index];
    let targetTop = Math.round(scrollRange * fraction);
    const sceneCanvasLimit = [0, 0.5, 1].some((checkpoint) => Math.abs(fraction - checkpoint) < 0.0001) ? canvasLimit : 0;
    let evidence = await positionDynamicSurfaceOnly(capture, profile, targetTop, {
      waitMs: index === 0 ? 80 : 160,
      label: `${prefix} dynamic scene ${index + 1} position`
    });
    if (fraction === 1 && (evidence?.maximumTop || 0) > targetTop + Math.max(8, targetTop * 0.01)) {
      targetTop = evidence.maximumTop;
      evidence = await positionDynamicSurfaceOnly(capture, profile, targetTop, {
        waitMs: 160,
        label: `${prefix} dynamic scene live endpoint`
      }) || evidence;
    }
    if (evidence && Math.abs((evidence.actualTop || 0) - targetTop) > Math.max(8, scrollRange * 0.02)) {
      await bestEffort(() => cdp(capture.tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: Math.round((profile.viewport?.width || 800) / 2), y: Math.round((profile.viewport?.height || 600) / 2)
      }), capture.warnings, `${prefix} dynamic scene pointer placement`);
      await bestEffort(() => cdp(capture.tabId, 'Input.dispatchMouseEvent', {
        type: 'mouseWheel', x: Math.round((profile.viewport?.width || 800) / 2), y: Math.round((profile.viewport?.height || 600) / 2),
        deltaX: primary.axis === 'horizontal' ? targetTop - (evidence.actualTop || 0) : 0,
        deltaY: primary.axis === 'horizontal' ? 0 : targetTop - (evidence.actualTop || 0)
      }), capture.warnings, `${prefix} dynamic scene wheel fallback`);
      await sleep(220);
      evidence = await positionDynamicSurfaceOnly(capture, profile, targetTop, {
        waitMs: 80,
        label: `${prefix} dynamic scene ${index + 1} position retry`
      }) || evidence;
    }
    const richEvidence = await positionDynamicSurface(capture, profile, evidence?.actualTop ?? targetTop, {
      waitMs: index === 0 ? 100 : 220,
      canvasLimit: sceneCanvasLimit,
      stateLimit,
      label: `${prefix} dynamic scene ${index + 1} evidence`
    });
    evidence = richEvidence ? { ...evidence, ...richEvidence } : evidence;
    const screenshot = await bestEffort(
      () => withOperationTimeout(cdp(capture.tabId, 'Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }), `${prefix} animation visual screenshot ${index + 1}`, 12_000),
      capture.warnings,
      `${prefix} animation visual screenshot ${index + 1}`
    );
    const file = screenshot?.data ? `${prefix}/forensics/animation_evidence/visual_frame_${String(index).padStart(2, '0')}.png` : null;
    if (file) addBase64(files, file, screenshot.data);
    const screenshotHash = screenshot?.data ? await sha256HexString(screenshot.data) : null;
    const canvasManifest = [];
    for (let canvasIndex = 0; canvasIndex < (evidence?.canvases || []).length; canvasIndex += 1) {
      const canvas = evidence.canvases[canvasIndex];
      const canvasBase64 = canvas.dataUrl?.startsWith('data:image/png;base64,') ? canvas.dataUrl.slice('data:image/png;base64,'.length) : null;
      const canvasHash = canvasBase64 ? await sha256HexString(canvasBase64) : null;
      const canvasKey = canvas.path || `canvas-${canvasIndex}`;
      const duplicateOfPrevious = Boolean(canvasHash && previousCanvasHashes.get(canvasKey) === canvasHash);
      if (canvasHash) previousCanvasHashes.set(canvasKey, canvasHash);
      const canvasFile = canvasBase64 && !duplicateOfPrevious
        ? `${prefix}/forensics/animation_evidence/canvas_scene_${String(index).padStart(2, '0')}_${String(canvasIndex).padStart(2, '0')}.png`
        : null;
      if (canvasFile) addBase64(files, canvasFile, canvasBase64);
      canvasManifest.push({ ...canvas, dataUrl: undefined, hash: canvasHash, duplicateOfPrevious, file: canvasFile });
    }
    const stateRecord = evidence ? { ...evidence, canvases: canvasManifest } : null;
    frames.push({ index, scrollFraction: fraction, requestedTop: targetTop, state: stateRecord, screenshotHash, file, captured: Boolean(file) });

    if (hoverFrames.length < hoverLimit && Date.now() < deadline) {
      const candidate = (evidence?.hoverCandidates || []).find((entry) => entry.path && !capturedHoverPaths.has(entry.path) && entry.area >= 600);
      if (candidate) {
        capturedHoverPaths.add(candidate.path);
        await bestEffort(() => cdp(capture.tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(candidate.x), y: Math.round(candidate.y) }), capture.warnings, `${prefix} pointer state ${hoverFrames.length + 1}`);
        await sleep(260);
        const hovered = await bestEffort(
          () => withOperationTimeout(cdp(capture.tabId, 'Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }), `${prefix} pointer screenshot ${hoverFrames.length + 1}`, 12_000),
          capture.warnings,
          `${prefix} pointer screenshot ${hoverFrames.length + 1}`
        );
        const hoverHash = hovered?.data ? await sha256HexString(hovered.data) : null;
        const visuallyChanged = Boolean(screenshotHash && hoverHash && screenshotHash !== hoverHash);
        const hoverFile = hovered?.data && visuallyChanged
          ? `${prefix}/forensics/animation_evidence/pointer_state_${String(hoverFrames.length).padStart(2, '0')}.png`
          : null;
        if (hoverFile) addBase64(files, hoverFile, hovered.data);
        hoverFrames.push({ index: hoverFrames.length, sceneIndex: index, candidate, beforeHash: screenshotHash, afterHash: hoverHash, visuallyChanged, file: hoverFile, captured: Boolean(hovered?.data) });
      }
    }
  }

  const secondarySurfaceFrames = [];
  for (let surfaceIndex = 0; surfaceIndex < secondarySurfaces.length && Date.now() < deadline; surfaceIndex += 1) {
    const surface = secondarySurfaces[surfaceIndex];
    const originalTop = surface.axis === 'horizontal' ? (surface.scrollLeft || 0) : (surface.scrollTop || 0);
    const secondaryFractions = isMax ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.5, 1];
    const framesForSurface = [];
    for (const fraction of secondaryFractions.slice(0, DYNAMIC_SECONDARY_SCENE_LIMIT)) {
      if (Date.now() >= deadline) break;
      throwIfCancelled(capture);
      let requestedTop = Math.round(surface.range * fraction);
      let state = await positionDynamicSurfaceOnly(capture, profile, requestedTop, {
        surface,
        waitMs: 120,
        canvasLimit: 0,
        stateLimit: 0,
        label: `${prefix} secondary scroll surface ${surfaceIndex + 1}`
      });
      if (fraction === 1 && (state?.maximumTop || 0) > requestedTop + Math.max(8, requestedTop * 0.01)) {
        requestedTop = state.maximumTop;
        state = await positionDynamicSurfaceOnly(capture, profile, requestedTop, {
          surface,
          waitMs: 140,
          label: `${prefix} secondary scroll surface ${surfaceIndex + 1} live endpoint`
        }) || state;
      }
      const screenshot = await bestEffort(
        () => withOperationTimeout(cdp(capture.tabId, 'Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }), `${prefix} secondary surface screenshot`, 8_000),
        capture.warnings,
        `${prefix} secondary surface screenshot`
      );
      const hash = screenshot?.data ? await sha256HexString(screenshot.data) : null;
      const previousHash = framesForSurface.at(-1)?.screenshotHash || null;
      const visuallyChanged = Boolean(hash && previousHash && hash !== previousHash);
      const file = screenshot?.data && (framesForSurface.length === 0 || visuallyChanged)
        ? `${prefix}/forensics/dynamic_surfaces/surface_${String(surfaceIndex + 1).padStart(2, '0')}_${String(framesForSurface.length).padStart(2, '0')}.png`
        : null;
      if (file) addBase64(files, file, screenshot.data);
      framesForSurface.push({ fraction, requestedTop, actualTop: state?.actualTop ?? null, maximumTop: state?.maximumTop ?? null, screenshotHash: hash, visuallyChanged, file, captured: Boolean(screenshot?.data) });
    }
    await positionDynamicSurfaceOnly(capture, profile, originalTop, { surface, waitMs: 100, label: `${prefix} secondary scroll surface restore` });
    const traversedStart = surface.range <= 0 || framesForSurface.some((frame) => frame.actualTop != null && Math.abs(frame.actualTop) <= Math.max(4, surface.range * 0.01));
    const traversedEnd = surface.range <= 0 || framesForSurface.some((frame) => {
      const liveMaximum = frame.maximumTop ?? surface.range;
      return frame.fraction === 1 && frame.actualTop != null && Math.abs(frame.actualTop - liveMaximum) <= Math.max(4, liveMaximum * 0.01);
    });
    secondarySurfaceFrames.push({
      surface: { kind: surface.kind, selector: surface.selector, axis: surface.axis, range: surface.range, rect: surface.rect },
      frames: framesForSurface,
      traversedStart,
      traversedEnd,
      complete: framesForSurface.length === secondaryFractions.length && framesForSurface.every((frame) => frame.captured) && traversedStart && traversedEnd
    });
  }

  const videoFrames = await captureVideoPlaybackStates(capture, files, prefix, profile, deadline);
  const canvasInteractionStates = await captureCanvasInteractionStates(capture, files, prefix, profile, deadline, isMax);

  const scrollTiles = [];
  const tileLimit = isMax ? DYNAMIC_MAX_SCROLL_TILE_LIMIT : DYNAMIC_FAST_SCROLL_TILE_LIMIT;
  const tileStep = Math.max(240, Math.floor((primary.axis === 'horizontal' ? (primary.clientWidth || profile.viewport?.width || 800) : (primary.clientHeight || profile.viewport?.height || 600)) * 0.86));
  const requiredTilePositions = scrollRange > 0
    ? [...new Set([...Array.from({ length: Math.floor(scrollRange / tileStep) + 1 }, (_value, index) => Math.min(scrollRange, index * tileStep)), scrollRange].map(Math.round))]
    : [0];
  const tilePositions = requiredTilePositions.length <= tileLimit
    ? requiredTilePositions
    : Array.from({ length: tileLimit }, (_value, index) => Math.round(scrollRange * index / Math.max(1, tileLimit - 1)));
  if (profile.alternatePrimary) {
    for (let index = 0; index < tilePositions.length && Date.now() < deadline; index += 1) {
      throwIfCancelled(capture);
      const targetTop = tilePositions[index];
      const tileState = await positionDynamicSurfaceOnly(capture, profile, targetTop, { waitMs: 120, label: `${prefix} scroll-surface tile ${index + 1}` });
      const screenshot = await bestEffort(
        () => withOperationTimeout(cdp(capture.tabId, 'Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }), `${prefix} scroll-surface tile screenshot ${index + 1}`, 12_000),
        capture.warnings,
        `${prefix} scroll-surface tile screenshot ${index + 1}`
      );
      const tileFile = screenshot?.data ? `${prefix}/forensics/dynamic_surfaces/scroll_tiles/tile_${String(index).padStart(3, '0')}.png` : null;
      if (tileFile) addBase64(files, tileFile, screenshot.data);
      scrollTiles.push({ index, requestedTop: targetTop, actualTop: tileState?.actualTop ?? null, maximumTop: tileState?.maximumTop ?? null, stable: tileState?.stable ?? false, file: tileFile, captured: Boolean(tileFile) });
    }
  }

  await positionDynamicSurfaceOnly(capture, profile, startTop, { waitMs: 180, label: `${prefix} dynamic surface restore` });
  await bestEffort(() => cdp(capture.tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: Math.round((profile.viewport?.width || 800) / 2), y: Math.round((profile.viewport?.height || 600) / 2)
  }), capture.warnings, `${prefix} pointer restore`);

  const traversedStart = scrollRange <= 0 || frames.some((frame) => Math.abs((frame.state?.actualTop || 0) - 0) <= Math.max(4, scrollRange * 0.01));
  const traversedEnd = scrollRange <= 0 || frames.some((frame) => {
    const liveMaximum = frame.state?.maximumTop ?? scrollRange;
    return frame.scrollFraction === 1 && Math.abs((frame.state?.actualTop || 0) - liveMaximum) <= Math.max(4, liveMaximum * 0.01);
  });
  const tileCoverageComplete = !profile.alternatePrimary || (
    requiredTilePositions.length <= tileLimit &&
    scrollTiles.length === requiredTilePositions.length &&
    scrollTiles.every((tile) => {
      const expectedTop = Math.min(tile.requestedTop, tile.maximumTop ?? tile.requestedTop);
      return tile.captured && tile.actualTop != null && Math.abs(tile.actualTop - expectedTop) <= Math.max(6, (tile.maximumTop ?? scrollRange) * 0.01);
    })
  );
  const timeBudgetReached = Date.now() >= deadline;
  const manifest = {
    schemaVersion: 4,
    strategy: secondarySurfaces.length
      ? 'Adaptive multi-surface scroll scenes, video checkpoints, safe canvas interaction probes, real pointer states, validated canvas snapshots, idle-motion probes and ordered viewport tiles.'
      : profile.alternatePrimary
      ? 'Adaptive nested-scroll scenes, video checkpoints, safe canvas interaction probes, real pointer states, validated canvas snapshots, idle-motion probes and ordered viewport tiles.'
      : scrollRange > 0
        ? 'Adaptive document-scroll scenes with pointer, canvas and idle-motion evidence.'
        : 'Temporal, pointer and canvas evidence for a non-scrolling surface.',
    profile: `${prefix}/forensics/dynamic_surfaces/profile.json`,
    primaryScrollSurface: { kind: primary.kind, selector: primary.selector, axis: primary.axis, range: scrollRange, verticalRange: primary.verticalRange, horizontalRange: primary.horizontalRange, clientHeight: primary.clientHeight, clientWidth: primary.clientWidth, scrollHeight: primary.scrollHeight, scrollWidth: primary.scrollWidth },
    alternateScrollSurface: Boolean(profile.alternatePrimary),
    scrollRange,
    frames,
    idleFrames,
    idleVisualChanged: idleFrames.some((frame) => frame.changedFromPrevious),
    pointerStates: hoverFrames,
    secondaryScrollSurfaces: {
      detected: detectedSecondarySurfaces.length,
      configuredLimit: Math.max(0, surfaceLimit - 1),
      captured: secondarySurfaceFrames.length,
      complete: allSecondarySurfacesWithinLimit && secondarySurfaceFrames.length === secondarySurfaces.length && secondarySurfaceFrames.every((entry) => entry.complete),
      surfaces: secondarySurfaceFrames
    },
    videoPlaybackStates: videoFrames,
    canvasInteractionStates,
    scrollTiles: {
      required: profile.alternatePrimary ? requiredTilePositions.length : 0,
      configuredLimit: tileLimit,
      captured: scrollTiles.length,
      tileStep,
      complete: tileCoverageComplete,
      frames: scrollTiles
    },
    traversedStart,
    traversedEnd,
    timeBudgetReached,
    complete: frames.length === fractions.length && frames.every((frame) => frame.captured) && traversedStart && traversedEnd && tileCoverageComplete && allSecondarySurfacesWithinLimit && secondarySurfaceFrames.length === secondarySurfaces.length && secondarySurfaceFrames.every((entry) => entry.complete),
    elapsedMs: Date.now() - startedAt
  };
  addJson(files, `${prefix}/forensics/animation_evidence/visual_manifest.json`, manifest);
  if (profile.alternatePrimary && !tileCoverageComplete) capture.warnings.push(`${prefix} nested-scroll visual coverage is partial; the archive was not marked dynamically complete.`);
  if (!manifest.secondaryScrollSurfaces.complete) capture.warnings.push(`${prefix} additional scroll-surface coverage is partial (${secondarySurfaceFrames.length}/${detectedSecondarySurfaces.length} detected surface axes sampled within the configured limit).`);
  return manifest;
}

function flattenDomTree(root) {
  const nodes = [];
  const visit = (node, parentPath = '', siblingIndex = 1) => {
    if (!node) return;
    const attributes = {};
    for (let index = 0; index < (node.attributes?.length || 0); index += 2) {
      attributes[node.attributes[index]] = node.attributes[index + 1];
    }
    const tag = String(node.localName || node.nodeName || 'node').toLowerCase();
    const segment = attributes.id ? `${tag}#${attributes.id}` : `${tag}:nth-child(${siblingIndex})`;
    const path = parentPath ? `${parentPath} > ${segment}` : segment;
    nodes.push({ node, path, attributes });
    const childGroups = [node.children, node.shadowRoots, node.pseudoElements].filter(Array.isArray);
    for (const group of childGroups) group.forEach((child, index) => visit(child, path, index + 1));
    if (node.contentDocument) visit(node.contentDocument, `${path} ::content-document`, 1);
  };
  visit(root);
  return nodes;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

// Per-node matched-style provenance is intentionally complete for every selected
// deep node. Native listeners remain limited to genuine interaction targets, but
// matched CSS cannot be safely inferred from tag/class shape: ancestry,
// combinators, state, position and container conditions can make two visually
// similar nodes match different rules.
const FAST_DEEP_INSPECTION_BUDGET_MS = 60_000;
const MAX_ENTRY_DEEP_INSPECTION_BUDGET_MS = 60_000;
const MAX_CRAWL_DEEP_INSPECTION_BUDGET_MS = 30_000;
const DEEP_NODE_CDP_TIMEOUT_MS = 10_000;
const MAX_FINALIZATION_RESERVE_MS = 60_000;
const MAX_POST_DEEP_RESERVE_MS = 3 * 60_000;
const FAST_SOFT_RUNTIME_LIMIT_MS = 10 * 60_000;

function unlimitedAwareStageBudget(capture, configuredBudgetMs, reserveMs = MAX_FINALIZATION_RESERVE_MS) {
  const configured = Math.max(1, Number(configuredBudgetMs) || 1);
  if (!capture?.unlimitedRuntimeSelected || !Number.isFinite(capture.captureDeadlineAt)) return configured;
  return Math.max(0, capture.captureDeadlineAt - Date.now() - Math.max(0, Number(reserveMs) || 0));
}

function maxOptionalStageAllowed(capture, minimumDurationMs = 0) {
  if (!['entire', 'max'].includes(capture.options.mode) || !Number.isFinite(capture.captureDeadlineAt)) return true;
  return Date.now() + Math.max(0, Number(minimumDurationMs) || 0) < capture.captureDeadlineAt - MAX_FINALIZATION_RESERVE_MS;
}

function effectiveDeepInspectionBudget(capture, requestedBudgetMs) {
  const configured = Math.max(1, Number(requestedBudgetMs) || FAST_DEEP_INSPECTION_BUDGET_MS);
  if (!['entire', 'max'].includes(capture.options.mode) || !Number.isFinite(capture.captureDeadlineAt)) return configured;
  if (capture.unlimitedRuntimeSelected) return unlimitedAwareStageBudget(capture, configured, MAX_POST_DEEP_RESERVE_MS);
  return Math.max(0, Math.min(configured, capture.captureDeadlineAt - Date.now() - MAX_POST_DEEP_RESERVE_MS));
}

async function captureDeepDomInspection(capture, prefix, files, timeBudgetMs = FAST_DEEP_INSPECTION_BUDGET_MS) {
  if (!capture.options.forensicMode) return;
  let inspectionStartedAt = Date.now();
  const boundedTimeBudgetMs = Math.max(0, Number(timeBudgetMs) || 0);
  const stageStart = prefix === 'current_state' ? 24 : 62;
  if (boundedTimeBudgetMs < 1_000) {
    const result = {
      completeWithinConfiguredNodeLimit: false,
      completeForAllElementNodes: false,
      iterationCompleteWithinConfiguredNodeLimit: false,
      queryFailures: { matchedStyles: 0, eventListeners: 0 },
      inspectedElementNodes: 0,
      selectedElementNodes: 0,
      totalElementNodes: null,
      configuredNodeLimit: capture.options.maxDeepNodes,
      stopReason: 'capture-finalization-reserve-reached',
      elapsedMs: 0
    };
    addJson(files, `${prefix}/cdp/deep_dom_inspection/manifest.json`, {
      format: 'chunked-jsonl', entries: 0, complete: false, iterationComplete: false,
      queryFailures: result.queryFailures, stopReason: result.stopReason,
      timeBudgetMs: boundedTimeBudgetMs, elapsedMs: 0,
      matchedStyleStrategy: 'every-selected-element-node'
    });
    addJson(files, `${prefix}/cdp/deep_dom_summary.json`, result);
    capture.deepInspectionResults?.set(prefix, result);
    const modeLabel = capture.options.mode === 'entire' ? 'Max' : 'Fast';
    capture.warnings.push(`${prefix} deep DOM inspection was skipped because the configured ${modeLabel} runtime had reached its safe archive-finalization window; all completed evidence was preserved.`);
    sendProgress(`${modeLabel} runtime is nearly reached; preserving the completed page evidence…`, stageStart + 3);
    return;
  }
  let inspectionDeadline = inspectionStartedAt + boundedTimeBudgetMs;
  sendProgress('Mapping matched CSS rules and native listeners on selected elements…', stageStart);
  await bestEffort(() => cdp(capture.tabId, 'DOM.enable', {}, remainingStageTimeout(inspectionDeadline, DEEP_NODE_CDP_TIMEOUT_MS)), capture.warnings, `${prefix} DOM enable`);
  await bestEffort(() => cdp(capture.tabId, 'CSS.enable', {}, remainingStageTimeout(inspectionDeadline, DEEP_NODE_CDP_TIMEOUT_MS)), capture.warnings, `${prefix} CSS enable`);
  let documentResult = await bestEffort(
    () => cdp(capture.tabId, 'DOM.getDocument', { depth: 0, pierce: true }, remainingStageTimeout(inspectionDeadline, DEEP_NODE_CDP_TIMEOUT_MS)),
    capture.warnings,
    `${prefix} deep DOM document`
  );
  if (!documentResult?.root) return;
  const queriedElements = await bestEffort(
    () => cdp(capture.tabId, 'DOM.querySelectorAll', { nodeId: documentResult.root.nodeId, selector: '*' }, remainingStageTimeout(inspectionDeadline, 30_000)),
    capture.warnings,
    `${prefix} deep DOM element index`
  );
  if (!queriedElements?.nodeIds) return;
  const totalElementNodes = queriedElements.nodeIds.length;
  const totalDomNodes = totalElementNodes + 1;
  const elementNodes = queriedElements.nodeIds.slice(0, capture.options.maxDeepNodes).map((nodeId) => ({ nodeId }));

  // Keep only a flat array of integer node IDs. The earlier implementation
  // requested the complete recursive DOM tree and retained it while thousands
  // of CSS payloads were collected, creating a large native/JS memory spike.
  documentResult = null;

  const failures = { matchedStyles: 0, eventListeners: 0 };
  const cssRuleDictionary = [];
  const cssRuleIndex = new Map();
  let cssRuleReferences = 0;
  let cssRuleDictionaryLimitReached = false;
  const internCssRules = (value) => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(internCssRules);
    const looksLikeCssRule = typeof value.styleSheetId === 'string' && value.selectorList && value.style && value.origin;
    if (looksLikeCssRule) {
      const serialized = JSON.stringify(value);
      let ruleId = cssRuleIndex.get(serialized);
      if (ruleId === undefined && cssRuleDictionary.length < 100_000) {
        ruleId = cssRuleDictionary.length;
        cssRuleIndex.set(serialized, ruleId);
        cssRuleDictionary.push({ id: ruleId, rule: value });
      }
      if (ruleId !== undefined) {
        cssRuleReferences += 1;
        return { ruleRef: ruleId };
      }
      cssRuleDictionaryLimitReached = true;
    }
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, internCssRules(nested)]));
  };
  let matchedStyleCandidateNodes = 0;
  let matchedStyleInspectedNodes = 0;
  let listenerCandidateNodes = 0;
  let listenerInspectedNodes = 0;
  const inspectionChunks = [];
  const batchSize = 40;
  const concurrency = 8;
  let inspectedCount = 0;
  let stopReason = null;
  // Every element node has *some* matched-styles result (even if it's just
  // inherited/empty rules), so matchedStyles === null reliably means the CDP call
  // itself threw rather than "this node legitimately has nothing." If an entire
  // batch comes back that way, and the next couple do too, the session under us
  // has gone bad — most likely `capture.detachedReason` (another CDP client, e.g.
  // a remote automation/orchestration tool controlling the same browser, took over
  // the debugger connection), but also possibly stale nodeIds after the page's own
  // JS invalidated the DOM tree mid-walk (a client-side re-render, router remount,
  // etc.) on a page with continuous dynamic content. Either way, without this
  // check the loop had no way to distinguish "a few nodes failed" from "nothing is
  // working anymore" and would mechanically iterate through every remaining node
  // in milliseconds, producing thousands of empty records and no visible error.
  let consecutiveFullyFailedBatches = 0;
  const maxConsecutiveFullyFailedBatches = 3;
  // CSS.getMatchedStylesForNode payloads can run several KB each; on high-node-count
  // pages the 40-element batches below can outpace the serialized offscreen write
  // queue (see ArchiveFileStore.set/stageFile) faster than the general-purpose 16MB
  // default accounts for. Kept smaller here so this loop specifically stays bounded.
  const backpressureThresholdBytes = 4 * 1024 * 1024;

  for (let offset = 0; offset < elementNodes.length; offset += batchSize) {
    const pausedForMs = await awaitPauseCheckpoint(capture);
    inspectionStartedAt += pausedForMs;
    inspectionDeadline += pausedForMs;
    if (Date.now() >= inspectionDeadline) {
      stopReason = 'time-budget-reached';
      break;
    }
    const batch = elementNodes.slice(offset, offset + batchSize);
    const inspectedBatch = await mapWithConcurrency(batch, concurrency, async (entry) => {
      let matchedStyles = null;
      let listeners = [];
      let objectId = null;
      let describedNode = null;
      let attributes = {};
      let tag = null;
      let backendNodeId = null;
      let listenerCandidate = false;
      try {
        if (Date.now() >= inspectionDeadline) throw new Error('Deep inspection stage deadline reached.');
        const described = await cdp(capture.tabId, 'DOM.describeNode', { nodeId: entry.nodeId, depth: 0, pierce: true }, remainingStageTimeout(inspectionDeadline, DEEP_NODE_CDP_TIMEOUT_MS));
        describedNode = described?.node || null;
        tag = describedNode?.localName || describedNode?.nodeName?.toLowerCase?.() || null;
        backendNodeId = describedNode?.backendNodeId || null;
        const rawAttributes = describedNode?.attributes || [];
        for (let index = 0; index < rawAttributes.length; index += 2) attributes[rawAttributes[index]] = rawAttributes[index + 1] || '';
        const role = attributes.role || '';
        listenerCandidate = /^(?:a|button|input|select|textarea|summary|details|dialog|option|video|audio|canvas|iframe)$/i.test(tag || '') ||
          /^(?:button|link|tab|checkbox|radio|switch|menuitem|option|slider|spinbutton|textbox|combobox|treeitem)$/i.test(role) ||
          Boolean(attributes.tabindex || attributes.contenteditable || attributes['aria-controls'] || attributes['aria-expanded']) ||
          Object.keys(attributes).some((name) => /^on/i.test(name));
      } catch {
        failures.matchedStyles += 1;
      }
      if (describedNode) {
        matchedStyleCandidateNodes += 1;
        try {
          if (Date.now() >= inspectionDeadline) throw new Error('Deep inspection stage deadline reached.');
          matchedStyles = await cdp(capture.tabId, 'CSS.getMatchedStylesForNode', { nodeId: entry.nodeId }, remainingStageTimeout(inspectionDeadline, DEEP_NODE_CDP_TIMEOUT_MS));
          matchedStyles = internCssRules(matchedStyles);
          matchedStyleInspectedNodes += 1;
        } catch { failures.matchedStyles += 1; }
      }
      if (listenerCandidate) {
        listenerCandidateNodes += 1;
        try {
          if (Date.now() >= inspectionDeadline) throw new Error('Deep inspection stage deadline reached.');
          const resolved = await cdp(capture.tabId, 'DOM.resolveNode', { nodeId: entry.nodeId }, remainingStageTimeout(inspectionDeadline, DEEP_NODE_CDP_TIMEOUT_MS));
          objectId = resolved?.object?.objectId || null;
          if (objectId) {
            const listenerResult = await cdp(capture.tabId, 'DOMDebugger.getEventListeners', { objectId, depth: 1, pierce: true }, remainingStageTimeout(inspectionDeadline, DEEP_NODE_CDP_TIMEOUT_MS));
            listeners = (listenerResult?.listeners || []).map((listener) => ({
            type: listener.type,
            useCapture: listener.useCapture,
            passive: listener.passive,
            once: listener.once,
            scriptId: listener.scriptId,
            lineNumber: listener.lineNumber,
            columnNumber: listener.columnNumber,
            handler: listener.handler ? { type: listener.handler.type, className: listener.handler.className, description: sanitizeTextBody(listener.handler.description || '', 'text') } : null,
            originalHandler: listener.originalHandler ? { type: listener.originalHandler.type, className: listener.originalHandler.className, description: sanitizeTextBody(listener.originalHandler.description || '', 'text') } : null
            }));
            listenerInspectedNodes += 1;
          }
        } catch {
          failures.eventListeners += 1;
        } finally {
          if (objectId && Date.now() < inspectionDeadline) await cdp(capture.tabId, 'Runtime.releaseObject', { objectId }, remainingStageTimeout(inspectionDeadline, DEEP_NODE_CDP_TIMEOUT_MS)).catch(() => {});
        }
      }
      return {
        nodeId: entry.nodeId,
        backendNodeId,
        path: backendNodeId ? `backend-node:${backendNodeId}` : `node:${entry.nodeId}`,
        tag,
        attributes: redactJson(attributes),
        matchedStyles,
        matchedStylesInspected: true,
        listeners,
        listenerInspected: listenerCandidate
      };
    });

    const matchedStyleAttempts = inspectedBatch.filter((entry) => entry.matchedStylesInspected);
    const batchFailureCount = matchedStyleAttempts.filter((entry) => entry.matchedStyles === null).length;
    consecutiveFullyFailedBatches = (matchedStyleAttempts.length > 0 && batchFailureCount === matchedStyleAttempts.length)
      ? consecutiveFullyFailedBatches + 1
      : 0;
    if (consecutiveFullyFailedBatches >= maxConsecutiveFullyFailedBatches) {
      const inspectedBeforeAbort = inspectedCount;
      if (capture.detachedReason) throwIfCancelled(capture);
      const reason = capture.detachedReason
        ? `the Chrome debugger detached (${capture.detachedReason})`
        : "the page's DOM references went stale mid-capture (a client-side re-render or navigation likely invalidated the node IDs this stage was using)";
      capture.warnings.push(
        `${prefix} deep DOM inspection: aborted after ${inspectedBeforeAbort}/${elementNodes.length} nodes — ` +
        `${maxConsecutiveFullyFailedBatches} consecutive batches (${maxConsecutiveFullyFailedBatches * batchSize} nodes) failed entirely, ` +
        `most likely because ${reason}.`
      );
      stopReason = 'consecutive-fully-failed-batches';
      break;
    }

    const chunkIndex = inspectionChunks.length;
    const chunkPath = `${prefix}/cdp/deep_dom_inspection/chunk_${String(chunkIndex).padStart(4, '0')}.jsonl`;
    addText(files, chunkPath, inspectedBatch.map((entry) => JSON.stringify(entry)).join('\n'));
    inspectedCount += inspectedBatch.length;
    inspectionChunks.push({ file: chunkPath, start: offset, entries: inspectedBatch.length });

    // Bound how far the CDP capture loop can race ahead of the serialized offscreen
    // write queue. Previously nothing called this (it existed but was dead code), so
    // unflushed batches piled up in memory on high-node-count pages; the resulting GC
    // pressure was the main driver of captures that got progressively slower the
    // longer they ran, rather than staying at a steady per-batch pace.
    await files.waitForBackpressure(backpressureThresholdBytes);

    const elapsedMs = Date.now() - inspectionStartedAt;
    if (inspectedCount < elementNodes.length && elapsedMs >= boundedTimeBudgetMs) {
      stopReason = 'time-budget-reached';
      const message = `${prefix} deep DOM inspection: time budget reached after ${inspectedCount}/${elementNodes.length} nodes (${Math.round(elapsedMs / 1000)}s); continuing with the rest of the capture.`;
      capture.warnings.push(message);
      sendProgress(`CSS/listener mapping time limit reached at ${inspectedCount}/${elementNodes.length}; continuing…`, stageStart + 3);
      break;
    }

    if (inspectedCount < elementNodes.length && inspectedCount % 200 === 0) {
      const fraction = inspectedCount / Math.max(1, elementNodes.length);
      sendProgress(`Mapping CSS and listeners… ${inspectedCount}/${elementNodes.length}`, stageStart + Math.floor(fraction * 3));
      // Yield between batches so Chrome can service debugger events and reclaim
      // the just-serialized batch before the next one arrives.
      await sleep(0);
    }
  }

  if (stopReason === 'time-budget-reached' && inspectedCount < elementNodes.length) {
    const message = `${prefix} deep DOM inspection: time budget reached after ${inspectedCount}/${elementNodes.length} nodes (${Math.round((Date.now() - inspectionStartedAt) / 1000)}s); continuing with the rest of the capture.`;
    if (!capture.warnings.some((warning) => warning.startsWith(`${prefix} deep DOM inspection: time budget reached`))) capture.warnings.push(message);
    sendProgress(`CSS/listener mapping time limit reached at ${inspectedCount}/${elementNodes.length}; continuing…`, stageStart + 3);
  }

  const globalListeners = [];
  for (const targetName of ['window', 'document']) {
    if (Date.now() >= inspectionDeadline) {
      stopReason ||= 'time-budget-reached';
      break;
    }
    let objectId = null;
    try {
      const evaluated = await cdp(capture.tabId, 'Runtime.evaluate', { expression: targetName, returnByValue: false }, remainingStageTimeout(inspectionDeadline, DEEP_NODE_CDP_TIMEOUT_MS));
      objectId = evaluated?.result?.objectId || null;
      if (!objectId) continue;
      const listenerResult = await cdp(capture.tabId, 'DOMDebugger.getEventListeners', { objectId, depth: 1, pierce: true }, remainingStageTimeout(inspectionDeadline, DEEP_NODE_CDP_TIMEOUT_MS));
      globalListeners.push({
        target: targetName,
        listeners: (listenerResult?.listeners || []).map((listener) => ({
          type: listener.type,
          useCapture: listener.useCapture,
          passive: listener.passive,
          once: listener.once,
          scriptId: listener.scriptId,
          lineNumber: listener.lineNumber,
          columnNumber: listener.columnNumber,
          handler: listener.handler?.description ? sanitizeTextBody(listener.handler.description, 'text') : null
        }))
      });
    } catch {
      failures.eventListeners += 1;
    } finally {
      if (objectId && Date.now() < inspectionDeadline) await cdp(capture.tabId, 'Runtime.releaseObject', { objectId }, remainingStageTimeout(inspectionDeadline, DEEP_NODE_CDP_TIMEOUT_MS)).catch(() => {});
    }
  }

  const cssRuleDictionaryPath = `${prefix}/cdp/deep_dom_inspection/css_rule_dictionary.jsonl`;
  if (cssRuleDictionary.length) files.stageJsonLines(cssRuleDictionaryPath, cssRuleDictionary);
  addJson(files, `${prefix}/cdp/deep_dom_inspection/manifest.json`, {
    format: 'chunked-jsonl',
    entries: inspectedCount,
    batchSize,
    concurrency,
    complete: inspectedCount === elementNodes.length && failures.matchedStyles === 0 && failures.eventListeners === 0,
    iterationComplete: inspectedCount === elementNodes.length,
    queryFailures: failures,
    cssRuleNormalization: {
      format: 'ruleRef values point to dictionary JSONL records by numeric id',
      dictionary: cssRuleDictionary.length ? cssRuleDictionaryPath : null,
      uniqueRules: cssRuleDictionary.length,
      references: cssRuleReferences,
      reusedReferences: Math.max(0, cssRuleReferences - cssRuleDictionary.length),
      configuredRuleLimit: 100_000,
      limitReached: cssRuleDictionaryLimitReached
    },
    stopReason,
    timeBudgetMs: boundedTimeBudgetMs,
    elapsedMs: Date.now() - inspectionStartedAt,
    matchedStyleStrategy: 'every-selected-element-node',
    matchedStyleCandidateNodes,
    matchedStyleInspectedNodes,
    listenerStrategy: 'interactive-and-semantic-controls-only',
    listenerCandidateNodes,
    listenerInspectedNodes,
    chunks: inspectionChunks
  });
  addJson(files, `${prefix}/cdp/global_event_listeners.json`, globalListeners);
  addJson(files, `${prefix}/cdp/deep_dom_summary.json`, {
    totalDomNodes,
    totalElementNodes,
    inspectedElementNodes: inspectedCount,
    configuredNodeLimit: capture.options.maxDeepNodes,
    truncated: inspectedCount < totalElementNodes,
    nodeLimitTruncated: elementNodes.length < totalElementNodes,
    timeBudgetTruncated: stopReason === 'time-budget-reached',
    stopReason,
    timeBudgetMs: boundedTimeBudgetMs,
    elapsedMs: Date.now() - inspectionStartedAt,
    storage: { format: 'chunked-jsonl', manifest: `${prefix}/cdp/deep_dom_inspection/manifest.json`, chunks: inspectionChunks.length },
    failures
  });
  capture.deepInspectionResults ||= new Map();
  capture.deepInspectionResults.set(prefix, {
    completeWithinConfiguredNodeLimit: inspectedCount === elementNodes.length && failures.matchedStyles === 0 && failures.eventListeners === 0,
    completeForAllElementNodes: inspectedCount === totalElementNodes && failures.matchedStyles === 0 && failures.eventListeners === 0,
    iterationCompleteWithinConfiguredNodeLimit: inspectedCount === elementNodes.length,
    queryFailures: failures,
    inspectedElementNodes: inspectedCount,
    selectedElementNodes: elementNodes.length,
    totalElementNodes,
    configuredNodeLimit: capture.options.maxDeepNodes,
    stopReason,
    elapsedMs: Date.now() - inspectionStartedAt
  });
}

async function captureTiledPageScreenshot(tabId, prefix, files, warnings, contentSize, stageDeadline = Number.POSITIVE_INFINITY) {
  const contentWidth = Math.max(1, Math.ceil(Number(contentSize?.width) || 1));
  const contentHeight = Math.max(1, Math.ceil(Number(contentSize?.height) || 1));
  const tileWidth = Math.min(4096, contentWidth);
  const tileHeight = Math.min(contentHeight, 8192, Math.max(1, Math.floor(16_000_000 / tileWidth)));
  const columns = Math.ceil(contentWidth / tileWidth);
  const rows = Math.ceil(contentHeight / tileHeight);
  const requiredTiles = columns * rows;
  const maximumTiles = 256;
  const tiles = [];

  for (let row = 0; row < rows && tiles.length < maximumTiles && Date.now() < stageDeadline; row += 1) {
    for (let column = 0; column < columns && tiles.length < maximumTiles && Date.now() < stageDeadline; column += 1) {
      throwIfCancelled(currentCapture);
      const x = column * tileWidth;
      const y = row * tileHeight;
      const width = Math.min(tileWidth, contentWidth - x);
      const height = Math.min(tileHeight, contentHeight - y);
      const screenshot = await bestEffort(
        () => cdp(tabId, 'Page.captureScreenshot', {
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: true,
          clip: { x, y, width, height, scale: 1 }
        }, remainingStageTimeout(stageDeadline, CDP_COMMAND_TIMEOUT_MS)),
        warnings,
        `${prefix} visual tile ${row + 1}/${rows}, ${column + 1}/${columns}`
      );
      const file = `${prefix}/visual_tiles/tile_r${String(row).padStart(3, '0')}_c${String(column).padStart(3, '0')}.png`;
      const entry = { row, column, x, y, width, height, file: null };
      if (screenshot?.data) {
        addBase64(files, file, screenshot.data);
        entry.file = file;
      } else {
        entry.error = 'Chrome did not return tile pixels.';
      }
      tiles.push(entry);
      await sleep(0);
    }
  }

  const capturedTiles = tiles.filter((tile) => tile.file).length;
  const complete = requiredTiles <= maximumTiles && capturedTiles === requiredTiles;
  const manifest = {
    format: 'tiled-full-page-png',
    contentSize: { width: contentWidth, height: contentHeight },
    tileSize: { width: tileWidth, height: tileHeight },
    grid: { columns, rows, requiredTiles, maximumTiles },
    capturedTiles,
    complete,
    tiles
  };
  addJson(files, `${prefix}/visual_tiles/manifest.json`, manifest);
  if (!complete) warnings.push(`${prefix} tiled visual coverage captured ${capturedTiles}/${requiredTiles} tile(s); Chrome's ${maximumTiles}-tile safety boundary was reached or a tile failed.`);
  return manifest;
}

async function captureCdpPage(tabId, prefix, files, warnings, dynamicProfile = null, capture = currentCapture) {
  const startedAt = Date.now();
  const isQuick = capture?.options?.mode === 'quick';
  const isMax = capture?.options?.mode === 'entire';
  const quickCoreDeadline = capture?.options?.mode === 'quick' ? startedAt + 90_000 : Number.POSITIVE_INFINITY;
  const fastCoreDeadline = capture?.options?.mode === 'max' ? startedAt + 60_000 : Number.POSITIVE_INFINITY;
  const stageDeadline = capture?.options?.mode === 'entire' && Number.isFinite(capture.captureDeadlineAt)
    ? capture.captureDeadlineAt - MAX_FINALIZATION_RESERVE_MS
    : Math.min(quickCoreDeadline, fastCoreDeadline);
  const runCoreCdp = (method, params = {}, maximumMs = CDP_COMMAND_TIMEOUT_MS) => {
    if (Date.now() >= stageDeadline) return Promise.reject(new Error('Max safe archive-finalization window reached.'));
    return cdp(tabId, method, params, remainingStageTimeout(stageDeadline, maximumMs));
  };
  const layout = await bestEffort(() => runCoreCdp('Page.getLayoutMetrics'), warnings, `${prefix} layout metrics`);
  if (layout) addJson(files, `${prefix}/cdp/layout_metrics.json`, layout);

  // Quick already has a lossless rendered-DOM export plus every computed
  // property for every element. Repeating the browser's heavy DOMSnapshot,
  // accessibility, and MHTML serializers can take minutes on long articles and
  // does not belong to Quick's advertised visual + DOM + styles contract.
  let domSnapshot = !isMax ? null : await bestEffort(
    () => runCoreCdp('DOMSnapshot.captureSnapshot', {
      computedStyles: COMPUTED_SNAPSHOT_STYLES,
      includePaintOrder: true,
      includeDOMRects: true
    }),
    warnings,
    `${prefix} CDP DOM snapshot`
  );
  if (isMax && !domSnapshot) {
    domSnapshot = await bestEffort(
      () => runCoreCdp('DOMSnapshot.captureSnapshot', { computedStyles: COMPUTED_SNAPSHOT_STYLES }),
      warnings,
      `${prefix} fallback CDP DOM snapshot`
    );
  }
  if (domSnapshot) {
    addJson(files, `${prefix}/cdp/dom_snapshot.json`, sanitizeDomSnapshot(domSnapshot));
    domSnapshot = null;
    await files.flush?.();
  }

  let accessibility = isQuick ? null : await bestEffort(() => runCoreCdp('Accessibility.getFullAXTree'), warnings, `${prefix} accessibility tree`);
  if (accessibility) {
    addJson(files, `${prefix}/cdp/accessibility_tree.json`, sanitizeAccessibilityTree(accessibility));
    accessibility = null;
    await files.flush?.();
  }

  let mhtml = isQuick ? null : await bestEffort(() => runCoreCdp('Page.captureSnapshot', { format: 'mhtml' }), warnings, `${prefix} MHTML snapshot`);
  if (mhtml?.data) {
    addText(files, `${prefix}/page_snapshot.mhtml`, sanitizeTextBody(mhtml.data, 'multipart/related'));
    mhtml = null;
    await files.flush?.();
  }

  let viewportScreenshot = await bestEffort(
    () => runCoreCdp('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }),
    warnings,
    `${prefix} viewport screenshot`
  );
  const viewportCaptured = Boolean(viewportScreenshot?.data);
  if (viewportCaptured) {
    addBase64(files, `${prefix}/visual_viewport.png`, viewportScreenshot.data);
    viewportScreenshot = null;
    await files.flush?.();
  }

  const visualManifest = {
    viewportFile: viewportCaptured ? `${prefix}/visual_viewport.png` : null,
    contentSize: layout?.cssContentSize ? {
      width: Math.ceil(layout.cssContentSize.width),
      height: Math.ceil(layout.cssContentSize.height)
    } : null,
    fullPage: null,
    complete: false,
    documentSurfaceOnly: (dynamicProfile?.surfaces || []).every((surface) => surface.kind === 'document'),
    dynamicSurfaceCoverageRequired: (dynamicProfile?.surfaces || []).length > 1 || Boolean(dynamicProfile?.alternatePrimary),
    dynamicSurfaceProfile: dynamicProfile ? `${prefix}/forensics/dynamic_surfaces/profile.json` : null,
    alternateScrollSurface: dynamicProfile?.alternatePrimary ? {
      selector: dynamicProfile.primary?.selector || null,
      axis: dynamicProfile.primary?.axis || null,
      range: dynamicProfile.primary?.range || 0,
      verticalRange: dynamicProfile.primary?.verticalRange || 0,
      horizontalRange: dynamicProfile.primary?.horizontalRange || 0,
      scrollHeight: dynamicProfile.primary?.scrollHeight || 0,
      clientHeight: dynamicProfile.primary?.clientHeight || 0
    } : null,
    detectedScrollSurfaces: (dynamicProfile?.surfaces || []).map((surface) => ({
      kind: surface.kind,
      selector: surface.selector || null,
      axis: surface.axis,
      range: surface.range,
      verticalRange: surface.verticalRange,
      horizontalRange: surface.horizontalRange
    }))
  };

  let screenshot = null;
  if (isQuick) {
    visualManifest.fullPage = { mode: 'viewport-only', file: viewportCaptured ? `${prefix}/visual_viewport.png` : null };
    visualManifest.complete = viewportCaptured;
  } else if (layout?.cssContentSize) {
    const size = layout.cssContentSize;
    if (size.width * size.height <= 24_000_000 && size.width <= 32767 && size.height <= 32767) {
      screenshot = await bestEffort(
        () => runCoreCdp('Page.captureScreenshot', {
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width: Math.max(1, size.width), height: Math.max(1, size.height), scale: 1 }
        }),
        warnings,
        `${prefix} full-page screenshot`
      );
    }
    if (screenshot?.data) {
      const fullPageFile = `${prefix}/visual_full_page.png`;
      addBase64(files, fullPageFile, screenshot.data);
      visualManifest.fullPage = { mode: 'single', file: fullPageFile };
      visualManifest.complete = true;
      screenshot = null;
      await files.flush?.();
    } else {
      const tiled = await captureTiledPageScreenshot(tabId, prefix, files, warnings, size, stageDeadline);
      visualManifest.fullPage = { mode: 'tiles', manifest: `${prefix}/visual_tiles/manifest.json`, capturedTiles: tiled.capturedTiles, requiredTiles: tiled.grid.requiredTiles };
      visualManifest.complete = tiled.complete;
    }
  } else {
    warnings.push(`${prefix} layout metrics were unavailable; only the current viewport could be captured visually.`);
  }
  addJson(files, `${prefix}/visual_manifest.json`, visualManifest);
  capture.coreCdpTimings ||= [];
  capture.coreCdpTimings.push({
    prefix,
    elapsedMs: Date.now() - startedAt,
    complete: isQuick
      ? files.has(`${prefix}/main_frame/rendered_dom.html`) && visualManifest.complete === true
      : (!isMax || Boolean(domSnapshot || files.has(`${prefix}/cdp/dom_snapshot.json`))) && files.has(`${prefix}/cdp/accessibility_tree.json`) && files.has(`${prefix}/page_snapshot.mhtml`) && visualManifest.complete === true
  });
  return visualManifest;
}

async function captureStage(capture, prefix, files, percent, stageOptions = {}) {
  const { deep = true, framework = true, label = 'Capturing page', deepTimeBudgetMs = FAST_DEEP_INSPECTION_BUDGET_MS } = stageOptions;
  await awaitPauseCheckpoint(capture);
  sendProgress(`${label}: reading elements, attributes, DOM and computed styles…`, percent);
  await captureScriptedPage(capture, prefix, files, capture.warnings);
  await Promise.all([
    captureCookieMetadata(capture, files, prefix),
    captureLiveInstrumentation(capture, files, prefix)
  ]);
  const dynamicProfile = await captureDynamicSurfaceProfile(capture, files, prefix);
  await awaitPauseCheckpoint(capture);
  const priorCoreTimings = (capture.coreCdpTimings || []).filter((entry) => entry.complete);
  const estimatedCoreMs = Math.max(180_000, Math.ceil((priorCoreTimings.at(-1)?.elapsedMs || 0) * 1.5));
  const coreAdmitted = capture.options.mode !== 'entire' || !Number.isFinite(capture.captureDeadlineAt) ||
    Date.now() + estimatedCoreMs + MAX_FINALIZATION_RESERVE_MS < capture.captureDeadlineAt;
  if (coreAdmitted) {
    sendProgress(capture.options.mode === 'quick'
      ? 'Capturing layout and lossless visuals…'
      : 'Capturing layout, accessibility tree, MHTML and lossless visuals…', percent + 7);
    await captureCdpPage(capture.tabId, prefix, files, capture.warnings, dynamicProfile, capture);
  } else {
    capture.warnings.push(`${prefix} layout/MHTML/accessibility/visual bundle was not started because Max had reached its safe archive-finalization window; an earlier complete state is retained when available.`);
    sendProgress('Max runtime is nearly reached; preserving the last complete page state…', percent + 7);
  }
  await captureQuickDynamicProbe(capture, files, prefix, dynamicProfile);
  await awaitPauseCheckpoint(capture);
  if (deep && coreAdmitted && maxOptionalStageAllowed(capture, 2_000)) {
    await captureAnimationStateMatrix(capture, files, prefix);
    await captureAnimationVisualTimeline(capture, files, prefix);
  } else if (deep && coreAdmitted) {
    const modeLabel = capture.options.mode === 'entire' ? 'Max' : 'Fast';
    capture.warnings.push(`${prefix} advanced animation-state sampling was skipped because ${modeLabel} had reached its safe archive-finalization window; the page's completed DOM, style, layout, accessibility, MHTML and visual evidence was preserved.`);
  }
  await awaitPauseCheckpoint(capture);
  if (deep && coreAdmitted) await captureDeepDomInspection(capture, prefix, files, effectiveDeepInspectionBudget(capture, deepTimeBudgetMs));
  if (framework && coreAdmitted && maxOptionalStageAllowed(capture, 2_000)) await captureFrameworkState(capture, prefix, files);
  await awaitPauseCheckpoint(capture);
  await files.flush?.();
  return { coreAdmitted };
}

async function captureFastPreReloadCheckpoint(capture, files) {
  const prefix = 'current_state';
  sendProgress('Current page checkpoint: preserving DOM and viewport before reloadâ€¦', 10);
  const results = await bestEffort(
    () => executeScript({
      target: { tabId: capture.tabId },
      func: () => ({
        url: location.href,
        title: document.title,
        readyState: document.readyState,
        doctype: document.doctype ? `<!DOCTYPE ${document.doctype.name}>` : '',
        html: document.documentElement?.outerHTML || '',
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio }
      })
    }, 'Fast pre-reload DOM checkpoint', 60_000),
    capture.warnings,
    'Fast pre-reload DOM checkpoint'
  );
  const checkpoint = results?.[0]?.result || null;
  if (checkpoint?.html) addText(files, `${prefix}/main_frame/rendered_dom.html`, `${checkpoint.doctype || ''}\n${checkpoint.html}`);
  addJson(files, `${prefix}/fast_pre_reload_checkpoint.json`, {
    url: sanitizedUrl(checkpoint?.url || capture.currentPageUrl),
    title: checkpoint?.title || capture.originalTitle,
    readyState: checkpoint?.readyState || null,
    viewport: checkpoint?.viewport || null,
    purpose: 'Lightweight state preserved before the authoritative full post-reload Fast capture.',
    complete: Boolean(checkpoint?.html)
  });
  const screenshot = await bestEffort(
    () => cdp(capture.tabId, 'Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, 20_000),
    capture.warnings,
    'Fast pre-reload viewport screenshot'
  );
  if (screenshot?.data) addBase64(files, `${prefix}/visual_viewport.png`, screenshot.data);
  addJson(files, `${prefix}/visual_manifest.json`, {
    viewportFile: screenshot?.data ? `${prefix}/visual_viewport.png` : null,
    fullPage: null,
    complete: Boolean(screenshot?.data),
    scope: 'pre-reload-checkpoint-only',
    authoritativeFullState: 'after_reload'
  });
  await Promise.all([
    captureCookieMetadata(capture, files, prefix),
    captureLiveInstrumentation(capture, files, prefix)
  ]);
  await files.flush?.();
}

function stagedJson(files, path) {
  const file = files.get(path);
  if (!file?.data) return null;
  try { return JSON.parse(file.data); } catch { return null; }
}

function completeCoreEvidenceRoot(files, prefix) {
  const elements = stagedJson(files, `${prefix}/main_frame/elements_computed_manifest.json`);
  const visual = stagedJson(files, `${prefix}/visual_manifest.json`);
  return elements?.complete === true &&
    files.has(`${prefix}/main_frame/rendered_dom.html`) &&
    files.has(`${prefix}/cdp/dom_snapshot.json`) &&
    files.has(`${prefix}/cdp/accessibility_tree.json`) &&
    files.has(`${prefix}/page_snapshot.mhtml`) &&
    visual?.complete === true;
}

function usableFiniteMaxEvidenceRoot(files, prefix) {
  const elements = stagedJson(files, `${prefix}/main_frame/elements_computed_manifest.json`);
  const visual = stagedJson(files, `${prefix}/visual_manifest.json`);
  return elements?.complete === true &&
    files.has(`${prefix}/main_frame/rendered_dom.html`) &&
    files.has(`${prefix}/cdp/dom_snapshot.json`) &&
    files.has(`${prefix}/cdp/accessibility_tree.json`) &&
    files.has(`${prefix}/page_snapshot.mhtml`) &&
    files.has(`${prefix}/visual_viewport.png`) &&
    Boolean(visual);
}

async function runLazyLoadSweep(capture, files, prefix, progress = 42) {
  await awaitPauseCheckpoint(capture);
  await captureDynamicSurfaceProfile(capture, files, prefix);
  sendProgress('Sweeping the real scroll surface to trigger lazy content and motion…', progress);
  const sweepStartedAt = Date.now();
  const results = await bestEffort(
    () => withOperationTimeout(chrome.scripting.executeScript({
      target: { tabId: capture.tabId, allFrames: true },
      func: async () => {
        const startedAt = performance.now();
        const maximumDurationMs = 20_000;
        const pathFor = (element) => {
          if (!(element instanceof Element)) return null;
          const segments = [];
          let current = element;
          while (current && current !== document.documentElement && segments.length < 16) {
            let segment = current.localName || 'element';
            if (current.id) { segment += `#${CSS.escape(current.id)}`; segments.unshift(segment); break; }
            const parent = current.parentElement;
            if (parent) {
              const peers = [...parent.children].filter((node) => node.localName === current.localName);
              if (peers.length > 1) segment += `:nth-of-type(${peers.indexOf(current) + 1})`;
            }
            segments.unshift(segment);
            current = parent;
          }
          return segments.join(' > ');
        };
        const documentRoot = document.scrollingElement || document.documentElement;
        const score = (element) => {
          const style = getComputedStyle(element);
          const marker = /lenis|locomotive|smooth|scroll-root|scroll-container|virtual-scroll/i.test(`${element.id || ''} ${typeof element.className === 'string' ? element.className : ''}`);
          const rect = element.getBoundingClientRect();
          const coverage = Math.min(1, Math.max(0, rect.width * rect.height) / Math.max(1, innerWidth * innerHeight));
          return Math.max(0, element.scrollHeight - element.clientHeight, (element.scrollWidth - element.clientWidth) * 0.8) + coverage * 2500 + (marker ? 6000 : 0) + (/auto|scroll|overlay/.test(`${style.overflowX} ${style.overflowY}`) ? 1200 : 0);
        };
        // Do not sort live elements with an expensive score callback. Array.sort
        // can call that callback O(n log n) times and every score forces style
        // and layout reads; on virtualized/video pages that can monopolize the
        // renderer for minutes even though the surrounding promise has timed
        // out. Scan once, cache each score, and stop the trigger-only discovery
        // pass at a deterministic renderer-safety boundary. The complete DOM and
        // computed-style evidence is captured separately, so this boundary only
        // limits which secondary scroll surfaces are exercised.
        const candidateScanStartedAt = performance.now();
        const candidateScanMaximumMs = 4_000;
        const candidateScanMaximumElements = 50_000;
        const scoredCandidates = [];
        const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
        let scannedElements = 0;
        let scanStoppedByTime = false;
        let element = walker.currentNode;
        while (element && scannedElements < candidateScanMaximumElements) {
          if (scannedElements > 0 && scannedElements % 128 === 0 && performance.now() - candidateScanStartedAt >= candidateScanMaximumMs) {
            scanStoppedByTime = true;
            break;
          }
          if ((element.scrollHeight - element.clientHeight > 4 || element.scrollWidth - element.clientWidth > 4) && element.clientHeight > 1 && element.clientWidth > 1) {
            scoredCandidates.push({ element, score: score(element) });
          }
          scannedElements += 1;
          element = walker.nextNode();
        }
        const scanStoppedByCount = Boolean(element) && scannedElements >= candidateScanMaximumElements;
        if (!scoredCandidates.some((entry) => entry.element === documentRoot)) scoredCandidates.push({ element: documentRoot, score: score(documentRoot) });
        scoredCandidates.sort((a, b) => b.score - a.score);
        const candidates = scoredCandidates.map((entry) => entry.element);
        const root = candidates[0] || documentRoot;
        const primaryDurationMs = candidates.length > 1 ? Math.floor(maximumDurationMs * 0.62) : maximumDurationMs;
        const rootKind = root === documentRoot ? 'document' : 'element';
        const axis = root.scrollHeight - root.clientHeight > 4 ? 'vertical' : 'horizontal';
        const startX = root.scrollLeft;
        const startY = root.scrollTop;
        const rangeFor = () => Math.max(0, axis === 'horizontal' ? root.scrollWidth - root.clientWidth : root.scrollHeight - root.clientHeight);
        const moveTo = (value) => {
          try { root.scrollTo({ top: axis === 'horizontal' ? startY : value, left: axis === 'horizontal' ? value : startX, behavior: 'instant' }); }
          catch { if (axis === 'horizontal') root.scrollLeft = value; else root.scrollTop = value; }
        };
        moveTo(0);
        let position = 0;
        let steps = 0;
        const checkpoints = [];
        while (
          position < rangeFor() &&
          steps < 240 &&
          performance.now() - startedAt < primaryDurationMs
        ) {
          position = Math.min(rangeFor(), position + Math.max(300, Math.floor((axis === 'horizontal' ? root.clientWidth : root.clientHeight) * 0.8)));
          moveTo(position);
          await new Promise((resolve) => { setTimeout(resolve, 100); });
          steps += 1;
          if (steps === 1 || steps % 10 === 0) {
            const visibleImages = [...document.images].filter((image) => {
              const rect = image.getBoundingClientRect();
              return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
            }).length;
            checkpoints.push({
              step: steps,
              requestedTop: position,
              actualTop: axis === 'horizontal' ? root.scrollLeft : root.scrollTop,
              scrollSurfaceHeight: root.scrollHeight,
              scrollSurfaceClientHeight: root.clientHeight,
              images: document.images.length,
              visibleImages,
              iframes: document.querySelectorAll('iframe').length,
              animations: document.getAnimations?.({ subtree: true })?.length || 0
            });
          }
        }
        await new Promise((resolve) => { setTimeout(resolve, 500); });
        try { root.scrollTo({ top: startY, left: startX, behavior: 'instant' }); } catch { root.scrollTop = startY; root.scrollLeft = startX; }
        const secondarySweeps = [];
        for (const surface of candidates.slice(1, 5)) {
          if (performance.now() - startedAt >= maximumDurationMs) break;
          const secondaryAxis = surface.scrollHeight - surface.clientHeight > 4 ? 'vertical' : 'horizontal';
          const secondaryRange = Math.max(0, secondaryAxis === 'horizontal' ? surface.scrollWidth - surface.clientWidth : surface.scrollHeight - surface.clientHeight);
          if (secondaryRange <= 4) continue;
          const secondaryStartX = surface.scrollLeft;
          const secondaryStartY = surface.scrollTop;
          const positions = [];
          for (const fraction of [0, 0.5, 1]) {
            if (performance.now() - startedAt >= maximumDurationMs) break;
            const requestedTop = Math.round(secondaryRange * fraction);
            try { surface.scrollTo({ top: secondaryAxis === 'horizontal' ? secondaryStartY : requestedTop, left: secondaryAxis === 'horizontal' ? requestedTop : secondaryStartX, behavior: 'instant' }); }
            catch { if (secondaryAxis === 'horizontal') surface.scrollLeft = requestedTop; else surface.scrollTop = requestedTop; }
            await new Promise((resolve) => { setTimeout(resolve, 100); });
            positions.push({ fraction, requestedTop, actualTop: secondaryAxis === 'horizontal' ? surface.scrollLeft : surface.scrollTop });
          }
          try { surface.scrollTo({ top: secondaryStartY, left: secondaryStartX, behavior: 'instant' }); } catch { surface.scrollTop = secondaryStartY; surface.scrollLeft = secondaryStartX; }
          secondarySweeps.push({ selector: pathFor(surface), axis: secondaryAxis, range: secondaryRange, positions, reachedEnd: positions.some((entry) => Math.abs(entry.actualTop - secondaryRange) <= Math.max(4, secondaryRange * 0.01)) });
        }
        const finalDocumentHeight = root.scrollHeight;
        const finalRange = rangeFor();
        const elapsedMs = Math.round(performance.now() - startedAt);
        const timeBudgetReached = elapsedMs >= maximumDurationMs && position < finalRange;
        return {
          scrollSurface: { kind: rootKind, selector: rootKind === 'document' ? null : pathFor(root), axis, startTop: axis === 'horizontal' ? startX : startY, clientHeight: root.clientHeight, clientWidth: root.clientWidth, scrollHeight: root.scrollHeight, scrollWidth: root.scrollWidth, range: finalRange },
          steps,
          checkpoints,
          secondarySweeps,
          candidateScan: {
            scannedElements,
            scrollableCandidates: candidates.length,
            maximumElements: candidateScanMaximumElements,
            maximumDurationMs: candidateScanMaximumMs,
            stoppedByTime: scanStoppedByTime,
            stoppedByCount: scanStoppedByCount
          },
          finalDocumentHeight,
          reachedEnd: position >= finalRange,
          truncated: (steps >= 240 || timeBudgetReached) && position < finalRange,
          timeBudgetReached,
          elapsedMs,
          maximumDurationMs
        };
      }
    }), `${prefix} lazy-load sweep`, 30_000),
    capture.warnings,
    `${prefix} lazy-load sweep`
  );
  capture.lastNetworkActivity = Date.now();
  const networkWaitStarted = Date.now();
  while (Date.now() - networkWaitStarted < 15_000) {
    await awaitPauseCheckpoint(capture);
    const quietFor = Date.now() - capture.lastNetworkActivity;
    if (capture.activeRequests.size === 0 && quietFor >= 1_000) break;
    await sleep(250);
  }
  if (results) {
    const frames = results.map((frame) => ({ frameId: frame.frameId, documentId: frame.documentId || null, ...redactJson(frame.result || {}) }));
    const mainSurface = frames[0]?.scrollSurface;
    const cachedProfile = capture.dynamicSurfaceProfiles?.get(prefix);
    if (cachedProfile?.primary && mainSurface?.range != null) {
      cachedProfile.primary.axis = mainSurface.axis || cachedProfile.primary.axis;
      cachedProfile.primary.range = mainSurface.range;
      cachedProfile.primary.verticalRange = mainSurface.axis === 'horizontal' ? cachedProfile.primary.verticalRange : mainSurface.range;
      cachedProfile.primary.horizontalRange = mainSurface.axis === 'horizontal' ? mainSurface.range : cachedProfile.primary.horizontalRange;
      cachedProfile.primary.scrollHeight = mainSurface.scrollHeight || cachedProfile.primary.scrollHeight;
      cachedProfile.primary.scrollWidth = mainSurface.scrollWidth || cachedProfile.primary.scrollWidth;
      cachedProfile.primary.clientHeight = mainSurface.clientHeight || cachedProfile.primary.clientHeight;
      cachedProfile.primary.clientWidth = mainSurface.clientWidth || cachedProfile.primary.clientWidth;
      cachedProfile.afterSweep = mainSurface;
    }
    const truncatedFrames = frames.filter((frame) => frame.truncated).map((frame) => frame.frameId);
    addJson(files, `${prefix}/forensics/lazy_load_sweep.json`, {
      frames,
      truncatedFrames,
      complete: truncatedFrames.length === 0,
      operationElapsedMs: Date.now() - sweepStartedAt,
      networkWaitMs: Date.now() - networkWaitStarted,
      activeRequestsAfterWait: capture.activeRequests.size
    });
    if (truncatedFrames.length) capture.warnings.push(`${prefix} lazy-load sweep reached its 20-second or 240-step safety boundary in ${truncatedFrames.length} frame(s); continuing.`);
  } else {
    addJson(files, `${prefix}/forensics/lazy_load_sweep.json`, {
      frames: [],
      truncatedFrames: [],
      complete: false,
      stopReason: 'operation-timeout-or-error',
      operationElapsedMs: Date.now() - sweepStartedAt,
      networkWaitMs: Date.now() - networkWaitStarted,
      activeRequestsAfterWait: capture.activeRequests.size
    });
  }
  await awaitPauseCheckpoint(capture);
}

async function captureMutationTimeline(capture, files, prefix, durationMs = 4000) {
  if (!capture.options.forensicMode) return;
  await captureDynamicSurfaceProfile(capture, files, prefix);
  sendProgress('Recording DOM, attribute, text and lazy-load changes…', 43);
  const results = await bestEffort(
    () => executeScript({
      target: { tabId: capture.tabId, allFrames: true },
      func: async (duration) => {
        const SECRET = /pass(?:word|wd)?|secret|token|api[-_]?key|auth(?:orization)?|cookie|session|csrf|xsrf|private[-_]?key/i;
        const clean = (value, key = '') => SECRET.test(key) ? '[REDACTED]' : String(value ?? '').slice(0, 1000);
        const pathFor = (node) => {
          if (!(node instanceof Element)) return node?.nodeName || 'node';
          const parts = [];
          let current = node;
          while (current && parts.length < 12) {
            let part = current.localName || 'element';
            if (current.id) { part += `#${current.id}`; parts.unshift(part); break; }
            const siblings = current.parentElement ? [...current.parentElement.children].filter((item) => item.localName === current.localName) : [];
            if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
            parts.unshift(part);
            current = current.parentElement;
          }
          return parts.join(' > ');
        };
        const summarize = (node) => node instanceof Element ? {
          nodeType: 'element',
          tag: node.localName,
          id: clean(node.id, 'id'),
          className: clean(node.className, 'class'),
          path: pathFor(node)
        } : { nodeType: node?.nodeName || 'node' };
        const events = [];
        let totalMutations = 0;
        const observer = new MutationObserver((records) => {
          totalMutations += records.length;
          for (const record of records) {
            if (events.length >= 5000) break;
            const entry = { timeMs: Math.round(performance.now()), type: record.type, target: pathFor(record.target) };
            if (record.type === 'attributes') {
              entry.attribute = record.attributeName;
              entry.oldValue = clean(record.oldValue, record.attributeName);
              entry.newValue = clean(record.target?.getAttribute?.(record.attributeName), record.attributeName);
            } else if (record.type === 'characterData') {
              entry.oldLength = String(record.oldValue || '').length;
              entry.newLength = String(record.target?.data || '').length;
            } else {
              entry.added = [...record.addedNodes].slice(0, 25).map(summarize);
              entry.removed = [...record.removedNodes].slice(0, 25).map(summarize);
            }
            events.push(entry);
          }
        });
        observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true, attributeOldValue: true, characterDataOldValue: true });
        const documentRoot = document.scrollingElement || document.documentElement;
        const score = (element) => {
          const style = getComputedStyle(element);
          const marker = /lenis|locomotive|smooth|scroll-root|scroll-container|virtual-scroll/i.test(`${element.id || ''} ${typeof element.className === 'string' ? element.className : ''}`);
          const rect = element.getBoundingClientRect();
          const coverage = Math.min(1, Math.max(0, rect.width * rect.height) / Math.max(1, innerWidth * innerHeight));
          return Math.max(0, element.scrollHeight - element.clientHeight, (element.scrollWidth - element.clientWidth) * 0.8) + coverage * 2500 + (marker ? 6000 : 0) + (/auto|scroll|overlay/.test(`${style.overflowX} ${style.overflowY}`) ? 1200 : 0);
        };
        const root = [documentRoot, ...document.querySelectorAll('*')]
          .filter((element) => (element.scrollHeight - element.clientHeight > 4 || element.scrollWidth - element.clientWidth > 4) && element.clientHeight > 1 && element.clientWidth > 1)
          .sort((a, b) => score(b) - score(a))[0] || documentRoot;
        const axis = root.scrollHeight - root.clientHeight > 4 ? 'vertical' : 'horizontal';
        const startX = root.scrollLeft;
        const startY = root.scrollTop;
        const started = performance.now();
        let position = axis === 'horizontal' ? startX : startY;
        while (performance.now() - started < duration) {
          const range = Math.max(0, axis === 'horizontal' ? root.scrollWidth - root.clientWidth : root.scrollHeight - root.clientHeight);
          position += Math.max(250, Math.floor((axis === 'horizontal' ? root.clientWidth : root.clientHeight) * 0.7));
          if (position >= range) position = 0;
          try { root.scrollTo({ top: axis === 'horizontal' ? startY : position, left: axis === 'horizontal' ? position : startX, behavior: 'instant' }); } catch { if (axis === 'horizontal') root.scrollLeft = position; else root.scrollTop = position; }
          await new Promise((resolve) => { setTimeout(resolve, 180); });
        }
        try { root.scrollTo({ top: startY, left: startX, behavior: 'instant' }); } catch { root.scrollTop = startY; root.scrollLeft = startX; }
        await new Promise((resolve) => { setTimeout(resolve, 250); });
        observer.disconnect();
        return {
          format: 'mutation-delta-v1',
          baseline: 'DOM state immediately before this observer window',
          fullSnapshotRepeatedDuringObservation: false,
          scrollSurface: { kind: root === documentRoot ? 'document' : 'element', selector: root === documentRoot ? null : pathFor(root), axis, range: Math.max(0, axis === 'horizontal' ? root.scrollWidth - root.clientWidth : root.scrollHeight - root.clientHeight), startTop: axis === 'horizontal' ? startX : startY },
          durationMs: Math.round(performance.now() - started),
          totalMutations,
          recordedMutations: events.length,
          truncated: events.length >= 5000,
          events
        };
      },
      args: [Math.min(10_000, Math.max(1000, durationMs))]
    }, `${prefix} mutation timeline script`),
    capture.warnings,
    `${prefix} mutation timeline`
  );
  if (!results) return;
  for (const frame of results) {
    if (frame.result) addJson(files, `${prefix}/forensics/mutation_timeline_frame_${frame.frameId}.json`, redactJson(frame.result));
  }
  capture.lastNetworkActivity = Date.now();
  await sleep(750);
}

async function captureOriginIntelligence(capture, files, prefix) {
  if (!capture.options.forensicMode) return;
  const origin = (() => { try { return new URL(capture.currentPageUrl || capture.originalUrl).origin; } catch { return null; } })();
  capture.originIntelligenceReferences ||= new Map();
  const existingReference = origin ? capture.originIntelligenceReferences.get(origin) : null;
  if (origin && !existingReference) capture.originIntelligenceReferences.set(origin, prefix);
  const includeOriginContents = !existingReference;
  sendProgress('Collecting origin storage, fonts, CSS rules, policies and runtime data…', 58);
  const pageData = await bestEffort(
    () => withOperationTimeout(chrome.scripting.executeScript({
      target: { tabId: capture.tabId, allFrames: true },
      func: async (includeOriginWideData) => {
        const output = {
          url: location.href,
          secureContext: isSecureContext,
          originWideDataCaptured: includeOriginWideData,
          storageEstimate: null,
          storagePersisted: null,
          opfs: { available: false, entries: [], truncated: false, error: null },
          fonts: [],
          cssRules: [],
          customGlobals: [],
          navigation: null
        };
        if (includeOriginWideData) try { output.storageEstimate = await navigator.storage?.estimate?.(); } catch {}
        if (includeOriginWideData) try { output.storagePersisted = await navigator.storage?.persisted?.(); } catch {}
        if (includeOriginWideData) try {
          const root = await navigator.storage?.getDirectory?.();
          if (root) {
            output.opfs.available = true;
            const walk = async (directory, path = '', depth = 0) => {
              if (depth > 8 || output.opfs.entries.length >= 5000) { output.opfs.truncated = true; return; }
              for await (const [name, handle] of directory.entries()) {
                if (output.opfs.entries.length >= 5000) { output.opfs.truncated = true; break; }
                const entryPath = path ? `${path}/${name}` : name;
                if (handle.kind === 'file') {
                  try {
                    const file = await handle.getFile();
                    output.opfs.entries.push({ path: entryPath, kind: 'file', size: file.size, type: file.type, lastModified: file.lastModified });
                  } catch { output.opfs.entries.push({ path: entryPath, kind: 'file', unreadable: true }); }
                } else {
                  output.opfs.entries.push({ path: entryPath, kind: 'directory' });
                  await walk(handle, entryPath, depth + 1);
                }
              }
            };
            await walk(root);
          }
        } catch (error) { output.opfs.error = error?.message || String(error); }
        try {
          output.fonts = [...document.fonts].slice(0, 1000).map((font) => ({
            family: font.family,
            status: font.status,
            style: font.style,
            weight: font.weight,
            stretch: font.stretch,
            unicodeRange: font.unicodeRange,
            variationSettings: font.variationSettings,
            featureSettings: font.featureSettings
          }));
        } catch {}
        try {
          const visitRules = (rules, sheetIndex, depth = 0) => {
            if (!rules || depth > 8 || output.cssRules.length >= 10_000) return;
            for (const rule of [...rules]) {
              if (output.cssRules.length >= 10_000) break;
              const item = { sheetIndex, type: rule.constructor?.name || String(rule.type), conditionText: rule.conditionText || null, name: rule.name || null, cssText: String(rule.cssText || '').slice(0, 4000) };
              output.cssRules.push(item);
              try { if (rule.cssRules) visitRules(rule.cssRules, sheetIndex, depth + 1); } catch {}
            }
          };
          [...document.styleSheets].forEach((sheet, index) => { try { visitRules(sheet.cssRules, index); } catch {} });
        } catch {}
        try {
          const standard = new Set(['window','self','document','name','location','customElements','history','navigation','locationbar','menubar','personalbar','scrollbars','statusbar','toolbar','status','closed','frames','length','top','opener','parent','frameElement','navigator','origin','external','screen','innerWidth','innerHeight','scrollX','pageXOffset','scrollY','pageYOffset','visualViewport','screenX','screenY','outerWidth','outerHeight','devicePixelRatio','event','clientInformation','screenLeft','screenTop','styleMedia','onsearch','isSecureContext','trustedTypes','performance','crypto','indexedDB','sessionStorage','localStorage','scheduler','alert','atob','blur','btoa','cancelAnimationFrame','cancelIdleCallback','captureEvents','clearInterval','clearTimeout','close','confirm','createImageBitmap','fetch','find','focus','getComputedStyle','getSelection','matchMedia','moveBy','moveTo','open','postMessage','print','prompt','queueMicrotask','releaseEvents','reportError','requestAnimationFrame','requestIdleCallback','resizeBy','resizeTo','scroll','scrollBy','scrollTo','setInterval','setTimeout','stop','structuredClone']);
          output.customGlobals = Object.getOwnPropertyNames(window).filter((name) => !standard.has(name) && !name.startsWith('on')).slice(0, 3000).map((name) => {
            let type = 'unreadable';
            try { type = typeof window[name]; } catch {}
            return { name, type };
          });
        } catch {}
        try {
          const nav = performance.getEntriesByType('navigation')[0];
          if (nav) output.navigation = nav.toJSON ? nav.toJSON() : null;
        } catch {}
        return output;
      },
      args: [includeOriginContents]
    }), `${prefix} origin page intelligence`, 30_000),
    capture.warnings,
    `${prefix} origin intelligence`
  );
  if (pageData) {
    for (const frame of pageData) {
      if (frame.result) addJson(files, `${prefix}/forensics/origin_intelligence_frame_${frame.frameId}.json`, redactJson(frame.result));
    }
  }
  if (existingReference) {
    addJson(files, `${prefix}/forensics/origin_intelligence_reference.json`, {
      origin,
      referencePrefix: existingReference,
      capturedOncePerOrigin: true,
      pageSpecificIntelligenceCapturedHere: true,
      reusedEvidence: ['storage estimate/persistence', 'OPFS contents', 'WebSQL contents', 'manifest/installability', 'security isolation', 'origin quota']
    });
  }

  const cdpData = {
    storageContentsCaptured: includeOriginContents,
    storageContentsPolicy: includeOriginContents ? 'Captured once for this origin.' : 'Skipped on later same-origin crawl pages; entry-page storage content remains authoritative.',
    mediaQueries: await bestEffort(() => cdp(capture.tabId, 'CSS.getMediaQueries', {}, 10_000), capture.warnings, 'CSS media queries'),
    appManifest: includeOriginContents ? await bestEffort(() => cdp(capture.tabId, 'Page.getAppManifest', {}, 10_000), capture.warnings, 'web app manifest') : { referencePrefix: existingReference },
    installabilityErrors: includeOriginContents ? await bestEffort(() => cdp(capture.tabId, 'Page.getInstallabilityErrors', {}, 10_000), capture.warnings, 'installability errors') : { referencePrefix: existingReference },
    securityIsolationStatus: includeOriginContents ? await bestEffort(() => cdp(capture.tabId, 'Network.getSecurityIsolationStatus', {}, 10_000), capture.warnings, 'security isolation status') : { referencePrefix: existingReference },
    domCounters: await optionalCdp(capture, 'DOM counters', 'Memory.getDOMCounters'),
    originUsage: includeOriginContents && origin ? await bestEffort(() => cdp(capture.tabId, 'Storage.getUsageAndQuota', { origin }, 10_000), capture.warnings, 'origin usage and quota') : (existingReference ? { referencePrefix: existingReference } : null)
  };
  addJson(files, `${prefix}/forensics/cdp_origin_intelligence.json`, redactJson(cdpData));
  if (includeOriginContents) {
    await captureOpfsContents(capture, files, prefix);
    await captureWebSql(capture, files, prefix);
  }
  await files.flush?.();
}

async function capturePseudoStateMatrix(capture, files, prefix, timeBudgetMs = pseudoStateBudget(capture)) {
  if (!capture.options.forensicMode) return;
  const startedAt = Date.now();
  const boundedTimeBudgetMs = Math.max(1, Number(timeBudgetMs) || pseudoStateBudget(capture));
  let deadline = startedAt + boundedTimeBudgetMs;
  sendProgress('Sampling safe hover, focus and active CSS states…', 65);
  const runCdp = (method, params = {}) => {
    if (Date.now() >= deadline) throw new Error('Pseudo-state stage time budget reached.');
    return cdp(capture.tabId, method, params, remainingStageTimeout(deadline, PSEUDO_STATE_COMMAND_TIMEOUT_MS));
  };
  const documentResult = await bestEffort(() => runCdp('DOM.getDocument', { depth: 1, pierce: true }), capture.warnings, 'pseudo-state document');
  if (!documentResult?.root?.nodeId) return;
  const found = await bestEffort(
    () => runCdp('DOM.querySelectorAll', {
      nodeId: documentResult.root.nodeId,
      selector: 'a,button,input,select,textarea,summary,[role="button"],[role="tab"],[tabindex]'
    }),
    capture.warnings,
    'interactive nodes for pseudo states'
  );
  const candidateNodeIds = found?.nodeIds || [];
  const nodeIds = candidateNodeIds.slice(0, PSEUDO_STATE_NODE_LIMIT);
  const states = ['hover', 'active', 'focus', 'focus-visible'];
  const output = [];
  let attemptedNodes = 0;
  let failedNodes = 0;
  let stopReason = candidateNodeIds.length > nodeIds.length ? 'node-limit-reached' : null;
  for (const nodeId of nodeIds) {
    deadline += await awaitPauseCheckpoint(capture);
    if (Date.now() >= deadline) {
      stopReason = 'time-budget-reached';
      break;
    }
    attemptedNodes += 1;
    try {
      const described = await runCdp('DOM.describeNode', { nodeId, depth: 0 });
      const baseResult = await runCdp('CSS.getComputedStyleForNode', { nodeId });
      const base = Object.fromEntries((baseResult?.computedStyle || []).map((item) => [item.name, item.value]));
      const stateDiffs = {};
      for (const state of states) {
        await runCdp('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [state] });
        const changedResult = await runCdp('CSS.getComputedStyleForNode', { nodeId });
        const diff = {};
        for (const item of changedResult?.computedStyle || []) {
          if (base[item.name] !== item.value) diff[item.name] = { base: base[item.name], value: item.value };
        }
        stateDiffs[state] = diff;
      }
      await runCdp('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
      output.push({ nodeId, backendNodeId: described?.node?.backendNodeId, nodeName: described?.node?.nodeName, attributes: redactJson(described?.node?.attributes || []), states: stateDiffs });
    } catch (error) {
      failedNodes += 1;
      if (Date.now() < deadline && !/time budget reached|timed out after 0s/i.test(error?.message || String(error))) {
        capture.warnings.push(`Pseudo-state node ${nodeId}: ${error?.message || String(error)}`);
      }
      await cdp(capture.tabId, 'CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] }, 2_000).catch(() => {});
      if (Date.now() >= deadline) {
        stopReason = 'time-budget-reached';
        break;
      }
    }
    if (attemptedNodes < nodeIds.length && attemptedNodes % 6 === 0) {
      sendProgress(`Sampling CSS states… ${attemptedNodes}/${nodeIds.length}`, 65);
    }
  }
  const elapsedMs = Date.now() - startedAt;
  if (stopReason === 'time-budget-reached') {
    capture.warnings.push(`${prefix} pseudo-state sampling: time budget reached after ${attemptedNodes}/${nodeIds.length} selected nodes (${Math.round(elapsedMs / 1000)}s); continuing with the rest of the capture.`);
    sendProgress(`CSS-state sampling time limit reached at ${attemptedNodes}/${nodeIds.length}; continuing…`, 66);
  }
  addJson(files, `${prefix}/forensics/pseudo_state_matrix.json`, {
    candidateNodes: candidateNodeIds.length,
    selectedNodes: nodeIds.length,
    attemptedNodes,
    inspectedNodes: output.length,
    failedNodes,
    configuredLimit: PSEUDO_STATE_NODE_LIMIT,
    complete: candidateNodeIds.length === nodeIds.length && attemptedNodes === nodeIds.length && failedNodes === 0,
    stopReason,
    timeBudgetMs: boundedTimeBudgetMs,
    elapsedMs,
    states,
    nodes: output
  });
  await files.flush?.();
}

async function discoverCurrentPage(capture, prefix = 'page-discovery') {
  const results = await executeScript({
    target: { tabId: capture.tabId },
    func: () => {
      const fingerprint = (value) => {
        let first = 0x811c9dc5;
        let second = 0x9e3779b9;
        for (let index = 0; index < value.length; index += 1) {
          const code = value.charCodeAt(index);
          first = Math.imul(first ^ code, 0x01000193);
          second = Math.imul(second ^ code, 0x85ebca6b);
        }
        return `${value.length}:${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
      };
      const elements = [...document.querySelectorAll('*')].slice(0, 25_000);
      const structureSource = elements.map((element) => `${element.localName}[${[...element.attributes].map((attribute) => attribute.name).sort().join(',')}]`).join('\n');
      const contentBlocks = [];
      for (let index = 0; index < elements.length && contentBlocks.length < 2000; index += 1) {
        const element = elements[index];
        const text = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent || '').join(' ').replace(/\s+/g, ' ').trim();
        const attributes = {};
        for (const name of ['href', 'src', 'srcset', 'alt', 'title', 'role', 'class', 'aria-label']) {
          if (element.hasAttribute(name)) attributes[name] = (element.getAttribute(name) || '').slice(0, 1000);
        }
        if (text || Object.keys(attributes).length) contentBlocks.push({ elementIndex: index, tag: element.localName, text: text.slice(0, 1000), attributes });
      }
      const html = document.documentElement?.outerHTML || '';
      return {
        title: document.title,
        url: location.href,
        contentType: document.contentType,
        canonicalUrl: document.querySelector('link[rel="canonical"]')?.href || null,
        links: [...new Set([...document.querySelectorAll('a[href]')].map((anchor) => anchor.href).filter(Boolean))],
        structureFingerprint: fingerprint(`${elements.length}:${structureSource}`),
        contentFingerprint: fingerprint(`${html.length}:${html}`),
        fingerprintedElementCount: elements.length,
        contentBlocks
      };
    }
  }, `${prefix} origin storage script`, 45_000);
  return results?.[0]?.result || { title: '', url: capture.currentPageUrl, contentType: '', canonicalUrl: null, links: [] };
}

function recordStructuralComparison(capture, files, prefix, info) {
  if (!info?.structureFingerprint) return { exactDuplicate: false, baseline: null };
  capture.structuralBaselines ||= new Map();
  const baseline = capture.structuralBaselines.get(info.structureFingerprint);
  if (!baseline) {
    capture.structuralBaselines.set(info.structureFingerprint, {
      prefix,
      url: sanitizedUrl(info.url),
      contentFingerprint: info.contentFingerprint,
      contentBlocks: info.contentBlocks || []
    });
    addJson(files, `${prefix}/forensics/structural_delta.json`, {
      role: 'structure-baseline',
      structureFingerprint: info.structureFingerprint,
      contentFingerprint: info.contentFingerprint,
      fingerprintedElementCount: info.fingerprintedElementCount,
      retainedContentBlocks: (info.contentBlocks || []).length
    });
    return { exactDuplicate: false, baseline: null };
  }
  const baselineByIndex = new Map((baseline.contentBlocks || []).map((block) => [block.elementIndex, block]));
  const changedBlocks = (info.contentBlocks || []).filter((block) => JSON.stringify(block) !== JSON.stringify(baselineByIndex.get(block.elementIndex))).map((block) => redactJson(block));
  const currentIndexes = new Set((info.contentBlocks || []).map((block) => block.elementIndex));
  const removedElementIndexes = (baseline.contentBlocks || []).filter((block) => !currentIndexes.has(block.elementIndex)).map((block) => block.elementIndex);
  const exactDuplicate = baseline.contentFingerprint === info.contentFingerprint;
  addJson(files, `${prefix}/forensics/structural_delta.json`, {
    role: exactDuplicate ? 'exact-content-match-supplement' : 'structurally-identical-content-delta',
    baselinePrefix: baseline.prefix,
    baselineUrl: baseline.url,
    structureFingerprint: info.structureFingerprint,
    contentFingerprint: info.contentFingerprint,
    exactDuplicate,
    coreCaptureReplaced: false,
    changedBlocks,
    removedElementIndexes,
    retainedOnlyDifferencesInThisFile: true
  });
  return { exactDuplicate, baseline };
}

async function exploreSafeUiStates(capture, files, prefix) {
  if (!capture.options.forensicMode) return { links: [], changedControls: 0 };
  const interactionBudgetMs = unlimitedAwareStageBudget(capture, 25_000);
  sendProgress('Exploring safe menus, tabs, accordions and disclosure controls…', capture.liveProgress || 60);
  const results = await bestEffort(
    () => executeScript({
      target: { tabId: capture.tabId },
      func: async (maximumDurationMs) => {
        const startedAt = performance.now();
        const deadline = startedAt + maximumDurationMs;
        const BLOCKED = /delete|remove|erase|buy|pay|checkout|purchase|order|book|logout|sign\s*out|submit|save|send|upload|download|confirm|accept|install|subscribe|unsubscribe/i;
        const selector = 'summary,[aria-controls],[aria-expanded],[role="tab"],[role="switch"],[data-toggle],[data-bs-toggle]';
        const beforeLinks = new Set([...document.querySelectorAll('a[href]')].map((node) => node.href));
        const discoveredLinks = new Set();
        const records = [];
        const candidates = [...document.querySelectorAll(selector)].filter((element) => {
          if (!(element instanceof HTMLElement) || !element.isConnected) return false;
          if (element.closest('form,a[href]') || element.matches(':disabled,[aria-disabled="true"]')) return false;
          if (element.hasAttribute('href') || element.hasAttribute('data-href') || element.hasAttribute('routerlink') || element.hasAttribute('to')) return false;
          const inline = element.getAttribute('onclick') || '';
          if (/location|navigate|router|push|replace|submit|fetch|xmlhttprequest/i.test(inline)) return false;
          const label = `${element.getAttribute('aria-label') || ''} ${element.textContent || ''}`.trim().slice(0, 300);
          return !BLOCKED.test(label);
        }).slice(0, 60);
        let attemptedControls = 0;
        for (let index = 0; index < candidates.length; index += 1) {
          if (performance.now() >= deadline) break;
          attemptedControls += 1;
          const element = candidates[index];
          const controlledId = element.getAttribute('aria-controls');
          const controlled = controlledId ? document.getElementById(controlledId) : null;
          const previouslySelectedTab = element.getAttribute('role') === 'tab'
            ? element.closest('[role="tablist"]')?.querySelector('[role="tab"][aria-selected="true"]') || null
            : null;
          const before = {
            expanded: element.getAttribute('aria-expanded'),
            selected: element.getAttribute('aria-selected'),
            checked: element.getAttribute('aria-checked'),
            open: element.closest('details')?.open ?? null,
            controlledHtml: controlled?.outerHTML?.slice(0, 100000) || null
          };
          let mutations = 0;
          const observer = new MutationObserver((entries) => { mutations += entries.length; });
          observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
          try { element.click(); } catch {}
          await new Promise((resolve) => { setTimeout(resolve, 90); });
          observer.disconnect();
          const after = {
            expanded: element.getAttribute('aria-expanded'),
            selected: element.getAttribute('aria-selected'),
            checked: element.getAttribute('aria-checked'),
            open: element.closest('details')?.open ?? null,
            controlledHtml: controlled?.outerHTML?.slice(0, 100000) || null
          };
          if (mutations || JSON.stringify(before) !== JSON.stringify(after)) {
            for (const link of document.querySelectorAll('a[href]')) {
              if (!beforeLinks.has(link.href)) discoveredLinks.add(link.href);
            }
          }
          let restored = true;
          let restoreAttempted = false;
          if (mutations || JSON.stringify(before) !== JSON.stringify(after)) {
            if (previouslySelectedTab && previouslySelectedTab !== element && previouslySelectedTab.isConnected) {
              restoreAttempted = true;
              try { previouslySelectedTab.click(); } catch {}
            } else if (
              element.matches('summary,[role="switch"],[aria-expanded]') ||
              before.checked !== after.checked ||
              before.expanded !== after.expanded ||
              before.open !== after.open
            ) {
              restoreAttempted = true;
              try { element.click(); } catch {}
            }
            if (restoreAttempted) await new Promise((resolve) => { setTimeout(resolve, 70); });
            const restoredState = {
              expanded: element.getAttribute('aria-expanded'),
              selected: element.getAttribute('aria-selected'),
              checked: element.getAttribute('aria-checked'),
              open: element.closest('details')?.open ?? null,
              controlledHtml: controlled?.outerHTML?.slice(0, 100000) || null
            };
            restored = !restoreAttempted || JSON.stringify(restoredState) === JSON.stringify(before);
            records.push({
              index,
              tag: element.localName,
              id: element.id || null,
              role: element.getAttribute('role'),
              label: (element.getAttribute('aria-label') || element.textContent || '').trim().slice(0, 500),
              mutations,
              before,
              after,
              restoreAttempted,
              restored,
              restoredState,
              controlHtml: element.outerHTML.slice(0, 50000)
            });
          }
        }
        return {
          attemptedControls,
          configuredControls: candidates.length,
          completedControls: attemptedControls,
          changedControls: records.length,
          restorationFailures: records.filter((record) => record.restoreAttempted && !record.restored).length,
          records,
          discoveredLinks: [...discoveredLinks],
          finalUrl: location.href,
          stopReason: performance.now() >= deadline ? 'time-budget-reached' : null,
          timeBudgetMs: maximumDurationMs,
          elapsedMs: Math.round(performance.now() - startedAt)
        };
      },
      args: [interactionBudgetMs]
    }, `${prefix} safe interaction explorer script`),
    capture.warnings,
    `${prefix} safe interaction explorer`
  );
  const result = results?.[0]?.result || { attemptedControls: 0, changedControls: 0, records: [], discoveredLinks: [] };
  if (result.stopReason === 'time-budget-reached') capture.warnings.push(`${prefix} safe interaction explorer reached its ${Math.round(interactionBudgetMs / 1000)}s boundary after ${result.records?.length || 0} changed control state(s); continuing.`);
  addJson(files, `${prefix}/forensics/interaction_explorer.json`, redactJson(result));
  if (result.restorationFailures) {
    const interactionPrefix = `${prefix}/interaction_state`;
    // Preserve the complete final browser state after the bounded interaction
    // pass, not just a screenshot and a reduced CDP style list. This captures
    // newly revealed DOM, all computed properties, MHTML, accessibility and
    // full measured-page pixels under a separate evidence root.
    if (capture.options.mode === 'entire') {
      await runLazyLoadSweep(capture, files, interactionPrefix, capture.liveProgress || 60);
      await captureScriptedPage(capture, interactionPrefix, files, capture.warnings);
      await captureCdpPage(capture.tabId, interactionPrefix, files, capture.warnings);
    } else {
      // Fast already retains every control mutation, before/after state and the
      // authoritative full page. Preserve a lightweight final checkpoint when a
      // control cannot be perfectly restored instead of repeating the entire
      // multi-minute element/style/accessibility/MHTML/visual pipeline.
      const finalState = await bestEffort(
        () => executeScript({ target: { tabId: capture.tabId }, func: () => ({ url: location.href, html: document.documentElement?.outerHTML || '' }) }, `${interactionPrefix} final DOM checkpoint`, 45_000),
        capture.warnings,
        `${interactionPrefix} final DOM checkpoint`
      );
      if (finalState?.[0]?.result?.html) addText(files, `${interactionPrefix}/rendered_dom.html`, finalState[0].result.html);
      const screenshot = await bestEffort(
        () => cdp(capture.tabId, 'Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }, 20_000),
        capture.warnings,
        `${interactionPrefix} viewport screenshot`
      );
      if (screenshot?.data) addBase64(files, `${interactionPrefix}/visual_viewport.png`, screenshot.data);
      addJson(files, `${interactionPrefix}/checkpoint_manifest.json`, {
        url: sanitizedUrl(finalState?.[0]?.result?.url || capture.currentPageUrl),
        dom: finalState?.[0]?.result?.html ? `${interactionPrefix}/rendered_dom.html` : null,
        viewport: screenshot?.data ? `${interactionPrefix}/visual_viewport.png` : null,
        fullMutationEvidence: `${prefix}/forensics/interaction_explorer.json`,
        scope: 'Fast lightweight unrestored-interaction checkpoint'
      });
    }
  }
  capture.interactionStates += result.changedControls || 0;
  await files.flush?.();
  return { links: result.discoveredLinks || [], changedControls: result.changedControls || 0 };
}

async function discoverExtendedRoutes(capture, files, prefix, includeSiteMaps = false) {
  const results = await bestEffort(
    () => withOperationTimeout(chrome.scripting.executeScript({
      target: { tabId: capture.tabId },
      func: async (scanSiteMaps) => {
        const scanDeadline = performance.now() + 18_000;
        const fetchWithTimeout = async (url, options = {}, timeoutMs = 5_000) => {
          const controller = new AbortController();
          const remainingMs = Math.max(1, Math.min(timeoutMs, scanDeadline - performance.now()));
          const timer = setTimeout(() => controller.abort(), remainingMs);
          try { return await fetch(url, { ...options, signal: controller.signal }); }
          finally { clearTimeout(timer); }
        };
        const links = new Set([...document.querySelectorAll('a[href]')].map((node) => node.href));
        const evidence = [];
        for (const element of document.querySelectorAll('[data-href],[data-url],[routerlink],[to]')) {
          for (const name of ['data-href', 'data-url', 'routerlink', 'to']) {
            const value = element.getAttribute(name);
            if (!value) continue;
            try {
              const url = new URL(value, location.href).href;
              links.add(url);
              evidence.push({ source: name, url });
            } catch {}
          }
        }
        for (const element of [...document.querySelectorAll('[onclick]')].slice(0, 2000)) {
          const source = element.getAttribute('onclick') || '';
          for (const match of source.matchAll(/["'`]((?:\/|\.\/|https?:\/\/)[^"'`\s]+)["'`]/g)) {
            try {
              const url = new URL(match[1], location.href).href;
              links.add(url);
              evidence.push({ source: 'onclick-literal', url });
            } catch {}
          }
        }
        const frameworkRoutes = [];
        const nextPages = globalThis.__BUILD_MANIFEST?.sortedPages || globalThis.__BUILD_MANIFEST?.pages;
        if (Array.isArray(nextPages)) frameworkRoutes.push(...nextPages);
        const nextData = globalThis.__NEXT_DATA__;
        if (nextData?.page) frameworkRoutes.push(nextData.page);
        for (const route of frameworkRoutes) {
          try { links.add(new URL(route, location.origin).href); } catch {}
        }
        const sitemap = [];
        const apiRoutes = [];
        if (scanSiteMaps) {
          const pending = ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml'].map((path) => new URL(path, location.origin).href);
          const seen = new Set();
          while (pending.length && seen.size < 12 && performance.now() < scanDeadline) {
            const url = pending.shift();
            if (seen.has(url)) continue;
            seen.add(url);
            try {
              const response = await fetchWithTimeout(url, { credentials: 'include', cache: 'force-cache' });
              if (!response.ok) continue;
              const text = await response.text();
              for (const match of text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
                const found = new DOMParser().parseFromString(`<!doctype html><body>${match[1]}`, 'text/html').body.textContent.trim();
                try {
                  const route = new URL(found, location.origin).href;
                  if (sitemap.length < 20000) sitemap.push(route);
                  if (/\.xml(?:$|\?)/i.test(route) && pending.length < 20) pending.push(route);
                  else if (links.size < 25000) links.add(route);
                } catch {}
              }
            } catch {}
          }
          try {
            if (performance.now() >= scanDeadline) throw new Error('Route-discovery time budget reached.');
            const response = await fetchWithTimeout(new URL('/wp-json/', location.origin), { credentials: 'include', cache: 'force-cache' });
            if (response.ok) {
              const json = await response.json();
              apiRoutes.push(...Object.keys(json?.routes || {}).slice(0, 5000));
            }
          } catch {}
        }
        return { links: [...links].slice(0, 25000), evidence: evidence.slice(0, 5000), frameworkRoutes, sitemap, apiRoutes };
      },
      args: [includeSiteMaps]
    }), `${prefix} extended route discovery`, 25_000),
    capture.warnings,
    `${prefix} extended route discovery`
  );
  const result = results?.[0]?.result || { links: [], evidence: [], frameworkRoutes: [], sitemap: [], apiRoutes: [] };
  addJson(files, `${prefix}/forensics/route_discovery.json`, redactJson(result));
  capture.discoveredRoutes += result.links.length || 0;
  return result.links || [];
}

async function crawlSameOriginSite(capture, files, entryInfo) {
  const origin = new URL(capture.originalUrl).origin;
  const visited = new Set([normalizeCrawlUrl(capture.originalUrl, origin, capture.options.includeQueryStrings)]);
  const capturedFinalUrls = new Set([
    normalizeCrawlUrl(entryInfo.canonicalUrl || entryInfo.url || capture.originalUrl, origin, capture.options.includeQueryStrings)
  ].filter(Boolean));
  const queue = [];
  const safetySkipped = new Set();
  const candidateQueueLimit = Math.min(5000, capture.options.maxPages * 25);
  const enqueue = (links, depth) => {
    if (depth > capture.options.crawlDepth) return;
    for (const raw of links) {
      const safetyReason = crawlSafetyReason(raw, origin);
      if (safetyReason) {
        const safetyKey = `${raw}|${safetyReason}`;
        if (!safetySkipped.has(safetyKey) && capture.crawlSkipped.length < 5000) {
          safetySkipped.add(safetyKey);
          capture.crawlSkipped.push({ url: sanitizedUrl(raw), depth, reason: safetyReason, safetyFiltered: true });
        }
        continue;
      }
      const url = normalizeCrawlUrl(raw, origin, capture.options.includeQueryStrings);
      if (!url || visited.has(url) || queue.some((entry) => entry.url === url)) continue;
      queue.push({ url, depth });
      if (queue.length + visited.size >= candidateQueueLimit) break;
    }
    capture.crawlQueueLength = queue.length;
  };
  enqueue(entryInfo.links, 1);
  let stoppedAtTimeLimit = false;
  let stoppedAfterRendererFailure = false;
  while (queue.length && capture.crawlPages.length < capture.options.maxPages) {
    await awaitPauseCheckpoint(capture);
    if (Number.isFinite(capture.captureDeadlineAt) && Date.now() >= capture.captureDeadlineAt) {
      stoppedAtTimeLimit = true;
      capture.warnings.push(`Max crawl runtime boundary reached after ${capture.crawlPages.length} page(s); finalizing the collected evidence safely.`);
      sendProgress(`Max time limit reached after ${capture.crawlPages.length} page(s); finalizing…`, 76);
      break;
    }
    if (Number.isFinite(capture.captureDeadlineAt) && capture.completedPageTimings.length) {
      const crawlPageTimings = capture.completedPageTimings.slice(1);
      const recentSeconds = crawlPageTimings.slice(-3).sort((left, right) => left - right);
      const entrySeconds = capture.completedPageTimings[0] || 1;
      // Entry capture includes the one-time current-state pass, reload and origin-wide work.
      // Do not project that cost onto every later route; use measured crawl routes as soon as
      // they exist and a conservative fraction of the entry route before then.
      const typicalSeconds = recentSeconds.length
        ? recentSeconds[Math.floor(recentSeconds.length / 2)]
        : Math.min(210, Math.max(90, entrySeconds * 0.34));
      const requiredMs = Math.max(75_000, Math.ceil(typicalSeconds * 1.35 * 1000)) + MAX_FINALIZATION_RESERVE_MS;
      const remainingMs = capture.captureDeadlineAt - Date.now();
      if (remainingMs < requiredMs) {
        stoppedAtTimeLimit = true;
        capture.warnings.push(`Max crawl stopped before starting another page because only ${Math.max(0, Math.round(remainingMs / 1000))}s remained; the next page was estimated to need ${Math.round((requiredMs - MAX_FINALIZATION_RESERVE_MS) / 1000)}s plus ZIP finalization. All completed page evidence remains preserved.`);
        sendProgress(`Max time is nearly reached; finalizing ${capture.crawlPages.length} full page(s)…`, 76);
        break;
      }
    }
    throwIfCancelled(capture);
    const item = queue.shift();
    capture.crawlQueueLength = queue.length;
    if (!item || visited.has(item.url)) continue;
    visited.add(item.url);
    const pageIndex = capture.crawlPages.length;
    capture.currentPageIndex = pageIndex;
    capture.currentPageUrl = item.url;
    capture.runtimeEpoch += 1;
    const pageStartedAt = Date.now();
    const progress = Math.min(70, 68 + Math.round((pageIndex / capture.options.maxPages) * 2));
    capture.liveProgress = progress;
    sendProgress(`Crawling page ${pageIndex + 1}/${capture.options.maxPages}: ${new URL(item.url).pathname}`, progress, { currentPage: pageIndex + 1, maximumPages: capture.options.maxPages });
    try {
      capture.loadSeen = false;
      capture.activeRequests.clear();
      capture.lastNetworkActivity = Date.now();
      const navigation = await cdp(capture.tabId, 'Page.navigate', { url: item.url });
      if (navigation?.errorText) throw new Error(navigation.errorText);
      await waitForSettled(capture);
      sendProgress(`Reading page ${pageIndex + 1} route and structure metadata…`, progress);
      let info = await discoverCurrentPage(capture, `site/discovery/page_${String(pageIndex).padStart(3, '0')}_before_capture`);
      capture.currentPageUrl = info.url || item.url;
      if (new URL(info.url || item.url).origin !== origin) {
        capture.crawlSkipped.push({ url: sanitizedUrl(item.url), finalUrl: sanitizedUrl(info.url), depth: item.depth, reason: 'Redirected outside the selected site origin', safetyFiltered: true });
        continue;
      }
      const redirectedSafetyReason = crawlSafetyReason(info.url || item.url, origin);
      if (redirectedSafetyReason) {
        capture.crawlSkipped.push({ url: sanitizedUrl(item.url), finalUrl: sanitizedUrl(info.url), depth: item.depth, reason: `Redirected to a route blocked by the Max safety policy: ${redirectedSafetyReason}`, safetyFiltered: true });
        continue;
      }
      if (!/^(?:text\/html|application\/xhtml\+xml)$/i.test(info.contentType || '')) {
        capture.crawlSkipped.push({ url: sanitizedUrl(item.url), finalUrl: sanitizedUrl(info.url), depth: item.depth, reason: `Non-HTML document (${info.contentType || 'unknown content type'})` });
        continue;
      }
      const finalKey = normalizeCrawlUrl(info.canonicalUrl || info.url, origin, capture.options.includeQueryStrings);
      if (finalKey && capturedFinalUrls.has(finalKey)) {
        capture.crawlSkipped.push({ url: sanitizedUrl(item.url), finalUrl: sanitizedUrl(info.url), depth: item.depth, reason: 'Duplicate canonical or redirected page' });
        continue;
      }
      if (finalKey) capturedFinalUrls.add(finalKey);

      const prefix = `site/pages/${capturePathLeaf(info.url || item.url, pageIndex)}`;
      recordStructuralComparison(capture, files, prefix, info);
      const record = { index: pageIndex, url: sanitizedUrl(item.url), finalUrl: sanitizedUrl(info.url), canonicalUrl: sanitizedUrl(info.canonicalUrl), contentType: info.contentType, depth: item.depth, prefix, status: 'pending', startedAt: new Date(pageStartedAt).toISOString() };
      capture.crawlPages.push(record);

      await runLazyLoadSweep(capture, files, prefix, progress);
      await captureMutationTimeline(capture, files, prefix, 4000);
      await captureStage(capture, prefix, files, progress, { deep: true, framework: true, label: `Page ${pageIndex + 1} full Max`, deepTimeBudgetMs: MAX_CRAWL_DEEP_INSPECTION_BUDGET_MS });
      if (!completeCoreEvidenceRoot(files, prefix)) {
        stoppedAtTimeLimit = Number.isFinite(capture.captureDeadlineAt) && Date.now() >= capture.captureDeadlineAt - MAX_FINALIZATION_RESERVE_MS;
        throw new Error(stoppedAtTimeLimit
          ? 'The page did not finish a complete core evidence state before Max’s safe archive-finalization window.'
          : 'The page did not return every required core evidence artifact and was excluded from completed-page claims.');
      }
      record.deepInspection = capture.deepInspectionResults?.get(prefix) || null;
      const interaction = maxOptionalStageAllowed(capture, 15_000)
        ? await exploreSafeUiStates(capture, files, prefix)
        : { links: [] };
      const extendedRoutes = maxOptionalStageAllowed(capture, 10_000)
        ? await discoverExtendedRoutes(capture, files, prefix, false)
        : [];
      if (maxOptionalStageAllowed(capture, 10_000)) await captureOriginIntelligence(capture, files, prefix);
      if (maxOptionalStageAllowed(capture, 5_000)) await capturePseudoStateMatrix(capture, files, prefix);
      if (maxOptionalStageAllowed(capture, 5_000)) await captureResponsiveMatrix(capture, files, `${prefix}/forensics/responsive`);
      info = await discoverCurrentPage(capture, `${prefix}/discovery_after_capture`);
      await checkpointPageRuntime(capture, files, prefix);
      record.title = info.title;
      record.finalUrl = sanitizedUrl(info.url);
      record.canonicalUrl = sanitizedUrl(info.canonicalUrl);
      info.links = [...new Set([...info.links, ...interaction.links, ...extendedRoutes])];
      record.discoveredLinks = info.links.length;
      record.status = 'captured';
      record.captureSeconds = Math.max(1, Math.round((Date.now() - pageStartedAt) / 1000));
      capture.completedPageTimings.push(record.captureSeconds);
      enqueue(info.links, item.depth + 1);
    } catch (error) {
      const record = capture.crawlPages.find((page) => page.index === pageIndex && page.status === 'pending');
      if (record) {
        record.status = 'failed';
        record.error = error?.message || String(error);
        record.finishedAt = new Date().toISOString();
      } else {
        capture.crawlSkipped.push({ url: sanitizedUrl(item.url), depth: item.depth, reason: error?.message || String(error) });
      }
      capture.warnings.push(`Site page ${item.url}: ${error?.message || String(error)}`);
      const rendererHealth = await probeTargetRenderer(capture);
      const completedPages = capture.crawlPages.filter((page) => page.status === 'captured').length;
      if (!rendererHealth.healthy && completedPages > 0) {
        stoppedAfterRendererFailure = true;
        capture.rendererFailures ||= [];
        capture.rendererFailures.push({ pageIndex, url: sanitizedUrl(item.url), reason: rendererHealth.reason, error: error?.message || String(error) });
        appendActivityLog(`Renderer recovery: page ${pageIndex + 1} became unavailable (${rendererHealth.reason}). Preserving ${completedPages} previously completed full page(s) and finalizing instead of discarding them.`, capture.lastProgress || null, 'error', capture);
        capture.debuggerUnavailableAfterRendererFailure = true;
        capture.debuggerAttached = false;
        capture.detachedReason = null;
        break;
      }
      if (stoppedAtTimeLimit) {
        appendActivityLog(`Max runtime boundary: excluded page ${pageIndex + 1} from completed-page claims and retained all earlier complete pages.`, capture.lastProgress || null, 'info', capture);
        break;
      }
    }
    const record = capture.crawlPages.find((page) => page.index === pageIndex && page.status !== 'pending');
    if (record && !record.finishedAt) record.finishedAt = new Date().toISOString();
  }
  addJson(files, 'site/crawl_manifest.json', {
    origin,
    entryUrl: sanitizedUrl(capture.originalUrl),
    configuredPageLimit: capture.options.maxPages,
    configuredDepth: capture.options.crawlDepth,
    candidateQueueLimit,
    safetyPolicy: {
      enabled: true,
      skippedCandidates: safetySkipped.size,
      description: 'Action-style, session-changing, payment, account, subscription and token-bearing routes are not navigated automatically.'
    },
    includeQueryStrings: capture.options.includeQueryStrings,
    capturedPages: capture.crawlPages,
    skippedTargets: capture.crawlSkipped,
    queuedButNotCaptured: queue.slice(0, 1000).map((entry) => ({ url: sanitizedUrl(entry.url), depth: entry.depth })),
    stoppedAtLimit: capture.crawlPages.length >= capture.options.maxPages && queue.length > 0,
    stoppedAtTimeLimit,
    stoppedAfterRendererFailure,
    rendererFailures: capture.rendererFailures || [],
    captureTimeBudgetMs: capture.options.maxRuntimeMinutes > 0 ? capture.options.maxRuntimeMinutes * 60_000 : null,
    runtimeLimit: capture.options.maxRuntimeMinutes > 0 ? `${capture.options.maxRuntimeMinutes} minutes` : 'unlimited'
  });
  await files.flush?.();
}

async function captureResponsiveMatrix(capture, files, outputPrefix = 'forensics/responsive', timeBudgetMs = responsiveBudget(capture)) {
  if (!capture.options.forensicMode) return;
  const startedAt = Date.now();
  const boundedTimeBudgetMs = capture.options.mode === 'entire'
    ? Number.isFinite(capture.captureDeadlineAt)
      ? Math.max(1, capture.captureDeadlineAt - Date.now() - MAX_FINALIZATION_RESERVE_MS)
      : Number.MAX_SAFE_INTEGER
    : Math.max(1, Number(timeBudgetMs) || responsiveBudget(capture));
  let deadline = startedAt + boundedTimeBudgetMs;
  sendProgress('Capturing mobile, tablet, and desktop responsive states…', 67);
  const allViewports = [
    { name: 'mobile_390x844', width: 390, height: 844, mobile: true },
    { name: 'tablet_768x1024', width: 768, height: 1024, mobile: true },
    { name: 'desktop_1440x900', width: 1440, height: 900, mobile: false }
  ];
  const viewports = allViewports;
  const states = [];
  let stopReason = null;
  const runCdp = (method, params = {}) => {
    if (Date.now() >= deadline) throw new Error('Responsive-state stage time budget reached.');
    return cdp(capture.tabId, method, params, remainingStageTimeout(deadline, RESPONSIVE_COMMAND_TIMEOUT_MS));
  };
  for (let viewportIndex = 0; viewportIndex < viewports.length; viewportIndex += 1) {
    deadline += await awaitPauseCheckpoint(capture);
    const viewport = viewports[viewportIndex];
    if (Date.now() >= deadline) {
      stopReason = 'time-budget-reached';
      break;
    }
    const stateStartedAt = Date.now();
    sendProgress(`Capturing responsive state ${viewportIndex + 1}/${viewports.length}: ${viewport.name}…`, 67);
    try {
      await runCdp('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: viewport.mobile,
        screenWidth: viewport.width,
        screenHeight: viewport.height,
        positionX: 0,
        positionY: 0,
        dontSetVisibleSize: false
      });
      await sleep(700);
      let layout = await runCdp('Page.getLayoutMetrics');
      const size = layout.cssContentSize || layout.contentSize || { width: viewport.width, height: viewport.height };
      let screenshot = null;
      const screenshotErrors = [];
      const attemptScreenshot = async (params, label) => {
        try { return await runCdp('Page.captureScreenshot', params); }
        catch (error) { screenshotErrors.push(`${label}: ${error?.message || String(error)}`); return null; }
      };
      if (size.width * size.height <= 120_000_000 && size.width <= 32767 && size.height <= 32767) {
        screenshot = await attemptScreenshot({
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width: Math.max(1, size.width), height: Math.max(1, size.height), scale: 1 }
        }, 'full-page');
      }
      if (!screenshot?.data) screenshot = await attemptScreenshot({ format: 'png', fromSurface: true, captureBeyondViewport: false }, 'viewport');
      if (!screenshot?.data && Date.now() < deadline) {
        await runCdp('Page.bringToFront').catch(() => {});
        await sleep(250);
        layout = await runCdp('Page.getLayoutMetrics').catch(() => layout);
        screenshot = await attemptScreenshot({ format: 'png', fromSurface: false, captureBeyondViewport: false }, 'compositor-fallback');
      }
      if (screenshot?.data) addBase64(files, `${outputPrefix}/${viewport.name}.png`, screenshot.data);
      const domSnapshot = await runCdp('DOMSnapshot.captureSnapshot', {
        computedStyles: COMPUTED_SNAPSHOT_STYLES,
        includePaintOrder: true,
        includeDOMRects: true
      });
      addJson(files, `${outputPrefix}/${viewport.name}_dom_snapshot.json`, sanitizeDomSnapshot(domSnapshot));
      addJson(files, `${outputPrefix}/${viewport.name}_layout.json`, layout);
      if (!screenshot?.data) capture.warnings.push(`Responsive state ${viewport.name} screenshot retries failed: ${screenshotErrors.join(' | ') || 'no image data returned'}`);
      states.push({ ...viewport, captured: Boolean(screenshot?.data), domCaptured: true, screenshotAttempts: screenshotErrors.length + (screenshot?.data ? 1 : 0), screenshotErrors, elapsedMs: Date.now() - stateStartedAt });
    } catch (error) {
      capture.warnings.push(`Responsive state ${viewport.name}: ${error?.message || String(error)}`);
      states.push({ ...viewport, captured: false, error: error?.message || String(error), elapsedMs: Date.now() - stateStartedAt });
      if (Date.now() >= deadline) {
        stopReason = 'time-budget-reached';
        break;
      }
    }
  }
  await cdp(capture.tabId, 'Emulation.clearDeviceMetricsOverride', {}, 5_000).catch(() => {});
  await sleep(500);
  const elapsedMs = Date.now() - startedAt;
  if (stopReason === 'time-budget-reached') {
    capture.warnings.push(`${outputPrefix} responsive capture: time budget reached after ${states.length}/${viewports.length} states (${Math.round(elapsedMs / 1000)}s); continuing.`);
    sendProgress(`Responsive capture time limit reached after ${states.length}/${viewports.length} states; continuing…`, 68);
  }
  addJson(files, `${outputPrefix}/manifest.json`, {
    complete: states.length === viewports.length && states.every((state) => state.captured),
    stopReason,
    timeBudgetMs: boundedTimeBudgetMs,
    elapsedMs,
    configuredStates: viewports.length,
    strategy: 'mobile-tablet-desktop-full-page-when-safe',
    states
  });
  await files.flush?.();
}

function buildNetworkFiles(capture, files) {
  const records = [...capture.requests.values()];
  const harEntries = [];
  const bodyManifest = [];
  const uniqueBodies = new Map();
  const stagedBodies = new Set();
  let reusedBodies = 0;
  const securityPolicyHeaders = [];
  const policyHeaderNames = new Set([
    'content-security-policy', 'content-security-policy-report-only', 'permissions-policy',
    'referrer-policy', 'cross-origin-opener-policy', 'cross-origin-embedder-policy',
    'cross-origin-resource-policy', 'strict-transport-security', 'x-content-type-options',
    'x-frame-options', 'x-xss-protection', 'origin-agent-cluster', 'reporting-endpoints',
    'report-to', 'nel'
  ]);

  records.forEach((record, index) => {
    let bodyFile = null;
    if (record.body?.file) {
      bodyFile = record.body.file;
      stagedBodies.add(bodyFile);
      bodyManifest.push({
        requestId: record.requestId,
        url: record.response?.url || record.request?.url,
        mimeType: record.response?.mimeType || '',
        byteLength: record.body.byteLength,
        file: bodyFile,
        preservedAtResponsePause: Boolean(record.body.preservedAtResponsePause),
        stagedIncrementally: true,
        reusedExactBody: false
      });
    } else if (record.body?.body !== undefined) {
      const mimeType = record.response?.mimeType || '';
      const ext = extensionFor(mimeType, record.response?.url || record.request?.url);
      let urlLeaf = 'response';
      try {
        urlLeaf = new URL(record.response?.url || record.request?.url || 'https://invalid/').pathname.split('/').pop() || 'response';
      } catch {}
      const stem = fileStemWithoutRepeatedExtension(urlLeaf, ext);
      const rawBody = record.body.body;
      const bodyKey = `${record.body.base64Encoded ? 'b64' : 'text'}:${mimeType}:${record.body.byteLength || rawBody.length}:${rawBody.slice(0, 128)}:${rawBody.slice(-128)}`;
      const duplicate = uniqueBodies.get(bodyKey);
      if (duplicate && duplicate.rawBody === rawBody) {
        bodyFile = duplicate.file;
        reusedBodies += 1;
      } else {
        bodyFile = `network/bodies/${String(index).padStart(4, '0')}_${stem}.${ext}`;
        if (record.body.base64Encoded) addBase64(files, bodyFile, rawBody);
        else addText(files, bodyFile, sanitizeTextBody(rawBody, mimeType));
        uniqueBodies.set(bodyKey, { file: bodyFile, rawBody });
      }
      bodyManifest.push({ requestId: record.requestId, url: record.response?.url || record.request?.url, mimeType, byteLength: record.body.byteLength, file: bodyFile, reusedExactBody: Boolean(duplicate && duplicate.rawBody === rawBody) });
    } else if (record.body?.omitted) {
      bodyManifest.push({ requestId: record.requestId, url: record.response?.url || record.request?.url, omitted: true, reason: record.body.reason });
    }

    let queryString = [];
    try {
      queryString = [...new URL(record.request?.url || '').searchParams.entries()].map(([name, value]) => ({ name, value: SECRET_KEY.test(name) ? '[REDACTED]' : value }));
    } catch {}

    const requestHeaders = record.request?.headers || [];
    const responseHeaders = record.response?.headers || [];
    const retainedPolicies = responseHeaders
      .filter((header) => policyHeaderNames.has(String(header.name || '').toLowerCase()))
      .map((header) => ({ name: String(header.name || '').toLowerCase(), value: sanitizeTextBody(String(header.value || '').slice(0, 100_000), 'text/plain') }));
    if (retainedPolicies.length) {
      securityPolicyHeaders.push({
        requestId: record.requestId,
        url: sanitizedUrl(record.response?.url || record.request?.url || ''),
        resourceType: record.type || null,
        status: record.response?.status || 0,
        headers: retainedPolicies
      });
    }
    harEntries.push({
      startedDateTime: record.wallTime ? new Date(record.wallTime * 1000).toISOString() : new Date().toISOString(),
      time: record.finishedAt && record.timestamp ? Math.max(0, (record.finishedAt - record.timestamp) * 1000) : 0,
      request: {
        method: record.request?.method || 'GET',
        url: record.request?.url || '',
        httpVersion: record.response?.protocol || '',
        headers: requestHeaders,
        queryString,
        cookies: [],
        headersSize: -1,
        bodySize: record.request?.postData?.text ? new TextEncoder().encode(record.request.postData.text).length : (record.request?.hasPostData ? -1 : 0),
        postData: record.request?.postData || undefined,
        _postDataOmittedForPrivacy: Boolean(record.request?.postDataOmittedForPrivacy)
      },
      response: {
        status: record.response?.status || 0,
        statusText: record.response?.statusText || record.failure?.errorText || '',
        httpVersion: record.response?.protocol || '',
        headers: responseHeaders,
        cookies: [],
        content: {
          size: record.body?.byteLength || record.encodedDataLength || 0,
          mimeType: record.response?.mimeType || '',
          _bodyFile: bodyFile,
          _omittedReason: record.body?.omitted ? record.body.reason : null
        },
        redirectURL: '',
        headersSize: -1,
        bodySize: record.encodedDataLength ?? -1,
        _fromDiskCache: record.response?.fromDiskCache,
        _fromServiceWorker: record.response?.fromServiceWorker
      },
      cache: {},
      timings: { blocked: -1, dns: -1, connect: -1, send: 0, wait: record.response?.timing?.receiveHeadersEnd ?? -1, receive: -1, ssl: -1 },
      serverIPAddress: record.response?.remoteIPAddress,
      connection: record.response?.connectionId ? String(record.response.connectionId) : undefined,
      _resourceType: record.type,
      _requestId: record.requestId,
      _failure: record.failure || null,
      _initiator: record.initiator || null
    });
  });

  addJson(files, 'network/network.har.json', {
    log: {
      version: '1.2',
      creator: { name: 'Let Me See Code', version: '2.2.16' },
      pages: [],
      entries: harEntries,
      _privacy: 'Cookie values, authorization values, secret header values, passwords, and secret POST fields were omitted or redacted. Separate metadata files contain only non-reusable properties and SHA-256 fingerprints.'
    }
  });
  addJson(files, 'network/body_manifest.json', { uniqueBodies: stagedBodies.size + uniqueBodies.size, reusedBodies, entries: bodyManifest });
  addJson(files, 'network/security_policy_headers.json', {
    capturedFromResponses: true,
    entries: securityPolicyHeaders
  });
  addJson(files, 'network/websockets.json', capture.webSockets);
  addJson(files, 'network/eventsource.json', {
    events: capture.eventSourceMessages,
    limits: capture.eventLimits.eventSourceMessages || { retained: capture.eventSourceMessages.length, dropped: 0 }
  });
  addJson(files, 'network/secret_header_fingerprints.json', {
    valuesIncluded: false,
    algorithm: 'SHA-256',
    retained: capture.secretHeaderFingerprints.length,
    dropped: capture.secretHeaderFingerprintDrops,
    headers: capture.secretHeaderFingerprints
  });
  addJson(files, 'diagnostics/event_limits.json', capture.eventLimits);
  addJson(files, 'network/stream_payload_limits.json', {
    maximumCharactersPerEvent: MAX_STREAM_EVENT_CHARACTERS,
    omittedEvents: capture.streamPayloadOmissions,
    omittedCharacters: capture.streamPayloadOmittedCharacters
  });
  addJson(files, 'diagnostics/console.json', capture.console);
  addJson(files, 'diagnostics/exceptions.json', capture.exceptions);
  addJson(files, 'diagnostics/browser_log.json', capture.logs);
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  const contexts = await withOperationTimeout(
    chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [offscreenUrl] }),
    'Offscreen-context lookup',
    5_000
  );
  if (contexts.length) return;
  if (!creatingOffscreenDocument) {
    const creation = chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: ['BLOBS'],
        justification: 'Build the captured page files into a downloadable ZIP Blob.'
      });
    creatingOffscreenDocument = withOperationTimeout(creation, 'Offscreen archive workspace creation', 12_000)
      .finally(() => { creatingOffscreenDocument = null; });
  }
  await creatingOffscreenDocument;
}

function bytesToBase64(bytes) {
  let binary = '';
  const block = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += block) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + block)));
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
  return output;
}

class ArchiveFileStore {
  constructor(captureId) {
    this.captureId = captureId;
    this.index = new Map();
    this.queue = Promise.resolve();
    this.started = false;
    this.finalized = false;
    this.aborted = false;
    this.stagedBytes = 0;
    this.queuedCharacters = 0;
    this.storageMode = 'unknown';
  }

  get size() { return this.index.size; }
  has(path) { return this.index.has(path); }
  get(path) { return this.index.get(path); }
  keys() { return this.index.keys(); }

  async start() {
    await withOperationTimeout(ensureOffscreenDocument(), 'Offscreen ZIP setup', 30_000);
    const started = await withOperationTimeout(chrome.runtime.sendMessage({ target: 'offscreen', action: 'START', captureId: this.captureId }), 'ZIP staging start', 30_000);
    if (!started?.ok) throw new Error(started?.error || 'Could not start incremental ZIP staging.');
    this.started = true;
    this.storageMode = started.storageMode || 'unknown';
  }

  register(path, file, retainData = false) {
    if (!this.started || this.finalized || this.aborted) throw new Error('The archive staging session is not writable.');
    if (this.index.has(path)) throw new Error(`Archive path was written more than once: ${path}`);
    const metadata = { kind: file.kind };
    if (retainData) metadata.data = file.data;
    this.index.set(path, metadata);
  }

  set(path, file) {
    const retainData = /\/(?:visual_manifest|visual_tiles\/manifest|elements_computed_manifest)\.json$/.test(path);
    this.register(path, file, retainData);
    const queuedCharacters = String(file.data ?? '').length;
    this.queuedCharacters += queuedCharacters;
    this.queue = this.queue.then(async () => {
      try {
        await this.stageFile(path, file);
      } finally {
        this.queuedCharacters = Math.max(0, this.queuedCharacters - queuedCharacters);
      }
    });
    // Avoid an unhandled rejection before the nearest explicit flush observes it.
    this.queue.catch(() => {});
    return this;
  }

  async sendChunk(path, index, data, final, store = false) {
    if (this.aborted) throw new Error('Archive staging was cancelled.');
    throwIfCancelled(currentCapture);
    const response = await withOperationTimeout(chrome.runtime.sendMessage({
      target: 'offscreen',
      action: 'FILE_CHUNK',
      captureId: this.captureId,
      path,
      index,
      final,
      store,
      data
    }), `ZIP chunk staging (${path})`, 30_000);
    if (!response?.ok) throw new Error(response?.error || `Could not stage ${path}.`);
  }

  async stageFile(path, file) {
    const source = String(file.data ?? '');
    let index = 0;
    if (file.kind === 'base64') {
      if (!source.length) {
        await this.sendChunk(path, 0, '', true, true);
        return;
      }
      const maximumCharacters = Math.max(4, Math.floor(MESSAGE_CHUNK_BYTES / 3) * 4);
      for (let offset = 0; offset < source.length; offset += maximumCharacters) {
        const end = Math.min(source.length, offset + maximumCharacters);
        const data = source.slice(offset, end);
        await this.sendChunk(path, index, data, end >= source.length, true);
        this.stagedBytes += Math.floor(data.length * 0.75);
        index += 1;
      }
      return;
    }

    if (!source.length) {
      await this.sendChunk(path, 0, '', true);
      return;
    }
    const maximumCharacters = MESSAGE_CHUNK_BYTES;
    for (let offset = 0; offset < source.length;) {
      let end = Math.min(source.length, offset + maximumCharacters);
      if (end < source.length && /[\uD800-\uDBFF]/.test(source[end - 1]) && /[\uDC00-\uDFFF]/.test(source[end])) end -= 1;
      const bytes = new TextEncoder().encode(source.slice(offset, end));
      await this.sendChunk(path, index, bytesToBase64(bytes), end >= source.length);
      this.stagedBytes += bytes.byteLength;
      index += 1;
      offset = end;
    }
  }

  stageJsonLines(path, items) {
    this.register(path, { kind: 'text', data: '' }, false);
    this.queue = this.queue.then(async () => {
      let messageIndex = 0;
      const maximumCharacters = MESSAGE_CHUNK_BYTES;
      let buffer = '';
      const sendBuffered = async (final) => {
        const bytes = new TextEncoder().encode(buffer);
        await this.sendChunk(path, messageIndex, bytesToBase64(bytes), final);
        this.stagedBytes += bytes.byteLength;
        messageIndex += 1;
        buffer = '';
      };
      for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        const serialized = `${itemIndex ? '\n' : ''}${JSON.stringify(items[itemIndex])}`;
        for (let offset = 0; offset < serialized.length;) {
          const capacity = maximumCharacters - buffer.length;
          let end = Math.min(serialized.length, offset + capacity);
          if (end < serialized.length && /[\uD800-\uDBFF]/.test(serialized[end - 1]) && /[\uDC00-\uDFFF]/.test(serialized[end])) end -= 1;
          if (end === offset) {
            await sendBuffered(false);
            continue;
          }
          buffer += serialized.slice(offset, end);
          offset = end;
          if (buffer.length >= maximumCharacters) await sendBuffered(false);
        }
      }
      await sendBuffered(true);
    });
    this.queue.catch(() => {});
    return this.queue;
  }

  async flush() {
    await this.queue;
  }

  async waitForBackpressure(maximumQueuedCharacters = 16 * 1024 * 1024) {
    if (this.queuedCharacters > maximumQueuedCharacters) await this.flush();
  }

  async finalize(filename) {
    await this.flush();
    const finalized = await withOperationTimeout(chrome.runtime.sendMessage({ target: 'offscreen', action: 'FINALIZE', captureId: this.captureId }), 'ZIP finalization', 5 * 60_000);
    if (!finalized?.ok || !finalized.blobUrl) throw new Error(finalized?.error || 'Could not create the ZIP archive.');
    if (finalized.recoveredFinalMarkers?.length) {
      const paths = finalized.recoveredFinalMarkers.map((entry) => entry.path).slice(0, 5).join(', ');
      appendActivityLog(`ZIP integrity detail: restored ${finalized.recoveredFinalMarkers.length} missing stream-final marker(s) after verifying acknowledged sequential chunks${paths ? ` (${paths})` : ''}; the archive includes diagnostics/zip_final_marker_recovery.json.`, currentCapture?.lastProgress || 98, 'info', currentCapture);
    }
    this.finalized = true;
    let downloadId;
    try {
      downloadId = await withOperationTimeout(chrome.downloads.download({ url: finalized.blobUrl, filename, saveAs: false, conflictAction: 'uniquify' }), 'ZIP download start', 30_000);
      pendingDownloadUrls.set(downloadId, finalized.blobUrl);
      // A long fallback only handles environments where download events are
      // unavailable; normal cleanup happens immediately on completion.
      setTimeout(() => {
        if (pendingDownloadUrls.get(downloadId) !== finalized.blobUrl) return;
        pendingDownloadUrls.delete(downloadId);
        chrome.runtime.sendMessage({ target: 'offscreen', action: 'REVOKE', blobUrl: finalized.blobUrl }).catch(() => {});
      }, 30 * 60 * 1000);
      return downloadId;
    } catch (error) {
      await withOperationTimeout(chrome.runtime.sendMessage({ target: 'offscreen', action: 'REVOKE', blobUrl: finalized.blobUrl }), 'ZIP URL cleanup', 5_000).catch(() => {});
      throw error;
    }
  }

  async abort() {
    if (!this.started || this.finalized || this.aborted) return;
    this.aborted = true;
    await withOperationTimeout(chrome.runtime.sendMessage({ target: 'offscreen', action: 'ABORT', captureId: this.captureId }), 'ZIP staging abort', 10_000).catch(() => {});
    await this.queue.catch(() => {});
  }
}

function captureMode(value) {
  return ['quick', 'max', 'entire'].includes(value) ? value : 'max';
}

function capturePathLeaf(url, index) {
  try {
    const parsed = new URL(url);
    const leaf = parsed.pathname === '/' ? 'home' : parsed.pathname.split('/').filter(Boolean).at(-1) || 'page';
    return `${String(index).padStart(3, '0')}_${cleanFilePart(leaf)}`;
  } catch {
    return `${String(index).padStart(3, '0')}_page`;
  }
}

function crawlSafetyReason(raw, expectedOrigin) {
  try {
    const url = new URL(raw);
    if (url.origin !== expectedOrigin) return null;
    if (url.username || url.password) return 'URL contains embedded credentials';
    const path = decodeURIComponent(url.pathname).toLowerCase().replace(/[_\s]+/g, '-');
    const dangerousSegment = /(?:^|\/)(?:logout|log-out|signout|sign-out|delete|destroy|remove|erase|unsubscribe|unfollow|leave-group|revoke|disconnect|deactivate|close-account|cancel-account|cancel-subscription|empty-cart|clear-cart|checkout|purchase|buy|pay|payment|place-order|order|book|confirm-order|install|activate|reset-password|password-reset)(?:[\/.\-]|$)/i;
    if (dangerousSegment.test(path)) return 'Potentially state-changing or sensitive route';
    const actionValue = [...url.searchParams.entries()]
      .filter(([key]) => /^(?:action|do|cmd|command|method|operation|task|event)$/i.test(key))
      .map(([, value]) => value)
      .join(' ');
    if (/delete|destroy|remove|erase|logout|signout|unsubscribe|revoke|disconnect|deactivate|close|cancel|checkout|purchase|buy|pay|order|book|install|activate|reset/i.test(actionValue)) {
      return 'Potentially state-changing query action';
    }
    const hasSingleUseCredential = [...url.searchParams.keys()].some((key) => /token|nonce|signature|sig|code|key/i.test(key));
    if (hasSingleUseCredential && /confirm|verify|invite|accept|unsubscribe|reset|activate|magic|login/i.test(path)) {
      return 'Token-bearing single-use route';
    }
    return null;
  } catch {
    return null;
  }
}

function isLikelyHtmlUrl(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return !/\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp|mp3|m4a|ogg|wav|flac|mp4|m4v|mov|avi|webm|pdf|zip|rar|7z|tar|gz|css|js|mjs|cjs|json|xml|rss|atom|woff2?|ttf|otf|eot|docx?|xlsx?|pptx?)(?:$|\/)/i.test(pathname);
  } catch {
    return false;
  }
}

function normalizeCrawlUrl(raw, origin, includeQuery = false) {
  try {
    const url = new URL(raw);
    if (url.origin !== origin || !/^https?:$/.test(url.protocol) || !isLikelyHtmlUrl(url)) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|fbclid|gclid|mc_|ref$)/i.test(key)) url.searchParams.delete(key);
    }
    if (!includeQuery) url.search = '';
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.href;
  } catch {
    return null;
  }
}

function recordCaptureTiming(capture) {
  return Math.max(1, Math.round((Date.now() - capture.startedAt) / 1000));
}

function buildCompletenessReport(capture, files) {
  const records = [...capture.requests.values()];
  const bodyEligible = records.filter((record) => record.response && !/^(?:text\/event-stream)$/i.test(record.response.mimeType || ''));
  const bodiesCaptured = records.filter((record) => record.body?.body !== undefined || record.body?.file).length;
  const bodiesOmitted = records.filter((record) => record.body?.omitted).map((record) => ({
    url: record.response?.url || record.request?.url,
    reason: record.body.reason
  }));
  const isAudioResponse = (record) => {
    const mimeType = String(record.response?.mimeType || '').toLowerCase();
    const url = String(record.response?.url || record.request?.url || '').split(/[?#]/, 1)[0].toLowerCase();
    if (mimeType.startsWith('audio/')) return true;
    if (mimeType.startsWith('video/')) return false;
    return /\.(?:aac|flac|m4a|mp3|oga|ogg|opus|wav|weba)$/.test(url) || (!mimeType && /\.webm$/.test(url));
  };
  const audioResponses = records.filter(isAudioResponse);
  const capturedAudioBodies = audioResponses.filter((record) => record.body?.body !== undefined || record.body?.file).length;
  const omittedAudioBodies = audioResponses.filter((record) => record.body?.omitted).map((record) => ({
    url: record.response?.url || record.request?.url,
    reason: record.body.reason
  }));
  const audioSnapshotPaths = [...files.keys()].filter((path) => /\/forensics\/audio\/frame_/.test(path));
  const webAudioGraphSnapshotCount = capture.audioEvidenceSummary?.webAudioGraphSnapshots || 0;
  const sourceMappedScripts = [...capture.scripts.values(), ...(capture.scriptSourceManifest || [])].filter((script) => script.sourceMapURL).length;
  const capturedScriptFiles = [...files.keys()].filter((path) => path.startsWith('forensics/scripts/') && path.endsWith('.js')).length;
  const primaryPages = capture.options.mode === 'entire'
    ? capture.crawlPages
      .filter((page) => page.status === 'captured')
      .map((page) => ({
        pageIndex: page.index,
        url: page.finalUrl || page.url,
        pagePrefix: page.prefix,
        evidenceRoot: page.evidenceRoot || (page.index === 0 ? `${page.prefix}/reloaded` : page.prefix)
      }))
    : [{
      pageIndex: 0,
      url: sanitizedUrl(capture.currentPageUrl || capture.originalUrl),
      pagePrefix: capture.options.mode === 'quick'
        ? 'current_state'
        : capture.options.reloadForNetwork ? 'after_reload' : 'after_dynamic_activity',
      evidenceRoot: capture.options.mode === 'quick'
        ? 'current_state'
        : capture.options.reloadForNetwork ? 'after_reload' : 'after_dynamic_activity'
    }];
  const stateRootEntries = capture.options.mode === 'entire'
    ? [
      ...(capture.crawlPages[0]?.status === 'captured'
        ? [{ pageIndex: 0, url: capture.crawlPages[0].finalUrl || capture.crawlPages[0].url, evidenceRoot: `${capture.crawlPages[0].prefix}/current_state`, role: 'pre-reload-state' }]
        : []),
      ...primaryPages.map((page) => ({ ...page, role: 'primary-page-state' }))
    ]
    : capture.options.mode === 'max'
      ? [
        { pageIndex: 0, url: sanitizedUrl(capture.originalUrl), evidenceRoot: 'current_state', role: 'pre-reload-state' },
        ...primaryPages.map((page) => ({ ...page, role: 'primary-page-state' }))
      ]
      : primaryPages.map((page) => ({ ...page, role: 'primary-page-state' }));
  const interactionStateRoots = primaryPages
    .filter((page) => files.has(`${page.evidenceRoot}/interaction_state/visual_manifest.json`) || files.has(`${page.evidenceRoot}/interaction_state/main_frame/rendered_dom.html`))
    .map((page) => ({
      pageIndex: page.pageIndex,
      url: page.url,
      pagePrefix: page.pagePrefix,
      evidenceRoot: `${page.evidenceRoot}/interaction_state`,
      role: 'post-interaction-state'
    }));
  const uniqueStateRoots = [...new Map([...stateRootEntries, ...interactionStateRoots].map((entry) => [entry.evidenceRoot, entry])).values()];
  const readJsonFile = (path) => {
    const file = files.get(path);
    if (!file || file.kind !== 'text') return null;
    try { return JSON.parse(file.data); } catch { return null; }
  };
  const auditEvidenceRoot = (entry) => {
    const root = entry.evidenceRoot;
    const visualManifest = readJsonFile(`${root}/visual_manifest.json`);
    const tiledManifest = readJsonFile(`${root}/visual_tiles/manifest.json`);
    const dynamicVisualManifest = readJsonFile(`${root}/forensics/animation_evidence/visual_manifest.json`);
    const elementManifest = readJsonFile(`${root}/main_frame/elements_computed_manifest.json`);
    const dynamicSurfaceCoverageRequired = visualManifest?.dynamicSurfaceCoverageRequired === true;
    const dynamicSurfaceCoverageComplete = !dynamicSurfaceCoverageRequired || dynamicVisualManifest?.complete === true;
    const evidence = {
      renderedDom: files.has(`${root}/main_frame/rendered_dom.html`),
      everyElementGeometryAndStyleReference: elementManifest?.complete === true,
      completeComputedStyleDictionary: elementManifest?.complete === true && (elementManifest?.chunks || []).every((chunk) => files.has(chunk.computedStyles)),
      elementCaptureManifest: elementManifest ? `${root}/main_frame/elements_computed_manifest.json` : null,
      readableStylesheets: files.has(`${root}/main_frame/stylesheets.json`),
      openShadowRoots: Boolean(elementManifest?.shadowRoots),
      liveState: files.has(`${root}/main_frame/state.json`),
      mhtml: files.has(`${root}/page_snapshot.mhtml`),
      cdpDomSnapshot: files.has(`${root}/cdp/dom_snapshot.json`),
      accessibilityTree: files.has(`${root}/cdp/accessibility_tree.json`),
      visualManifest: Boolean(visualManifest),
      fullPageVisual: files.has(`${root}/visual_full_page.png`) || Boolean(tiledManifest),
      // The base full-page visual and the dynamic/alternate-surface matrix are
      // separate evidence classes. Quick intentionally records only a bounded
      // motion probe, so dynamic depth must not make an otherwise complete core
      // snapshot report itself as broken.
      fullPageVisualComplete: visualManifest?.complete === true,
      fullPageVisualMode: visualManifest?.fullPage?.mode || null,
      dynamicSurfaceCoverageRequired,
      dynamicSurfaceCoverageComplete,
      dynamicSurfaceVisualManifest: dynamicVisualManifest ? `${root}/forensics/animation_evidence/visual_manifest.json` : null,
      alternateScrollSurface: visualManifest?.alternateScrollSurface || null,
      lazyLoadSweep: files.has(`${root}/forensics/lazy_load_sweep.json`),
      deepDomInspection: files.has(`${root}/cdp/deep_dom_inspection/manifest.json`),
      scriptedChildFrames: [...files.keys()].filter((path) => path.startsWith(`${root}/frames/`) && path.endsWith('/rendered_dom.html')).length
    };
    const coreSnapshotComplete = (capture.options.mode === 'quick'
      ? [
        evidence.renderedDom,
        evidence.everyElementGeometryAndStyleReference,
        evidence.completeComputedStyleDictionary,
        evidence.fullPageVisualComplete
      ]
      : capture.options.mode === 'max'
        ? [
          evidence.renderedDom,
          evidence.everyElementGeometryAndStyleReference,
          evidence.completeComputedStyleDictionary,
          evidence.mhtml,
          evidence.accessibilityTree,
          evidence.fullPageVisualComplete
        ]
      : [
        evidence.renderedDom,
        evidence.everyElementGeometryAndStyleReference,
        evidence.completeComputedStyleDictionary,
        evidence.mhtml,
        evidence.cdpDomSnapshot,
        evidence.accessibilityTree,
        evidence.fullPageVisualComplete
      ]).every(Boolean);
    return {
      pageIndex: entry.pageIndex,
      url: entry.url,
      role: entry.role || 'primary-page-state',
      evidenceRoot: root,
      coreSnapshotComplete,
      evidence
    };
  };
  const stateEvidence = uniqueStateRoots.map(auditEvidenceRoot);
  const primaryEvidence = primaryPages.map((page) => auditEvidenceRoot({ ...page, role: 'primary-page-state' }));
  const browserExposedCoreComplete = primaryEvidence.length > 0 && primaryEvidence.every((entry) => entry.coreSnapshotComplete);
  if (!browserExposedCoreComplete) {
    const incompleteRoots = primaryEvidence.filter((entry) => !entry.coreSnapshotComplete).map((entry) => entry.evidenceRoot);
    capture.warnings.push(`Core browser-exposed evidence was incomplete for ${incompleteRoots.length || primaryPages.length} page state(s): ${incompleteRoots.join(', ') || 'no completed page state'}. See capture_completeness.json.`);
  }
  if (capture.options.mode === 'entire') {
    const shallowPages = (capture.crawlPages || []).filter((page) => page.status === 'captured' && page.deepInspection?.completeWithinConfiguredNodeLimit !== true);
    if (shallowPages.length) {
      capture.warnings.push(`Max matched-CSS depth was incomplete on ${shallowPages.length} captured page(s): ${shallowPages.map((page) => page.prefix).join(', ')}. Exact stop reasons are recorded in maxDepthAudit and each deep DOM manifest.`);
    }
  }
  const knownGaps = [
    'Server-side source code, databases, deployment secrets, and APIs never called by the browser are outside the browser capture boundary.',
    'Cookie values (including HttpOnly values), passwords, authorization values, and recognized secrets are intentionally omitted or redacted. Non-reusable metadata and SHA-256 fingerprints are recorded separately.',
    'Closed shadow roots, DRM-protected media, inaccessible cross-origin frames, and tainted canvas pixels remain browser-protected.',
    'Network traffic from before debugger attachment is unavailable; current-state and post-attachment evidence are preserved separately when applicable.',
    'Submitted POST bodies, WebSocket messages, event streams and data-channel payloads are sanitized heuristically, but free-form sensitive text can remain when its field name does not identify it as a secret. Review an archive before sharing it.',
    'A capture records states that were loaded or conservatively explored during the run. Hidden workflow branches, future states, alternate accounts/experiments, and unbounded infinite content cannot all be inferred from one browser session.',
    'Oversized pages use lossless PNG tiles with a finite 256-tile stability boundary. The per-page visual manifest reports whether the full measured document rectangle was covered.'
  ];
  if (capture.options.mode === 'entire') {
    knownGaps.push('Max mode combines links, sitemap/router hints and conservative UI exploration, then stops at configured page/depth limits. Forms, authenticated workflow branches, role variants and undiscoverable runtime routes may remain uncaptured.');
  }
  if ((capture.rendererFailures || []).length) {
    knownGaps.push(`Chrome's renderer became unavailable on ${(capture.rendererFailures || []).length} crawl page(s). Those pages are marked failed and excluded from completed-page claims; earlier full pages were preserved.`);
  }
  addJson(files, 'capture_completeness.json', {
    generatedAt: new Date().toISOString(),
    mode: capture.options.mode,
    timing: {
      elapsedSecondsAtReport: Math.round((Date.now() - capture.startedAt) / 1000)
    },
      pages: {
      captured: primaryPages.length,
      prefixes: primaryPages.map((page) => page.pagePrefix),
      primaryEvidenceRoots: primaryPages.map((page) => page.evidenceRoot),
      browserExposedCoreComplete,
      completenessDefinition: 'For every primary page state: rendered DOM, element/style mapping, full computed-style dictionary, MHTML, CDP DOM snapshot, accessibility tree, and complete document visual coverage were all present. Dynamic and alternate scroll-surface coverage is audited separately.',
      evidenceAudit: stateEvidence,
      crawl: capture.crawlPages || []
    },
    maxDepthAudit: capture.options.mode === 'entire' ? {
      selectedNodePolicy: 'Every selected deep node receives its own matched-CSS query.',
      configuredDeepNodeLimit: capture.options.maxDeepNodes,
      pages: (capture.crawlPages || []).filter((page) => page.status === 'captured').map((page) => ({
        index: page.index,
        url: page.finalUrl || page.url,
        prefix: page.prefix,
        deepInspection: page.deepInspection || null,
        completeWithinConfiguredNodeLimit: page.deepInspection?.completeWithinConfiguredNodeLimit === true
      })),
      allCapturedPagesCompleteWithinConfiguredNodeLimit: (capture.crawlPages || []).filter((page) => page.status === 'captured').every((page) => page.deepInspection?.completeWithinConfiguredNodeLimit === true)
    } : null,
    network: {
      observedRequests: records.length,
      bodyEligibleRequests: bodyEligible.length,
      capturedBodies: bodiesCaptured,
      bodiesPreservedAtResponseTime: capture.interceptedBodies || 0,
      omittedBodies: bodiesOmitted.length,
      omittedDetails: bodiesOmitted.slice(0, 1000),
      totalCapturedBodyBytes: capture.totalBodyBytes,
      totalBodyLimitBytes: MAX_TOTAL_BODY_BYTES,
      potentiallySensitiveRuntimePayloadClasses: capture.options.forensicMode ? ['post-data', 'websocket', 'server-sent-events', 'webrtc-data-channel'] : []
    },
    runtime: {
      observedScripts: capture.totalObservedScripts,
      ignoredInjectedExtensionScripts: capture.ignoredInjectedScripts,
      scriptMetadataDrops: capture.scriptMetadataDrops,
      capturedScriptFiles,
      scriptsAdvertisingSourceMaps: sourceMappedScripts,
      executionContexts: capture.executionContexts.length,
      ignoredInjectedExtensionExecutionContexts: capture.ignoredInjectedExecutionContexts,
      relatedTargets: capture.childTargets.size,
      webSocketEvents: capture.webSockets.length,
      eventSourceEvents: capture.eventSourceMessages.length
    },
    rendererRecovery: {
      failures: capture.rendererFailures || [],
      completedPagesPreserved: Boolean((capture.rendererFailures || []).length && primaryPages.length)
    },
    audioEvidence: {
      publicNetworkAudioResponses: audioResponses.length,
      publicAudioBodiesCaptured: capturedAudioBodies,
      publicAudioBodiesOmitted: omittedAudioBodies.length,
      omittedPublicAudioDetails: omittedAudioBodies.slice(0, 1000),
      runtimeSnapshots: audioSnapshotPaths.length,
      mediaElementRuntimeSnapshots: capture.audioEvidenceSummary?.mediaElementSnapshots || 0,
      capturesMediaElementConfigurationAndLifecycle: (capture.audioEvidenceSummary?.mediaElementSnapshots || 0) > 0,
      webAudioGraphSnapshots: webAudioGraphSnapshotCount,
      capturesWebAudioGraphAutomationAndAnalyserSummaries: webAudioGraphSnapshotCount > 0,
      rawAnalyserSamplesCollected: false,
      microphoneOrOtherInputAudioCollected: false,
      privacyBoundary: 'Records browser-exposed configuration, lifecycle, graph topology, parameter automation, bounded analyser summaries and public response bodies. It does not record microphone input or retain raw analyser/decoded sample buffers. Submitted network, WebSocket, event-stream and data-channel payloads can still contain sensitive text when field names do not reveal that sensitivity; review Max archives before sharing.'
    },
    animationEvidence: {
      pagesOrStates: (capture.animationAudits || []).map((audit) => {
        const visual = readJsonFile(`${audit.prefix}/forensics/animation_evidence/visual_manifest.json`);
        return {
          prefix: audit.prefix,
          observed: audit.observed,
          fullySampled: audit.fullySampled,
          partiallySampled: audit.partiallySampled,
          definitionComplete: audit.complete,
          visualComplete: visual?.complete === true,
          alternateScrollSurface: visual?.alternateScrollSurface === true,
          scrollTilesComplete: visual?.scrollTiles?.complete ?? null,
          secondaryScrollSurfacesDetected: visual?.secondaryScrollSurfaces?.detected || 0,
          secondaryScrollSurfacesCaptured: visual?.secondaryScrollSurfaces?.captured || 0,
          secondaryScrollSurfacesComplete: visual?.secondaryScrollSurfaces?.complete ?? null,
          videoPlaybackStates: visual?.videoPlaybackStates?.length || 0,
          canvasInteractionStates: visual?.canvasInteractionStates?.length || 0,
          pointerStates: visual?.pointerStates?.length || 0,
          idleVisualChanged: visual?.idleVisualChanged ?? null,
          complete: audit.complete === true && visual?.complete === true,
          manifest: `${audit.prefix}/forensics/animation_evidence/manifest.json`,
          visualManifest: `${audit.prefix}/forensics/animation_evidence/visual_manifest.json`
        };
      }),
      totals: {
        observed: (capture.animationAudits || []).reduce((sum, audit) => sum + (audit.observed || 0), 0),
        fullySampled: (capture.animationAudits || []).reduce((sum, audit) => sum + (audit.fullySampled || 0), 0),
        partiallySampled: (capture.animationAudits || []).reduce((sum, audit) => sum + (audit.partiallySampled || 0), 0)
      },
      complete: (capture.animationAudits || []).length > 0 && (capture.animationAudits || []).every((audit) => audit.complete === true && readJsonFile(`${audit.prefix}/forensics/animation_evidence/visual_manifest.json`)?.complete === true)
    },
    advancedEvidence: {
      mutationTimeline: [...files.keys()].some((path) => path.includes('mutation_timeline')),
      originIntelligence: [...files.keys()].some((path) => path.includes('origin_intelligence')),
      pseudoStateMatrix: [...files.keys()].some((path) => path.includes('pseudo_state_matrix')),
      responsiveMatrix: [...files.keys()].some((path) => path.startsWith('forensics/responsive/') || path.includes('/forensics/responsive/')),
      perPageRuntimeCheckpoints: capture.runtimeCheckpoints?.length || 0,
      uniqueCapturedScriptSources: capture.scriptSourceIndex?.size || capturedScriptFiles,
      safelyExploredUiStates: capture.interactionStates || 0,
      discoveredRouteCandidates: capture.discoveredRoutes || 0,
      lazyLoadSweeps: [...files.keys()].filter((path) => path.endsWith('/forensics/lazy_load_sweep.json')).length,
      tiledFullPageVisuals: [...files.keys()].filter((path) => path.endsWith('/visual_tiles/manifest.json')).length,
      completeFullPageVisuals: primaryEvidence.filter((entry) => entry.evidence.fullPageVisualComplete).length,
      capturedSourceMaps: [...files.keys()].filter((path) => path.startsWith('forensics/source_maps/') && path.endsWith('.map')).length,
      capturedWasmModules: [...files.keys()].filter((path) => path.startsWith('forensics/wasm/') && path.endsWith('.wasm')).length,
      convertedWatModules: [...files.keys()].filter((path) => path.startsWith('forensics/wasm/') && path.endsWith('.wat')).length,
      reconstructedSourceFiles: capture.reconstructedSourceFiles || 0,
      beautifiedScripts: [...files.keys()].filter((path) => path.startsWith('forensics/beautified/')).length,
      astSummaries: [...files.keys()].filter((path) => path.startsWith('forensics/ast/')).length,
      cookieMetadataSnapshots: [...files.keys()].filter((path) => path.endsWith('/forensics/cookie_metadata.json')).length,
      securityMetadataSnapshots: [...files.keys()].filter((path) => path.endsWith('/security_metadata.json')).length,
      hardwareProfiles: [...files.keys()].filter((path) => path.endsWith('/hardware_profile.json')).length,
      documentIntelligenceSnapshots: [...files.keys()].filter((path) => path.endsWith('/document_intelligence.json')).length,
      performanceIntelligenceSnapshots: [...files.keys()].filter((path) => path.endsWith('/performance_intelligence.json')).length,
      cssIntelligenceSnapshots: [...files.keys()].filter((path) => path.endsWith('/css_intelligence.json')).length,
      navigationIntelligenceSnapshots: [...files.keys()].filter((path) => path.endsWith('/navigation_intelligence.json')).length,
      policyIntelligenceSnapshots: [...files.keys()].filter((path) => path.endsWith('/policy_intelligence.json')).length,
      frameworkBootstrapSnapshots: [...files.keys()].filter((path) => path.endsWith('/framework_bootstrap_intelligence.json')).length,
      exactJsonArtifactsReused: files.deduplicationRecords?.length || 0,
      liveInstrumentationSnapshots: [...files.keys()].filter((path) => path.includes('/forensics/live_instrumentation_frame_')).length,
      audioEvidenceSnapshots: audioSnapshotPaths.length,
      dynamicSurfaceProfiles: [...files.keys()].filter((path) => path.endsWith('/forensics/dynamic_surfaces/profile.json')).length,
      nestedScrollVisualTiles: [...files.keys()].filter((path) => /\/forensics\/dynamic_surfaces\/scroll_tiles\/tile_/.test(path)).length,
      pointerVisualStates: [...files.keys()].filter((path) => /\/forensics\/animation_evidence\/pointer_state_/.test(path)).length,
      idleMotionFrames: [...files.keys()].filter((path) => /\/forensics\/animation_evidence\/idle_frame_/.test(path)).length,
      opfsContentFiles: [...files.keys()].filter((path) => path.includes('/forensics/opfs/files/')).length,
      webSqlManifests: [...files.keys()].filter((path) => path.endsWith('/forensics/websql/manifest.json')).length,
      animationEvidenceManifests: [...files.keys()].filter((path) => path.endsWith('/forensics/animation_evidence/manifest.json')).length,
      animationVisualManifests: [...files.keys()].filter((path) => path.endsWith('/forensics/animation_evidence/visual_manifest.json')).length,
      animationVisualFrames: [...files.keys()].filter((path) => /\/forensics\/animation_evidence\/visual_frame_\d+\.png$/.test(path)).length,
      secretHeaderFingerprints: capture.secretHeaderFingerprints.length
    },
    stabilityBoundaries: {
      eventCollections: capture.eventLimits,
      streamPayloads: { maxCharactersPerEvent: MAX_STREAM_EVENT_CHARACTERS, omittedEvents: capture.streamPayloadOmissions, omittedCharacters: capture.streamPayloadOmittedCharacters },
      secretHeaderFingerprintDrops: capture.secretHeaderFingerprintDrops,
      sourceAnalysis: { limits: { files: MAX_SOURCE_ANALYSIS_FILES, perFileBytes: MAX_SOURCE_ANALYSIS_FILE_BYTES, totalInputBytes: MAX_SOURCE_ANALYSIS_INPUT_BYTES }, entries: capture.sourceAnalysisManifest },
      wasmToWat: { limits: { perModuleBytes: MAX_WASM_WAT_INPUT_BYTES, totalInputBytes: MAX_WASM_WAT_TOTAL_BYTES }, entries: capture.wasmWatManifest },
      reconstructedSources: { maxFiles: MAX_RECONSTRUCTED_SOURCE_FILES, maxBytes: MAX_RECONSTRUCTED_SOURCE_BYTES, capturedFiles: capture.reconstructedSourceFiles, capturedBytes: capture.reconstructedSourceBytes }
    },
    warnings: capture.warnings,
    knownGaps
  });
}

function buildEvidenceIndex(capture, files) {
  const categorized = {};
  for (const path of files.keys()) {
    const category = path.split('/')[0] || 'root';
    (categorized[category] ||= []).push(path);
  }
  const routes = (capture.crawlPages || []).map((page) => ({
    index: page.index,
    url: page.finalUrl || page.url,
    title: page.title || null,
    depth: page.depth,
    prefix: page.prefix,
    status: page.status
  }));
  const primaryDom = capture.options.mode === 'entire'
    ? `${capture.crawlPages[0]?.prefix || 'site/pages/000_home'}/reloaded/main_frame/rendered_dom.html`
    : capture.options.mode === 'quick'
      ? 'current_state/main_frame/rendered_dom.html'
      : `${capture.options.reloadForNetwork ? 'after_reload' : 'after_dynamic_activity'}/main_frame/rendered_dom.html`;
  const primaryVisualManifest = `${primaryDom.slice(0, -'/main_frame/rendered_dom.html'.length)}/visual_manifest.json`;
  const primaryFrameRoot = primaryDom.slice(0, -'/rendered_dom.html'.length);
  addJson(files, 'evidence_index.json', {
    format: 'Let Me See Code evidence index',
    generatedAt: new Date().toISOString(),
    recommendedReadingOrder: [
      'capture_manifest.json',
      'capture_completeness.json',
      capture.options.mode === 'entire' ? 'site/crawl_manifest.json' : primaryDom,
      primaryDom,
      `${primaryFrameRoot}/document_intelligence.json`,
      `${primaryFrameRoot}/css_intelligence.json`,
      `${primaryFrameRoot}/navigation_intelligence.json`,
      `${primaryFrameRoot}/policy_intelligence.json`,
      `${primaryFrameRoot}/framework_bootstrap_intelligence.json`,
      `${primaryFrameRoot}/performance_intelligence.json`,
      primaryVisualManifest,
      'network/network.har.json',
      'network/security_policy_headers.json',
      'deduplication_manifest.json',
      'network/secret_header_fingerprints.json',
      'forensics/scripts/manifest.json'
    ],
    routeGraph: routes,
    fileCategories: categorized
  });
}

function runArchiveBuilder(capture, files, label, builder) {
  try {
    builder();
    return true;
  } catch (error) {
    const message = `${label}: ${error?.message || String(error)}`;
    capture.warnings.push(message);
    try {
      addJson(files, `diagnostics/finalization_${cleanFilePart(label, 'builder')}_error.json`, {
        label,
        error: error?.message || String(error),
        continuedToZipFinalization: true,
        at: new Date().toISOString()
      });
    } catch {}
    return false;
  }
}

async function runOptionalFinalizer(capture, files, label, operation) {
  try {
    await operation();
    return true;
  } catch (error) {
    const message = `${label}: ${error?.message || String(error)}`;
    capture.warnings.push(message);
    try {
      addJson(files, `diagnostics/finalization_${cleanFilePart(label, 'collector')}_error.json`, {
        label,
        error: error?.message || String(error),
        continuedToZipFinalization: true,
        at: new Date().toISOString()
      });
    } catch {}
    return false;
  }
}

async function runCapture(options) {
  if (currentCapture) throw new Error('A capture is already running. Open the extension to view or cancel it.');
  const requestedTabId = Number(options?.targetTabId);
  const tab = Number.isInteger(requestedTabId) && requestedTabId > 0
    ? await withOperationTimeout(chrome.tabs.get(requestedTabId), 'Selected-tab lookup', 5_000).catch(() => null)
    : (await withOperationTimeout(chrome.tabs.query({ active: true, currentWindow: true }), 'Active-tab lookup', 5_000))[0];
  if (!tab?.id || !tab.url) throw new Error('No active page was found.');
  if (!/^(?:https?:|file:)/i.test(tab.url)) {
    throw new Error('Chrome does not allow deep capture on this browser-internal page. Open a normal http(s) page and try again.');
  }

  const mode = captureMode(options?.mode);
  const requestedRuntimeMinutes = Number(options?.maxRuntimeMinutes);
  const maxRuntimeMinutes = requestedRuntimeMinutes === 0
    ? 0
    : [10, 20, 30, 60].includes(requestedRuntimeMinutes) ? requestedRuntimeMinutes : DEFAULT_MAX_RUNTIME_MINUTES;
  const effectiveMaxRuntimeMinutes = resolveMaxRuntimeSafetyMinutes(maxRuntimeMinutes);
  const capture = {
    captureId: crypto.randomUUID(),
    tabId: tab.id,
    options: {
      mode,
      reloadForNetwork: mode === 'entire' || (mode === 'max' && options?.reloadForNetwork !== false),
      forensicMode: mode !== 'quick',
      settleSeconds: mode === 'quick' ? 0 : Math.min(30, Math.max(0, Number.isFinite(Number(options?.settleSeconds)) ? Number(options.settleSeconds) : 5)),
      maxBodyBytes: Math.min(50 * 1024 * 1024, Math.max(1 * 1024 * 1024, Number(options?.maxBodyBytes) || 35 * 1024 * 1024)),
      maxDeepNodes: Math.min(10_000, Math.max(100, Number(options?.maxDeepNodes) || 3_500)),
      maxPages: Math.min(50, Math.max(2, Number(options?.maxPages) || 8)),
      maxRuntimeMinutes,
      crawlDepth: Math.min(4, Math.max(1, Number(options?.crawlDepth) || 2)),
      includeQueryStrings: options?.includeQueryStrings === true
    },
    startedAt: Date.now(),
    captureDeadlineAt: mode === 'entire'
      ? Date.now() + effectiveMaxRuntimeMinutes * 60_000
      : mode === 'max'
        ? Date.now() + FAST_SOFT_RUNTIME_LIMIT_MS
        : Number.POSITIVE_INFINITY,
    unlimitedRuntimeSelected: mode === 'entire' && maxRuntimeMinutes === 0,
    originalUrl: tab.url,
    originalTitle: tab.title || '',
    currentPageUrl: tab.url,
    currentPageIndex: 0,
    crawlPages: [],
    crawlSkipped: [],
    runtimeEpoch: 0,
    runtimeCheckpoints: [],
    deepInspectionResults: new Map(),
    scriptSourceIndex: new Map(),
    scriptSourceManifest: [],
    totalScriptSourceBytes: 0,
    interactionStates: 0,
    discoveredRoutes: 0,
    completedPageTimings: [],
    liveProgress: 4,
    requests: new Map(),
    activeRequests: new Set(),
    pendingBodies: new Set(),
    activeBodyReads: 0,
    bodyReadWaiters: [],
    pendingMetadata: new Set(),
    webSockets: [],
    eventSourceMessages: [],
    console: [],
    exceptions: [],
    logs: [],
    executionContexts: [],
    ignoredExecutionContextIds: new Set(),
    ignoredInjectedExecutionContexts: 0,
    scripts: new Map(),
    totalObservedScripts: 0,
    ignoredInjectedScripts: 0,
    scriptMetadataDrops: 0,
    scriptCountsByEpoch: new Map(),
    childTargets: new Map(),
    eventLimits: {},
    streamPayloadOmissions: 0,
    streamPayloadOmittedCharacters: 0,
    secretHeaderFingerprints: [],
    secretHeaderFingerprintDrops: 0,
    instrumentationSource: null,
    instrumentationIdentifier: null,
    instrumentationCapturedPrefixes: new Set(),
    instrumentationCursors: new Map(),
    audioEvidenceSummary: { snapshots: 0, mediaElementSnapshots: 0, webAudioGraphSnapshots: 0 },
    dynamicSurfaceProfiles: new Map(),
    cookieMetadataPrefixes: new Set(),
    opfsOrigins: new Map(),
    webSqlDatabases: new Map(),
    webSqlPrefixes: new Set(),
    webSqlSupported: false,
    optionalCapabilities: {},
    capturedSourceAnalysisKeys: new Set(),
    sourceAnalysisManifest: [],
    sourceAnalysisInputBytes: 0,
    reconstructedSourceFiles: 0,
    reconstructedSourceBytes: 0,
    wasmWatManifest: [],
    wasmWatInputBytes: 0,
    initialPerformance: null,
    warnings: [],
    totalBodyBytes: 0,
    nextNetworkBodyFileIndex: 0,
    interceptedBodies: 0,
    lastNetworkActivity: Date.now(),
    loadSeen: false,
    detachedReason: null,
    rendererFailures: [],
    debuggerUnavailableAfterRendererFailure: false,
    cancelRequested: false,
    pauseRequested: false,
    paused: false,
    pausedStartedAt: null,
    totalPausedMs: 0,
    targetTabClosed: false,
    terminalState: null,
    terminalError: null,
    terminalFinishedAt: null,
    completedFilename: null,
    completedActualSeconds: null,
    completedPages: null,
    debuggerAttached: false,
    intentionalDetach: false,
    intentionalDetachCount: 0,
    lastProgress: 0,
    lastLoggedLabel: null,
    lastLoggedPercent: null,
    statusLabel: 'Preparing capture…'
  };
  currentCapture = capture;
  persistCaptureState(publicCaptureState(capture));
  const files = new ArchiveFileStore(capture.captureId);
  capture.files = files;
  let attached = false;

  try {
    const previousState = await withOperationTimeout(
      chrome.storage.local.get({ activeCaptureState: { running: false, state: 'idle' } }),
      'Previous-capture state check',
      5_000
    ).catch(() => ({ activeCaptureState: { running: false, state: 'unknown' } }));
    if (previousState.activeCaptureState?.running && previousState.activeCaptureState?.captureId !== capture.captureId) {
      appendActivityLog(`Startup recovery: replaced stale running state from capture ${previousState.activeCaptureState.captureId || 'unknown'} before starting this task.`, 1, 'error', capture);
    }
    sendProgress('Preparing the local archive workspace…', 2);
    await files.start();
    appendActivityLog(`Startup detail: local archive workspace opened in ${files.storageMode} mode.`, 2, 'info', capture);
    const attachment = await attachDebuggerReliably(capture);
    attached = true;
    sendProgress('Chrome connection is healthy; enabling capture domains…', 5, { startupAttempt: attachment.attempt, startupAttempts: DEBUGGER_ATTACH_ATTEMPTS });
    await cdp(tab.id, 'Page.enable', {}, 10_000);
    await cdp(tab.id, 'Log.enable', {}, 10_000);
    await cdp(tab.id, 'Network.enable', {
      maxTotalBufferSize: MAX_TOTAL_BODY_BYTES,
      maxResourceBufferSize: capture.options.maxBodyBytes,
      maxPostDataSize: capture.options.forensicMode ? capture.options.maxBodyBytes : 0
    }, 15_000);
    await withOperationTimeout(installPageInstrumentation(capture), 'Page instrumentation startup', 35_000);
    appendActivityLog(`Startup detail: Page, Runtime, Log and Network domains are active; instrumentation installed in ${Math.round((Date.now() - capture.startedAt) / 1000)}s.`, 6, 'info', capture);
    sendProgress('Chrome capture tools are ready…', 6);
    if (capture.options.forensicMode) {
      await cdp(tab.id, 'Fetch.enable', {
        patterns: ['Document', 'Stylesheet', 'Script', 'XHR', 'Fetch'].map((resourceType) => ({ urlPattern: '*', resourceType, requestStage: 'Response' }))
      }).catch((error) => capture.warnings.push(`Response-time interception unavailable: ${error?.message || String(error)}`));
    }

    if (capture.options.forensicMode) {
      await cdp(tab.id, 'DOM.enable').catch(() => {});
      await cdp(tab.id, 'CSS.enable').catch(() => {});
      await cdp(tab.id, 'Debugger.enable').catch((error) => capture.warnings.push(`Debugger enable: ${error?.message || String(error)}`));
      await cdp(tab.id, 'Profiler.enable').catch((error) => capture.warnings.push(`Profiler enable: ${error?.message || String(error)}`));
      await cdp(tab.id, 'Performance.enable').catch(() => {});
      const webSqlCapability = await optionalCdp(capture, 'Legacy WebSQL inspection', 'Database.enable');
      capture.webSqlSupported = webSqlCapability?.supported !== false && webSqlCapability !== null;
      capture.initialPerformance = await cdp(tab.id, 'Performance.getMetrics').catch(() => null);
      await cdp(tab.id, 'CSS.startRuleUsageTracking').catch((error) => capture.warnings.push(`CSS coverage start: ${error?.message || String(error)}`));
      await cdp(tab.id, 'Profiler.startPreciseCoverage', { callCount: true, detailed: true, allowTriggeredUpdates: false }).catch((error) => capture.warnings.push(`JavaScript coverage start: ${error?.message || String(error)}`));
      await cdp(tab.id, 'Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
        filter: [
          { type: 'iframe', exclude: false },
          { type: 'worker', exclude: false },
          { type: 'shared_worker', exclude: false },
          { type: 'service_worker', exclude: false }
        ]
      }).catch((error) => capture.warnings.push(`Related-target auto-attach unavailable: ${error?.message || String(error)}`));
    }

    if (mode === 'quick') {
      await captureStage(capture, 'current_state', files, 12, { deep: false, framework: false, label: 'Quick capture' });
    } else if (mode === 'max') {
      // The per-node CSS/listener walk (captureStage's `deep` option) is the most
      // expensive stage by far. It used to run in full here AND again below on the
      // reloaded/settled page, which repeated ~5000 nodes worth of CDP round trips for
      // a state that's almost always superseded by the reload. Skip it on this first,
      // pre-reload pass — everything else (DOM, computed styles, layout, accessibility,
      // MHTML, visual capture) still runs, only the matched-styles/listeners walk is
      // deferred to the settled page below.
      await captureFastPreReloadCheckpoint(capture, files);
      let finalPrefix = 'current_state';
      if (capture.options.reloadForNetwork) {
        sendProgress('Reloading to record network traffic…', 31);
        capture.loadSeen = false;
        capture.activeRequests.clear();
        capture.lastNetworkActivity = Date.now();
        await cdp(tab.id, 'Page.reload', { ignoreCache: false });
        await waitForSettled(capture);
        await runLazyLoadSweep(capture, files, 'after_reload', 41);
        await captureMutationTimeline(capture, files, 'after_reload', 4000);
        await captureStage(capture, 'after_reload', files, 48, { label: 'Reloaded page' });
        finalPrefix = 'after_reload';
      } else {
        capture.warnings.push('Network reload was disabled; only requests observed after capture began are available.');
        await runLazyLoadSweep(capture, files, 'after_dynamic_activity', 41);
        await captureMutationTimeline(capture, files, 'after_dynamic_activity', 3500);
        await captureStage(capture, 'after_dynamic_activity', files, 48, { label: 'Dynamic page state' });
        finalPrefix = 'after_dynamic_activity';
      }
      if (maxOptionalStageAllowed(capture, 45_000)) await captureOriginIntelligence(capture, files, finalPrefix);
      else capture.warnings.push('Fast preserved the complete post-reload DOM, computed styles, viewport, accessibility, MHTML, runtime and network evidence and stopped optional origin-wide intelligence at its soft runtime boundary. Full-document visual completeness is reported separately in capture_completeness.json.');
      if (maxOptionalStageAllowed(capture, 30_000)) await exploreSafeUiStates(capture, files, finalPrefix);
      if (maxOptionalStageAllowed(capture, 20_000)) await discoverExtendedRoutes(capture, files, finalPrefix, false);
      if (maxOptionalStageAllowed(capture, 15_000)) await capturePseudoStateMatrix(capture, files, finalPrefix);
      if (maxOptionalStageAllowed(capture, 20_000)) await captureResponsiveMatrix(capture, files);
    } else {
      const entryBase = `site/pages/${capturePathLeaf(capture.originalUrl, 0)}`;
      const entryStartedAt = Date.now();
      // Same reasoning as the 'max' branch above: defer the expensive deep DOM
      // inspection to the reloaded/settled entry page instead of running it twice.
      await captureStage(capture, `${entryBase}/current_state`, files, 8, { deep: false, label: 'Entry page current state' });
      sendProgress('Reloading the entry page before the site crawl…', 22);
      capture.runtimeEpoch += 1;
      capture.loadSeen = false;
      capture.activeRequests.clear();
      capture.lastNetworkActivity = Date.now();
      await cdp(tab.id, 'Page.reload', { ignoreCache: false });
      await waitForSettled(capture);
      await runLazyLoadSweep(capture, files, `${entryBase}/reloaded`, 31);
      await captureMutationTimeline(capture, files, `${entryBase}/reloaded`, 4000);
      await captureStage(capture, `${entryBase}/reloaded`, files, 34, {
        label: 'Entry page reloaded',
        deepTimeBudgetMs: MAX_ENTRY_DEEP_INSPECTION_BUDGET_MS
      });
      const reloadedRoot = `${entryBase}/reloaded`;
      const currentRoot = `${entryBase}/current_state`;
      const reloadedComplete = completeCoreEvidenceRoot(files, reloadedRoot);
      const currentComplete = completeCoreEvidenceRoot(files, currentRoot);
      const entryEvidenceRoot = reloadedComplete
        ? reloadedRoot
        : currentComplete
          ? currentRoot
          : !capture.unlimitedRuntimeSelected && usableFiniteMaxEvidenceRoot(files, reloadedRoot)
            ? reloadedRoot
            : !capture.unlimitedRuntimeSelected && usableFiniteMaxEvidenceRoot(files, currentRoot)
              ? currentRoot
              : null;
      if (!entryEvidenceRoot) throw new Error('Max could not finish a usable entry-page evidence state inside the configured runtime.');
      const usingEntryFallback = entryEvidenceRoot === currentRoot;
      const usingFiniteVisualFallback = !completeCoreEvidenceRoot(files, entryEvidenceRoot);
      if (usingFiniteVisualFallback) {
        capture.warnings.push(`The finite Max runtime ended before Chrome completed lossless full-document pixels for ${entryEvidenceRoot}; complete DOM, all computed styles, native DOM snapshot, accessibility, MHTML and viewport pixels were preserved, and the visual manifest records the exact missing tiles. Unlimited Max does not use this finite-runtime fallback.`);
      }
      if (usingEntryFallback && !usingFiniteVisualFallback) {
        capture.warnings.push('The reloaded entry state could not finish before Max’s safe archive-finalization window, so the complete pre-reload entry state is the authoritative primary evidence. Reload/network evidence collected before the boundary remains included separately.');
      }
      sendProgress('Reading entry-page routes and structural fingerprints…', 65);
      let entryInfo = await discoverCurrentPage(capture, `${entryBase}/reloaded/discovery_before_interactions`);
      const entryInteraction = !usingEntryFallback && maxOptionalStageAllowed(capture, 60_000)
        ? await exploreSafeUiStates(capture, files, `${entryBase}/reloaded`)
        : { links: [] };
      const entryExtendedRoutes = !usingEntryFallback && maxOptionalStageAllowed(capture, 30_000)
        ? await discoverExtendedRoutes(capture, files, `${entryBase}/reloaded`, true)
        : [];
      entryInfo.links = [...new Set([...entryInfo.links, ...entryInteraction.links, ...entryExtendedRoutes])];
      capture.crawlPages.push({
        index: 0,
        url: sanitizedUrl(capture.originalUrl),
        finalUrl: sanitizedUrl(entryInfo.url),
        title: entryInfo.title,
        canonicalUrl: sanitizedUrl(entryInfo.canonicalUrl),
        contentType: entryInfo.contentType,
        depth: 0,
        prefix: entryBase,
        evidenceRoot: entryEvidenceRoot,
        status: 'captured',
        discoveredLinks: entryInfo.links.length
      });
      if (!usingEntryFallback && maxOptionalStageAllowed(capture, 90_000)) await captureOriginIntelligence(capture, files, `${entryBase}/reloaded`);
      if (!usingEntryFallback && maxOptionalStageAllowed(capture, 45_000)) await capturePseudoStateMatrix(capture, files, `${entryBase}/reloaded`);
      if (!usingEntryFallback && maxOptionalStageAllowed(capture, 45_000)) await captureResponsiveMatrix(capture, files, `${entryBase}/reloaded/forensics/responsive`);
      if (!usingEntryFallback) entryInfo = await discoverCurrentPage(capture, `${entryBase}/reloaded/discovery_after_interactions`);
      entryInfo.links = [...new Set([...entryInfo.links, ...entryInteraction.links, ...entryExtendedRoutes])];
      recordStructuralComparison(capture, files, entryBase, entryInfo);
      capture.crawlPages[0].deepInspection = capture.deepInspectionResults?.get(`${entryBase}/reloaded`) || null;
      if (!usingEntryFallback && maxOptionalStageAllowed(capture, 45_000)) await checkpointPageRuntime(capture, files, `${entryBase}/reloaded`);
      const entrySeconds = Math.max(1, Math.round((Date.now() - entryStartedAt) / 1000));
      capture.crawlPages[0].captureSeconds = entrySeconds;
      capture.crawlPages[0].finishedAt = new Date().toISOString();
      capture.completedPageTimings.push(entrySeconds);
      await crawlSameOriginSite(capture, files, entryInfo);
    }

    await awaitPauseCheckpoint(capture);
    sendProgress('Finishing and indexing response bodies: assets, fonts, audio and scripts…', mode === 'entire' ? 77 : 68);
    const pendingDrainBudgetMs = mode === 'entire' && Number.isFinite(capture.captureDeadlineAt)
      ? Math.max(1, Math.min(30_000, capture.captureDeadlineAt - Date.now() - 30_000))
      : 30_000;
    await bestEffort(
      () => withOperationTimeout(Promise.allSettled([...capture.pendingBodies, ...capture.pendingMetadata]), 'Pending network evidence drain', pendingDrainBudgetMs),
      capture.warnings,
      'Pending network evidence drain'
    );
    await awaitPauseCheckpoint(capture);
    if (!capture.debuggerUnavailableAfterRendererFailure) {
      if (mode !== 'entire' || maxOptionalStageAllowed(capture, 60_000)) {
        await runOptionalFinalizer(capture, files, 'final live instrumentation', () => captureLiveInstrumentation(capture, files, mode === 'entire' ? `${capture.crawlPages.at(-1)?.prefix || 'site/final'}/final_state` : 'final_state'));
      }
      if (mode !== 'entire' || maxOptionalStageAllowed(capture, FINAL_SCRIPT_CAPTURE_BUDGET_MS)) {
        await runOptionalFinalizer(capture, files, 'final forensic artifacts', () => finalizeForensicArtifacts(capture, files));
      } else {
        capture.warnings.push('Final optional debugger collectors were skipped at the Max runtime boundary; page-level evidence and all completed response bodies remain preserved.');
      }
    } else {
      capture.warnings.push('Final debugger-dependent collectors were skipped after Chrome made the renderer unavailable; completed page evidence already staged remains authoritative.');
      appendActivityLog('Renderer recovery: skipped final debugger-dependent collectors and moved directly to indexing the completed evidence.', capture.lastProgress || null, 'info', capture);
    }
    await awaitPauseCheckpoint(capture);
    capture.warnings = [...new Set(capture.warnings)];
    runArchiveBuilder(capture, files, 'network evidence assembly', () => buildNetworkFiles(capture, files));
    runArchiveBuilder(capture, files, 'deduplication manifest', () => addJson(files, 'deduplication_manifest.json', {
      strategy: 'Capture first, then SHA-256 exact-content references only. Unique or merely similar evidence is never discarded.',
      exactArtifactReferences: files.deduplicationRecords || [],
      originWideReferences: [...(capture.originIntelligenceReferences || new Map()).entries()].map(([origin, referencePrefix]) => ({ origin, referencePrefix })),
      networkBodies: 'See network/body_manifest.json for exact response-body reuse.',
      scriptSources: 'See forensics/scripts/manifest.json for exact script-source reuse.',
      mutationCapture: 'Mutation timelines are supplemental deltas from a fully captured baseline.',
      structuralComparison: 'Structural fingerprints and deltas never replace a requested page core capture.'
    }));
    runArchiveBuilder(capture, files, 'completeness report', () => buildCompletenessReport(capture, files));
    runArchiveBuilder(capture, files, 'evidence index', () => buildEvidenceIndex(capture, files));

    const publicMode = { quick: 'quick', max: 'fast', entire: 'max' }[mode];
    const completedPageCount = mode === 'entire'
      ? capture.crawlPages.filter((page) => page.status === 'captured').length
      : 1;
    capture.warnings = [...new Set(capture.warnings)];
    if (capture.warnings.length) {
      appendActivityLog(`Capture diagnostics: ${capture.warnings.length} non-fatal warning(s) were preserved in WARNINGS.json.`, capture.lastProgress || null, 'info', capture);
      for (const warning of capture.warnings.slice(0, 12)) appendActivityLog(`Capture warning: ${warning}`, capture.lastProgress || null, 'info', capture);
      if (capture.warnings.length > 12) appendActivityLog(`Capture diagnostics: ${capture.warnings.length - 12} additional warning(s) are listed inside the archive.`, capture.lastProgress || null, 'info', capture);
    }
    addJson(files, 'capture_manifest.json', {
      format: 'Let Me See Code Capture',
      formatVersion: 6,
      extensionVersion: '2.2.16',
      capturedAt: new Date().toISOString(),
      page: { title: capture.originalTitle, url: sanitizedUrl(capture.originalUrl), tabId: tab.id },
      options: capture.options,
      optionalCapabilities: capture.optionalCapabilities,
      summary: {
        files: files.size + 2,
        mode: publicMode,
        engineMode: mode,
        capturedPages: completedPageCount,
        failedPages: mode === 'entire' ? capture.crawlPages.filter((page) => page.status === 'failed').length : 0,
        elapsedSecondsBeforePacking: Math.round((Date.now() - capture.startedAt) / 1000),
        networkRequests: capture.requests.size,
        capturedResponseBytes: capture.totalBodyBytes,
        observedScripts: capture.totalObservedScripts,
        ignoredInjectedExtensionScripts: capture.ignoredInjectedScripts,
        scriptMetadataDrops: capture.scriptMetadataDrops,
        webSocketEvents: capture.webSockets.length,
        eventSourceEvents: capture.eventSourceMessages.length,
        secretHeaderFingerprints: capture.secretHeaderFingerprints.length,
        reconstructedSourceFiles: capture.reconstructedSourceFiles,
        wasmModulesConvertedToWat: capture.wasmWatManifest.filter((entry) => entry.watFile).length,
        consoleEvents: capture.console.length,
        exceptions: capture.exceptions.length
      },
      redactions: ['password values', 'cookie values including HttpOnly cookie values', 'authorization and token header values', 'CSRF values', 'actual keystrokes and typed text', 'clipboard contents', 'secret URL parameters', 'secret fields inside POST bodies and app state'],
      warnings: capture.warnings
    });
    addJson(files, 'WARNINGS.json', capture.warnings);

    const archiveFileCount = files.size;
    sendProgress(`Packing ${archiveFileCount} evidence files with binary-safe ZIP storage…`, 77);
    await awaitPauseCheckpoint(capture);
    const filename = `let-me-see-code-${siteArchivePart(capture.originalUrl)}-${publicMode}.zip`;
    await files.finalize(filename);
    const actualSeconds = await recordCaptureTiming(capture);
    sendProgress('Capture complete', 100, { actualSeconds, capturedPages: completedPageCount });
    capture.terminalState = 'completed';
    capture.terminalFinishedAt = new Date().toISOString();
    capture.completedFilename = filename;
    capture.completedActualSeconds = actualSeconds;
    capture.completedPages = completedPageCount;
    persistCaptureState(publicCaptureState(capture, {
      running: false,
      state: 'completed',
      percent: 100,
      actualSeconds,
      filename,
      capturedPages: completedPageCount,
      finishedAt: capture.terminalFinishedAt
    }));
    return { ok: true, filename, fileCount: archiveFileCount, warnings: capture.warnings, actualSeconds, pageCount: completedPageCount, capturedPages: completedPageCount };
  } catch (error) {
    const targetClosed = capture.targetTabClosed;
    const cancelled = capture.cancelRequested || /cancelled by the user/i.test(error?.message || '');
    const failureLabel = targetClosed
      ? 'Capture stopped because the target tab was closed.'
      : cancelled
        ? 'Capture cancelled'
        : (error?.message || String(error));
    capture.terminalState = targetClosed ? 'stopped' : cancelled ? 'cancelled' : 'failed';
    capture.terminalError = targetClosed || cancelled ? null : (error?.message || String(error));
    capture.terminalFinishedAt = new Date().toISOString();
    const failedStage = capture.currentStageLabel || capture.statusLabel || 'startup';
    const stageSeconds = capture.currentStageStartedAt ? Math.max(0, Math.round((Date.now() - capture.currentStageStartedAt) / 1000)) : null;
    if (!targetClosed) {
      appendActivityLog(failureLabel, capture.lastProgress || null, cancelled ? 'info' : 'error', capture);
      appendActivityLog(`Failure detail: stage “${failedStage}”${stageSeconds == null ? '' : ` had been active for ${stageSeconds}s`}; page ${capture.currentPageIndex + 1}; URL ${sanitizedUrl(capture.currentPageUrl || capture.originalUrl)}; ${files.size} evidence files had been staged and will be discarded.`, capture.lastProgress || null, cancelled ? 'info' : 'error', capture);
    }
    persistCaptureState(publicCaptureState(capture, {
      running: false,
      state: capture.terminalState,
      label: failureLabel,
      error: capture.terminalError,
      finishedAt: capture.terminalFinishedAt
    }));
    throw error;
  } finally {
    if (!files.finalized) {
      appendActivityLog(`Cleanup detail: discarding unfinished archive workspace containing ${files.size} staged file(s).`, capture.lastProgress || null, 'info', capture);
      await withOperationTimeout(files.abort(), 'Unfinished archive cleanup', 45_000).catch((error) => {
        appendActivityLog(`Cleanup warning: unfinished archive cleanup did not confirm completion: ${error?.message || String(error)}`, capture.lastProgress || null, 'error', capture);
      });
    }
    if (attached && mode === 'entire' && capture.originalUrl && capture.currentPageUrl !== capture.originalUrl) {
      const restored = await cdp(tab.id, 'Page.navigate', { url: capture.originalUrl }, 8_000).then(() => true).catch(() => false);
      appendActivityLog(`Cleanup detail: original Max entry page ${restored ? 'restored' : 'could not be restored before detach'}.`, capture.lastProgress || null, restored ? 'info' : 'error', capture);
      if (restored) await sleep(500);
    }
    const detach = await safeDebuggerDetach(tab.id, capture, 'Final debugger cleanup');
    appendActivityLog(`Cleanup detail: Chrome debugger ${detach.detached ? 'detached successfully' : `was already absent or unavailable (${detach.error || 'unknown'})`}.`, capture.lastProgress || null, detach.detached ? 'info' : 'error', capture);
    currentCapture = null;
  }
}

async function cancelActiveCapture() {
  if (!currentCapture) return { ok: true, cancelled: false, message: 'No capture is running.' };
  const capture = currentCapture;
  capture.cancelRequested = true;
  capture.terminalState = 'cancelled';
  capture.terminalError = null;
  capture.terminalFinishedAt = new Date().toISOString();
  sendProgress('Cancelling capture…', capture.lastProgress || 1);
  persistCaptureState(publicCaptureState(capture, { running: false, state: 'cancelled', label: 'Capture cancelled', error: null, finishedAt: capture.terminalFinishedAt }));
  appendActivityLog(`Cancellation detail: requested during “${capture.currentStageLabel || capture.statusLabel || 'startup'}” on page ${capture.currentPageIndex + 1}.`, capture.lastProgress || 1, 'info', capture);
  if (capture.debuggerAttached) await cdp(capture.tabId, 'Page.stopLoading', {}, 3_000).catch(() => {});
  await safeDebuggerDetach(capture.tabId, capture, 'Cancellation debugger cleanup');
  return { ok: true, cancelled: true };
}

function pauseActiveCapture() {
  if (!currentCapture) return { ok: true, paused: false, message: 'No capture is running.' };
  if (currentCapture.cancelRequested) return { ok: false, paused: false, message: 'Capture is already cancelling.' };
  if (!currentCapture.pauseRequested && !currentCapture.paused) {
    currentCapture.pauseRequested = true;
    sendProgress('Pause requested—finishing the current safe step…', currentCapture.lastProgress || 1);
  }
  return { ok: true, ...publicCaptureState(currentCapture) };
}

function resumeActiveCapture() {
  if (!currentCapture) return { ok: true, resumed: false, message: 'No capture is running.' };
  currentCapture.pauseRequested = false;
  persistCaptureState(publicCaptureState(currentCapture));
  return { ok: true, resumed: true, ...publicCaptureState(currentCapture) };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === 'offscreen') return undefined;
  if (message?.type === 'START_CAPTURE') {
    runCapture(message.options)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({ ok: false, error: error?.message || String(error) });
      });
    return true;
  }
  if (message?.type === 'GET_CAPTURE_STATUS') {
    if (currentCapture) {
      sendResponse({ ok: true, ...publicCaptureState(currentCapture) });
    } else {
      chrome.storage.local.get({ activeCaptureState: { running: false, state: 'idle' } }).then(({ activeCaptureState }) => {
        const state = activeCaptureState?.running
          ? { ...activeCaptureState, running: false, state: 'interrupted', label: 'The previous capture ended unexpectedly. You can start a new capture.' }
          : activeCaptureState;
        if (activeCaptureState?.running) persistCaptureState(state);
        sendResponse({ ok: true, ...state });
      }).catch((error) => sendResponse({ ok: false, running: false, error: error?.message || String(error) }));
      return true;
    }
  }
  if (message?.type === 'CANCEL_CAPTURE') {
    cancelActiveCapture().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
    return true;
  }
  if (message?.type === 'PAUSE_CAPTURE') {
    sendResponse(pauseActiveCapture());
    return undefined;
  }
  if (message?.type === 'RESUME_CAPTURE') {
    sendResponse(resumeActiveCapture());
    return undefined;
  }
  return undefined;
});
