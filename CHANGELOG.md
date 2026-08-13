# Changelog

## 2.2.16

- Completed the final cross-site Quick, Fast, and Max benchmark across static pages, documentation, framework applications, forms, media-heavy pages, e-commerce, social platforms, and animation-focused sites.
- Reworked lazy-surface discovery into a deterministic single pass with cached scores and explicit element/time boundaries, preventing renderer-heavy pages from appearing stuck.
- Removed duplicated full-page and interaction-state work from Fast while preserving authoritative post-reload, mutation, network, responsive, animation, and runtime evidence.
- Added element and computed-style progress counts to long extraction stages so expensive work remains visible and diagnosable.
- Strengthened debugger startup with bounded retries, target health checks, detailed timing, safe cleanup, and graceful handling when DevTools or another automation client owns the tab.
- Fixed the matched-CSS/listener mapping failure caused by an undefined `prefix` reference and tightened high-risk per-element work to reduce renderer instability.
- Improved animation, scroll-surface, pointer, canvas, video, Web Audio, and audio-linked motion evidence while keeping browser and media safety boundaries explicit.
- Fixed large-archive ZIP finalization by validating per-file chunk sequences and recovering only an acknowledged missing final marker; reordered, duplicated, or incomplete chunks still fail closed.
- Kept Windows-safe asset paths and `.zip` downloads, with explicit archive integrity checks before export.
- Improved cancellation and failure cleanup so unfinished archive data is discarded, Chrome detaches cleanly, detailed diagnostics remain available, and the progress display disappears.
- Made Unlimited Max extend optional-stage budgets to its remaining runtime rather than silently using ordinary finite limits. Unlimited remains protected by an internal 30-hour safety ceiling and configured page limit.
- Preserved same-origin, HTML-route, redirect, token, action-query, and destructive-route safeguards during Max crawling.
- Refreshed the repository documentation, v2.2.16 screenshots, privacy and security guidance, contribution instructions, issue forms, and automated validation workflow.

## 2.2.15

- Internal release-candidate stabilization; its debugger, renderer-safety, archive, logging, and capture-depth changes are incorporated into the public v2.2.16 release.

## 2.2.14

- Separated verified scroll positioning from heavier scene analysis so animation screenshots retain trustworthy requested/actual positions even when optional scene evidence reaches its own boundary.
- Replaced repeated 20,000-element scene sweeps with viewport-focused, bounded candidate discovery and background-tab-safe frame waits.
- Verified that nested scroll surfaces actually move before sampling them and deduplicated equivalent surface axes.
- Added page-local stable identities and geometry recovery for nested scroll surfaces that frameworks replace after profiling.
- Accelerated Web Animations state sampling while expanding its bounded Fast and Max budgets.
- Added full-page, viewport and compositor screenshot fallbacks for responsive evidence while retaining DOM/layout evidence on screenshot failure.
- Corrected Max crawl forecasting so one-time entry-page work is not projected onto every later route.
- Added concise non-fatal warning summaries to activity history and retained complete details in `WARNINGS.json`.
- Kept the popup UI unchanged apart from the displayed version.

## 2.2.13

- Prioritized start/end/midpoint scroll evidence so long animation-heavy pages retain full-range motion checkpoints before optional detail.
- Removed tiny-overflow and document/body duplicate false positives from secondary scroll-surface completeness.
- Bounded per-scene canvas work and reserved animation time for scroll traversal, preventing single-scene timeouts from consuming the motion stage.
- Filtered unrelated browser-extension runtime contexts and scripts from website evidence.
- Deduplicated optional-capability warnings and kept final cleanup logs at 100%.

## 2.2.12

- Splits element geometry and complete computed-style capture into bounded renderer-side chunks, staging and releasing each chunk before continuing.
- Processes each accessible frame sequentially so several frame-sized evidence objects are never returned to the extension at the same time.
- Releases CDP DOM snapshots, accessibility trees, MHTML, screenshots and canvas payloads between stages to reduce renderer and service-worker peak memory.
- Replaces the recursive deep-DOM tree request with a flat element index and bounded per-node descriptions before matched-CSS/listener inspection.
- Adds explicit renderer health probes and truthful incomplete-stage reporting instead of continuing after Chrome replaces a crashed page.
- Fixes undefined `prefix` references in page discovery and OPFS listing/content paths.
- Adds route-discovery progress checkpoints so failures are attributed to the stage that actually ran.

## 2.2.11

- Added bounded debugger startup with stale-session cleanup, one retry and command-channel health checks.
- Added timeouts to all page-script injections and the remaining cleanup operations.
- Added detailed startup, stage-duration, failure and cleanup records to Activity logs.
- Progress now disappears when a run fails, is interrupted, is cancelled or stops because its tab closed.

## 2.2.10

- Added safe Max route filtering, multi-scroll-surface visual capture, video checkpoints and bounded canvas interaction probes.
- Added raw-canvas health metadata and duplicate-frame suppression.
- Normalized repeated matched-CSS rules into a shared dictionary to reduce archive duplication.
- Corrected WebM audio classification, WebAudio completeness, deep-DOM completeness and Max script completeness reporting.
- Expanded browser-exposed WebGL texture-source and WebGPU command metadata.
- Removed repeated filename extensions from network bodies.

## 2.2.9

- Fixed intermittent corrupt ZIP entries by storing binary evidence without streamed Deflate and retaining owned ZIP output buffers in both OPFS and memory modes.
- Added binary ZIP stress tests for both packaging paths.
- Made the existing activity messages more descriptive without changing capture stages or UI layout.
- Records unsupported optional Chrome debugging domains as capability metadata instead of warnings.

## 2.2.8

- Added adaptive nested-scroll, canvas, pointer, temporal and audio evidence for difficult motion-heavy sites.
- Corrected false-complete animation and full-page reporting when the real page lives in an inner scrolling surface.
- Kept the v2.2.7 popup layout and styling unchanged apart from the displayed version.

## 2.2.7

- Restored the previous popup composition and limited visual changes to deeper, more translucent glass.
- Enlarged the header logo, lowered the About logo and replaced the logo orbit with a 4.5-second cursor pixel trail.
- Increased and changed the font stack for mode scope, capture guidance, runtime safety and debugging-banner copy.
- Added an internal ten-hour boundary for Unlimited Max runs without exposing it in the popup.
- GitHub ZIP packaging now includes only loadable extension runtime files at the archive root.

## 2.2.6

- Moved animation collection ahead of deep CSS mapping so animation evidence is preserved before page budgets become constrained.
- Expanded animation detection to 500 definitions and prioritized, deduplicated sampling to 90 finite animation states per frame.
- Added library markers, complete keyframes/timing/playback metadata, scroll-state snapshots, visual animation frames and explicit completeness reporting.
- Changed downloaded archive names to `let-me-see-code-<dotted-url>-<mode>.zip`.
- Removed machine-analysis wording from the visible product and archive index.
- Refined the popup with deeper liquid glass, glass switches, draggable spring interactions and interactive logo motion while preserving the fixed popup height.

## 2.2.5

- Replaced unsupported/deprecated Performance Timeline queries for long tasks, layout shifts, LCP and Event Timing with early buffered `PerformanceObserver` collection.
- Added bounded advanced-performance deltas, support/omission metadata and regression fixtures covering all four entry types.
- Increased liquid-glass blur, saturation, refraction, specular highlights and material depth across the popup without changing its layout or controls.
- Retained all v2.2.4 full-depth Max, no-page-skipping, finalization-isolation, HAOQI and OPFS ZIP fixes.

## 2.2.4

- Fixed the v2.2.3 HAOQI finalization crash (`redactString is not defined`) and added a CSP/Permissions Policy regression fixture.
- Restored matched-CSS inspection for every selected Max deep node and removed unsafe selector-shape inference.
- Removed structural-fingerprint page skipping; structural comparisons are supplemental and never replace core capture.
- Restored page-specific origin intelligence on every route while retaining once-per-origin storage/content collection.
- Changed web-storage reuse from unconditional same-origin references to exact SHA-256 content references.
- Allowed Max deep inspection to consume the remaining selected runtime, with a finalization reserve and a pre-route completion estimate so completed routes remain full-depth.
- Fault-isolated optional final collectors and archive indexes so their failures produce diagnostics instead of discarding the staged ZIP.
- Exercised the actual OPFS ZIP path in self-tests and verified an `application/zip` Blob plus a readable streamed archive.
- Kept the popup UI unchanged apart from the displayed version.

## 2.2.3

- Fixed the large-capture download regression where OPFS-staged archives inherited the temporary `.zip.part` file's missing MIME type and Chrome saved the valid ZIP as `.txt`.
- Added explicit CSS, social/document, semantic element, ARIA/slot/shadow, image, font, media, manifest/installability, performance, navigation/history, policy, framework-bootstrap, animation and no-entered-value form-validation inventories.
- Added response security-policy header aggregation for CSP, Permissions Policy, referrer policy, COOP/COEP/CORP, HSTS and related browser-exposed headers.
- Reduced matched-style CDP calls to one representative per unique style shape and restricted native listener inspection to interactive or semantic controls.
- Captured origin-wide intelligence once per origin, reused exact computed-style/stylesheet/storage/script/network artifacts, and published `deduplication_manifest.json`.
- Added structural fingerprints and content-block deltas. Exact duplicate DOM routes reference the earlier evidence; structurally identical but content-different routes retain a compact difference record without discarding their full unique capture.
- Added regression validation for the OPFS ZIP MIME path, low-round-trip strategies and every new inventory.

## 2.2.2

- Introduced the Obsidian Sea Glass palette with an almost-black graphite canvas, icy upper-right light source, faint lower-left teal reflection and subtle film grain.
- Rebalanced glass surfaces around clearer navigation and controls, darker text-bearing panels, thin edge highlights and restrained shadows.
- Replaced the glossy Capture-button gradient with a solid mineral-blue treatment and removed its shine flare.
- Retuned the 44-particle field toward quiet blue-gray points that brighten near the pointer, retaining connections, cursor response and repulsion.
- Kept Pause/Resume, capture modes, settings, evidence collectors, permissions and generated archive behavior unchanged from 2.2.1.

## 2.2.1

- Restored the full interactive particle field with 44 visible particles, connection lines, cursor glow and pointer repulsion.
- Increased glass translucency and blur depth across tabs, mode cards, controls, progress, settings, logs and About surfaces.
- Replaced decorative multicolour treatments with a quieter graphite and steel-blue system for a more deliberate, less generated appearance.
- Kept Pause/Resume, capture modes, settings, evidence collectors, permissions and generated archive behavior unchanged from 2.2.0.

## 2.2.0

- Rebuilt the popup visual system with native CSS liquid-glass surfaces, layered translucency, restrained highlights and a graphite/ice-blue palette.
- Added macOS-first system typography, standard and prefixed backdrop-filter declarations, a no-blur fallback and retained reduced-motion support.
- Refined tabs, capture modes, buttons, settings, progress, logs and About styling while keeping the 420 × 560 non-scrolling layout.
- Kept Pause/Resume, capture modes, settings, evidence collectors, permissions and generated archive behavior unchanged from 2.1.7.

## 2.1.7

- Added safe Pause/Resume checkpoints that preserve the active archive and extend a finite Max deadline by the paused duration.
- Replaced the fixed Max runtime with 10, 20, 30 and 60-minute choices plus Unlimited.
- Moved the existing Max-pages control beside Max runtime and removed the Capture controls heading, supporting copy and Lean/Balanced/Complete presets.
- Compacted popup spacing and typography so Capture, Settings, Logs and About fit the standard extension window without vertical scrolling.
- Removed the old three-item About strip and added a linked repository-star footer.
- Kept capture evidence, collector limits, mode definitions and all other settings unchanged from 2.1.6.

## 2.1.6

- Replaced the unbounded-feeling lazy sweep with a 20-second page-side deadline and a 30-second outer safety timeout, while retaining scroll checkpoints and explicit truncation reasons.
- Shortened reload/network-settle waits, increased deep-style concurrency from four to eight, prioritized event-listener inspection for interactive nodes, and reduced deep-stage budgets to 120/60/30 seconds for Fast/Max entry/Max crawl pages.
- Reduced pseudo-state and responsive budgets; later Max pages now use a mobile/desktop responsive strategy while the entry page retains all three viewports.
- Stopped repeating full same-origin application storage contents on every Max page. IndexedDB, Cache, OPFS and WebSQL contents are captured on the entry page; later pages retain metadata and policy records.
- Added document inventories and browser performance timelines at low incremental cost, including JSON-LD, media, custom elements, navigation, paint, long-task, layout-shift, LCP and event-timing evidence.
- Added Lean/Balanced/Complete presets, live elapsed/page progress, clearer mode limits, improved keyboard focus treatment and a refined About panel.
- Changed the Balanced defaults to a 5-second dynamic wait, 35 MB response limit, 3,500 deep nodes and eight Max pages, and reduced the total Max boundary to 20 minutes.

## 2.1.5

- Fixed the next observed Max stall at `Sampling hover, focus and active CSS states`: the old loop could issue 11 sequential CDP commands for each of 100 controls with no stage deadline or intermediate progress.
- Reduced pseudo-state selection to 24 controls, added progress every six controls, 5-second per-command timeouts and mode/page-specific stage budgets with partial-result metadata.
- Added deadlines and manifests to responsive capture, page script checkpoints, final script collection and source-map retrieval.
- Added finite execution boundaries to animation sampling, route/sitemap discovery, page extraction, origin inspection, OPFS and WebSQL collection.
- Added a 30-minute Max crawl boundary so collected evidence is finalized instead of allowing an unusually slow site to run forever.
- Added regression coverage for healthy-but-slow pseudo-state and responsive collectors while retaining the deep-inspection regression tests from 2.1.4.

## 2.1.4

- Fixed the healthy-but-slow Max behavior visible as long pauses at 62%/75%: per-element matched-CSS/listener inspection now has explicit budgets of 90 seconds for the entry page and 45 seconds for each additional page (3 minutes for single-page Fast).
- Preserved all completed inspection chunks and added explicit completion, truncation, stop-reason, budget and elapsed-time fields to the inspection manifest and summary before continuing the capture.
- Tightened the timeout for the three per-element CDP operations from the global 60 seconds to 15 seconds.
- Changed stale-node batch failure from an otherwise-fatal capture error into a partial optional-stage result when Chrome is still attached; genuine debugger detach, tab closure and user cancellation remain fatal.
- Kept the full rendered DOM, computed-style dictionary, DOM snapshot, accessibility, MHTML, visual, network, runtime, responsive and crawl stages unchanged.

## 2.1.3

- Kept the popup layout and styling unchanged apart from the displayed version.
- Fixed a bug where, if the Chrome debugger session lost its connection to the tab for any reason other than the tab closing (for example another tool taking over the same CDP connection, or the page invalidating its own DOM mid-capture), the deep CSS/listener inspection stage didn't notice and instead raced through the rest of the page's elements in milliseconds producing empty records, with no error ever surfacing. It now recognizes a run of fully-failed batches and stops the stage cleanly with a clear message instead.
- Made a debugger detach fatal everywhere in the capture pipeline (not just the one place that already checked for it), so any of the many existing cancellation checkpoints throughout the file now stop the capture immediately instead of continuing to iterate against a dead session.
- Added a timeout to every Chrome DevTools Protocol command as a safety net against a command that never resolves at all, distinct from one that fails fast.
- No changes to redaction/privacy behavior, capture mode semantics, storage/network capture, source-map reconstruction or Wasm decompilation.

## 2.1.2

- Kept the popup layout and styling unchanged apart from the displayed version.
- Fixed a Fast/Max-mode performance regression where the deep per-node CSS/listener inspection ran twice on the entry page (pre-reload and post-reload) instead of once on the settled state, roughly doubling that stage's cost for no evidentiary benefit.
- Wired up the previously-unused write-queue backpressure inside the deep DOM inspection loop so the CDP capture loop can no longer race arbitrarily far ahead of the serialized offscreen ZIP-staging queue; this was the primary cause of captures that got progressively slower on high-node-count pages instead of holding a steady per-batch pace.
- Added a dedicated, tighter backpressure threshold for this stage specifically, since matched-style payloads are larger than the general-purpose default accounts for.
- No changes to redaction/privacy behavior, capture mode semantics, storage/network capture, source-map reconstruction or Wasm decompilation.

## 2.1.1

- Kept the popup layout and styling unchanged apart from the displayed version.
- Fixed the likely Max-mode crash path by staging completed network bodies immediately instead of retaining them in service-worker memory until packaging.
- Limited simultaneous response/POST body reads to four and added queue backpressure, including OPFS ZIP-writer backpressure for incompressible media and binaries.
- Added extension-origin OPFS staging for the growing ZIP, with cleanup on download completion, cancellation and failure plus an in-memory compatibility fallback.
- Streamed large element JSONL and flushed/released heavyweight DOM, computed-style and canvas stages earlier.
- Optimized element-path and full computed-style interning while preserving every collected computed property.
- Hardened inline-script secret redaction, fixed completeness accounting for staged bodies/visual manifests, added extractor timing diagnostics and activated the existing open-Logs-on-error setting.
- Added adversarial regression coverage for target-tab closure, popup restoration/cancellation, a 12,033-element document, 5,000 IndexedDB records, OPFS/Cache Storage, 25,000 secret headers, 50,000 events, source maps, Wasm, framework state and incremental ZIP cancellation.

## 2.1.0

- Kept the existing popup UI unchanged apart from its displayed version.
- Added cookie flag metadata, secret-header fingerprints, CSRF fingerprints, password-field metadata, aggregate keyboard/pointer telemetry and coarse hardware/WebGL profiles without reusable credential values or typed content.
- Added bounded early capture for SSE, WebRTC data channels, WebGL and WebGPU calls, shaders and eligible buffers.
- Added bounded OPFS content and legacy WebSQL extraction with explicit per-item omission manifests.
- Added embedded source-map reconstruction, JavaScript beautification, limited AST summaries and `.wasm` to `.wat` conversion while always retaining eligible raw artifacts.
- Expanded Redux, Zustand, MobX and Svelte adapters plus scroll and animation state sampling.
- Added fixed-memory event queues, delta instrumentation snapshots, sequential heavy collectors and explicit retained/dropped counters to reduce crash risk.

## 2.0.7

- Fixed the dormant lazy-load sweep and now run it before every primary deep-page snapshot, including same-origin crawl pages.
- Added bounded network-quiet waiting and a per-page `lazy_load_sweep.json` record showing scroll coverage, truncation and outstanding requests.
- Replaced the misleading viewport fallback for oversized pages with complete measured-page PNG tiling plus `visual_manifest.json` coverage proof.
- Added a per-state evidence audit to `capture_completeness.json`, including an aggregate browser-exposed core-completeness result.
- Upgraded the post-interaction artifact from a reduced screenshot/DOM sample to rendered DOM, all computed CSS properties, MHTML, accessibility, CDP layout and full visual coverage.
- Reduced computed-style memory duplication with collision-safe fingerprint interning and changed Cache Storage body extraction from unbounded parallel reads to sequential, byte-bounded streaming.
- Removed the dormant ETA request, calculation, persistence and message fields instead of merely hiding their text in the popup.

## 2.0.6

- Replaced the 200-line activity limit with complete task-aware retention for the two newest capture runs.
- Added capture IDs and task metadata to logs, grouped the Logs view by task, and changed its badge to show retained tasks.
- Added unlimited local extension storage so large two-task histories do not hit Chrome's normal storage quota.
- Reworked deep DOM/CSS inspection into 40-node JSONL batches with four concurrent debugger operations instead of retaining one enormous 5,000-node object graph.
- Released resolved remote objects in `finally` blocks, including when listener inspection fails.
- Replaced whole-archive synchronous ZIP creation with incremental streaming compression and explicit cleanup after cancellation or failure.

## 2.0.5

- Moved the live completion percentage directly below the progress bar.
- Styled the percentage as a high-contrast, fixed-width readout so progress remains immediately visible throughout a capture.
- Removed the live ETA/calibration line from the progress panel so only measured completion is presented.

## 2.0.4

- Removed the simulated inset popup shell and its fake rounded outer corners.
- Bounded the popup's root grid and every active-capture row so showing Cancel cannot widen the interface.
- Fixed target, mode, action, progress and guidance sections overflowing or being clipped during a running capture.
- Kept button copy compact with safe truncation at narrow widths while preserving the full capture workflow.

## 2.0.3

- Removed the idle “selected tab locks” strip; the target strip now appears only during an active capture.
- Moved the tab/window and page-interaction guidance to the bottom of the Capture tab and removed it from Settings.
- Rebuilt the popup around an inset 26 px rounded application shell so the outer corners are visibly distinct.
- Replaced the blue-only theme with a deeper neutral, indigo, aqua and mint palette.
- Increased particle count, brightness and motion, added particle connections, a cursor glow and strong cursor repulsion.
- Correctly centered Cancel/Cancelling and Copy logs text, including stable alignment beside the cancel icon.
- Refined tab, card, toggle, log-empty-state and button styling for a more cohesive interface.

## 2.0.2

- Added an explicit target-tab removal handler that immediately marks the run stopped and requests debugger detachment.
- Added target-closed handling to debugger detach events and made the dynamic wait cancellation-aware in 250 ms intervals.
- Replaced the popup message with “Safe to switch tabs or windows.”
- Added a warning not to interact with the captured page because user actions can alter DOM, network and visual evidence.
- Added a dedicated stopped state in the popup when the target tab is closed.

## 2.0.1

- Rebuilt the popup at 420×560 so it remains inside Chrome's popup viewport at common Windows display-scaling levels.
- Enlarged the header and About logos and increased spacing between controls.
- Removed all pre-capture estimating requests, ranges and measuring text; Max now simply warns that it may take a long time.
- Removed the local-status strip, About capability tiles, footer labels, Logs heading/subtitle and LIVE badge.
- Tightened truncation and responsive sizing so target titles, mode cards and active-capture controls do not overflow sideways.

## 2.0.0

- Renamed the extension to **Let Me See Code** and added the supplied logo, Chrome icons, an About tab, Aditya Mittal credit and GitHub profile.
- Rebuilt the popup with a softer dark-blue palette, rounded surfaces, interactive particles, hidden scrollbars, Capture/Settings/Logs/About tabs, and Quick/Fast/Max public mode names.
- Locked each capture to the tab selected at start so switching tabs or windows cannot retarget it.
- Persisted capture state outside the popup, allowing capture to continue while the popup is closed and restoring live progress when reopened.
- Made progress monotonic and added cancellation, stale-running-state recovery and persistent activity logs.
- Added response-time interception for high-value network bodies, with end-of-request retrieval as fallback.
- Added conservative automatic UI-state exploration and post-interaction DOM/screenshot evidence.
- Added sitemap, sitemap-index, WordPress, router-attribute, framework-manifest and inline route discovery.
- Added best-effort source-map download and dedicated WebAssembly bytecode artifacts.
- Added exact response-body deduplication, an evidence file index and a route graph.
- Retained 50 MB response and 10-second dynamic-wait defaults, credential redaction and active-tab-only access.

## 1.4.0

- Changed Entire Site from a deep-entry/shallow-page crawl to the complete Max pipeline on every captured HTML page.
- Added per-page runtime checkpoints so scripts, JavaScript/CSS coverage, execution contexts, and performance are preserved before navigation invalidates Chrome runtime identifiers.
- Added content-type validation, common non-HTML extension filtering, and canonical/redirect destination deduplication so images and duplicate destinations do not consume page slots.
- Deduplicated identical script source files while retaining per-page manifests and provenance.
- Rebuilt the Entire Site estimator around full-Max per-page cost, archive overhead, and an upward compatibility correction for timings recorded by older shallow crawls.
- Rebuilt the live Entire Site ETA from completed page timings, remaining eligible links, and accumulated response/script bytes.
- Added skipped-target reasons and per-page capture durations to the crawl manifest.

## 1.3.0

- Added Quick, Max, and Entire Site capture modes.
- Added per-mode adaptive time ranges, confidence labels, local per-origin calibration, and a live recalibrating ETA.
- Added a bounded same-origin crawler with page, link-depth, and query-string controls; the starting URL is restored afterward.
- Added Max mutation timelines, forced pseudo-state computed-style diffs, OPFS metadata, font/CSS/runtime inventories, storage quota, installability, isolation, and DOM-counter evidence.
- Added `capture_completeness.json` with page, network-body, script, target, advanced-evidence, warning, and known-gap coverage.
- Added per-page association to captured network events during an Entire Site crawl.
- Preserved active-tab-only access and recognized credential/secret redaction.

## 1.2.0

- Increased the default maximum response body from 10 MB to 50 MB.
- Increased the default dynamic-content wait from 3 seconds to 10 seconds.
- Removed `AI_HANDOFF.md` from generated capture archives.
- Redesigned the popup around Capture, Settings, and Logs views.
- Added persistent local activity logs with copy, clear, timestamps, retention, and automatic failure-display settings.
- Replaced the old footer warning with a concise local-processing and redaction status line.

## 1.1.0

- Added Forensic Max mode with explicit privacy boundary.
- Added redacted POST-body capture and deep application-data capture.
- Added IndexedDB records and Cache Storage response bodies with size limits.
- Added native DOMDebugger event-listener extraction and matched CSS rule provenance.
- Added framework-state detection for React, Vue, Angular, Next, Nuxt, Apollo, and Pinia.
- Added loaded JavaScript sources, JS precise coverage, CSS rule-usage coverage, performance metrics, and execution contexts.
- Added automatic lazy-load scrolling and configurable deep-node inspection.
- Added mobile, tablet, and desktop emulation captures with per-viewport layout and DOM snapshots.
- Added browser-exposed iframe and worker target discovery, network capture, DOM/accessibility snapshots, and script sources.
- Kept passwords, cookies, authorization headers, tokens, and obvious secrets redacted.

## 1.0.0

- Initial release.
- One-click pre-reload and post-reload page capture.
- Rendered HTML, complete computed CSS, geometry, state, open shadow DOM, canvas, and design-token export.
- CDP accessibility, DOM snapshot, layout, MHTML, and screenshot capture.
- Network response bodies, HAR-shaped metadata, WebSocket events, and diagnostics.
- Local reconstruction ZIP packaging with mandatory authentication redaction.
