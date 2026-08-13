const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const captureData = {
  haoqi: {
    name: 'HAOQI©2026',
    url: 'https://haoqi.design/',
    description: 'A complete eight-route crawl with browser-exposed core evidence present for every primary page state.',
    completeness: 'Complete',
    completenessWidth: 100,
    metrics: [
      ['Evidence files', '1,088'],
      ['Captured pages', '8 / 8'],
      ['Network requests', '310'],
      ['Response data', '80.9 MB'],
      ['Scripts observed', '498'],
      ['Wasm → WAT', '8 modules']
    ],
    frames: [
      { src: 'assets/captures/haoqi-home.png', label: 'Home', badge: 'Current viewport', alt: 'Captured viewport of HAOQI Design' },
      { src: 'assets/captures/haoqi-reunimos.png', label: 'Route 02', badge: 'Reunimos route', alt: 'Captured viewport of the Reunimos route' },
      { src: 'assets/captures/haoqi-inspire.png', label: 'Route 03', badge: 'Inspire Mono route', alt: 'Captured viewport of the Inspire Mono route' }
    ]
  },
  hack: {
    name: 'Hack the North',
    url: 'https://hackthenorth.com/',
    description: 'A difficult motion-heavy page with tiled visuals, 76 observed animations, runtime checkpoints and 1,924 preserved response bodies.',
    completeness: 'Bounded partial',
    completenessWidth: 78,
    metrics: [
      ['Evidence files', '2,621'],
      ['Captured pages', '1 deep'],
      ['Network requests', '1,980'],
      ['Response data', '69.2 MB'],
      ['Scripts observed', '380'],
      ['Animations', '76 observed']
    ],
    frames: [
      { src: 'assets/captures/hackthenorth-home.png', label: 'Viewport', badge: 'Current viewport', alt: 'Captured viewport of Hack the North' },
      { src: 'assets/captures/hackthenorth-motion-0.png', label: 'Motion 01', badge: 'Animation frame 01', alt: 'Captured animation frame from Hack the North' },
      { src: 'assets/captures/hackthenorth-motion-2.png', label: 'Motion 03', badge: 'Animation frame 03', alt: 'Captured later animation frame from Hack the North' }
    ]
  }
};

const evidenceData = {
  document: {
    path: 'site/pages/000_home/reloaded/main_frame/',
    kicker: 'RENDERED DOCUMENT',
    title: 'The page after the browser finished.',
    description: 'Element attributes, geometry, computed-style references, accessible structure, open shadow roots and readable stylesheet rules.',
    tree: [
      ['folder', 0, 'main_frame'], ['folder', 1, 'styles'], ['file', 2, 'stylesheets.json'], ['file selected', 2, 'elements_computed.json'],
      ['file', 2, 'css_intelligence.json'], ['file', 1, 'rendered_dom.html'], ['file', 1, 'accessibility_tree.json'], ['file', 1, 'dom_snapshot.json']
    ],
    preview: {
      elementCount: 3920,
      attributes: 'complete',
      computedStyleDictionary: true,
      readableStylesheets: true,
      openShadowRoots: true,
      accessibilityTree: 'captured'
    }
  },
  visual: {
    path: 'site/pages/000_home/reloaded/visual_tiles/',
    kicker: 'LOSSLESS VISUAL EVIDENCE',
    title: 'The viewport, the page, and states between.',
    description: 'Viewport images, full-page captures or lossless tiles, responsive states, layout data and manifests that explain how every image was measured.',
    tree: [
      ['folder', 0, 'visual_tiles'], ['file selected', 1, 'tile_r000_c000.png'], ['file', 1, 'tile_r001_c000.png'], ['file', 1, 'tile_r002_c000.png'],
      ['file', 1, 'manifest.json'], ['file', 0, 'visual_viewport.png'], ['file', 0, 'visual_manifest.json'], ['file', 0, 'layout_metrics.json']
    ],
    preview: {
      mode: 'lossless PNG tiles',
      viewport: '1920 × 900',
      documentCoverage: 'measured',
      responsiveProfiles: ['390×844', '768×1024', '1440×900'],
      pixelDataReencoded: false
    }
  },
  motion: {
    path: 'site/pages/000_home/reloaded/forensics/animation_evidence/',
    kicker: 'TEMPORAL EVIDENCE',
    title: 'Motion recorded as states, not guesses.',
    description: 'Animation definitions, timing, playback state, idle-change frames, scroll-linked scenes, media configuration and bounded Web Audio graph evidence.',
    tree: [
      ['folder', 0, 'animation_evidence'], ['file selected', 1, 'manifest.json'], ['file', 1, 'frame_0.json'], ['file', 1, 'visual_frame_00.png'],
      ['file', 1, 'visual_frame_01.png'], ['file', 1, 'visual_frame_02.png'], ['file', 1, 'idle_frame_00.png'], ['file', 0, 'audio_evidence.json']
    ],
    preview: {
      animationsObserved: 76,
      fullySampled: 8,
      idleVisualChanged: true,
      motionFrames: 3,
      publicAudioBodies: 22,
      microphoneCaptured: false
    }
  },
  network: {
    path: 'network/',
    kicker: 'REQUEST & ASSET GRAPH',
    title: 'Every public response tells part of the story.',
    description: 'Request metadata, headers with secret values redacted, captured public response bodies, body maps, initiators, resource timing and deduplication records.',
    tree: [
      ['folder', 0, 'network'], ['folder', 1, 'bodies'], ['file selected', 2, '001505_fuel-particles.webp'], ['file', 2, '001539_fuel-particles.webp'],
      ['file', 1, 'requests.json'], ['file', 1, 'body_manifest.json'], ['file', 0, 'deduplication_manifest.json'], ['file', 0, 'security_metadata.json']
    ],
    preview: {
      observedRequests: 1980,
      capturedBodies: 1924,
      totalBodyBytes: 69218790,
      secretHeaderFingerprints: 66,
      authorizationValuesRetained: false,
      duplicateBodiesReused: true
    }
  },
  runtime: {
    path: 'forensics/',
    kicker: 'RUNTIME & ORIGIN STATE',
    title: 'The clues that static HTML cannot show.',
    description: 'Script sources, beautified code, AST summaries, source maps, framework markers, service workers, Cache Storage, IndexedDB schemas and origin-wide metadata.',
    tree: [
      ['folder', 0, 'forensics'], ['folder', 1, 'scripts'], ['file selected', 2, 'manifest.json'], ['folder', 1, 'beautified'],
      ['folder', 1, 'ast'], ['folder', 1, 'source_maps'], ['folder', 1, 'storage'], ['file', 1, 'framework_bootstrap.json']
    ],
    preview: {
      scriptsObserved: 380,
      uniqueScriptSources: 223,
      beautifiedScripts: 120,
      astSummaries: 120,
      capturedSourceMaps: 2,
      storageValuesPolicy: 'schema-first + redaction'
    }
  },
  routes: {
    path: 'site/crawl_manifest.json',
    kicker: 'CRAWL & COMPLETENESS AUDIT',
    title: 'Know what completed—and what did not.',
    description: 'Same-origin routes, safety decisions, per-page capture duration, configured limits, optional capability support and exact completeness boundaries.',
    tree: [
      ['folder', 0, 'site'], ['folder', 1, 'pages'], ['folder', 2, '000_home'], ['folder', 2, '001_reunimos'],
      ['file selected', 1, 'crawl_manifest.json'], ['file', 0, 'capture_manifest.json'], ['file', 0, 'capture_completeness.json'], ['file', 0, 'WARNINGS.json']
    ],
    preview: {
      sameOriginOnly: true,
      unsafeActionRoutesSkipped: true,
      configuredPageLimit: 8,
      configuredDepth: 2,
      completedPagesExported: 8,
      partialPagesExported: 0
    }
  }
};

const modeData = {
  quick: {
    glyph: 'Q', kicker: 'QUICK · LIGHT', title: 'The rendered state, instantly.',
    description: 'Captures the current visual, DOM, attributes, computed styles, accessibility, metadata, forms and responsive resource choices without reloading.',
    tags: ['Current DOM', 'Computed styles', 'Visual', 'Metadata'], facts: [['Scope', '1 page'], ['Reload', 'Never'], ['Best for', 'Fast reference']]
  },
  fast: {
    glyph: 'F', kicker: 'FAST · DEEP', title: 'One page, deeply understood.',
    description: 'Preserves the live state, reloads once for network evidence, then collects runtime, storage, motion and reconstruction intelligence within bounded stages.',
    tags: ['DOM + styles', 'Network bodies', 'Runtime', 'Motion'], facts: [['Scope', '1 page'], ['Reload', 'Once'], ['Best for', 'Deep analysis']]
  },
  max: {
    glyph: 'M', kicker: 'MAX · SITE', title: 'Follow the site, keep every layer.',
    description: 'Runs the full-depth pipeline across safe same-origin routes, deduplicates origin-wide evidence and finishes only complete pages within your selected limits.',
    tags: ['Same-origin crawl', 'Full evidence', 'Completeness audit', 'Deduplication'], facts: [['Scope', 'Many pages'], ['Reload', 'Per route'], ['Best for', 'Reconstruction']]
  }
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]);
}

function syntaxJson(value) {
  return escapeHtml(JSON.stringify(value, null, 2)).replace(/(&quot;.*?&quot;)(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?/g, (match, string, colon, bool) => {
    if (string) return `<span class="${colon ? 'code-key' : 'code-string'}">${string}</span>${colon || ''}`;
    if (bool) return `<span class="code-bool">${match}</span>`;
    return `<span class="code-number">${match}</span>`;
  });
}

let selectedCapture = 'haoqi';
let selectedFrame = 0;

function renderCapture(key, frameIndex = 0) {
  selectedCapture = key;
  selectedFrame = frameIndex;
  const capture = captureData[key];
  const frame = capture.frames[frameIndex];
  $$('.capture-tab').forEach((button) => {
    const active = button.dataset.capture === key;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  const visual = $('.visual-window');
  visual.classList.add('changing');
  window.setTimeout(() => {
    $('#captureImage').src = frame.src;
    $('#captureImage').alt = frame.alt;
    $('#captureUrl').textContent = capture.url;
    $('#visualLabel').textContent = frame.badge;
    $('#visualIndex').textContent = `${String(frameIndex + 1).padStart(2, '0')} / 03`;
    visual.classList.remove('changing');
  }, 160);
  $('#captureName').textContent = capture.name;
  $('#captureDescription').textContent = capture.description;
  $('#captureMetrics').innerHTML = capture.metrics.map(([term, value]) => `<div><dt>${term}</dt><dd>${value}</dd></div>`).join('');
  $('#completenessValue').textContent = capture.completeness;
  $('#completenessBar').style.width = `${capture.completenessWidth}%`;
  $('#frameStrip').innerHTML = capture.frames.map((item, index) => `<button class="frame-button ${index === frameIndex ? 'active' : ''}" type="button" data-frame="${index}"><img src="${item.src}" alt=""><span>${item.label}</span></button>`).join('');
  $$('.frame-button').forEach((button) => button.addEventListener('click', () => renderCapture(selectedCapture, Number(button.dataset.frame))));
  updateExpandedVisual();
}

$$('.capture-tab').forEach((button) => button.addEventListener('click', () => renderCapture(button.dataset.capture, 0)));

function setVisualFit(mode) {
  const fill = mode === 'fill';
  $('.visual-window').classList.toggle('fill', fill);
  $('#fitVisual').classList.toggle('active', !fill);
  $('#fillVisual').classList.toggle('active', fill);
  $('#fitVisual').setAttribute('aria-pressed', String(!fill));
  $('#fillVisual').setAttribute('aria-pressed', String(fill));
}

function updateExpandedVisual() {
  const capture = captureData[selectedCapture];
  const frame = capture.frames[selectedFrame];
  if (!capture || !frame) return;
  $('#dialogTitle').textContent = `${capture.name} · ${frame.badge}`;
  $('#dialogImage').src = frame.src;
  $('#dialogImage').alt = frame.alt;
  $('#dialogCounter').textContent = `${String(selectedFrame + 1).padStart(2, '0')} / ${String(capture.frames.length).padStart(2, '0')}`;
}

$('#fitVisual').addEventListener('click', () => setVisualFit('fit'));
$('#fillVisual').addEventListener('click', () => setVisualFit('fill'));
$('#expandVisual').addEventListener('click', () => {
  updateExpandedVisual();
  $('#visualDialog').showModal();
});
$('#captureImage').addEventListener('dblclick', () => {
  updateExpandedVisual();
  $('#visualDialog').showModal();
});
$('#closeVisual').addEventListener('click', () => $('#visualDialog').close());
$('#previousVisual').addEventListener('click', () => {
  const total = captureData[selectedCapture].frames.length;
  renderCapture(selectedCapture, (selectedFrame - 1 + total) % total);
});
$('#nextVisual').addEventListener('click', () => {
  const total = captureData[selectedCapture].frames.length;
  renderCapture(selectedCapture, (selectedFrame + 1) % total);
});
$('#visualDialog').addEventListener('click', (event) => {
  if (event.target === $('#visualDialog')) $('#visualDialog').close();
});

$('#resetPopup').addEventListener('click', () => {
  const iframe = $('#popupDemo');
  iframe.src = 'popup-demo.html';
});

function renderEvidence(key) {
  const item = evidenceData[key];
  $$('.evidence-button').forEach((button) => {
    const active = button.dataset.evidence === key;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $('#evidencePath').textContent = item.path;
  $('#previewKicker').textContent = item.kicker;
  $('#previewTitle').textContent = item.title;
  $('#previewDescription').textContent = item.description;
  $('#fileTree').innerHTML = item.tree.map(([type, depth, label]) => `<div class="tree-item ${type} depth-${depth}"><i></i><span>${label}</span></div>`).join('');
  $('#dataPreview').innerHTML = syntaxJson(item.preview);
}

$$('.evidence-button').forEach((button) => button.addEventListener('click', () => renderEvidence(button.dataset.evidence)));

function renderMode(key) {
  const item = modeData[key];
  $$('.site-mode').forEach((button) => {
    const active = button.dataset.mode === key;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $('#modeGlyph').textContent = item.glyph;
  $('#modeKicker').textContent = item.kicker;
  $('#modeTitle').textContent = item.title;
  $('#modeDescription').textContent = item.description;
  $('#modeTags').innerHTML = item.tags.map((tag) => `<span>${tag}</span>`).join('');
  $('#modeFacts').innerHTML = item.facts.map(([term, value]) => `<div><dt>${term}</dt><dd>${value}</dd></div>`).join('');
}

$$('.site-mode').forEach((button) => button.addEventListener('click', () => renderMode(button.dataset.mode)));

function sizePopup() {
  const viewport = $('#popupViewport');
  if (!viewport) return;
  const scale = Math.min(1, viewport.clientWidth / 420);
  viewport.style.setProperty('--popup-scale', scale.toFixed(4));
  viewport.style.height = `${560 * scale}px`;
}

const popupObserver = new ResizeObserver(sizePopup);
popupObserver.observe($('#popupViewport'));
window.addEventListener('resize', sizePopup, { passive: true });

function updateScroll() {
  const maximum = document.documentElement.scrollHeight - innerHeight;
  const value = maximum > 0 ? scrollY / maximum : 0;
  $('#scrollProgress').style.width = `${Math.max(0, Math.min(1, value)) * 100}%`;
}
window.addEventListener('scroll', updateScroll, { passive: true });

const sectionLinks = $$('[data-section-link]');
const sectionObserver = new IntersectionObserver((entries) => {
  const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (!visible) return;
  sectionLinks.forEach((link) => link.classList.toggle('active', link.dataset.sectionLink === visible.target.id));
}, { rootMargin: '-20% 0px -58% 0px', threshold: [0, .15, .35, .6] });
['proof', 'evidence', 'modes', 'privacy'].forEach((id) => sectionObserver.observe(document.getElementById(id)));

const lightProbe = $('#lightProbe');
window.addEventListener('pointermove', (event) => {
  if (matchMedia('(pointer: coarse)').matches) return;
  lightProbe.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
}, { passive: true });
document.documentElement.addEventListener('mouseleave', () => { lightProbe.style.opacity = '.08'; });
document.documentElement.addEventListener('mouseenter', () => { lightProbe.style.opacity = '.32'; });

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: .12 });
$$('.reveal').forEach((element) => revealObserver.observe(element));

$$('.glass').forEach((element) => {
  element.addEventListener('pointermove', (event) => {
    const bounds = element.getBoundingClientRect();
    element.style.setProperty('--glass-x', `${event.clientX - bounds.left}px`);
    element.style.setProperty('--glass-y', `${event.clientY - bounds.top}px`);
  });
});

$$('[data-tilt]').forEach((element) => {
  element.addEventListener('pointermove', (event) => {
    if (matchMedia('(pointer: coarse)').matches) return;
    const bounds = element.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - .5;
    const y = (event.clientY - bounds.top) / bounds.height - .5;
    element.style.transform = `rotateX(${(-y * 2.1).toFixed(2)}deg) rotateY(${(x * 2.8).toFixed(2)}deg)`;
  });
  element.addEventListener('pointerleave', () => { element.style.transform = ''; });
});

window.addEventListener('message', (event) => {
  if (event.source !== $('#popupDemo')?.contentWindow || event.data?.source !== 'let-me-see-code-demo') return;
  const card = $('.popup-card');
  card.dataset.captureState = event.data.state || '';
  if (event.data.mode && captureData[event.data.mode]) renderCapture(event.data.mode, 0);
});

renderCapture('haoqi', 0);
renderEvidence('document');
renderMode('fast');
sizePopup();
updateScroll();
