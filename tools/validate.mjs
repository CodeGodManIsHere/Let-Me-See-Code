import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  'manifest.json', 'service_worker.js', 'page_extractor.js', 'popup.html', 'popup.css',
  'popup.js', 'activity_log.js', 'page_instrumentation.js', 'offscreen.html', 'offscreen.js',
  'vendor/fflate.js', 'vendor/fflate.LICENSE', 'vendor/acorn.mjs', 'vendor/acorn.LICENSE',
  'vendor/astring.mjs', 'vendor/astring.LICENSE', 'vendor/wabt.js', 'vendor/wabt.LICENSE',
  'README.md', 'PRIVACY.md', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'LICENSE',
  '.github/workflows/validate.yml', '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml', 'docs/index.html', 'docs/demo.css',
  'docs/demo.js', 'docs/popup-demo.html', 'docs/popup-demo.css', 'docs/popup-demo.js',
  'docs/og.png', 'docs/.nojekyll', 'docs/assets/icon-128.png', 'docs/assets/let-me-see-code.png',
  'docs/assets/captures/haoqi-home.png', 'docs/assets/captures/haoqi-reunimos.png',
  'docs/assets/captures/haoqi-inspire.png', 'docs/assets/captures/hackthenorth-home.png',
  'docs/assets/captures/hackthenorth-motion-0.png', 'docs/assets/captures/hackthenorth-motion-2.png',
  'assets/let-me-see-code.png',
  'assets/icon-16.png', 'assets/icon-32.png', 'assets/icon-48.png', 'assets/icon-128.png',
  'tools/selftest.mjs'
];

const errors = [];
for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) errors.push(`Missing ${relative}`);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
} catch (error) {
  errors.push(`Invalid manifest JSON: ${error.message}`);
}

if (manifest) {
  if (manifest.manifest_version !== 3) errors.push('manifest_version must be 3');
  if (manifest.name !== 'Let Me See Code') errors.push('manifest name must be Let Me See Code');
  if (manifest.version !== '2.2.16') errors.push('manifest version must be 2.2.16');
  if (manifest.description !== 'The true tool for viewing source.') errors.push('Manifest description must use the requested product copy');
  if (manifest.background?.service_worker !== 'service_worker.js') errors.push('Unexpected service worker path');
  if (manifest.action?.default_popup !== 'popup.html') errors.push('Unexpected popup path');
  const permissions = new Set(manifest.permissions || []);
  for (const permission of ['activeTab', 'debugger', 'downloads', 'offscreen', 'scripting', 'storage', 'unlimitedStorage']) {
    if (!permissions.has(permission)) errors.push(`Missing permission: ${permission}`);
  }
  for (const permission of permissions) {
    if (!['activeTab', 'debugger', 'downloads', 'offscreen', 'scripting', 'storage', 'unlimitedStorage'].includes(permission)) errors.push(`Unexpected production permission: ${permission}`);
  }
  if ((manifest.host_permissions || []).length) errors.push('Permanent host access is intentionally forbidden');
}

const popupHtml = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const popupCss = fs.readFileSync(path.join(root, 'popup.css'), 'utf8');
const popupSource = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const popupIds = new Set([...popupHtml.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
for (const match of popupSource.matchAll(/\$\(['"]#([^'"]+)['"]\)/g)) {
  if (!popupIds.has(match[1])) errors.push(`popup.js references missing #${match[1]}`);
}

for (const mode of ['quick', 'max', 'entire']) {
  if (!popupHtml.includes(`value="${mode}"`)) errors.push(`Missing ${mode} capture mode in popup`);
}
if (popupHtml.includes('The selected tab locks when capture starts')) errors.push('Idle target-lock copy must not be shown');
if ((popupHtml.match(/Safe to switch tabs or windows\. Avoid interacting with the captured page while a run is active</g) || []).length !== 1) {
  errors.push('Capture guidance must appear exactly once');
}
if (!popupHtml.includes('id="targetStrip" hidden')) errors.push('Target strip must start hidden');
if (!/<div class="progress-track">[\s\S]*?<div class="progress-meta">[\s\S]*?id="progressValue"/.test(popupHtml)) errors.push('Visible percentage must appear below the progress bar');
if (popupHtml.includes('id="etaText"') || /Calibrating live ETA|>ETA\s/.test(popupHtml)) errors.push('Progress area must not show estimating text');
if (/\b(?:etaSeconds|estimatedSeconds|ESTIMATE_CAPTURE)\b/.test(`${popupSource}\n${fs.readFileSync(path.join(root, 'service_worker.js'), 'utf8')}`)) errors.push('Obsolete ETA protocol and estimator state must remain removed');
if (!popupSource.includes("document.addEventListener('pointermove'")) errors.push('Interactive particle pointer handling is missing');
if (!popupCss.includes('grid-template-columns: minmax(0, 1fr);')) errors.push('Popup root grid must use a bounded column');
if (!popupCss.includes('.action-row:has(.cancel-button:not([hidden])) { grid-template-columns: minmax(0, 1fr) 70px 70px; gap: 7px; }')) errors.push('Running action row must have bounded Pause and Cancel columns');
if (/main\s*\{[^}]*border-radius:\s*26px/s.test(popupCss)) errors.push('Inset fake popup corners must remain removed');
if (popupHtml.includes('activityLogMaxEntries') || popupSource.includes('activityLogMaxEntries')) errors.push('Line-based activity log cap must remain removed');
if (!popupHtml.includes('Complete newest runs') || !popupHtml.includes('2 tasks')) errors.push('Two-task log retention must be visible in Settings');
if (/data-preset=|>Lean<|>Balanced<|>Complete<|>Fastest<|>Recommended<|>Most data</.test(popupHtml)) errors.push('Removed capture presets must not remain in the popup');
if (!popupHtml.includes('id="elapsedValue"') || !popupHtml.includes('id="pageValue"')) errors.push('Measured elapsed/page progress is missing');
if (!popupSource.includes('usesPreviousDefaults') || !popupSource.includes("settingsVersion: '2.2.16'")) errors.push('Settings migration/versioning is missing');
if ((popupSource.match(/progressShell\.hidden = true/g) || []).length < 4) errors.push('Progress must disappear after failed, interrupted, cancelled, stopped and idle states');
if (!popupHtml.includes('id="maxRuntimeMinutes"') || !popupHtml.includes('id="maxPages"')) errors.push('Adjacent Max runtime/page controls are missing');
if (!popupHtml.includes('id="pauseButton"') || !popupSource.includes("type: messageType") || !popupSource.includes("'PAUSE_CAPTURE'")) errors.push('Popup Pause/Resume control is missing');
if (popupHtml.includes('Capture controls') || popupHtml.includes('Limits for speed and stability.')) errors.push('Removed Settings heading copy must not remain');
if (/LOCAL|trust-grid/.test(popupHtml)) errors.push('Removed About trust strip must not remain');
if (/\bAI\b/i.test(`${popupHtml}\n${popupSource}`)) errors.push('Removed product wording must not return');
if (!popupHtml.includes('Liked the extension? Star the repo') || !popupHtml.includes('https://github.com/CodeGodManIsHere/Let-Me-See-Code')) errors.push('Linked repository-star footer is missing');
if (!popupCss.includes('overflow-y: hidden')) errors.push('Popup panels must fit without vertical scrolling');
if (!popupCss.includes('-webkit-backdrop-filter') || !popupCss.includes('backdrop-filter')) errors.push('Cross-platform liquid-glass material styling is missing');
if (!popupCss.includes('-apple-system') || !popupCss.includes('prefers-reduced-motion')) errors.push('macOS typography or reduced-motion support is missing');
if (!popupSource.includes('Array.from({ length: 44 }') || !popupCss.includes('opacity: .66')) errors.push('Visible interactive particle field is missing');
for (const paletteToken of ['#060a0e', '#142a36', 'rgba(20, 31, 39, .43)', '#f4f7f8', '#a3afb7', '#55b9e8', '#65d6ba', '#f0c36a', '#ef7b82']) {
  if (!popupCss.includes(paletteToken)) errors.push(`Obsidian Sea Glass palette token is missing: ${paletteToken}`);
}
if (!popupCss.includes('background-image: url("data:image/svg+xml') || !popupCss.includes('content: none')) errors.push('Obsidian grain or solid Capture-button treatment is missing');

const workerSource = fs.readFileSync(path.join(root, 'service_worker.js'), 'utf8');
if (/\bAI\b/i.test(workerSource)) errors.push('Removed product wording must not return in the capture engine');
const retentionSource = fs.readFileSync(path.join(root, 'activity_log.js'), 'utf8');
const offscreenSource = fs.readFileSync(path.join(root, 'offscreen.js'), 'utf8');
for (const requiredFeature of [
  'checkpointPageRuntime',
  'isLikelyHtmlUrl',
  'scripts_manifest.json',
  'Duplicate canonical or redirected page',
  'deep: true, framework: true',
  'capturePausedResponse',
  'exploreSafeUiStates',
  'discoverExtendedRoutes',
  'captureSourceMaps',
  'Debugger.getWasmBytecode',
  'CANCEL_CAPTURE',
  'targetTabId',
  'chrome.tabs.onRemoved',
  'stopForClosedTarget',
  'captureTiledPageScreenshot',
  'visual_tiles/manifest.json',
  'visual_manifest.json',
  'lazy_load_sweep.json',
  'browserExposedCoreComplete',
  'post-interaction-state',
  'captureCookieMetadata',
  'secret_header_fingerprints.json',
  'captureOpfsContents',
  'captureWebSql',
  'analyzeJavaScriptSource',
  'convertWasmToWat',
  'reconstructed_sources',
  'Network.eventSourceMessageReceived',
  'installPageInstrumentation'
]) {
  if (!workerSource.includes(requiredFeature)) errors.push(`Missing v2 feature: ${requiredFeature}`);
}
if (!workerSource.includes('Potentially state-changing or sensitive route') || !workerSource.includes('Token-bearing single-use route')) errors.push('Max route safety policy is incomplete');
if (!workerSource.includes("type: 'mousePressed'") || !workerSource.includes("type: 'keyUp'") || !workerSource.includes("type: 'touchStart'")) errors.push('Bounded canvas click, keyboard or touch interaction capture is missing');
if (!workerSource.includes('looksBlank') || !workerSource.includes('duplicateOfPrevious')) errors.push('Raw canvas health and duplicate-frame validation is missing');
if (!workerSource.includes('failures.matchedStyles === 0 && failures.eventListeners === 0')) errors.push('Deep-DOM completeness must include query success');
if (!workerSource.includes('one-or-more-runtime-checkpoints-incomplete')) errors.push('Max script manifest must report incomplete runtime checkpoints');
for (const requiredFeature of [
  'captureDynamicSurfaceProfile',
  'positionDynamicSurface',
  'captureQuickDynamicProbe',
  'dynamicSurfaceCoverageRequired',
  'nestedScrollVisualTiles',
  'pointerVisualStates',
  'audioEvidenceSnapshots'
]) {
  if (!workerSource.includes(requiredFeature)) errors.push(`Missing v2.2.8 dynamic evidence feature: ${requiredFeature}`);
}
if ((workerSource.match(/await runLazyLoadSweep\(/g) || []).length < 5) errors.push('Lazy-load sweep is not wired into every deep capture path');
if (!retentionSource.includes('ACTIVITY_LOG_TASK_LIMIT = 2') || !workerSource.includes('retainRecentActivityTasks')) errors.push('Two-task activity retention is missing');
if (workerSource.includes('activityLogMaxEntries')) errors.push('Service worker still contains a line-based log cap');
if (!workerSource.includes('deep_dom_inspection/chunk_') || !workerSource.includes('const concurrency = 8')) errors.push('Eight-worker batched deep-DOM inspection is missing');
if (!workerSource.includes('MAX_ENTRY_DEEP_INSPECTION_BUDGET_MS') || !workerSource.includes("stopReason = 'time-budget-reached'")) errors.push('Time-bounded deep-DOM inspection is missing');
if (!workerSource.includes('PSEUDO_STATE_MAX_ENTRY_BUDGET_MS') || !workerSource.includes('CSS-state sampling time limit reached')) errors.push('Time-bounded pseudo-state inspection is missing');
if (!workerSource.includes('RESPONSIVE_MAX_ENTRY_BUDGET_MS') || !workerSource.includes('responsive capture: time budget reached')) errors.push('Time-bounded responsive capture is missing');
if (!workerSource.includes('PAGE_SCRIPT_CHECKPOINT_BUDGET_MS') || !workerSource.includes('FINAL_SCRIPT_CAPTURE_BUDGET_MS')) errors.push('Time-bounded script preservation is missing');
if (!workerSource.includes('DEFAULT_MAX_RUNTIME_MINUTES') || !workerSource.includes('maxRuntimeMinutes') || !workerSource.includes("runtimeLimit")) errors.push('Configurable Max runtime boundary is missing');
if (!workerSource.includes('awaitPauseCheckpoint') || !workerSource.includes("message?.type === 'PAUSE_CAPTURE'") || !workerSource.includes("message?.type === 'RESUME_CAPTURE'")) errors.push('Safe Pause/Resume protocol is missing');
if (!workerSource.includes('maximumDurationMs = 20_000') || !workerSource.includes("lazy-load sweep`, 30_000")) errors.push('Wall-clock-bounded lazy-load sweep is missing');
if (!workerSource.includes('includeOriginContents') || !workerSource.includes('storageContentsCaptured')) errors.push('Entry-page-only origin content policy is missing');
if (!workerSource.includes("version: '2.2.16'") || !workerSource.includes("extensionVersion: '2.2.16'")) errors.push('Capture metadata version must match manifest 2.2.16');
for (const feature of ['crawlSafetyReason', 'secondaryScrollSurfaces', 'captureVideoPlaybackStates', 'captureCanvasInteractionStates', 'css_rule_dictionary.jsonl', 'fileStemWithoutRepeatedExtension', 'webAudioGraphSnapshotCount']) {
  if (!workerSource.includes(feature)) errors.push(`Missing 2.2.10 hardening feature: ${feature}`);
}
for (const feature of ['attachDebuggerReliably', 'DEBUGGER_ATTACH_TIMEOUT_MS', 'safeDebuggerDetach', 'debuggerHealthProbe', 'Chrome did not answer; cleaned the stale connection', 'Failure detail:', 'Stage timing:', 'executeScript(details']) {
  if (!workerSource.includes(feature)) errors.push(`Missing 2.2.11 reliability feature: ${feature}`);
}
const rendererSafetySource = `${workerSource}\n${fs.readFileSync(path.join(root, 'page_extractor.js'), 'utf8')}`;
for (const feature of [
  "extractorPhase: 'elements'",
  "extractorPhase: 'document'",
  'elements_computed_manifest.json',
  'probeTargetRenderer',
  'maxCanvasSnapshotPixels',
  "DOM.querySelectorAll', { nodeId: documentResult.root.nodeId, selector: '*'"
]) {
  if (!rendererSafetySource.includes(feature)) errors.push(`Missing 2.2.12 renderer-safety feature: ${feature}`);
}
if (!workerSource.includes('async function listOpfsFiles(capture, prefix)') || !workerSource.includes('async function readOpfsBatch(capture, paths, prefix)') || !workerSource.includes("async function discoverCurrentPage(capture, prefix = 'page-discovery')")) {
  errors.push('Every helper that labels OPFS or page-discovery work must receive an explicit evidence prefix');
}
if (!offscreenSource.includes('ZipDeflate') || !offscreenSource.includes('ZipPassThrough') || !offscreenSource.includes('outputChunks.push(chunk)') || !offscreenSource.includes("message.action === 'ABORT'")) errors.push('Binary-safe streaming ZIP packaging and cleanup are missing');
if (!workerSource.includes('optionalCdp') || !workerSource.includes('isUnsupportedCdpMethod') || !workerSource.includes('binary-safe ZIP storage')) errors.push('Scoped compatibility logging and binary-safe ZIP progress are missing');
if (!offscreenSource.includes("{ type: 'application/zip' }") || !workerSource.includes("-${publicMode}.zip`")) errors.push('Capture download must retain ZIP MIME type and .zip filename');
if (!offscreenSource.includes('new Blob([stagedFile], { type: \'application/zip\' })')) errors.push('OPFS-staged captures must be retyped as application/zip before download');
if (!offscreenSource.includes("message.action === 'WASM_TO_WAT'") || !fs.readFileSync(path.join(root, 'offscreen.html'), 'utf8').includes('vendor/wabt.js')) errors.push('Bundled Wasm-to-WAT conversion is missing');
if (!workerSource.includes('addDeduplicatedJson') || !workerSource.includes('deduplication_manifest.json')) errors.push('Exact JSON artifact deduplication is missing');
if (!workerSource.includes('recordStructuralComparison') || !workerSource.includes('structurally-identical-content-delta') || !workerSource.includes('coreCaptureReplaced: false')) errors.push('Supplemental structural duplicate/delta detection is missing');
if (!workerSource.includes('origin_intelligence_reference.json') || !workerSource.includes('capturedOncePerOrigin')) errors.push('Origin-wide evidence reuse is missing');
if (!workerSource.includes("listenerStrategy: 'interactive-and-semantic-controls-only'") || !workerSource.includes("matchedStyleStrategy: 'every-selected-element-node'")) errors.push('Full matched-CSS plus interactive-listener strategy is missing');
if (workerSource.includes('matchedStyleReferencePath') || workerSource.includes("status: 'deduplicated'")) errors.push('Unsafe Max capture replacement shortcuts must remain removed');
if (!workerSource.includes('effectiveDeepInspectionBudget') || !workerSource.includes('MAX_FINALIZATION_RESERVE_MS')) errors.push('Max deep capture must use the remaining run budget with finalization reserve');
if (!workerSource.includes('maxDepthAudit') || !workerSource.includes('allCapturedPagesCompleteWithinConfiguredNodeLimit')) errors.push('Explicit Max depth completeness audit is missing');
if (!workerSource.includes("const viewports = allViewports") || workerSource.includes('mobile + desktop DOM/layout evidence')) errors.push('Max routes must retain all responsive viewport states');
if (!workerSource.includes('runArchiveBuilder') || !workerSource.includes('runOptionalFinalizer')) errors.push('Finalization fault isolation is missing');
if (/\bredactString\s*\(/.test(workerSource)) errors.push('Service worker must not call the page-only redactString helper');
if (!workerSource.includes('network/security_policy_headers.json')) errors.push('Network security-policy header inventory is missing');

const extractorSource = fs.readFileSync(path.join(root, 'page_extractor.js'), 'utf8');
if (!extractorSource.includes('computedStyleMatchesDeclaration') || !extractorSource.includes('styleBucketFingerprint')) errors.push('Collision-safe compact computed-style interning is missing');
if (!extractorSource.includes('readResponseBytesBounded') || !extractorSource.includes('for (let requestIndex = 0; requestIndex < requests.length; requestIndex += 1)')) errors.push('Sequential bounded Cache Storage extraction is missing');
if (!extractorSource.includes('collectSecurityMetadata') || !extractorSource.includes('collectHardwareProfile')) errors.push('Secret-safe security metadata or hardware profile capture is missing');
if (!extractorSource.includes('collectDocumentIntelligence') || !extractorSource.includes('collectPerformanceIntelligence')) errors.push('Document/performance intelligence capture is missing');
for (const deprecatedType of ['longtask', 'layout-shift', 'largest-contentful-paint', 'event']) {
  if (extractorSource.includes(`getEntriesByType('${deprecatedType}')`) || extractorSource.includes(`getEntriesByType("${deprecatedType}")`)) errors.push(`Deprecated Performance Timeline query remains: ${deprecatedType}`);
}
if (!extractorSource.includes('deprecatedEntryTypeQueriesUsed: false') || !extractorSource.includes('bufferedObserverApi')) errors.push('Performance intelligence must document buffered observer collection');
for (const collector of ['collectCssIntelligence', 'collectNavigationIntelligence', 'collectPolicyIntelligence', 'collectFrameworkBootstrapIntelligence']) {
  if (!extractorSource.includes(collector)) errors.push(`Expanded low-cost evidence collector is missing: ${collector}`);
}
if (!extractorSource.includes('enteredValueCaptured: false') || /return \{ \.\.\.base, value:/.test(extractorSource)) errors.push('Form validation evidence must not collect entered values');
if (!extractorSource.includes('assignedElementPaths') || !extractorSource.includes('delegatesFocus')) errors.push('Slot/open-shadow-root metadata is incomplete');
if (!extractorSource.includes('INCLUDE_APPLICATION_CONTENTS') || !extractorSource.includes('contentsIncluded')) errors.push('Per-page application-content policy is missing');

const instrumentationSource = fs.readFileSync(path.join(root, 'page_instrumentation.js'), 'utf8');
for (const feature of ['pointerColumns', "addEventListener('keydown'", 'RTCPeerConnection', 'RTCDataChannel', 'WebGLRenderingContext', 'GPUDevice', 'BaseAudioContext', 'AudioNode', 'AudioParam', 'AnalyserNode', 'HTMLMediaElement']) {
  if (!instrumentationSource.includes(feature)) errors.push(`Page instrumentation is missing ${feature}`);
}
for (const audioFeature of ['audioConnections', 'audioParameterEvents', 'analyserReads', 'workletModules', 'microphoneInputCaptured: false']) {
  if (!`${instrumentationSource}\n${workerSource}`.includes(audioFeature)) errors.push(`Audio evidence is missing ${audioFeature}`);
}
if (!instrumentationSource.includes('CSS.registerProperty') || !instrumentationSource.includes('registeredProperties')) errors.push('Runtime CSS registered-property instrumentation is missing');
for (const feature of ['graphicsSourceDescriptor', 'GPUCommandEncoder', 'GPURenderPassEncoder', '24 * 1024 * 1024']) {
  if (!instrumentationSource.includes(feature)) errors.push(`Expanded graphics instrumentation is missing ${feature}`);
}
for (const performanceType of ['longtask', 'layout-shift', 'largest-contentful-paint', 'event']) {
  if (!instrumentationSource.includes(performanceType)) errors.push(`Buffered PerformanceObserver instrumentation is missing ${performanceType}`);
}
if (!instrumentationSource.includes('durationThreshold: 16') || !instrumentationSource.includes('performanceEntriesPerType')) errors.push('Bounded Event Timing observer configuration is missing');
if (!popupCss.includes('blur(34px) saturate(164%)') || !popupCss.includes('previous composition with deeper, more translucent glass')) errors.push('v2.2.7 liquid-glass refinement is missing');
if (!popupSource.includes('installGlassDrag') || !popupSource.includes('installLogoAnimations')) errors.push('Draggable glass controls or logo interaction is missing');
if (!popupSource.includes('trailUntil = now + 4500') || !popupSource.includes("pixel.className = 'cursor-pixel'") || !popupCss.includes('@keyframes cursor-pixel-fade')) errors.push('Four-and-a-half-second cursor pixel trail is missing');
if (!workerSource.includes('MAX_UNLIMITED_RUNTIME_MINUTES = 30 * 60') || !workerSource.includes('effectiveMaxRuntimeMinutes')) errors.push('Concealed thirty-hour Unlimited safety boundary is missing');
if (!workerSource.includes('unlimitedAwareStageBudget') || !workerSource.includes('capture.unlimitedRuntimeSelected')) errors.push('Unlimited Max must not inherit ordinary optional-stage time budgets');
if (!workerSource.includes("capture?.options?.mode === 'quick' ? startedAt + 90_000")) errors.push('Quick core CDP/visual capture must have a bounded stage deadline');
if (!workerSource.includes("capture?.options?.mode === 'max' ? startedAt + 60_000")) errors.push('Fast core CDP/visual capture must have a bounded stage deadline');
if (!workerSource.includes('FAST_DEEP_INSPECTION_BUDGET_MS = 60_000')) errors.push('Fast matched-style inspection must have a bounded one-minute budget');
if (!workerSource.includes('usableFiniteMaxEvidenceRoot') || !workerSource.includes('Unlimited Max does not use this finite-runtime fallback')) errors.push('Finite Max must export a usable explicitly-audited archive when only full-document tiles miss the runtime');
if (!workerSource.includes("const isQuick = capture?.options?.mode === 'quick'") || !workerSource.includes("'Capturing layout and lossless visuals…'")) errors.push('Quick must avoid redundant deep serializers while retaining its visual/DOM/style contract');
if (!workerSource.includes("visualManifest.fullPage = { mode: 'viewport-only'")) errors.push('Quick must retain the current visual without attempting an unbounded full-document screenshot');
if (!workerSource.includes("capture.options.mode === 'quick' ? 2000 : 750")) errors.push('Quick element/style extraction must use a higher-throughput bounded chunk size');
if (!extractorSource.includes('Math.min(2000, Math.max(50')) errors.push('Page extractor must accept the Quick high-throughput chunk size without silently truncating ranges');
if (!extractorSource.includes('QUICK_STYLE_PROPERTIES') || !workerSource.includes("quickStyleMode: capture.options.mode === 'quick'")) errors.push('Quick must use its bounded critical computed-style projection');
if (!workerSource.includes("const isMax = capture?.options?.mode === 'entire'") || (workerSource.match(/const maximumCharacters = MESSAGE_CHUNK_BYTES/g) || []).length < 2) errors.push('Fast must avoid redundant CDP DOM serialization and archive text staging must use bounded high-throughput chunks');
if (/30\s*(?:hours?|hrs?)/i.test(`${popupHtml}\n${popupSource}`)) errors.push('The hidden Unlimited safety boundary must not be disclosed in the UI');
if (!workerSource.includes('captureAnimationVisualTimeline') || !workerSource.includes('animationEvidence') || !workerSource.includes('ANIMATION_SAMPLED_LIMIT = 90')) errors.push('Expanded animation evidence pipeline is missing');
for (const feature of ['DYNAMIC_MIN_SCROLL_RANGE = 32', 'prioritizedScrollFractions', 'DYNAMIC_CANVAS_SAMPLE_MAX_PIXELS', 'isInjectedExtensionRuntimeUrl', 'ignoredInjectedExtensionScripts', 'capture.warnings = [...new Set(capture.warnings)]']) {
  if (!workerSource.includes(feature)) errors.push(`Missing v2.2.13 capture-quality feature: ${feature}`);
}
for (const feature of ['positionDynamicSurfaceOnly', 'verifiedVerticalDelta', 'surfaceSignatures', 'entrySeconds * 0.34', 'compositor-fallback', 'Capture diagnostics:']) {
  if (!workerSource.includes(feature)) errors.push(`Missing v2.2.14 motion/crawl reliability feature: ${feature}`);
}
for (const feature of [
  'maxOptionalStageAllowed',
  'capture-finalization-reserve-reached',
  'detectedSecondarySurfaces',
  'Dynamic and alternate scroll-surface coverage is audited separately.'
]) {
  if (!workerSource.includes(feature)) errors.push(`Missing v2.2.16 cross-site reliability feature: ${feature}`);
}
if (!workerSource.includes('__LET_ME_SEE_CODE_SCROLL_SURFACES__') || !workerSource.includes('surfaceKey')) errors.push('Stable dynamic-surface identity and recovery are missing');
if (!workerSource.includes('siteArchivePart') || !workerSource.includes('let-me-see-code-${siteArchivePart(capture.originalUrl)}-${publicMode}.zip')) errors.push('Dotted URL archive naming is missing');

for (const relative of ['popup.html', 'offscreen.html']) {
  const html = fs.readFileSync(path.join(root, relative), 'utf8');
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map((match) => match[1]);
  for (const source of scripts) {
    if (/^(?:https?:)?\/\//i.test(source)) errors.push(`${relative} contains remote script ${source}`);
    else if (!fs.existsSync(path.join(root, source))) errors.push(`${relative} references missing script ${source}`);
  }
}

for (const relative of ['service_worker.js', 'page_extractor.js', 'page_instrumentation.js', 'popup.js', 'activity_log.js', 'offscreen.js']) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  if (/\beval\s*\(/.test(source)) errors.push(`${relative} uses eval()`);
  if (/\bnew\s+Function\s*\(/.test(source)) errors.push(`${relative} uses new Function()`);
}

if (errors.length) {
  console.error(errors.map((error) => `ERROR: ${error}`).join('\n'));
  process.exit(1);
}

console.log(`Let Me See Code validation passed (${required.length} required files).`);
