import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { retainRecentActivityTasks } from '../activity_log.js';
import { strFromU8, unzipSync } from '../vendor/fflate.js';
import { parse as parseJavaScript } from '../vendor/acorn.mjs';
import { generate as generateJavaScript } from '../vendor/astring.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function listener() {}
const screenshotBase64 = Buffer.from([137, 80, 78, 71]).toString('base64');
// Mutable knob so a test can simulate CDP.getMatchedStylesForNode starting to
// fail from a given nodeId onward, mimicking a debugger detach or a page whose
// DOM invalidated the node IDs mid-walk.
const deepDomMock = { failMatchedStylesFromNodeId: Infinity, elementCount: 0, commandDelayMs: 0, pseudoNodeCount: 0, pseudoCommandDelayMs: 0, responsiveCommandDelayMs: 0, matchedStyleCalls: 0 };
const debuggerLifecycleMock = { attachCalls: 0, detachCalls: 0, outcomes: [] };
function fakeDeepDomDocument(elementCount) {
  const children = [];
  for (let index = 1; index <= elementCount; index += 1) {
    const attributes = ['class', 'same-style-shape', 'data-index', String(index)];
    children.push({ nodeId: index, backendNodeId: index, nodeType: 1, localName: 'div', attributes });
  }
  return { root: { nodeId: 0, backendNodeId: 0, nodeType: 9, localName: '#document', attributes: [], children } };
}
const chromeMock = {
  debugger: {
    onEvent: { addListener: listener },
    onDetach: { addListener: listener },
    attach: async () => {
      debuggerLifecycleMock.attachCalls += 1;
      const outcome = debuggerLifecycleMock.outcomes.shift() || 'success';
      if (outcome === 'hang') return new Promise(() => {});
      if (outcome instanceof Error) throw outcome;
      return undefined;
    },
    detach: async () => { debuggerLifecycleMock.detachCalls += 1; },
    sendCommand: async (_source, method, params) => {
      if (deepDomMock.responsiveCommandDelayMs > 0 && ['Emulation.setDeviceMetricsOverride', 'Page.getLayoutMetrics', 'Page.captureScreenshot', 'DOMSnapshot.captureSnapshot'].includes(method)) {
        await new Promise((resolve) => { setTimeout(resolve, deepDomMock.responsiveCommandDelayMs); });
      }
      if (deepDomMock.commandDelayMs > 0 && ['CSS.getMatchedStylesForNode', 'DOM.resolveNode', 'DOMDebugger.getEventListeners'].includes(method)) {
        await new Promise((resolve) => { setTimeout(resolve, deepDomMock.commandDelayMs); });
      }
      if (method === 'Page.captureScreenshot') return { data: screenshotBase64 };
      if (method === 'Page.getLayoutMetrics') return { cssContentSize: { width: 800, height: 600 } };
      if (method === 'DOMSnapshot.captureSnapshot') return { strings: [], documents: [] };
      if (method === 'Emulation.setDeviceMetricsOverride' || method === 'Emulation.clearDeviceMetricsOverride') return {};
      if (method === 'DOM.enable' || method === 'CSS.enable') return {};
      if (method === 'Runtime.enable') return {};
      if (method === 'Runtime.evaluate') return { result: { value: 1 } };
      if (method === 'DOM.getDocument') {
        if (params?.depth === 1) return { root: { nodeId: 999_999, nodeType: 9, localName: '#document', attributes: [] } };
        return fakeDeepDomDocument(deepDomMock.elementCount);
      }
      if (method === 'DOM.querySelectorAll') {
        const count = params?.selector === '*' ? deepDomMock.elementCount : deepDomMock.pseudoNodeCount;
        return { nodeIds: Array.from({ length: count }, (_value, index) => index + 1) };
      }
      if (deepDomMock.pseudoCommandDelayMs > 0 && ['DOM.describeNode', 'CSS.getComputedStyleForNode', 'CSS.forcePseudoState'].includes(method)) {
        await new Promise((resolve) => { setTimeout(resolve, deepDomMock.pseudoCommandDelayMs); });
      }
      if (method === 'DOM.describeNode') return { node: { backendNodeId: params?.nodeId, nodeName: 'BUTTON', localName: 'button', attributes: ['id', `button-${params?.nodeId}`] } };
      if (method === 'CSS.getComputedStyleForNode') return { computedStyle: [{ name: 'color', value: 'rgb(0, 0, 0)' }] };
      if (method === 'CSS.forcePseudoState') return {};
      if (method === 'CSS.getMatchedStylesForNode') {
        deepDomMock.matchedStyleCalls += 1;
        if (params?.nodeId >= deepDomMock.failMatchedStylesFromNodeId) throw new Error('mocked: node not found (stale nodeId)');
        return {
          matchedCSSRules: [{
            matchingSelectors: [0],
            rule: {
              styleSheetId: 'sheet-1',
              selectorList: { text: '.same-style-shape', selectors: [{ text: '.same-style-shape' }] },
              origin: 'regular',
              style: { cssText: 'color: black;', cssProperties: [{ name: 'color', value: 'black' }] }
            }
          }]
        };
      }
      if (method === 'DOM.resolveNode') return { object: { objectId: `obj-${params?.nodeId}` } };
      if (method === 'DOMDebugger.getEventListeners') return { listeners: [] };
      if (method === 'Runtime.releaseObject') return {};
      throw new Error(`Unexpected mocked CDP method: ${method}`);
    }
  },
  tabs: { onRemoved: { addListener: listener }, get: async (tabId) => ({ id: tabId, url: 'https://example.test/', title: 'Example' }) },
  runtime: { onMessage: { addListener: listener }, sendMessage: async () => ({}) },
  storage: { local: { get: async (defaults) => defaults, set: async () => {} } }
};

const workerSource = fs.readFileSync(path.join(root, 'service_worker.js'), 'utf8')
  .replace(
    "import { ACTIVITY_LOG_TASK_LIMIT, retainRecentActivityTasks } from './activity_log.js';",
    'const ACTIVITY_LOG_TASK_LIMIT = 2; const retainRecentActivityTasks = (entries) => entries;'
  )
  .replace("import { parse as parseJavaScript } from './vendor/acorn.mjs';", '')
  .replace("import { generate as generateJavaScript } from './vendor/astring.mjs';", '')
  + '\nglobalThis.__workerTests = { captureTiledPageScreenshot, buildCompletenessReport, buildNetworkFiles, analyzeJavaScriptSource, scheduleSecretHeaderFingerprints, captureDeepDomInspection, capturePseudoStateMatrix, captureResponsiveMatrix, effectiveDeepInspectionBudget, unlimitedAwareStageBudget, animationCaptureBudget, pseudoStateBudget, maxOptionalStageAllowed, resolveMaxRuntimeSafetyMinutes, crawlSafetyReason, fileStemWithoutRepeatedExtension, isInjectedExtensionRuntimeUrl, prioritizedScrollFractions, sendProgress, attachDebuggerReliably, safeDebuggerDetach, setCurrentCapture: (capture) => { currentCapture = capture; }, runArchiveBuilder, throwIfCancelled, awaitPauseCheckpoint };';
const workerContext = vm.createContext({
  console,
  chrome: chromeMock,
  crypto,
  URL,
  Blob,
  TextEncoder,
  TextDecoder,
  atob,
  btoa,
  parseJavaScript,
  generateJavaScript,
  setTimeout,
  clearTimeout
});
new vm.Script(workerSource, { filename: 'service_worker.js' }).runInContext(workerContext);

assert.equal(workerContext.__workerTests.resolveMaxRuntimeSafetyMinutes(0), 1800);
assert.equal(workerContext.__workerTests.resolveMaxRuntimeSafetyMinutes(60), 60);
assert.match(workerContext.__workerTests.crawlSafetyReason('https://example.test/logout', 'https://example.test'), /state-changing/);
assert.match(workerContext.__workerTests.crawlSafetyReason('https://example.test/account?action=delete', 'https://example.test'), /query action/);
assert.equal(workerContext.__workerTests.crawlSafetyReason('https://example.test/articles/animation', 'https://example.test'), null);
assert.equal(workerContext.__workerTests.crawlSafetyReason('https://cdn.example.test/logout', 'https://example.test'), null);
assert.equal(workerContext.__workerTests.fileStemWithoutRepeatedExtension('GeistMono-wght-.ttf', 'ttf'), 'GeistMono-wght-');
assert.equal(workerContext.__workerTests.isInjectedExtensionRuntimeUrl('chrome-extension://abcdefghijklmnop/content.js'), true);
assert.equal(workerContext.__workerTests.isInjectedExtensionRuntimeUrl('let-me-see-code://page-instrumentation.js'), true);
assert.equal(workerContext.__workerTests.isInjectedExtensionRuntimeUrl('https://example.test/app.js'), false);
assert.deepEqual(Array.from(workerContext.__workerTests.prioritizedScrollFractions(7)), [0, 1, 0.5, 0.25, 0.75, 0.125, 0.875]);
const completedProgressCapture = { captureId: 'progress-test', originalTitle: 'Example', startedAt: Date.now(), options: { mode: 'max' }, lastProgress: 100, currentStageLabel: 'Capture complete', currentStageStartedAt: Date.now(), targetTabClosed: false };
workerContext.__workerTests.setCurrentCapture(completedProgressCapture);
workerContext.__workerTests.sendProgress('Cleanup detail', 77);
assert.equal(completedProgressCapture.lastProgress, 100, 'cleanup progress must not fall below completed progress');
workerContext.__workerTests.setCurrentCapture(null);

const startupCapture = {
  captureId: 'startup-test', tabId: 42, currentPageUrl: 'https://example.test/', originalUrl: 'https://example.test/', originalTitle: 'Example',
  currentPageIndex: 0, startedAt: Date.now(), options: { mode: 'entire' }, warnings: [], lastProgress: 0,
  cancelRequested: false, targetTabClosed: false, detachedReason: null, debuggerAttached: false, intentionalDetach: false,
  statusLabel: 'Preparing capture', currentStageLabel: null, currentStageStartedAt: null
};
workerContext.__workerTests.setCurrentCapture(startupCapture);
debuggerLifecycleMock.attachCalls = 0;
debuggerLifecycleMock.detachCalls = 0;
debuggerLifecycleMock.outcomes = ['hang', 'success'];
const recoveredStartup = await workerContext.__workerTests.attachDebuggerReliably(startupCapture, { attempts: 2, attachTimeoutMs: 10, startupTimeoutMs: 100, retryDelayMs: 1, healthTimeoutMs: 10 });
assert.equal(recoveredStartup.attempt, 2);
assert.equal(debuggerLifecycleMock.attachCalls, 2);
assert.ok(debuggerLifecycleMock.detachCalls >= 1, 'timed-out startup must clean stale debugger state before retrying');

debuggerLifecycleMock.attachCalls = 0;
debuggerLifecycleMock.detachCalls = 0;
debuggerLifecycleMock.outcomes = [new Error('Another debugger is already attached to the tab with id: 42')];
await assert.rejects(
  workerContext.__workerTests.attachDebuggerReliably(startupCapture, { attempts: 2, attachTimeoutMs: 10, startupTimeoutMs: 100, retryDelayMs: 1, healthTimeoutMs: 10 }),
  /DevTools or another browser-debugging tool controls this tab/
);
assert.equal(debuggerLifecycleMock.attachCalls, 1, 'an external debugger conflict must fail immediately instead of retrying or waiting');
workerContext.__workerTests.setCurrentCapture(null);

const observerCalls = [];
class FakePerformanceObserver {
  static supportedEntryTypes = ['longtask', 'layout-shift', 'largest-contentful-paint', 'event'];
  constructor(callback) { this.callback = callback; }
  observe(options) {
    observerCalls.push(options);
    const fixtures = {
      longtask: { entryType: 'longtask', name: 'self', startTime: 1, duration: 51, attribution: [] },
      'layout-shift': { entryType: 'layout-shift', name: '', startTime: 2, duration: 0, value: 0.04, hadRecentInput: false, lastInputTime: 0, sources: [] },
      'largest-contentful-paint': { entryType: 'largest-contentful-paint', name: '', startTime: 3, duration: 0, renderTime: 3, loadTime: 0, size: 800, id: 'hero', url: 'https://example.test/hero.png?token=private' },
      event: { entryType: 'event', name: 'click', startTime: 4, duration: 24, processingStart: 5, processingEnd: 6, interactionId: 7, cancelable: true }
    };
    this.callback({ getEntries: () => [fixtures[options.type]] });
  }
}
class FakeElement {}
class FakeAudioParam {
  constructor() { this.value = 1; this.defaultValue = 1; this.minValue = 0; this.maxValue = 4; this.automationRate = 'a-rate'; }
  setValueAtTime(value) { this.value = value; return this; }
  linearRampToValueAtTime(value) { this.value = value; return this; }
  exponentialRampToValueAtTime(value) { this.value = value; return this; }
  setTargetAtTime(value) { this.value = value; return this; }
  setValueCurveAtTime() { return this; }
  cancelScheduledValues() { return this; }
  cancelAndHoldAtTime() { return this; }
}
class FakeAudioNode {
  constructor(context) { this.context = context; this.channelCount = 2; this.channelCountMode = 'max'; this.channelInterpretation = 'speakers'; this.numberOfInputs = 1; this.numberOfOutputs = 1; }
  connect(destination) { return destination; }
  disconnect() {}
}
class FakeGainNode extends FakeAudioNode {
  constructor(context) { super(context); this._gain = new FakeAudioParam(); }
  get gain() { return this._gain; }
}
class FakeAnalyserNode extends FakeAudioNode {
  getByteFrequencyData(array) { for (let index = 0; index < array.length; index += 1) array[index] = index; }
  getFloatFrequencyData(array) { array.fill(-20); }
  getByteTimeDomainData(array) { array.fill(128); }
  getFloatTimeDomainData(array) { array.fill(0); }
}
class FakeBaseAudioContext {
  constructor() { this.sampleRate = 48000; this.currentTime = 0; this.state = 'running'; this.destination = { maxChannelCount: 2 }; }
  addEventListener() {}
  createGain() { return new FakeGainNode(this); }
  createAnalyser() { return new FakeAnalyserNode(this); }
  decodeAudioData() { return Promise.resolve({ duration: 1, sampleRate: 48000, numberOfChannels: 2, length: 48000 }); }
}
class FakeAudioContext extends FakeBaseAudioContext {
  resume() { return Promise.resolve(); }
  suspend() { return Promise.resolve(); }
  close() { return Promise.resolve(); }
}
const instrumentationContext = vm.createContext({
  console,
  URL,
  Blob,
  ArrayBuffer,
  Uint8Array,
  TextEncoder,
  btoa,
  atob,
  setTimeout,
  clearTimeout,
  performance: { now: () => 10 },
  PerformanceObserver: FakePerformanceObserver,
  Element: FakeElement,
  HTMLElement: FakeElement,
  HTMLInputElement: FakeElement,
  HTMLTextAreaElement: FakeElement,
  AudioParam: FakeAudioParam,
  AudioNode: FakeAudioNode,
  AnalyserNode: FakeAnalyserNode,
  BaseAudioContext: FakeBaseAudioContext,
  AudioContext: FakeAudioContext,
  navigator: {},
  location: { href: 'https://example.test/' },
  document: { documentElement: { clientWidth: 800, clientHeight: 600 } },
  innerWidth: 800,
  innerHeight: 600,
  addEventListener() {}
});
const instrumentationFixtureSource = fs.readFileSync(path.join(root, 'page_instrumentation.js'), 'utf8');
new vm.Script(instrumentationFixtureSource, { filename: 'page_instrumentation.js' }).runInContext(instrumentationContext);
const performanceState = instrumentationContext.__LET_ME_SEE_CODE_INSTRUMENTATION__.performance;
assert.deepEqual(observerCalls.map((entry) => entry.type), ['longtask', 'layout-shift', 'largest-contentful-paint', 'event']);
assert.ok(observerCalls.every((entry) => entry.buffered === true));
assert.equal(performanceState.entries.longtask.length, 1);
assert.equal(performanceState.entries['layout-shift'].length, 1);
assert.equal(performanceState.entries['largest-contentful-paint'][0].url, 'https://example.test/hero.png');
assert.equal(performanceState.entries.event.length, 1);
vm.runInContext(`
  const testAudioContext = new AudioContext();
  const testGain = testAudioContext.createGain();
  const testAnalyser = testAudioContext.createAnalyser();
  testGain.connect(testAnalyser);
  testGain.gain.setValueAtTime(0.5, 1);
  const testFrequencies = new Uint8Array(8);
  testAnalyser.getByteFrequencyData(testFrequencies);
`, instrumentationContext);
const audioState = instrumentationContext.__LET_ME_SEE_CODE_INSTRUMENTATION__.audio;
assert.equal(audioState.contexts.length, 1);
assert.equal(audioState.nodes.length, 2);
assert.equal(audioState.connections.length, 1);
assert.equal(audioState.parameterEvents.length, 1);
assert.equal(Object.values(audioState.analyserReads)[0].reads, 1);
assert.equal(audioState.rawAudioSamplesCaptured, undefined);
const extractorFixtureSource = fs.readFileSync(path.join(root, 'page_extractor.js'), 'utf8');
for (const deprecatedType of ['longtask', 'layout-shift', 'largest-contentful-paint', 'event']) {
  assert.doesNotMatch(extractorFixtureSource, new RegExp(`getEntriesByType\\(['\"]${deprecatedType}['\"]\\)`));
}

const tiledFiles = new Map();
const tiledWarnings = [];
const tiled = await workerContext.__workerTests.captureTiledPageScreenshot(
  7,
  'test_page',
  tiledFiles,
  tiledWarnings,
  { width: 9000, height: 20000 }
);
assert.equal(tiled.complete, true);
assert.equal(tiled.capturedTiles, tiled.grid.requiredTiles);
assert.ok(tiled.grid.requiredTiles > 1);
assert.equal(tiledWarnings.length, 0);
assert.ok(tiledFiles.has('test_page/visual_tiles/manifest.json'));
assert.equal(
  [...tiledFiles.keys()].filter((file) => /visual_tiles\/tile_.*\.png$/.test(file)).length,
  tiled.grid.requiredTiles
);

const boundaryFiles = new Map();
const boundaryWarnings = [];
const bounded = await workerContext.__workerTests.captureTiledPageScreenshot(
  7,
  'boundary_page',
  boundaryFiles,
  boundaryWarnings,
  { width: 4096, height: 3906 * 257 }
);
assert.equal(bounded.grid.requiredTiles, 257);
assert.equal(bounded.capturedTiles, 256);
assert.equal(bounded.complete, false);
assert.equal(boundaryWarnings.length, 1);

// A detach for any reason (not just the target tab closing) must now be fatal —
// this is what lets every existing throwIfCancelled() call site throughout the
// capture pipeline stop cleanly instead of continuing after the session is dead.
assert.throws(
  () => workerContext.__workerTests.throwIfCancelled({ detachedReason: 'canceled_by_user' }),
  /Chrome debugger detached \(canceled_by_user\)/
);
assert.doesNotThrow(() => workerContext.__workerTests.throwIfCancelled({ detachedReason: null }));

const pausedCapture = {
  pauseRequested: true,
  paused: false,
  cancelRequested: false,
  targetTabClosed: false,
  detachedReason: null,
  captureDeadlineAt: Date.now() + 1000,
  lastProgress: 42,
  totalPausedMs: 0
};
const deadlineBeforePause = pausedCapture.captureDeadlineAt;
setTimeout(() => { pausedCapture.pauseRequested = false; }, 25);
const pausedForMs = await workerContext.__workerTests.awaitPauseCheckpoint(pausedCapture);
assert.equal(pausedCapture.paused, false);
assert.ok(pausedForMs >= 20 && pausedCapture.totalPausedMs === pausedForMs);
assert.ok(pausedCapture.captureDeadlineAt >= deadlineBeforePause + pausedForMs);

function makeFakeFileStore() {
  const store = new Map();
  return {
    store,
    set(filePath, file) { store.set(filePath, file); return this; },
    stageJsonLines(filePath, items) { store.set(filePath, { kind: 'text', data: items.map((item) => JSON.stringify(item)).join('\n') }); return this; },
    async waitForBackpressure() {}
  };
}

// Regression test for the Max-mode run that raced through ~2,600 nodes in under
// a second after the CDP session went bad partway through: once every node in
// several consecutive batches fails CSS.getMatchedStylesForNode, the stage must
// stop that optional stage with a clear partial-result marker instead of
// mechanically finishing the remaining nodes with empty records or discarding
// the rest of an otherwise useful capture.
deepDomMock.elementCount = 200;
deepDomMock.failMatchedStylesFromNodeId = 81; // fails starting in the 3rd batch of 40
const stalledFiles = makeFakeFileStore();
const stalledCapture = {
  tabId: 1,
  options: { forensicMode: true, maxDeepNodes: 200 },
  warnings: [],
  detachedReason: null,
  cancelRequested: false,
  targetTabClosed: false
};
await workerContext.__workerTests.captureDeepDomInspection(stalledCapture, 'current_state', stalledFiles);
const inspectedChunks = [...stalledFiles.store.keys()].filter((key) => key.includes('deep_dom_inspection/chunk_'));
assert.ok(inspectedChunks.length > 0 && inspectedChunks.length < 5, 'should have staged some but not all batches before aborting');
assert.ok(stalledCapture.warnings.some((warning) => /aborted after/.test(warning)));
const stalledSummary = JSON.parse(stalledFiles.store.get('current_state/cdp/deep_dom_summary.json').data);
assert.equal(stalledSummary.stopReason, 'consecutive-fully-failed-batches');
assert.equal(stalledSummary.truncated, true);
deepDomMock.failMatchedStylesFromNodeId = Infinity;

// Even identical tag/class shapes can match different selectors because of
// ancestry, position, state or container context. Max must inspect every node.
deepDomMock.elementCount = 120;
deepDomMock.matchedStyleCalls = 0;
const completeStyleFiles = makeFakeFileStore();
await workerContext.__workerTests.captureDeepDomInspection({
  tabId: 1,
  options: { forensicMode: true, maxDeepNodes: 120 },
  warnings: [],
  detachedReason: null,
  cancelRequested: false,
  targetTabClosed: false
}, 'current_state', completeStyleFiles);
const completeStyleManifest = JSON.parse(completeStyleFiles.store.get('current_state/cdp/deep_dom_inspection/manifest.json').data);
assert.equal(completeStyleManifest.matchedStyleCandidateNodes, 120);
assert.equal(completeStyleManifest.matchedStyleInspectedNodes, 120);
assert.equal(deepDomMock.matchedStyleCalls, 120);
assert.equal(completeStyleManifest.cssRuleNormalization.uniqueRules, 1);
assert.equal(completeStyleManifest.cssRuleNormalization.references, 120);
assert.equal(completeStyleManifest.cssRuleNormalization.reusedReferences, 119);

const unlimitedDeadline = Date.now() + 30 * 60 * 60_000;
const unlimitedCapture = {
  options: { mode: 'entire' },
  unlimitedRuntimeSelected: true,
  captureDeadlineAt: unlimitedDeadline,
  currentPageIndex: 0
};
const unlimitedMaxBudget = workerContext.__workerTests.effectiveDeepInspectionBudget(unlimitedCapture, 30_000);
assert.ok(unlimitedMaxBudget > 29 * 60 * 60_000, 'Unlimited Max deep inspection must not inherit the ordinary 30s page budget');
assert.ok(unlimitedMaxBudget <= 30 * 60 * 60_000 - 3 * 60_000, 'Unlimited Max must retain its archive-finalization reserve');
assert.ok(workerContext.__workerTests.animationCaptureBudget(unlimitedCapture, 'site/pages/000_entry/reloaded') > 29 * 60 * 60_000, 'Unlimited Max animation sampling must not inherit the ordinary entry budget');
assert.ok(workerContext.__workerTests.pseudoStateBudget(unlimitedCapture) > 29 * 60 * 60_000, 'Unlimited Max pseudo-state sampling must not inherit the ordinary entry budget');
assert.equal(workerContext.__workerTests.maxOptionalStageAllowed(unlimitedCapture, 12 * 60 * 60_000), true, 'Unlimited Max optional collectors remain admitted well beyond ordinary run lengths');
assert.equal(workerContext.__workerTests.unlimitedAwareStageBudget({ options: { mode: 'entire' }, unlimitedRuntimeSelected: false, captureDeadlineAt: unlimitedDeadline }, 25_000), 25_000);
const finiteMaxBudget = workerContext.__workerTests.effectiveDeepInspectionBudget({
  options: { mode: 'entire' },
  captureDeadlineAt: Date.now() + 5 * 60_000
}, 30_000);
assert.equal(finiteMaxBudget, 30_000, 'Max deep inspection must honor its configured per-page budget');
const exhaustedMaxBudget = workerContext.__workerTests.effectiveDeepInspectionBudget({
  options: { mode: 'entire' },
  captureDeadlineAt: Date.now() + 60_000
}, 30_000);
assert.equal(exhaustedMaxBudget, 0, 'Max deep inspection must not enter a costly batch inside the archive-finalization reserve');

// A healthy but slow CDP session must also be bounded. One completed batch is
// retained, the time-budget truncation is explicit, and the capture can proceed.
deepDomMock.elementCount = 120;
deepDomMock.commandDelayMs = 150;
const budgetFiles = makeFakeFileStore();
const budgetCapture = {
  tabId: 1,
  options: { forensicMode: true, maxDeepNodes: 120 },
  warnings: [],
  detachedReason: null,
  cancelRequested: false,
  targetTabClosed: false
};
await workerContext.__workerTests.captureDeepDomInspection(budgetCapture, 'current_state', budgetFiles, 1_000);
const budgetSummary = JSON.parse(budgetFiles.store.get('current_state/cdp/deep_dom_summary.json').data);
assert.ok(budgetSummary.inspectedElementNodes <= 40);
assert.equal(budgetSummary.timeBudgetTruncated, true);
assert.equal(budgetSummary.stopReason, 'time-budget-reached');
assert.ok(budgetCapture.warnings.some((warning) => /time budget reached/.test(warning)));
deepDomMock.commandDelayMs = 0;

// Pseudo-state sampling used to perform up to 1,100 sequential CDP commands
// without a deadline. A slow but healthy command stream must now retain a
// partial manifest and return control to the rest of the capture.
deepDomMock.pseudoNodeCount = 100;
deepDomMock.pseudoCommandDelayMs = 5;
const pseudoBudgetFiles = makeFakeFileStore();
const pseudoBudgetCapture = {
  tabId: 1,
  options: { forensicMode: true, mode: 'entire' },
  currentPageIndex: 0,
  warnings: [],
  detachedReason: null,
  cancelRequested: false,
  targetTabClosed: false
};
await workerContext.__workerTests.capturePseudoStateMatrix(pseudoBudgetCapture, pseudoBudgetFiles, 'current_state', 10);
const pseudoBudgetSummary = JSON.parse(pseudoBudgetFiles.store.get('current_state/forensics/pseudo_state_matrix.json').data);
assert.equal(pseudoBudgetSummary.stopReason, 'time-budget-reached');
assert.ok(pseudoBudgetSummary.attemptedNodes > 0 && pseudoBudgetSummary.attemptedNodes < pseudoBudgetSummary.selectedNodes);
assert.ok(pseudoBudgetCapture.warnings.some((warning) => /pseudo-state sampling: time budget reached/.test(warning)));
deepDomMock.pseudoCommandDelayMs = 0;

// The control path still captures every selected node on a small healthy page.
deepDomMock.pseudoNodeCount = 3;
const pseudoHealthyFiles = makeFakeFileStore();
const pseudoHealthyCapture = { ...pseudoBudgetCapture, warnings: [] };
await workerContext.__workerTests.capturePseudoStateMatrix(pseudoHealthyCapture, pseudoHealthyFiles, 'current_state', 5_000);
const pseudoHealthySummary = JSON.parse(pseudoHealthyFiles.store.get('current_state/forensics/pseudo_state_matrix.json').data);
assert.equal(pseudoHealthySummary.complete, true);
assert.equal(pseudoHealthySummary.inspectedNodes, 3);

// Responsive screenshots/snapshots also carry a stage deadline and a manifest,
// so a slow viewport cannot silently hold Max at 67%.
deepDomMock.responsiveCommandDelayMs = 5;
const responsiveBudgetFiles = makeFakeFileStore();
const responsiveBudgetCapture = { ...pseudoBudgetCapture, options: { forensicMode: true, mode: 'max' }, warnings: [] };
await workerContext.__workerTests.captureResponsiveMatrix(responsiveBudgetCapture, responsiveBudgetFiles, 'responsive_test', 10);
const responsiveBudgetSummary = JSON.parse(responsiveBudgetFiles.store.get('responsive_test/manifest.json').data);
assert.equal(responsiveBudgetSummary.stopReason, 'time-budget-reached');
assert.ok(responsiveBudgetSummary.states.length < responsiveBudgetSummary.configuredStates);
deepDomMock.responsiveCommandDelayMs = 0;

// Sanity check the same stage still completes normally end-to-end when nothing
// fails, so the stall guard isn't just always tripping.
deepDomMock.elementCount = 80;
const healthyFiles = makeFakeFileStore();
const healthyCapture = {
  tabId: 1,
  options: { forensicMode: true, maxDeepNodes: 80 },
  warnings: [],
  detachedReason: null,
  cancelRequested: false,
  targetTabClosed: false
};
await workerContext.__workerTests.captureDeepDomInspection(healthyCapture, 'current_state', healthyFiles);
assert.ok(healthyFiles.store.has('current_state/cdp/deep_dom_inspection/manifest.json'));
assert.equal(JSON.parse(healthyFiles.store.get('current_state/cdp/deep_dom_summary.json').data).inspectedElementNodes, 80);

const completenessFiles = new Map();
const evidenceRoot = 'after_dynamic_activity';
for (const relative of [
  'main_frame/rendered_dom.html',
  'main_frame/elements_computed/chunk_0000.jsonl',
  'main_frame/computed_styles/chunk_0000.json',
  'main_frame/stylesheets.json',
  'main_frame/open_shadow_roots.json',
  'main_frame/state.json',
  'page_snapshot.mhtml',
  'cdp/dom_snapshot.json',
  'cdp/accessibility_tree.json',
  'visual_full_page.png',
  'forensics/lazy_load_sweep.json'
]) {
  completenessFiles.set(`${evidenceRoot}/${relative}`, { kind: 'text', data: '{}' });
}
completenessFiles.set(`${evidenceRoot}/main_frame/elements_computed_manifest.json`, {
  kind: 'text',
  data: JSON.stringify({
    complete: true,
    totalElements: 1,
    capturedElements: 1,
    chunks: [{
      records: `${evidenceRoot}/main_frame/elements_computed/chunk_0000.jsonl`,
      computedStyles: `${evidenceRoot}/main_frame/computed_styles/chunk_0000.json`,
      entries: 1
    }]
  })
});
completenessFiles.set(`${evidenceRoot}/visual_manifest.json`, {
  kind: 'text',
  data: JSON.stringify({ complete: true, fullPage: { mode: 'single', file: `${evidenceRoot}/visual_full_page.png` } })
});
const completenessCapture = {
  requests: new Map(),
  scripts: new Map(),
  childTargets: new Map(),
  webSockets: [],
  eventSourceMessages: [],
  executionContexts: [],
  warnings: [],
  options: { mode: 'max', reloadForNetwork: false },
  originalUrl: 'https://example.test/',
  currentPageUrl: 'https://example.test/',
  startedAt: Date.now(),
  crawlPages: [],
  runtimeCheckpoints: [],
  scriptSourceIndex: new Map(),
  interactionStates: 0,
  discoveredRoutes: 0,
  totalBodyBytes: 0,
  interceptedBodies: 0,
  eventLimits: {},
  secretHeaderFingerprintDrops: 0,
  secretHeaderFingerprints: [],
  sourceAnalysisManifest: [],
  wasmWatManifest: [],
  reconstructedSourceFiles: 0,
  reconstructedSourceBytes: 0
};
workerContext.__workerTests.buildCompletenessReport(completenessCapture, completenessFiles);
const report = JSON.parse(completenessFiles.get('capture_completeness.json').data);
assert.equal(report.pages.primaryEvidenceRoots[0], evidenceRoot);
assert.equal(report.pages.browserExposedCoreComplete, true);
assert.equal(report.pages.evidenceAudit.find((entry) => entry.evidenceRoot === evidenceRoot).coreSnapshotComplete, true);

// Regression for the HAOQI v2.2.3 failure: a response containing CSP or other
// policy headers must be aggregated without calling a page-only sanitizer.
const policyFiles = new Map();
const policyCapture = {
  requests: new Map([['request-1', {
    requestId: 'request-1',
    type: 'Document',
    wallTime: Date.now() / 1000,
    request: { method: 'GET', url: 'https://haoqi.design/', headers: [] },
    response: {
      url: 'https://haoqi.design/',
      status: 200,
      statusText: 'OK',
      headers: [
        { name: 'content-security-policy', value: "default-src 'self'; report-uri https://example.test/csp?token=private" },
        { name: 'permissions-policy', value: 'camera=(), microphone=()' }
      ],
      mimeType: 'text/html',
      protocol: 'h2'
    },
    body: { omitted: true, reason: 'test fixture' }
  }]]),
  webSockets: [],
  eventSourceMessages: [],
  eventLimits: {},
  secretHeaderFingerprints: [],
  secretHeaderFingerprintDrops: 0,
  streamPayloadOmissions: 0,
  streamPayloadOmittedCharacters: 0,
  console: [],
  exceptions: [],
  logs: []
};
assert.doesNotThrow(() => workerContext.__workerTests.buildNetworkFiles(policyCapture, policyFiles));
const policyInventory = JSON.parse(policyFiles.get('network/security_policy_headers.json').data);
assert.equal(policyInventory.entries.length, 1);
assert.equal(policyInventory.entries[0].headers.length, 2);
assert.doesNotMatch(JSON.stringify(policyInventory), /token=private/);

const resilientFiles = new Map();
const resilientCapture = { warnings: [] };
assert.equal(workerContext.__workerTests.runArchiveBuilder(resilientCapture, resilientFiles, 'optional evidence', () => { throw new Error('fixture failure'); }), false);
assert.ok(resilientCapture.warnings.some((warning) => /fixture failure/.test(warning)));
assert.ok([...resilientFiles.keys()].some((key) => key.startsWith('diagnostics/finalization_')));

const analysisFiles = new Map();
const analysisCapture = {
  capturedSourceAnalysisKeys: new Set(),
  sourceAnalysisManifest: [],
  sourceAnalysisInputBytes: 0,
  currentPageUrl: 'https://example.test/',
  originalUrl: 'https://example.test/'
};
await workerContext.__workerTests.analyzeJavaScriptSource(
  analysisCapture,
  analysisFiles,
  'export async function load(){ return fetch("/api/items?token=private") }',
  'forensics/scripts/0000_sample.js',
  { url: 'https://example.test/sample.js' }
);
assert.equal(analysisCapture.sourceAnalysisManifest.length, 1);
assert.ok(analysisCapture.sourceAnalysisManifest[0].astFile);
assert.ok(analysisCapture.sourceAnalysisManifest[0].beautifiedFile);
const astSummary = JSON.parse(analysisFiles.get(analysisCapture.sourceAnalysisManifest[0].astFile).data);
assert.deepEqual(astSummary.routeCandidates, ['/api/items?token=%5BREDACTED%5D']);

const fingerprintCapture = {
  secretHeaderFingerprints: [],
  secretHeaderFingerprintDrops: 0,
  pendingMetadata: new Set(),
  warnings: []
};
workerContext.__workerTests.scheduleSecretHeaderFingerprints(
  fingerprintCapture,
  'root:1',
  'request',
  { Authorization: 'Bearer reusable-secret', Cookie: 'session=must-not-hash', 'X-CSRF-Token': 'csrf-value' }
);
await Promise.allSettled([...fingerprintCapture.pendingMetadata]);
assert.equal(fingerprintCapture.secretHeaderFingerprints.length, 2);
assert.ok(fingerprintCapture.secretHeaderFingerprints.every((entry) => entry.length > 0 && /^[a-f0-9]{64}$/.test(entry.sha256)));
assert.doesNotMatch(JSON.stringify(fingerprintCapture.secretHeaderFingerprints), /reusable-secret|csrf-value|must-not-hash/);

const activity = [];
for (const taskId of ['one', 'two', 'three']) {
  for (let index = 0; index < 501; index += 1) activity.push({ taskId, index });
}
const retained = retainRecentActivityTasks(activity);
assert.equal(retained.length, 1002);
assert.deepEqual([...new Set(retained.map((entry) => entry.taskId))], ['two', 'three']);

let offscreenListener = null;
const parsedProgram = parseJavaScript('export const answer=42', { ecmaVersion: 'latest', sourceType: 'module' });
assert.match(generateJavaScript(parsedProgram), /export const answer = 42/);

const require = createRequire(import.meta.url);
globalThis.WabtModule = require(path.join(root, 'vendor/wabt.js'));
globalThis.chrome = {
  runtime: {
    onMessage: {
      addListener(handler) { offscreenListener = handler; }
    }
  }
};
const opfsChunks = new Map();
const opfsDirectory = {
  async removeEntry(fileName) { opfsChunks.delete(fileName); },
  async getFileHandle(fileName) {
    const chunks = [];
    opfsChunks.set(fileName, chunks);
    return {
      async createWritable() {
        return {
          async write(chunk) { chunks.push(new Uint8Array(chunk)); },
          async close() {},
          async abort() { chunks.length = 0; }
        };
      },
      async getFile() { return new Blob(chunks); }
    };
  }
};
Object.defineProperty(globalThis.navigator, 'storage', {
  configurable: true,
  value: {
    async getDirectory() {
      return { async getDirectoryHandle() { return opfsDirectory; } };
    }
  }
});
await import(`${pathToFileURL(path.join(root, 'offscreen.js')).href}?selftest=${Date.now()}`);
assert.equal(typeof offscreenListener, 'function');
const sendOffscreen = (message) => new Promise((resolve, reject) => {
  const handled = offscreenListener({ target: 'offscreen', ...message }, {}, (response) => {
    if (response?.ok) resolve(response);
    else reject(new Error(response?.error || 'Offscreen request failed.'));
  });
  if (handled !== true) reject(new Error('Offscreen listener did not accept the request.'));
});
const captureId = 'selftest';
const convertedWat = await sendOffscreen({ action: 'WASM_TO_WAT', base64: Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]).toString('base64') });
assert.match(convertedWat.wat, /\(module/);
await sendOffscreen({ action: 'START', captureId });
const expectedFiles = new Map([
  ['hello.txt', { bytes: Buffer.from('hello streamed zip'), store: false }],
  ['nested/data.json', { bytes: Buffer.from('{"works":true}'), store: false }],
  ['network/bodies/font.ttf', { bytes: Buffer.from(Array.from({ length: 171072 }, (_, index) => (index * 31 + Math.floor(index / 257)) & 255)), store: true }]
]);
for (const [filePath, entry] of expectedFiles) {
  const { bytes, store } = entry;
  const split = Math.max(1, Math.floor(bytes.length / 2));
  const chunks = bytes.length > 1 ? [bytes.subarray(0, split), bytes.subarray(split)] : [bytes];
  for (let index = 0; index < chunks.length; index += 1) {
    await sendOffscreen({
      action: 'FILE_CHUNK',
      captureId,
      path: filePath,
      index,
      total: chunks.length,
      store,
      data: chunks[index].toString('base64')
    });
  }
}
const finalized = await sendOffscreen({ action: 'FINALIZE', captureId });
assert.equal(finalized.storageMode, 'opfs');
const finalizedResponse = await fetch(finalized.blobUrl);
const finalizedBlob = await finalizedResponse.blob();
assert.equal(finalizedBlob.type, 'application/zip');
const archiveBytes = new Uint8Array(await finalizedBlob.arrayBuffer());
const archive = unzipSync(archiveBytes);
assert.equal(strFromU8(archive['hello.txt']), 'hello streamed zip');
assert.equal(strFromU8(archive['nested/data.json']), '{"works":true}');
assert.deepEqual(Buffer.from(archive['network/bodies/font.ttf']), expectedFiles.get('network/bodies/font.ttf').bytes);
await sendOffscreen({ action: 'REVOKE', blobUrl: finalized.blobUrl });

Object.defineProperty(globalThis.navigator, 'storage', { configurable: true, value: undefined });
const memoryCaptureId = 'selftest-memory';
await sendOffscreen({ action: 'START', captureId: memoryCaptureId });
const memoryBytes = Buffer.from(Array.from({ length: 524321 }, (_, index) => (index * 17 + 9) & 255));
for (let index = 0, offset = 0; offset < memoryBytes.length; index += 1, offset += 131072) {
  const chunk = memoryBytes.subarray(offset, Math.min(memoryBytes.length, offset + 131072));
  await sendOffscreen({
    action: 'FILE_CHUNK', captureId: memoryCaptureId, path: 'binary/font-stress.ttf', index,
    total: Math.ceil(memoryBytes.length / 131072), store: true, data: chunk.toString('base64')
  });
}
const memoryFinalized = await sendOffscreen({ action: 'FINALIZE', captureId: memoryCaptureId });
assert.equal(memoryFinalized.storageMode, 'memory');
const memoryArchive = unzipSync(new Uint8Array(await (await fetch(memoryFinalized.blobUrl)).arrayBuffer()));
assert.deepEqual(Buffer.from(memoryArchive['binary/font-stress.ttf']), memoryBytes);
await sendOffscreen({ action: 'REVOKE', blobUrl: memoryFinalized.blobUrl });

console.log(`Self-test passed: bounded debugger timeout/retry/conflict handling, safe-crawl filtering, clean body paths, Web Audio graph instrumentation, thirty-hour Unlimited safety boundary, Pause/Resume deadline preservation, ${tiled.grid.requiredTiles} visual tiles, completeness audit, parser/printer, Wasm-to-WAT, two-task retention, and binary-safe OPFS/memory ZIP round-trips.`);
