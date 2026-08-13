(() => {
  'use strict';

  const STATE_KEY = '__LET_ME_SEE_CODE_INSTRUMENTATION__';
  if (globalThis[STATE_KEY]) return;

  const LIMITS = Object.freeze({
    pointerColumns: 32,
    pointerRows: 18,
    rtcEvents: 2000,
    rtcPayloadBytes: 4 * 1024 * 1024,
    graphicsEvents: 10000,
    graphicsPayloadBytes: 24 * 1024 * 1024,
    shaderCharacters: 2 * 1024 * 1024,
    audioEvents: 4000,
    audioConnections: 2000,
    audioParameterEvents: 4000,
    performanceEntriesPerType: 5000,
    errors: 100
  });
  const state = {
    formatVersion: 3,
    startedAt: new Date().toISOString(),
    limits: { ...LIMITS },
    keyboard: {
      keydown: 0,
      keyup: 0,
      repeats: 0,
      compositionStart: 0,
      compositionEnd: 0,
      targetKinds: { password: 0, textInput: 0, editable: 0, other: 0 }
    },
    pointer: {
      moves: 0,
      downs: 0,
      ups: 0,
      clicks: 0,
      types: {},
      grid: new Array(LIMITS.pointerColumns * LIMITS.pointerRows).fill(0)
    },
    css: {
      registeredProperties: [],
      droppedRegisteredProperties: 0
    },
    performance: {
      collection: 'PerformanceObserver buffered entries',
      supportedEntryTypes: [...(globalThis.PerformanceObserver?.supportedEntryTypes || [])],
      observedTypes: [],
      unsupportedTypes: [],
      droppedByType: {},
      entries: {
        longtask: [],
        'layout-shift': [],
        'largest-contentful-paint': [],
        event: []
      }
    },
    webrtc: {
      peerConnectionsObserved: 0,
      channelsObserved: 0,
      events: [],
      payloadBytes: 0,
      droppedEvents: 0,
      droppedPayloadBytes: 0
    },
    graphics: {
      webglAvailable: Boolean(globalThis.WebGLRenderingContext || globalThis.WebGL2RenderingContext),
      webgpuAvailable: Boolean(globalThis.navigator?.gpu),
      callCounts: {},
      events: [],
      payloadBytes: 0,
      shaderCharacters: 0,
      droppedEvents: 0,
      droppedPayloadBytes: 0
    },
    audio: {
      webAudioAvailable: Boolean(globalThis.AudioContext || globalThis.webkitAudioContext),
      contexts: [],
      nodes: [],
      connections: [],
      parameterEvents: [],
      events: [],
      analyserReads: {},
      workletModules: [],
      mediaElements: {},
      droppedEvents: 0,
      droppedConnections: 0,
      droppedParameterEvents: 0,
      privacy: 'Graph metadata and bounded analyser summaries only. Microphone samples, decoded PCM and entered data are never recorded.'
    },
    errors: []
  };
  Object.defineProperty(globalThis, STATE_KEY, {
    value: state,
    configurable: false,
    enumerable: false,
    writable: false
  });

  const reportError = (area, error) => {
    if (state.errors.length >= LIMITS.errors) return;
    state.errors.push({ area, message: String(error?.message || error).slice(0, 1000) });
  };
  const safeUrl = (value) => {
    try {
      const url = new URL(String(value || ''), location.href);
      url.search = '';
      url.hash = '';
      return url.href;
    } catch { return String(value || '').slice(0, 2000); }
  };
  const nodeDescriptor = (node) => {
    try {
      return node instanceof Element ? {
        tag: node.localName,
        id: String(node.id || '').slice(0, 500),
        className: String(node.className || '').slice(0, 1000),
        role: node.getAttribute('role') || null
      } : null;
    } catch { return null; }
  };

  const audioContexts = new WeakMap();
  const audioNodes = new WeakMap();
  const audioParams = new WeakMap();
  let nextAudioContextId = 1;
  let nextAudioNodeId = 1;
  let nextAudioParamId = 1;
  const pushAudioEvent = (event) => {
    if (state.audio.events.length >= LIMITS.audioEvents) {
      state.audio.droppedEvents += 1;
      return;
    }
    state.audio.events.push({ at: performance.now(), ...event });
  };
  const mediaDescriptor = (media) => {
    try {
      return {
        tag: media?.localName || null,
        src: safeUrl(media?.currentSrc || media?.src || ''),
        currentTime: Number.isFinite(media?.currentTime) ? media.currentTime : null,
        duration: Number.isFinite(media?.duration) ? media.duration : null,
        paused: Boolean(media?.paused),
        muted: Boolean(media?.muted),
        volume: Number.isFinite(media?.volume) ? media.volume : null,
        playbackRate: Number.isFinite(media?.playbackRate) ? media.playbackRate : null,
        loop: Boolean(media?.loop),
        autoplay: Boolean(media?.autoplay),
        node: nodeDescriptor(media)
      };
    } catch { return null; }
  };
  const observeAudioContext = (context) => {
    if (!context) return null;
    let id = audioContexts.get(context);
    if (id) return id;
    id = `context-${nextAudioContextId++}`;
    audioContexts.set(context, id);
    const record = {
      id,
      type: context.constructor?.name || 'BaseAudioContext',
      sampleRate: context.sampleRate || null,
      state: context.state || null,
      baseLatency: Number.isFinite(context.baseLatency) ? context.baseLatency : null,
      outputLatency: Number.isFinite(context.outputLatency) ? context.outputLatency : null,
      destinationMaxChannels: context.destination?.maxChannelCount ?? null,
      createdAt: performance.now()
    };
    state.audio.contexts.push(record);
    try {
      context.addEventListener?.('statechange', () => {
        record.state = context.state || null;
        pushAudioEvent({ type: 'context-state', contextId: id, state: record.state, currentTime: context.currentTime });
      });
    } catch (error) { reportError('audio-context-state', error); }
    return id;
  };
  const observeAudioParam = (param, nodeId, name) => {
    if (!param || typeof param !== 'object') return null;
    let id = audioParams.get(param);
    if (id) return id;
    id = `param-${nextAudioParamId++}`;
    audioParams.set(param, id);
    pushAudioEvent({
      type: 'audio-param', id, nodeId, name,
      value: Number.isFinite(param.value) ? param.value : null,
      defaultValue: Number.isFinite(param.defaultValue) ? param.defaultValue : null,
      minValue: Number.isFinite(param.minValue) ? param.minValue : null,
      maxValue: Number.isFinite(param.maxValue) ? param.maxValue : null,
      automationRate: param.automationRate || null
    });
    return id;
  };
  const observeAudioNode = (node, context, factory = null, media = null) => {
    if (!node) return null;
    let id = audioNodes.get(node);
    if (id) return id;
    id = `node-${nextAudioNodeId++}`;
    audioNodes.set(node, id);
    const contextId = observeAudioContext(context || node.context);
    const record = {
      id,
      contextId,
      type: node.constructor?.name || 'AudioNode',
      factory,
      channelCount: node.channelCount ?? null,
      channelCountMode: node.channelCountMode || null,
      channelInterpretation: node.channelInterpretation || null,
      numberOfInputs: node.numberOfInputs ?? null,
      numberOfOutputs: node.numberOfOutputs ?? null,
      media: mediaDescriptor(media),
      parameters: []
    };
    for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(node) || {})) {
      let value;
      try { value = node[name]; } catch { continue; }
      if (globalThis.AudioParam && value instanceof globalThis.AudioParam) {
        const paramId = observeAudioParam(value, id, name);
        if (paramId) record.parameters.push({ id: paramId, name });
      }
    }
    state.audio.nodes.push(record);
    pushAudioEvent({ type: 'node-created', nodeId: id, contextId, nodeType: record.type, factory });
    return id;
  };

  try {
    const contextPrototype = globalThis.BaseAudioContext?.prototype;
    const mediaFactoryNames = new Set(['createMediaElementSource']);
    const factories = [
      'createAnalyser','createBiquadFilter','createBufferSource','createChannelMerger','createChannelSplitter',
      'createConstantSource','createConvolver','createDelay','createDynamicsCompressor','createGain','createIIRFilter',
      'createMediaElementSource','createMediaStreamDestination','createMediaStreamSource','createOscillator','createPanner',
      'createPeriodicWave','createScriptProcessor','createStereoPanner','createWaveShaper'
    ];
    for (const methodName of factories) {
      const original = contextPrototype?.[methodName];
      if (typeof original !== 'function' || original.__lmscWrapped) continue;
      const wrapped = function (...args) {
        const result = original.apply(this, args);
        observeAudioContext(this);
        if (result instanceof (globalThis.AudioNode || Object)) observeAudioNode(result, this, methodName, mediaFactoryNames.has(methodName) ? args[0] : null);
        else pushAudioEvent({ type: 'audio-factory', contextId: observeAudioContext(this), factory: methodName, resultType: result?.constructor?.name || null });
        return result;
      };
      Object.defineProperty(wrapped, '__lmscWrapped', { value: true });
      contextPrototype[methodName] = wrapped;
    }
    for (const methodName of ['resume', 'suspend', 'close']) {
      const original = globalThis.AudioContext?.prototype?.[methodName];
      if (typeof original !== 'function' || original.__lmscWrapped) continue;
      const wrapped = function (...args) {
        const contextId = observeAudioContext(this);
        pushAudioEvent({ type: `context-${methodName}`, contextId, state: this.state || null, currentTime: this.currentTime });
        return original.apply(this, args);
      };
      Object.defineProperty(wrapped, '__lmscWrapped', { value: true });
      globalThis.AudioContext.prototype[methodName] = wrapped;
    }
    const decodeOriginal = contextPrototype?.decodeAudioData;
    if (typeof decodeOriginal === 'function' && !decodeOriginal.__lmscWrapped) {
      const wrapped = function (audioData, ...args) {
        const contextId = observeAudioContext(this);
        const bytes = audioData?.byteLength ?? null;
        pushAudioEvent({ type: 'decode-audio-data', contextId, encodedBytes: bytes });
        const result = decodeOriginal.call(this, audioData, ...args);
        Promise.resolve(result).then((buffer) => pushAudioEvent({
          type: 'decoded-audio-buffer', contextId, encodedBytes: bytes,
          duration: buffer?.duration ?? null, sampleRate: buffer?.sampleRate ?? null,
          channels: buffer?.numberOfChannels ?? null, frames: buffer?.length ?? null
        })).catch(() => {});
        return result;
      };
      Object.defineProperty(wrapped, '__lmscWrapped', { value: true });
      contextPrototype.decodeAudioData = wrapped;
    }

    const nodePrototype = globalThis.AudioNode?.prototype;
    const connectOriginal = nodePrototype?.connect;
    if (typeof connectOriginal === 'function' && !connectOriginal.__lmscWrapped) {
      const wrapped = function (destination, output = 0, input = 0) {
        const sourceId = observeAudioNode(this, this.context);
        const destinationId = destination instanceof globalThis.AudioNode
          ? observeAudioNode(destination, destination.context)
          : observeAudioParam(destination, null, null);
        if (state.audio.connections.length < LIMITS.audioConnections) {
          state.audio.connections.push({ at: performance.now(), sourceId, destinationId, output, input, action: 'connect' });
        } else state.audio.droppedConnections += 1;
        return connectOriginal.apply(this, arguments);
      };
      Object.defineProperty(wrapped, '__lmscWrapped', { value: true });
      nodePrototype.connect = wrapped;
    }
    const disconnectOriginal = nodePrototype?.disconnect;
    if (typeof disconnectOriginal === 'function' && !disconnectOriginal.__lmscWrapped) {
      const wrapped = function (...args) {
        const sourceId = observeAudioNode(this, this.context);
        if (state.audio.connections.length < LIMITS.audioConnections) {
          state.audio.connections.push({ at: performance.now(), sourceId, action: 'disconnect', argumentCount: args.length });
        } else state.audio.droppedConnections += 1;
        return disconnectOriginal.apply(this, args);
      };
      Object.defineProperty(wrapped, '__lmscWrapped', { value: true });
      nodePrototype.disconnect = wrapped;
    }

    const parameterMethods = ['setValueAtTime','linearRampToValueAtTime','exponentialRampToValueAtTime','setTargetAtTime','setValueCurveAtTime','cancelScheduledValues','cancelAndHoldAtTime'];
    for (const methodName of parameterMethods) {
      const original = globalThis.AudioParam?.prototype?.[methodName];
      if (typeof original !== 'function' || original.__lmscWrapped) continue;
      const wrapped = function (...args) {
        const paramId = observeAudioParam(this, null, null);
        if (state.audio.parameterEvents.length < LIMITS.audioParameterEvents) {
          state.audio.parameterEvents.push({ at: performance.now(), paramId, method: methodName, arguments: args.map((value) => typeof value === 'number' ? value : ArrayBuffer.isView(value) ? { length: value.length } : null) });
        } else state.audio.droppedParameterEvents += 1;
        return original.apply(this, args);
      };
      Object.defineProperty(wrapped, '__lmscWrapped', { value: true });
      globalThis.AudioParam.prototype[methodName] = wrapped;
    }

    for (const methodName of ['getByteFrequencyData','getFloatFrequencyData','getByteTimeDomainData','getFloatTimeDomainData']) {
      const original = globalThis.AnalyserNode?.prototype?.[methodName];
      if (typeof original !== 'function' || original.__lmscWrapped) continue;
      const wrapped = function (array) {
        const result = original.apply(this, arguments);
        const nodeId = observeAudioNode(this, this.context);
        const values = array && array.length ? Array.from(array).slice(0, 4096) : [];
        let min = null, max = null, mean = null;
        if (values.length) {
          min = Math.min(...values); max = Math.max(...values);
          mean = values.reduce((sum, value) => sum + value, 0) / values.length;
        }
        const key = `${nodeId}:${methodName}`;
        const previous = state.audio.analyserReads[key] || { nodeId, method: methodName, reads: 0 };
        state.audio.analyserReads[key] = { ...previous, reads: previous.reads + 1, length: array?.length ?? null, min, max, mean, lastAt: performance.now() };
        return result;
      };
      Object.defineProperty(wrapped, '__lmscWrapped', { value: true });
      globalThis.AnalyserNode.prototype[methodName] = wrapped;
    }

    for (const methodName of ['start', 'stop']) {
      const original = globalThis.AudioScheduledSourceNode?.prototype?.[methodName];
      if (typeof original !== 'function' || original.__lmscWrapped) continue;
      const wrapped = function (...args) {
        const nodeId = observeAudioNode(this, this.context);
        pushAudioEvent({ type: `source-${methodName}`, nodeId, arguments: args.map((value) => typeof value === 'number' ? value : null) });
        return original.apply(this, args);
      };
      Object.defineProperty(wrapped, '__lmscWrapped', { value: true });
      globalThis.AudioScheduledSourceNode.prototype[methodName] = wrapped;
    }

    const addModuleOriginal = globalThis.AudioWorklet?.prototype?.addModule;
    if (typeof addModuleOriginal === 'function' && !addModuleOriginal.__lmscWrapped) {
      const wrapped = function (url, options) {
        state.audio.workletModules.push({ at: performance.now(), url: safeUrl(url), credentials: options?.credentials || null });
        return addModuleOriginal.apply(this, arguments);
      };
      Object.defineProperty(wrapped, '__lmscWrapped', { value: true });
      globalThis.AudioWorklet.prototype.addModule = wrapped;
    }
  } catch (error) {
    reportError('web-audio-hooks', error);
  }

  try {
    const mediaPrototype = globalThis.HTMLMediaElement?.prototype;
    for (const methodName of ['play', 'pause', 'load']) {
      const original = mediaPrototype?.[methodName];
      if (typeof original !== 'function' || original.__lmscWrapped) continue;
      const wrapped = function (...args) {
        pushAudioEvent({ type: `media-${methodName}`, media: mediaDescriptor(this) });
        return original.apply(this, args);
      };
      Object.defineProperty(wrapped, '__lmscWrapped', { value: true });
      mediaPrototype[methodName] = wrapped;
    }
    for (const eventName of ['loadedmetadata','play','playing','pause','seeking','seeked','ratechange','volumechange','ended','emptied','stalled','waiting']) {
      addEventListener(eventName, (event) => {
        const media = event.target;
        if (!globalThis.HTMLMediaElement || !(media instanceof globalThis.HTMLMediaElement)) return;
        const descriptor = mediaDescriptor(media);
        const key = `${descriptor?.tag || 'media'}:${descriptor?.src || nodeDescriptor(media)?.id || 'inline'}`;
        state.audio.mediaElements[key] = descriptor;
        pushAudioEvent({ type: `media-event:${eventName}`, media: descriptor });
      }, true);
    }
  } catch (error) {
    reportError('html-media-hooks', error);
  }
  const performanceEntryValue = (entry) => {
    const base = {
      entryType: entry.entryType,
      name: /^(?:https?:|file:)/i.test(entry.name || '') ? safeUrl(entry.name) : String(entry.name || '').slice(0, 2000),
      startTime: entry.startTime,
      duration: entry.duration
    };
    if (entry.entryType === 'longtask') {
      return {
        ...base,
        attribution: [...(entry.attribution || [])].slice(0, 100).map((item) => ({
          name: item.name || null,
          entryType: item.entryType || null,
          startTime: item.startTime,
          duration: item.duration,
          containerType: item.containerType || null,
          containerName: item.containerName || null,
          containerId: item.containerId || null,
          containerSrc: safeUrl(item.containerSrc || '')
        }))
      };
    }
    if (entry.entryType === 'layout-shift') {
      return {
        ...base,
        value: entry.value,
        hadRecentInput: entry.hadRecentInput,
        lastInputTime: entry.lastInputTime,
        sources: [...(entry.sources || [])].slice(0, 100).map((source) => ({
          currentRect: source.currentRect ? { x: source.currentRect.x, y: source.currentRect.y, width: source.currentRect.width, height: source.currentRect.height } : null,
          previousRect: source.previousRect ? { x: source.previousRect.x, y: source.previousRect.y, width: source.previousRect.width, height: source.previousRect.height } : null,
          node: nodeDescriptor(source.node)
        }))
      };
    }
    if (entry.entryType === 'largest-contentful-paint') {
      return { ...base, renderTime: entry.renderTime, loadTime: entry.loadTime, size: entry.size, id: entry.id || null, url: safeUrl(entry.url || ''), element: nodeDescriptor(entry.element) };
    }
    if (entry.entryType === 'event') {
      return {
        ...base,
        processingStart: entry.processingStart,
        processingEnd: entry.processingEnd,
        interactionId: entry.interactionId,
        cancelable: entry.cancelable,
        target: nodeDescriptor(entry.target)
      };
    }
    return base;
  };
  const performanceObservers = [];
  for (const type of ['longtask', 'layout-shift', 'largest-contentful-paint', 'event']) {
    if (!globalThis.PerformanceObserver?.supportedEntryTypes?.includes(type)) {
      state.performance.unsupportedTypes.push(type);
      continue;
    }
    try {
      const observer = new PerformanceObserver((list) => {
        const target = state.performance.entries[type];
        for (const entry of list.getEntries()) {
          if (target.length < LIMITS.performanceEntriesPerType) target.push(performanceEntryValue(entry));
          else state.performance.droppedByType[type] = (state.performance.droppedByType[type] || 0) + 1;
        }
      });
      observer.observe(type === 'event' ? { type, buffered: true, durationThreshold: 16 } : { type, buffered: true });
      performanceObservers.push(observer);
      state.performance.observedTypes.push(type);
    } catch (error) {
      state.performance.unsupportedTypes.push(type);
      reportError(`performance-observer-${type}`, error);
    }
  }
  const targetKind = (target) => {
    try {
      if (target instanceof HTMLInputElement && target.type === 'password') return 'password';
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return 'textInput';
      if (target instanceof HTMLElement && target.isContentEditable) return 'editable';
    } catch {}
    return 'other';
  };

  addEventListener('keydown', (event) => {
    state.keyboard.keydown += 1;
    if (event.repeat) state.keyboard.repeats += 1;
    state.keyboard.targetKinds[targetKind(event.target)] += 1;
  }, { capture: true, passive: true });
  addEventListener('keyup', () => { state.keyboard.keyup += 1; }, { capture: true, passive: true });
  addEventListener('compositionstart', () => { state.keyboard.compositionStart += 1; }, { capture: true, passive: true });
  addEventListener('compositionend', () => { state.keyboard.compositionEnd += 1; }, { capture: true, passive: true });

  const pointerCell = (event) => {
    const width = Math.max(1, innerWidth || document.documentElement?.clientWidth || 1);
    const height = Math.max(1, innerHeight || document.documentElement?.clientHeight || 1);
    const column = Math.min(LIMITS.pointerColumns - 1, Math.max(0, Math.floor((event.clientX / width) * LIMITS.pointerColumns)));
    const row = Math.min(LIMITS.pointerRows - 1, Math.max(0, Math.floor((event.clientY / height) * LIMITS.pointerRows)));
    const index = row * LIMITS.pointerColumns + column;
    state.pointer.grid[index] = Math.min(Number.MAX_SAFE_INTEGER, state.pointer.grid[index] + 1);
  };
  addEventListener('pointermove', (event) => {
    state.pointer.moves += 1;
    state.pointer.types[event.pointerType || 'unknown'] = (state.pointer.types[event.pointerType || 'unknown'] || 0) + 1;
    pointerCell(event);
  }, { capture: true, passive: true });
  addEventListener('pointerdown', (event) => { state.pointer.downs += 1; pointerCell(event); }, { capture: true, passive: true });
  addEventListener('pointerup', (event) => { state.pointer.ups += 1; pointerCell(event); }, { capture: true, passive: true });
  addEventListener('click', (event) => { state.pointer.clicks += 1; pointerCell(event); }, { capture: true, passive: true });

  try {
    const originalRegisterProperty = globalThis.CSS?.registerProperty;
    if (typeof originalRegisterProperty === 'function' && !originalRegisterProperty.__lmscWrapped) {
      const wrappedRegisterProperty = function (definition) {
        if (state.css.registeredProperties.length < 5000) {
          state.css.registeredProperties.push({
            at: performance.now(),
            name: String(definition?.name || '').slice(0, 1000),
            syntax: String(definition?.syntax || '').slice(0, 2000),
            inherits: Boolean(definition?.inherits),
            initialValue: definition?.initialValue === undefined ? null : String(definition.initialValue).slice(0, 4000)
          });
        } else {
          state.css.droppedRegisteredProperties += 1;
        }
        return originalRegisterProperty.call(this, definition);
      };
      Object.defineProperty(wrappedRegisterProperty, '__lmscWrapped', { value: true });
      globalThis.CSS.registerProperty = wrappedRegisterProperty;
    }
  } catch (error) {
    reportError('css-register-property-hook', error);
  }

  const bytesToBase64 = (bytes) => {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize)));
    }
    return btoa(binary);
  };
  const toBytes = (value, offset = 0, length = undefined) => {
    try {
      let bytes = null;
      if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
      else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      if (!bytes) return null;
      const start = Math.max(0, Number(offset) || 0);
      const end = length === undefined ? bytes.length : Math.min(bytes.length, start + Math.max(0, Number(length) || 0));
      return bytes.subarray(start, end);
    } catch {
      return null;
    }
  };

  const pushRtc = (event) => {
    if (state.webrtc.events.length >= LIMITS.rtcEvents) {
      state.webrtc.droppedEvents += 1;
      return;
    }
    state.webrtc.events.push({ at: performance.now(), ...event });
  };
  const captureRtcPayload = async (data) => {
    try {
      if (typeof data === 'string') {
        const bytes = new TextEncoder().encode(data);
        if (state.webrtc.payloadBytes + bytes.byteLength > LIMITS.rtcPayloadBytes) {
          state.webrtc.droppedPayloadBytes += bytes.byteLength;
          return { kind: 'text', byteLength: bytes.byteLength, omitted: true };
        }
        state.webrtc.payloadBytes += bytes.byteLength;
        return { kind: 'text', byteLength: bytes.byteLength, text: data };
      }
      const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : toBytes(data);
      if (!bytes) return { kind: Object.prototype.toString.call(data), byteLength: null, omitted: true };
      if (state.webrtc.payloadBytes + bytes.byteLength > LIMITS.rtcPayloadBytes) {
        state.webrtc.droppedPayloadBytes += bytes.byteLength;
        return { kind: 'binary', byteLength: bytes.byteLength, omitted: true };
      }
      state.webrtc.payloadBytes += bytes.byteLength;
      return { kind: 'binary', byteLength: bytes.byteLength, base64: bytesToBase64(bytes) };
    } catch (error) {
      reportError('webrtc-payload', error);
      return { kind: 'unreadable', omitted: true };
    }
  };
  const observedChannels = new WeakMap();
  const observeChannel = (channel, direction = 'unknown') => {
    if (!channel || observedChannels.has(channel)) return channel;
    state.webrtc.channelsObserved += 1;
    const channelId = state.webrtc.channelsObserved;
    observedChannels.set(channel, channelId);
    pushRtc({ type: 'channel', channelId, direction, label: String(channel.label || '').slice(0, 500), protocol: String(channel.protocol || '').slice(0, 200), ordered: channel.ordered, negotiated: channel.negotiated, id: channel.id ?? null });
    channel.addEventListener('open', () => pushRtc({ type: 'open', channelId }));
    channel.addEventListener('close', () => pushRtc({ type: 'close', channelId }));
    channel.addEventListener('error', () => pushRtc({ type: 'error', channelId }));
    channel.addEventListener('message', (event) => {
      void captureRtcPayload(event.data).then((payload) => pushRtc({ type: 'message', direction: 'received', channelId, payload }));
    });
    return channel;
  };
  const observedPeers = new WeakSet();
  const observePeer = (peer) => {
    if (!peer || observedPeers.has(peer)) return;
    observedPeers.add(peer);
    state.webrtc.peerConnectionsObserved += 1;
    peer.addEventListener('datachannel', (event) => observeChannel(event.channel, 'remote'));
    peer.addEventListener('connectionstatechange', () => pushRtc({ type: 'connection-state', state: peer.connectionState || null }));
  };
  try {
    const prototype = globalThis.RTCPeerConnection?.prototype;
    if (prototype) {
      const originalCreateDataChannel = prototype.createDataChannel;
      if (typeof originalCreateDataChannel === 'function') {
        prototype.createDataChannel = function (...args) {
          observePeer(this);
          return observeChannel(originalCreateDataChannel.apply(this, args), 'local');
        };
      }
      const dataChannelPrototype = globalThis.RTCDataChannel?.prototype;
      const originalSend = dataChannelPrototype?.send;
      if (typeof originalSend === 'function' && !originalSend.__lmscWrapped) {
        const wrappedSend = function (data) {
          observeChannel(this, 'existing');
          const channelId = observedChannels.get(this) || null;
          void captureRtcPayload(data).then((payload) => pushRtc({ type: 'message', direction: 'sent', channelId, payload }));
          return originalSend.call(this, data);
        };
        Object.defineProperty(wrappedSend, '__lmscWrapped', { value: true });
        dataChannelPrototype.send = wrappedSend;
      }
      for (const methodName of ['setLocalDescription', 'setRemoteDescription', 'addIceCandidate', 'addTrack', 'addTransceiver']) {
        const original = prototype[methodName];
        if (typeof original !== 'function') continue;
        prototype[methodName] = function (...args) {
          observePeer(this);
          return original.apply(this, args);
        };
      }
    }
  } catch (error) {
    reportError('webrtc-hooks', error);
  }

  const incrementCall = (name) => {
    state.graphics.callCounts[name] = (state.graphics.callCounts[name] || 0) + 1;
  };
  const pushGraphics = (event) => {
    if (state.graphics.events.length >= LIMITS.graphicsEvents) {
      state.graphics.droppedEvents += 1;
      return;
    }
    state.graphics.events.push({ at: performance.now(), ...event });
  };
  const captureGraphicsBytes = (value, offset, length) => {
    const bytes = toBytes(value, offset, length);
    if (!bytes) return { byteLength: null, omitted: true };
    if (state.graphics.payloadBytes + bytes.byteLength > LIMITS.graphicsPayloadBytes) {
      state.graphics.droppedPayloadBytes += bytes.byteLength;
      return { byteLength: bytes.byteLength, omitted: true };
    }
    state.graphics.payloadBytes += bytes.byteLength;
    return { byteLength: bytes.byteLength, base64: bytesToBase64(bytes) };
  };
  const graphicsSourceDescriptor = (value) => {
    try {
      if (globalThis.HTMLImageElement && value instanceof HTMLImageElement) return { kind: 'image', src: safeUrl(value.currentSrc || value.src || ''), width: value.naturalWidth, height: value.naturalHeight, complete: value.complete };
      if (globalThis.HTMLVideoElement && value instanceof HTMLVideoElement) return { kind: 'video', src: safeUrl(value.currentSrc || value.src || ''), width: value.videoWidth, height: value.videoHeight, currentTime: value.currentTime, duration: Number.isFinite(value.duration) ? value.duration : null, paused: value.paused };
      if (globalThis.HTMLCanvasElement && value instanceof HTMLCanvasElement) return { kind: 'canvas', width: value.width, height: value.height };
      if (globalThis.OffscreenCanvas && value instanceof OffscreenCanvas) return { kind: 'offscreen-canvas', width: value.width, height: value.height };
      if (globalThis.ImageBitmap && value instanceof ImageBitmap) return { kind: 'image-bitmap', width: value.width, height: value.height };
      if (globalThis.VideoFrame && value instanceof VideoFrame) return { kind: 'video-frame', codedWidth: value.codedWidth, codedHeight: value.codedHeight, displayWidth: value.displayWidth, displayHeight: value.displayHeight, timestamp: value.timestamp, duration: value.duration };
      if (globalThis.ImageData && value instanceof ImageData) return { kind: 'image-data', width: value.width, height: value.height, colorSpace: value.colorSpace || null, payload: captureGraphicsBytes(value.data) };
    } catch (error) {
      reportError('graphics-source-descriptor', error);
    }
    return null;
  };
  const captureShader = (api, source, label = null) => {
    const text = String(source ?? '');
    if (state.graphics.shaderCharacters + text.length > LIMITS.shaderCharacters) {
      pushGraphics({ api, type: 'shader', label, characterLength: text.length, omitted: true });
      return;
    }
    state.graphics.shaderCharacters += text.length;
    pushGraphics({ api, type: 'shader', label, characterLength: text.length, source: text });
  };
  const wrapMethod = (prototype, methodName, api, beforeCall) => {
    try {
      if (!prototype || typeof prototype[methodName] !== 'function') return;
      const original = prototype[methodName];
      if (original.__lmscWrapped) return;
      const wrapped = function (...args) {
        incrementCall(`${api}.${methodName}`);
        try { beforeCall?.call(this, args); } catch (error) { reportError(`${api}.${methodName}`, error); }
        return original.apply(this, args);
      };
      Object.defineProperty(wrapped, '__lmscWrapped', { value: true });
      prototype[methodName] = wrapped;
    } catch (error) {
      reportError(`${api}.${methodName}-hook`, error);
    }
  };
  const instrumentWebGl = (prototype, api) => {
    wrapMethod(prototype, 'shaderSource', api, (args) => captureShader(api, args[1]));
    wrapMethod(prototype, 'bufferData', api, (args) => {
      const payload = typeof args[1] === 'number' ? { byteLength: args[1], allocatedOnly: true } : captureGraphicsBytes(args[1], args[3], args[4]);
      pushGraphics({ api, type: 'bufferData', target: args[0], usage: args[2], payload });
    });
    wrapMethod(prototype, 'bufferSubData', api, (args) => pushGraphics({ api, type: 'bufferSubData', target: args[0], destinationOffset: args[1], payload: captureGraphicsBytes(args[2], args[3], args[4]) }));
    for (const methodName of ['texImage2D', 'texSubImage2D', 'compressedTexImage2D', 'compressedTexSubImage2D']) {
      wrapMethod(prototype, methodName, api, (args) => {
        const candidate = [...args].reverse().find((value) => value instanceof ArrayBuffer || ArrayBuffer.isView(value));
        const source = [...args].reverse().map(graphicsSourceDescriptor).find(Boolean) || null;
        pushGraphics({ api, type: methodName, numericArguments: args.filter((value) => typeof value === 'number'), payload: candidate ? captureGraphicsBytes(candidate) : null, source });
      });
    }
    for (const methodName of ['compileShader', 'linkProgram', 'useProgram', 'drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) wrapMethod(prototype, methodName, api);
  };
  instrumentWebGl(globalThis.WebGLRenderingContext?.prototype, 'webgl');
  instrumentWebGl(globalThis.WebGL2RenderingContext?.prototype, 'webgl2');

  try {
    wrapMethod(globalThis.GPUDevice?.prototype, 'createShaderModule', 'webgpu', (args) => captureShader('webgpu', args[0]?.code, args[0]?.label || null));
    wrapMethod(globalThis.GPUDevice?.prototype, 'createBuffer', 'webgpu', (args) => pushGraphics({ api: 'webgpu', type: 'createBuffer', descriptor: { label: args[0]?.label || null, size: args[0]?.size ?? null, usage: args[0]?.usage ?? null, mappedAtCreation: Boolean(args[0]?.mappedAtCreation) } }));
    wrapMethod(globalThis.GPUQueue?.prototype, 'writeBuffer', 'webgpu', (args) => pushGraphics({ api: 'webgpu', type: 'writeBuffer', bufferOffset: args[1] || 0, payload: captureGraphicsBytes(args[2], args[3], args[4]) }));
    wrapMethod(globalThis.GPUQueue?.prototype, 'writeTexture', 'webgpu', (args) => pushGraphics({ api: 'webgpu', type: 'writeTexture', destination: { mipLevel: args[0]?.mipLevel || 0, origin: args[0]?.origin || null, aspect: args[0]?.aspect || null }, layout: args[2] || null, size: args[3] || null, payload: captureGraphicsBytes(args[1]) }));
    for (const methodName of ['createRenderPipeline', 'createRenderPipelineAsync', 'createComputePipeline', 'createComputePipelineAsync', 'createBindGroup', 'createBindGroupLayout', 'createPipelineLayout', 'createSampler', 'createTexture', 'createCommandEncoder']) wrapMethod(globalThis.GPUDevice?.prototype, methodName, 'webgpu');
    for (const methodName of ['beginRenderPass', 'beginComputePass', 'copyBufferToBuffer', 'copyBufferToTexture', 'copyTextureToBuffer', 'copyTextureToTexture', 'finish']) wrapMethod(globalThis.GPUCommandEncoder?.prototype, methodName, 'webgpu-command');
    for (const methodName of ['setPipeline', 'setBindGroup', 'setVertexBuffer', 'setIndexBuffer', 'setViewport', 'setScissorRect', 'draw', 'drawIndexed', 'drawIndirect', 'drawIndexedIndirect', 'executeBundles', 'end']) wrapMethod(globalThis.GPURenderPassEncoder?.prototype, methodName, 'webgpu-render-pass');
    for (const methodName of ['setPipeline', 'setBindGroup', 'dispatchWorkgroups', 'dispatchWorkgroupsIndirect', 'end']) wrapMethod(globalThis.GPUComputePassEncoder?.prototype, methodName, 'webgpu-compute-pass');
  } catch (error) {
    reportError('webgpu-hooks', error);
  }
})();
