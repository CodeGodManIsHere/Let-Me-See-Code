const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const modes = {
  quick: {
    name: 'Quick', engine: 'quick', tone: 'Current-state snapshot', scope: 'One page · visual + DOM + styles',
    title: 'Capture Quick', sub: 'Current-page evidence', notice: 'Quick preserves the current page exactly as it is now.',
    stages: [[4,'Attaching Chrome capture tools…'],[18,'Reading the rendered DOM, attributes and computed styles…'],[43,'Capturing layout, accessibility and current visual…'],[72,'Collecting metadata, forms, media and responsive sources…'],[92,'Indexing the current-state evidence…'],[100,'Validating and finalizing the local archive…']]
  },
  max: {
    name: 'Fast', engine: 'fast', tone: 'Bounded deep capture', scope: 'One page · runtime + network',
    title: 'Capture Fast', sub: 'Deep single-page evidence', notice: 'The live page is saved before a single network reload.',
    stages: [[2,'Preparing the local archive workspace…'],[7,'Connecting Chrome tools for DOM, runtime and network…'],[15,'Preserving the current live page state…'],[29,'Reloading once for authoritative network evidence…'],[44,'Sweeping scroll surfaces to reveal lazy content and motion…'],[61,'Capturing animation, canvas, video and audio-linked states…'],[76,'Mapping selected CSS rules and native listeners…'],[89,'Collecting runtime, storage, security and framework evidence…'],[96,'Deduplicating assets and indexing completeness…'],[100,'Validating and finalizing the local archive…']]
  },
  entire: {
    name: 'Max', engine: 'max', tone: 'Full-depth site capture', scope: 'Same-origin pages · safe crawl',
    title: 'Capture Max', sub: 'Deep multi-page evidence', notice: 'Max follows eligible same-origin pages within the selected limits.',
    stages: [[2,'Preparing the local archive workspace…',1],[6,'Connecting Chrome tools and locking the selected tab…',1],[14,'Preserving entry-page DOM, styles, layout and visuals…',1],[27,'Recording lazy content, scroll surfaces and motion…',1],[40,'Collecting runtime, network, storage and security evidence…',1],[54,'Crawling page 2/3: /features',2],[65,'Capturing page 2 animation and responsive states…',2],[76,'Crawling page 3/3: /about',3],[86,'Capturing page 3 complete evidence…',3],[94,'Deduplicating site-wide assets and indexing the crawl…',3],[100,'Validating every file and finalizing the local archive…',3]]
  }
};

let selectedMode = 'max';
let runState = 'idle';
let stageIndex = 0;
let elapsed = 0;
let timer = null;
let activity = [];

function sendParent(state) {
  window.parent.postMessage({ source: 'let-me-see-code-demo', state, mode: modes[selectedMode].engine }, '*');
}

function switchTab(name) {
  $$('.tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === name));
  $$('.tab-panel').forEach((panel) => {
    const active = panel.id === `${name}Panel`;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
}

$$('.tab').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tab)));

function updateMode(mode) {
  if (runState === 'running' || runState === 'paused') return;
  selectedMode = mode;
  const profile = modes[mode];
  $$('.mode-card').forEach((card) => {
    const active = card.dataset.mode === mode;
    card.classList.toggle('selected', active);
    const radio = $('input[type="radio"]', card);
    if (radio) radio.checked = active;
  });
  $('#profileTone').textContent = profile.tone;
  $('#profileScope').textContent = profile.scope;
  $('#captureButtonTitle').textContent = profile.title;
  $('#captureButtonSub').textContent = profile.sub;
  $('#reloadRow').hidden = mode !== 'max';
  $('#reloadNotice').textContent = profile.notice;
  $('#result').hidden = true;
  sendParent('mode-changed');
}

$$('.mode-card').forEach((card) => card.addEventListener('click', () => updateMode(card.dataset.mode)));

function updateMaxHints() {
  const runtime = $('#maxRuntimeMinutes').value;
  const pages = Math.max(2, Math.min(50, Number($('#maxPages').value) || 8));
  $('#maxPages').value = pages;
  $('#maxRuntimeHint').textContent = runtime === '0' ? 'Unlimited' : `${runtime}m cap`;
  $('#maxPageHint').textContent = `${pages} pages`;
}

$('#maxRuntimeMinutes').addEventListener('change', updateMaxHints);
$('#maxPages').addEventListener('input', updateMaxHints);
$('#maxPages').addEventListener('change', updateMaxHints);

function timeNow() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function renderLogs() {
  const list = $('#logList');
  if (!activity.length) {
    list.innerHTML = '<div class="empty-log">No capture activity yet.</div>';
  } else {
    list.innerHTML = activity.map((entry) => `<div class="log-entry ${entry.type}"><span class="log-time">${entry.time}</span><span class="log-message">${entry.text}</span><b class="log-percent">${entry.progress}%</b></div>`).join('');
    list.scrollTop = list.scrollHeight;
  }
  $('#logCount').textContent = String(activity.length);
}

function addLog(progress, text, type = '') {
  activity.push({ time: timeNow(), progress, text, type });
  renderLogs();
}

function setRunningUi(running) {
  $('.action-row').classList.toggle('is-running', running);
  $('#captureButton').hidden = running;
  $('#pauseButton').hidden = !running;
  $('#cancelButton').hidden = !running;
  $$('.mode-card input').forEach((input) => { input.disabled = running; });
}

function showStage() {
  const profile = modes[selectedMode];
  const [progress, text, page = 1] = profile.stages[stageIndex];
  $('#statusText').textContent = text;
  $('#progressBar').style.width = `${progress}%`;
  $('#progressValue').textContent = `${progress}%`;
  $('#elapsedValue').textContent = `${elapsed}s elapsed`;
  $('#pageValue').hidden = selectedMode !== 'entire';
  $('#pageValue').textContent = selectedMode === 'entire' ? `page ${page}/3` : '';
  addLog(progress, text);
  if (progress >= 100) finishCapture();
}

function startCapture() {
  if (runState === 'running' || runState === 'paused') return;
  runState = 'running';
  stageIndex = 0;
  elapsed = 0;
  activity = [];
  renderLogs();
  $('#targetStrip').hidden = false;
  $('#targetStatus').textContent = `Demo target · ${selectedMode === 'entire' ? 'haoqi.design' : 'example.com'}`;
  $('#result').hidden = true;
  $('#progressShell').hidden = false;
  $('#pauseButton').innerHTML = '<b aria-hidden="true">Ⅱ</b><span>Pause</span>';
  setRunningUi(true);
  showStage();
  sendParent('running');
  timer = window.setInterval(() => {
    if (runState !== 'running') return;
    elapsed += 1;
    stageIndex += 1;
    $('#elapsedValue').textContent = `${elapsed}s elapsed`;
    if (stageIndex < modes[selectedMode].stages.length) showStage();
  }, 850);
}

function finishCapture() {
  window.clearInterval(timer);
  timer = null;
  runState = 'complete';
  setRunningUi(false);
  const profile = modes[selectedMode];
  const pages = selectedMode === 'entire' ? 3 : 1;
  const domain = selectedMode === 'entire' ? 'haoqi.design' : 'example.com';
  const file = `let-me-see-code-${domain}-${profile.engine}.zip`;
  $('#result').innerHTML = `<b>${file}</b><span>is ready · ${elapsed}s</span><span>${pages} page${pages === 1 ? '' : 's'} · simulated archive</span>`;
  $('#result').hidden = false;
  sendParent('complete');
}

function togglePause() {
  const progress = Number($('#progressValue').textContent.replace('%', '')) || 0;
  if (runState === 'running') {
    runState = 'paused';
    $('#pauseButton').innerHTML = '<b aria-hidden="true">▶</b><span>Resume</span>';
    addLog(progress, 'Pause requested; stopped at a safe evidence checkpoint…');
    sendParent('paused');
  } else if (runState === 'paused') {
    runState = 'running';
    $('#pauseButton').innerHTML = '<b aria-hidden="true">Ⅱ</b><span>Pause</span>';
    addLog(progress, 'Capture resumed from the protected checkpoint…');
    sendParent('running');
  }
}

function cancelCapture() {
  if (runState !== 'running' && runState !== 'paused') return;
  window.clearInterval(timer);
  timer = null;
  runState = 'cancelled';
  const progress = Number($('#progressValue').textContent.replace('%', '')) || 0;
  addLog(progress, 'Capture cancelled; unfinished archive data discarded safely…', 'error');
  setRunningUi(false);
  $('#progressShell').hidden = true;
  $('#result').innerHTML = '<b>Capture cancelled</b><span>No partial archive was created</span><span>Ready to run again</span>';
  $('#result').hidden = false;
  sendParent('cancelled');
}

$('#captureButton').addEventListener('click', startCapture);
$('#pauseButton').addEventListener('click', togglePause);
$('#cancelButton').addEventListener('click', cancelCapture);
$('#clearLogs').addEventListener('click', () => { activity = []; renderLogs(); });
$('#copyLogs').addEventListener('click', async () => {
  const value = activity.map((entry) => `${entry.time}\t${entry.progress}%\t${entry.text}`).join('\n');
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    $('#copyLogs').textContent = 'Copied';
  } catch {
    $('#copyLogs').textContent = 'Copy unavailable';
  }
  window.setTimeout(() => { $('#copyLogs').textContent = 'Copy logs'; }, 1200);
});

// The installed popup has a tactile grab-and-spring response. The demo preserves it.
$$('.tab, .inline-toggle, .toggle-tile').forEach((control) => {
  let origin = null;
  control.addEventListener('pointerdown', (event) => {
    origin = { x: event.clientX, y: event.clientY };
    control.setPointerCapture?.(event.pointerId);
  });
  control.addEventListener('pointermove', (event) => {
    if (!origin) return;
    const x = Math.max(-5, Math.min(5, (event.clientX - origin.x) * .12));
    const y = Math.max(-3, Math.min(3, (event.clientY - origin.y) * .1));
    control.style.transform = `translate(${x}px, ${y}px)`;
  });
  const release = () => {
    origin = null;
    control.style.transition = 'transform .38s cubic-bezier(.2,.85,.2,1.2)';
    control.style.transform = '';
    window.setTimeout(() => { control.style.transition = ''; }, 400);
  };
  control.addEventListener('pointerup', release);
  control.addEventListener('pointercancel', release);
});

const particleCanvas = $('#particleCanvas');
const particleContext = particleCanvas.getContext('2d');
let particles = [];
let trailUntil = 0;
let lastPointer = { x: 65, y: 45 };

function resizeParticles() {
  const ratio = Math.min(2, devicePixelRatio || 1);
  particleCanvas.width = 420 * ratio;
  particleCanvas.height = 560 * ratio;
  particleContext.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function spawnParticle(x, y, burst = false) {
  particles.push({
    x: x + (Math.random() - .5) * (burst ? 34 : 9),
    y: y + (Math.random() - .5) * (burst ? 26 : 9),
    vx: (Math.random() - .5) * (burst ? 1.8 : .45),
    vy: (Math.random() - .5) * (burst ? 1.6 : .45) - .15,
    life: 1,
    size: Math.random() * 2.2 + 1,
    color: Math.random() > .42 ? '85,185,232' : '101,214,186'
  });
}

function activateTrail(event) {
  lastPointer = { x: event.clientX, y: event.clientY };
  trailUntil = performance.now() + 4500;
  for (let index = 0; index < 30; index += 1) spawnParticle(lastPointer.x, lastPointer.y, true);
}

document.addEventListener('pointermove', (event) => {
  lastPointer = { x: event.clientX, y: event.clientY };
  if (performance.now() < trailUntil) {
    spawnParticle(event.clientX, event.clientY);
    if (Math.random() > .45) spawnParticle(event.clientX, event.clientY);
  }
});

$$('.logo-button').forEach((button) => button.addEventListener('click', activateTrail));

function drawParticles() {
  particleContext.clearRect(0, 0, 420, 560);
  particles = particles.filter((particle) => particle.life > .025);
  particles.forEach((particle) => {
    particle.x += particle.vx;
    particle.y += particle.vy;
    particle.life *= .958;
    particleContext.fillStyle = `rgba(${particle.color},${particle.life})`;
    particleContext.fillRect(Math.round(particle.x), Math.round(particle.y), particle.size, particle.size);
  });
  requestAnimationFrame(drawParticles);
}

resizeParticles();
drawParticles();
updateMaxHints();
updateMode('max');
$('#targetStrip').hidden = false;
$('#targetStatus').textContent = 'Demo target · example.com';
renderLogs();
