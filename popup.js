const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const inputs = {
  reloadForNetwork: $('#reloadForNetwork'),
  settleSeconds: $('#settleSeconds'),
  maxBodyMb: $('#maxBodyMb'),
  maxDeepNodes: $('#maxDeepNodes'),
  maxPages: $('#maxPages'),
  maxRuntimeMinutes: $('#maxRuntimeMinutes'),
  crawlDepth: $('#crawlDepth'),
  includeQueryStrings: $('#includeQueryStrings'),
  activityLogEnabled: $('#activityLogEnabled'),
  activityLogTimestamps: $('#activityLogTimestamps'),
  activityLogAutoOpenErrors: $('#activityLogAutoOpenErrors')
};

const defaults = {
  settingsVersion: '2.2.16',
  captureMode: 'max',
  reloadForNetwork: true,
  settleSeconds: 5,
  maxBodyMb: 35,
  maxDeepNodes: 3500,
  maxPages: 8,
  maxRuntimeMinutes: 20,
  crawlDepth: 2,
  includeQueryStrings: false,
  activityLogEnabled: true,
  activityLogTimestamps: true,
  activityLogAutoOpenErrors: true,
  captureActivityLogs: []
};

const captureButton = $('#captureButton');
const pauseButton = $('#pauseButton');
const cancelButton = $('#cancelButton');
const reloadNotice = $('#reloadNotice');
const progressShell = $('#progressShell');
const statusText = $('#statusText');
const progressValue = $('#progressValue');
const progressBar = $('#progressBar');
const elapsedValue = $('#elapsedValue');
const pageValue = $('#pageValue');
const profileTone = $('#profileTone');
const profileScope = $('#profileScope');
const result = $('#result');
const logList = $('#logList');
const logCount = $('#logCount');
const targetStatus = $('#targetStatus');
const targetStrip = $('#targetStrip');

let statusTimer = null;
let highestProgress = 0;
let captureRunning = false;
let capturePaused = false;
let autoOpenedFailureKey = null;

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function selectedMode() {
  return $('input[name="captureMode"]:checked')?.value || 'max';
}

function formatDuration(value) {
  const seconds = Math.max(0, Math.round(Number(value) || 0));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function compactUrl(raw) {
  try {
    const url = new URL(raw);
    return `${url.hostname}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return raw || 'selected tab';
  }
}

function currentOptions() {
  const mode = selectedMode();
  return {
    mode,
    reloadForNetwork: mode === 'max' && inputs.reloadForNetwork.checked,
    settleSeconds: clamp(inputs.settleSeconds.value, 0, 30, 5),
    maxBodyBytes: clamp(inputs.maxBodyMb.value, 1, 50, 35) * 1024 * 1024,
    maxDeepNodes: clamp(inputs.maxDeepNodes.value, 100, 10000, 3500),
    maxPages: clamp(inputs.maxPages.value, 2, 50, 8),
    maxRuntimeMinutes: [0, 10, 20, 30, 60].includes(Number(inputs.maxRuntimeMinutes.value)) ? Number(inputs.maxRuntimeMinutes.value) : 20,
    crawlDepth: clamp(inputs.crawlDepth.value, 1, 4, 2),
    includeQueryStrings: inputs.includeQueryStrings.checked
  };
}

function switchTab(name) {
  $$('.tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === name));
  $$('.tab-panel').forEach((panel) => {
    const active = panel.id === `${name}Panel`;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  if (name === 'logs') renderLogs();
}

function updateModeUi() {
  const mode = selectedMode();
  const runtimeMinutes = [0, 10, 20, 30, 60].includes(Number(inputs.maxRuntimeMinutes.value)) ? Number(inputs.maxRuntimeMinutes.value) : 20;
  const runtimeLabel = runtimeMinutes === 0 ? 'Unlimited runtime' : `${runtimeMinutes}-minute limit`;
  $$('.mode-card').forEach((card) => card.classList.toggle('selected', card.dataset.mode === mode));
  const reloadDisabled = mode !== 'max';
  $('#reloadRow').classList.toggle('disabled', reloadDisabled);
  inputs.reloadForNetwork.disabled = reloadDisabled || captureRunning;
  const copy = {
    quick: {
      title: 'Capture Quick', subtitle: 'Current-page essentials',
      notice: 'No reload. Captures the page exactly as it looks now.',
      tone: 'Instant current state', scope: 'One page · visual + DOM + styles'
    },
    max: {
      title: 'Capture Fast', subtitle: 'Deep single-page evidence',
      notice: inputs.reloadForNetwork.checked ? 'Saves the live state, then reloads once for complete network evidence.' : 'No reload: deep current-state evidence without earlier network traffic.',
      tone: 'Bounded deep capture', scope: inputs.reloadForNetwork.checked ? 'One page · runtime + network' : 'One page · live runtime only'
    },
    entire: {
      title: 'Capture Max', subtitle: 'Bounded site capture',
      notice: `Captures same-origin HTML pages until the page limit or ${runtimeLabel.toLowerCase()} is reached.`,
      tone: 'Site-wide evidence', scope: `Up to ${clamp(inputs.maxPages.value, 2, 50, 8)} pages or ${runtimeLabel}`
    }
  }[mode];
  $('#captureButtonTitle').textContent = copy.title;
  $('#captureButtonSub').textContent = copy.subtitle;
  reloadNotice.textContent = copy.notice;
  profileTone.textContent = copy.tone;
  profileScope.textContent = copy.scope;
  $('#maxPageHint').textContent = `${clamp(inputs.maxPages.value, 2, 50, 8)} pages`;
  $('#maxRuntimeHint').textContent = runtimeMinutes === 0 ? 'No cap' : `${runtimeMinutes}m cap`;
}

function setControlsRunning(running, cancelling = false, paused = false, pauseRequested = false) {
  captureRunning = running;
  capturePaused = paused;
  captureButton.disabled = running;
  pauseButton.hidden = !running;
  pauseButton.disabled = cancelling || (pauseRequested && !paused);
  pauseButton.classList.toggle('resume', paused);
  pauseButton.querySelector('b').textContent = paused ? '▶' : 'Ⅱ';
  pauseButton.querySelector('span').textContent = paused ? 'Resume' : pauseRequested ? 'Pausing' : 'Pause';
  cancelButton.hidden = !running;
  cancelButton.disabled = cancelling;
  cancelButton.querySelector('span').textContent = cancelling ? 'Cancelling' : 'Cancel';
  $$('input[name="captureMode"]').forEach((input) => { input.disabled = running; });
  updateModeUi();
}

function showProgress(message, percent, reset = false, details = {}) {
  if (reset) highestProgress = 0;
  highestProgress = Math.max(highestProgress, clamp(percent, 0, 100, 0));
  progressShell.hidden = false;
  statusText.textContent = message;
  progressValue.textContent = `${highestProgress}%`;
  progressBar.style.width = `${highestProgress}%`;
  elapsedValue.textContent = `${formatDuration(details.elapsedSeconds)} elapsed`;
  const currentPage = Number(details.currentPage);
  const maximumPages = Number(details.maximumPages);
  pageValue.hidden = !(currentPage > 0);
  pageValue.textContent = currentPage > 0 ? `Page ${currentPage}${maximumPages > 0 ? `/${maximumPages}` : ''}` : '';
}

function showResult(message, isError = false) {
  result.hidden = false;
  result.classList.toggle('error', isError);
  result.textContent = message;
}

function showCompletedResult(filename, actualSeconds, capturedPages) {
  result.hidden = false;
  result.classList.remove('error');
  result.replaceChildren();
  const filenameLine = document.createElement('strong');
  filenameLine.className = 'result-filename';
  filenameLine.textContent = filename || 'Capture';
  const readyLine = document.createElement('span');
  readyLine.className = 'result-ready';
  readyLine.textContent = `is ready • ${formatDuration(actualSeconds)}`;
  const pagesLine = document.createElement('span');
  pagesLine.className = 'result-pages';
  pagesLine.textContent = `${Math.max(1, Number(capturedPages) || 1)} ${Number(capturedPages) === 1 ? 'page' : 'pages'}`;
  result.append(filenameLine, readyLine, pagesLine);
}

function renderCaptureState(state) {
  if (!state?.ok) return;
  const running = Boolean(state.running);
  setControlsRunning(running, state.state === 'cancelling', Boolean(state.paused), Boolean(state.pauseRequested));
  targetStrip.hidden = !running;
  targetStrip.classList.toggle('running', running);
  if (running && (state.targetTitle || state.targetUrl)) targetStatus.textContent = `Capturing: ${state.targetTitle || compactUrl(state.targetUrl)}`;

  if (running) {
    result.hidden = true;
    showProgress(state.label || 'Capture running…', state.percent || 0, false, state);
  } else if (state.state === 'completed') {
    highestProgress = 100;
    showProgress('ZIP downloaded', 100, false, { elapsedSeconds: state.actualSeconds });
    showCompletedResult(state.filename, state.actualSeconds, state.capturedPages);
  } else if (state.state === 'failed' || state.state === 'interrupted') {
    progressShell.hidden = true;
    highestProgress = 0;
    showResult(state.error || state.label || 'The capture stopped unexpectedly.', true);
    const failureKey = `${state.finishedAt || ''}|${state.error || state.label || state.state}`;
    if (inputs.activityLogAutoOpenErrors.checked && autoOpenedFailureKey !== failureKey) {
      autoOpenedFailureKey = failureKey;
      switchTab('logs');
    }
  } else if (state.state === 'cancelled') {
    progressShell.hidden = true;
    highestProgress = 0;
    showResult('Capture cancelled. No new archive was downloaded.', true);
  } else if (state.state === 'stopped') {
    progressShell.hidden = true;
    highestProgress = 0;
    showResult(state.label || 'Capture stopped because the target tab was closed.', true);
  } else if (state.state === 'idle') {
    progressShell.hidden = true;
  }
}

async function persistSettings() {
  await chrome.storage.local.set({
    settingsVersion: '2.2.16',
    captureMode: selectedMode(), reloadForNetwork: inputs.reloadForNetwork.checked,
    settleSeconds: clamp(inputs.settleSeconds.value, 0, 30, 5), maxBodyMb: clamp(inputs.maxBodyMb.value, 1, 50, 35),
    maxDeepNodes: clamp(inputs.maxDeepNodes.value, 100, 10000, 3500), maxPages: clamp(inputs.maxPages.value, 2, 50, 8),
    maxRuntimeMinutes: [0, 10, 20, 30, 60].includes(Number(inputs.maxRuntimeMinutes.value)) ? Number(inputs.maxRuntimeMinutes.value) : 20,
    crawlDepth: clamp(inputs.crawlDepth.value, 1, 4, 2), includeQueryStrings: inputs.includeQueryStrings.checked,
    activityLogEnabled: inputs.activityLogEnabled.checked, activityLogTimestamps: inputs.activityLogTimestamps.checked,
    activityLogAutoOpenErrors: inputs.activityLogAutoOpenErrors.checked
  });
}

function logTaskKey(entry) {
  return entry?.taskId ? `capture:${entry.taskId}` : 'legacy';
}

function logTaskLabel(entry) {
  const mode = { quick: 'Quick', max: 'Fast', entire: 'Max' }[entry?.taskMode] || 'Capture';
  const title = entry?.taskTitle || 'Earlier activity';
  return `${mode} · ${title}`;
}

async function renderLogs() {
  const saved = await chrome.storage.local.get(defaults);
  const logs = Array.isArray(saved.captureActivityLogs) ? saved.captureActivityLogs : [];
  logCount.textContent = String(new Set(logs.map(logTaskKey)).size);
  logList.replaceChildren();
  if (!logs.length) {
    const empty = document.createElement('div'); empty.className = 'empty-log'; empty.textContent = 'No capture activity yet.'; logList.append(empty); return;
  }
  let displayedTask = null;
  logs.slice().reverse().forEach((entry) => {
    const taskKey = logTaskKey(entry);
    if (taskKey !== displayedTask) {
      displayedTask = taskKey;
      const task = document.createElement('div'); task.className = 'log-task';
      const taskName = document.createElement('strong'); taskName.textContent = logTaskLabel(entry);
      const taskTime = document.createElement('span');
      const startedAt = entry.taskStartedAt || entry.timestamp;
      taskTime.textContent = startedAt ? new Date(startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
      task.append(taskName, taskTime); logList.append(task);
    }
    const row = document.createElement('div'); row.className = `log-entry ${entry.level === 'error' ? 'error' : ''}`;
    const time = document.createElement('span'); time.className = 'log-time';
    time.textContent = saved.activityLogTimestamps && entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '•';
    const message = document.createElement('span'); message.className = 'log-message'; message.textContent = entry.label || 'Activity';
    const percent = document.createElement('span'); percent.className = 'log-percent';
    percent.textContent = Number.isFinite(entry.percent) ? `${entry.percent}%` : entry.level === 'error' ? 'ERR' : '';
    row.append(time, message, percent); logList.append(row);
  });
}

async function refreshCaptureStatus() {
  try {
    const state = await chrome.runtime.sendMessage({ type: 'GET_CAPTURE_STATUS' });
    renderCaptureState(state);
    if (state?.running) window.setTimeout(renderLogs, 50);
  } catch {}
}

async function restoreSettings() {
  const saved = await chrome.storage.local.get(defaults);
  const usesPreviousDefaults = !['2.1.6', '2.1.7', '2.2.0', '2.2.1', '2.2.2', '2.2.3', '2.2.4', '2.2.5', '2.2.6', '2.2.7', '2.2.8', '2.2.9', '2.2.10', '2.2.11', '2.2.12', '2.2.13', '2.2.14', '2.2.15', '2.2.16'].includes(saved.settingsVersion)
    && Number(saved.settleSeconds) === 10 && Number(saved.maxBodyMb) === 50
    && Number(saved.maxDeepNodes) === 5000 && Number(saved.maxPages) === 10 && Number(saved.crawlDepth) === 2;
  if (usesPreviousDefaults) Object.assign(saved, { settleSeconds: 5, maxBodyMb: 35, maxDeepNodes: 3500, maxPages: 8, crawlDepth: 2 });
  const mode = ['quick', 'max', 'entire'].includes(saved.captureMode) ? saved.captureMode : 'max';
  const radio = $(`input[name="captureMode"][value="${mode}"]`); if (radio) radio.checked = true;
  inputs.reloadForNetwork.checked = Boolean(saved.reloadForNetwork);
  inputs.settleSeconds.value = clamp(saved.settleSeconds, 0, 30, 5); inputs.maxBodyMb.value = clamp(saved.maxBodyMb, 1, 50, 35);
  inputs.maxDeepNodes.value = clamp(saved.maxDeepNodes, 100, 10000, 3500); inputs.maxPages.value = clamp(saved.maxPages, 2, 50, 8);
  inputs.maxRuntimeMinutes.value = [0, 10, 20, 30, 60].includes(Number(saved.maxRuntimeMinutes)) ? String(saved.maxRuntimeMinutes) : '20';
  inputs.crawlDepth.value = clamp(saved.crawlDepth, 1, 4, 2); inputs.includeQueryStrings.checked = Boolean(saved.includeQueryStrings);
  inputs.activityLogEnabled.checked = saved.activityLogEnabled !== false; inputs.activityLogTimestamps.checked = saved.activityLogTimestamps !== false;
  inputs.activityLogAutoOpenErrors.checked = saved.activityLogAutoOpenErrors !== false;
  updateModeUi(); await persistSettings(); await renderLogs(); await refreshCaptureStatus();
}

function startParticles() {
  const canvas = $('#particleCanvas');
  const context = canvas.getContext('2d');
  if (!context || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const pointer = { x: -1000, y: -1000, active: false };
  const viewport = { width: canvas.clientWidth, height: canvas.clientHeight, left: 0, top: 0 };
  const particles = Array.from({ length: 44 }, (_, index) => ({
    x: Math.random() * viewport.width,
    y: Math.random() * viewport.height,
    vx: (Math.random() - .5) * .24,
    vy: (Math.random() - .5) * .24,
    radius: index % 7 === 0 ? 2.25 : 1 + Math.random() * .78,
    alpha: .22 + Math.random() * .24,
    tint: index % 11 === 0 ? '101,214,186' : index % 5 === 0 ? '85,185,232' : '126,151,164'
  }));
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    viewport.width = rect.width; viewport.height = rect.height; viewport.left = rect.left; viewport.top = rect.top;
    const scale = devicePixelRatio || 1;
    canvas.width = viewport.width * scale; canvas.height = viewport.height * scale;
    context.setTransform(scale, 0, 0, scale, 0, 0);
  };
  const movePointer = (event) => { pointer.x = event.clientX - viewport.left; pointer.y = event.clientY - viewport.top; pointer.active = true; };
  document.addEventListener('pointermove', movePointer, { passive: true });
  document.addEventListener('mousemove', movePointer, { passive: true });
  document.addEventListener('pointerleave', () => { pointer.active = false; pointer.x = -1000; pointer.y = -1000; });
  resize();
  const frame = () => {
    context.clearRect(0, 0, viewport.width, viewport.height);
    if (pointer.active) {
      const glow = context.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, 104);
      glow.addColorStop(0, 'rgba(85, 185, 232, .12)');
      glow.addColorStop(.46, 'rgba(101, 214, 186, .035)');
      glow.addColorStop(1, 'rgba(20, 42, 54, 0)');
      context.fillStyle = glow;
      context.fillRect(pointer.x - 104, pointer.y - 104, 208, 208);
    }
    for (let first = 0; first < particles.length; first += 1) {
      for (let second = first + 1; second < particles.length; second += 1) {
        const a = particles[first], b = particles[second];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance >= 84) continue;
        context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y);
        context.strokeStyle = `rgba(126, 151, 164, ${.13 * (1 - distance / 84)})`;
        context.lineWidth = .62; context.stroke();
      }
    }
    for (const particle of particles) {
      const dx = particle.x - pointer.x, dy = particle.y - pointer.y, distance = Math.hypot(dx, dy);
      let intensity = 0;
      if (pointer.active && distance < 138 && distance > 0) {
        intensity = 1 - distance / 138;
        const force = .22 * intensity;
        particle.vx += dx / distance * force;
        particle.vy += dy / distance * force;
        context.beginPath(); context.moveTo(pointer.x, pointer.y); context.lineTo(particle.x, particle.y);
        context.strokeStyle = `rgba(85, 185, 232, ${.34 * intensity})`;
        context.lineWidth = .76; context.stroke();
      }
      particle.vx += (Math.random() - .5) * .0025;
      particle.vy += (Math.random() - .5) * .0025;
      particle.vx *= .978; particle.vy *= .978;
      const speed = Math.hypot(particle.vx, particle.vy);
      if (speed > 2.1) { particle.vx = particle.vx / speed * 2.1; particle.vy = particle.vy / speed * 2.1; }
      particle.x += particle.vx; particle.y += particle.vy;
      if (particle.x < -5) particle.x = viewport.width + 5; if (particle.x > viewport.width + 5) particle.x = -5;
      if (particle.y < -5) particle.y = viewport.height + 5; if (particle.y > viewport.height + 5) particle.y = -5;
      context.beginPath(); context.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      context.fillStyle = `rgba(${particle.tint}, ${Math.min(1, particle.alpha + intensity * .52)})`; context.fill();
    }
    requestAnimationFrame(frame);
  };
  addEventListener('resize', resize, { passive: true });
  frame();
}

function installGlassDrag(element) {
  let startX = 0;
  let startY = 0;
  let dragged = false;
  const finish = () => {
    element.classList.remove('glass-grabbed');
    element.style.setProperty('--drag-x', '0px');
    element.style.setProperty('--drag-y', '0px');
    if (dragged) element.dataset.justDragged = 'true';
    setTimeout(() => { delete element.dataset.justDragged; }, 0);
  };
  element.classList.add('glass-draggable');
  element.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('input, select, a')) return;
    startX = event.clientX;
    startY = event.clientY;
    dragged = false;
    element.classList.add('glass-grabbed');
    element.setPointerCapture?.(event.pointerId);
  });
  element.addEventListener('pointermove', (event) => {
    if (!element.classList.contains('glass-grabbed')) return;
    const rawX = event.clientX - startX;
    const rawY = event.clientY - startY;
    dragged ||= Math.hypot(rawX, rawY) > 4;
    element.style.setProperty('--drag-x', `${Math.max(-12, Math.min(12, rawX * .34))}px`);
    element.style.setProperty('--drag-y', `${Math.max(-8, Math.min(8, rawY * .28))}px`);
  });
  element.addEventListener('pointerup', finish);
  element.addEventListener('pointercancel', finish);
  element.addEventListener('lostpointercapture', () => {
    if (element.classList.contains('glass-grabbed')) finish();
  });
  element.addEventListener('click', (event) => {
    if (!element.dataset.justDragged) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}

function installLogoAnimations() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const palette = ['#8cddff', '#55b9e8', '#65d6ba', '#d7f5ff', '#7898ff'];
  let trailUntil = 0;
  let lastEmissionAt = 0;
  let activeButton = null;
  let stopTimer = null;

  const emitPixel = (x, y, burst = false) => {
    const pixel = document.createElement('i');
    pixel.className = 'cursor-pixel';
    const size = burst ? 3 + Math.random() * 4 : 2 + Math.random() * 3;
    const angle = Math.random() * Math.PI * 2;
    const distance = burst ? 7 + Math.random() * 27 : 2 + Math.random() * 11;
    pixel.style.setProperty('--pixel-size', `${size}px`);
    pixel.style.setProperty('--pixel-x', `${x + Math.cos(angle) * distance}px`);
    pixel.style.setProperty('--pixel-y', `${y + Math.sin(angle) * distance}px`);
    pixel.style.setProperty('--pixel-drift-x', `${(Math.random() - .5) * (burst ? 42 : 24)}px`);
    pixel.style.setProperty('--pixel-drift-y', `${-8 - Math.random() * (burst ? 34 : 20)}px`);
    pixel.style.setProperty('--pixel-color', palette[Math.floor(Math.random() * palette.length)]);
    pixel.style.setProperty('--pixel-life', `${650 + Math.random() * 520}ms`);
    document.body.append(pixel);
    pixel.addEventListener('animationend', () => pixel.remove(), { once: true });
    setTimeout(() => pixel.remove(), 1400);
  };

  const activateTrail = (button) => {
    const now = performance.now();
    trailUntil = now + 4500;
    activeButton?.classList.remove('trail-active');
    activeButton = button;
    button.classList.add('trail-active');
    clearTimeout(stopTimer);
    stopTimer = setTimeout(() => {
      button.classList.remove('trail-active');
      if (activeButton === button) activeButton = null;
    }, 4500);
    const rect = button.getBoundingClientRect();
    for (let index = 0; index < 22; index += 1) emitPixel(rect.left + rect.width / 2, rect.top + rect.height / 2, true);
  };

  document.addEventListener('pointermove', (event) => {
    const now = performance.now();
    if (now >= trailUntil || now - lastEmissionAt < 24) return;
    lastEmissionAt = now;
    emitPixel(event.clientX, event.clientY);
    emitPixel(event.clientX, event.clientY);
  }, { passive: true });

  $$('.logo-button').forEach((button) => {
    button.addEventListener('click', () => activateTrail(button));
  });
}

$$('.tab').forEach((button) => {
  button.addEventListener('click', () => switchTab(button.dataset.tab));
  installGlassDrag(button);
});
$$('.toggle-tile, .inline-toggle').forEach(installGlassDrag);
installLogoAnimations();
Object.values(inputs).forEach((input) => input.addEventListener('change', async () => { updateModeUi(); await persistSettings(); if (input === inputs.activityLogTimestamps) await renderLogs(); }));
$$('input[name="captureMode"]').forEach((radio) => radio.addEventListener('change', async () => { updateModeUi(); await persistSettings(); }));

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'CAPTURE_PROGRESS') return;
  setControlsRunning(message.percent < 100, false, Boolean(message.paused), Boolean(message.pauseRequested));
  showProgress(message.label || 'Working…', message.percent || 0, false, message);
  setTimeout(renderLogs, 60);
});

$('#copyLogs').addEventListener('click', async () => {
  const saved = await chrome.storage.local.get(defaults);
  const lines = [];
  let copiedTask = null;
  for (const entry of (saved.captureActivityLogs || [])) {
    const taskKey = logTaskKey(entry);
    if (taskKey !== copiedTask) {
      copiedTask = taskKey;
      lines.push(`===== ${logTaskLabel(entry)} =====`);
    }
    lines.push(`${entry.timestamp || ''}\t${entry.level || 'info'}\t${Number.isFinite(entry.percent) ? `${entry.percent}%` : ''}\t${entry.label || ''}`);
  }
  const text = lines.join('\n');
  await navigator.clipboard.writeText(text || 'No Let Me See Code activity logs.');
  $('#copyLogs').textContent = 'Copied'; setTimeout(() => { $('#copyLogs').textContent = 'Copy logs'; }, 1200);
});
$('#clearLogs').addEventListener('click', async () => { await chrome.storage.local.set({ captureActivityLogs: [] }); await renderLogs(); });

captureButton.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^(?:https?:|file:)/i.test(tab.url || '')) { showResult('Open a normal webpage before starting a capture.', true); return; }
  const options = currentOptions();
  options.targetTabId = tab.id;
  await persistSettings();
  highestProgress = 0; result.hidden = true; targetStatus.textContent = `Capturing: ${tab.title || compactUrl(tab.url)}`;
  targetStrip.hidden = false; targetStrip.classList.add('running'); setControlsRunning(true); showProgress('Locking the selected tab…', 1, true);
  try {
    const response = await chrome.runtime.sendMessage({ type: 'START_CAPTURE', options });
    if (!response?.ok) throw new Error(response?.error || 'Capture failed.');
  } catch (error) {
    showResult(error?.message || String(error), true);
  } finally {
    await refreshCaptureStatus();
  }
});

cancelButton.addEventListener('click', async () => {
  cancelButton.disabled = true; cancelButton.querySelector('span').textContent = 'Cancelling';
  try { await chrome.runtime.sendMessage({ type: 'CANCEL_CAPTURE' }); } finally { setTimeout(refreshCaptureStatus, 250); }
});

pauseButton.addEventListener('click', async () => {
  pauseButton.disabled = true;
  const messageType = capturePaused ? 'RESUME_CAPTURE' : 'PAUSE_CAPTURE';
  try {
    const response = await chrome.runtime.sendMessage({ type: messageType });
    if (!response?.ok) showResult(response?.message || 'The capture could not be paused or resumed.', true);
  } finally {
    setTimeout(refreshCaptureStatus, 150);
  }
});

startParticles();
restoreSettings().catch((error) => showResult(error?.message || String(error), true));
statusTimer = setInterval(refreshCaptureStatus, 1000);
addEventListener('unload', () => clearInterval(statusTimer));
