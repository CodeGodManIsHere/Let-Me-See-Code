(async () => {
  const SECRET_KEY = /pass(?:word|wd)?|secret|token|api[-_]?key|auth(?:orization)?|cookie|session|csrf|xsrf|private[-_]?key/i;
  const BEARER = /\b(?:bearer|basic)\s+[a-z0-9._~+\/-]+=*/gi;
  const MAX_STORAGE_VALUE = 250_000;
  const CAPTURE_OPTIONS = globalThis.__PAGE_MIRROR_OPTIONS__ || {};
  const FORENSIC_MODE = CAPTURE_OPTIONS.forensicMode === true;
  const INCLUDE_APPLICATION_CONTENTS = CAPTURE_OPTIONS.includeApplicationContents !== false;
  const MAX_APP_RECORDS = Math.min(20_000, Math.max(100, Number(CAPTURE_OPTIONS.maxAppRecords) || 5_000));
  const MAX_APP_BYTES = Math.min(100 * 1024 * 1024, Math.max(1 * 1024 * 1024, Number(CAPTURE_OPTIONS.maxAppBytes) || 25 * 1024 * 1024));
  const EXTRACTOR_PHASE = String(CAPTURE_OPTIONS.extractorPhase || 'legacy');
  const ELEMENT_CHUNK_START = Math.max(0, Number(CAPTURE_OPTIONS.elementChunkStart) || 0);
  const ELEMENT_CHUNK_LIMIT = Math.min(2000, Math.max(50, Number(CAPTURE_OPTIONS.elementChunkLimit) || 400));
  const QUICK_STYLE_MODE = CAPTURE_OPTIONS.quickStyleMode === true;
  const QUICK_STYLE_PROPERTIES = [
    'display', 'position', 'inset', 'z-index', 'overflow', 'opacity', 'visibility',
    'box-sizing', 'width', 'height', 'margin', 'padding', 'border', 'border-radius',
    'background', 'color', 'font', 'line-height', 'letter-spacing', 'text-align',
    'white-space', 'flex', 'flex-direction', 'justify-content', 'align-items', 'gap',
    'grid-template-columns', 'grid-template-rows', 'transform', 'filter', 'box-shadow'
  ];
  const MAX_CANVAS_SNAPSHOT_PIXELS = Math.min(16_000_000, Math.max(250_000, Number(CAPTURE_OPTIONS.maxCanvasSnapshotPixels) || 4_000_000));
  const MAX_CANVAS_SNAPSHOT_CHARACTERS = Math.min(32_000_000, Math.max(1_000_000, Number(CAPTURE_OPTIONS.maxCanvasSnapshotCharacters) || 12_000_000));

  function redactString(value, key = '') {
    if (SECRET_KEY.test(String(key))) return '[REDACTED]';
    return String(value ?? '').replace(BEARER, '[REDACTED_AUTH]');
  }

  function safeStructured(value, key = '', depth = 0, seen = new WeakSet()) {
    if (SECRET_KEY.test(String(key))) return '[REDACTED]';
    if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'string') return redactString(value, key).slice(0, 1_000_000);
    if (typeof value === 'bigint') return `${value}n`;
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (depth > 8) return '[MAX_DEPTH]';
    if (typeof value !== 'object') return String(value);
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);
    if (value instanceof Date) return value.toISOString();
    if (value instanceof RegExp) return String(value);
    if (value instanceof Blob) return { _type: value.constructor.name, type: value.type, size: value.size };
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      const bytes = value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      return { _type: value.constructor.name, byteLength: bytes.byteLength, base64: bytesToBase64(bytes.subarray(0, 2_000_000)), truncated: bytes.byteLength > 2_000_000 };
    }
    if (Array.isArray(value)) return value.slice(0, 10_000).map((item, index) => safeStructured(item, String(index), depth + 1, seen));
    const output = {};
    for (const childKey of Object.keys(value).slice(0, 10_000)) {
      try { output[childKey] = safeStructured(value[childKey], childKey, depth + 1, seen); }
      catch (error) { output[childKey] = `[UNREADABLE: ${error?.message || String(error)}]`; }
    }
    return output;
  }

  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunk)));
    }
    return btoa(binary);
  }

  async function sha256Hex(value) {
    const bytes = new TextEncoder().encode(String(value ?? ''));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function readResponseBytesBounded(response, maximumBytes) {
    const allowed = Math.max(0, maximumBytes);
    const announcedLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(announcedLength) && announcedLength > allowed) {
      return { bytes: null, omitted: `Response declared ${announcedLength} bytes; ${allowed} bytes remained in the application-data budget.` };
    }
    if (!response.body?.getReader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      return bytes.byteLength <= allowed
        ? { bytes, omitted: null }
        : { bytes: null, omitted: `Response exceeded the remaining ${allowed}-byte application-data budget.` };
    }

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        if (total + chunk.byteLength > allowed) {
          await reader.cancel('Application-data byte limit reached.').catch(() => {});
          return { bytes: null, omitted: `Response exceeded the remaining ${allowed}-byte application-data budget.` };
        }
        chunks.push(chunk);
        total += chunk.byteLength;
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes, omitted: null };
  }

  function sanitizePayloadText(text, mimeType = '') {
    const source = String(text ?? '');
    if (/json|graphql/i.test(mimeType) || /^[\s\r\n]*[\[{]/.test(source)) {
      try { return JSON.stringify(safeStructured(JSON.parse(source)), null, 2); } catch {}
    }
    return redactString(source)
      .replace(/(["']?(?:access[_-]?token|refresh[_-]?token|token|csrf|xsrf|api[_-]?key|auth(?:orization)?|cookie|session|password|secret)["']?\s*[:=]\s*["']?)([^"'\s&,;}<]+)/gi, '$1[REDACTED]');
  }

  function sanitizeScriptSource(text) {
    let output = redactString(text)
      .replace(/(["']?(?:access[_-]?token|refresh[_-]?token|token|csrf|xsrf|api[_-]?key|auth(?:orization)?|cookie|session|password|secret)["']?\s*[:=]\s*)([^,;\r\n}]+)/gi, '$1[REDACTED]')
      .replace(/(["']?(?:access[_-]?token|refresh[_-]?token|token|csrf|xsrf|api[_-]?key|auth(?:orization)?|cookie|session|password|secret)["']?\s*[:=]\s*["']?)([^"'\s&,;}<]+)/gi, '$1[REDACTED]');
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

  function sanitizeUrl(raw) {
    if (!raw || typeof raw !== 'string') return raw;
    try {
      const url = new URL(raw, location.href);
      for (const key of [...url.searchParams.keys()]) {
        if (SECRET_KEY.test(key)) url.searchParams.set(key, '[REDACTED]');
      }
      return url.href;
    } catch {
      return redactString(raw);
    }
  }

  function sanitizeAttributes(element) {
    const fieldKey = element.getAttribute?.('name') || element.getAttribute?.('id') || element.getAttribute?.('http-equiv') || '';
    return Array.from(element.attributes || [], ({ name, value }) => {
      const secretValueAttribute = SECRET_KEY.test(fieldKey) && /^(?:value|content)$/i.test(name);
      let safeValue = SECRET_KEY.test(name) || secretValueAttribute ? '[REDACTED]' : redactString(value, name);
      if (/^(?:href|src|action|formaction|poster|cite)$/i.test(name)) safeValue = sanitizeUrl(safeValue);
      if (/^(?:srcset)$/i.test(name)) {
        safeValue = safeValue.split(',').map((part) => {
          const [url, ...descriptor] = part.trim().split(/\s+/);
          return [sanitizeUrl(url), ...descriptor].join(' ');
        }).join(', ');
      }
      return { name, value: safeValue };
    });
  }

  function sanitizeHtml() {
    const clone = document.documentElement.cloneNode(true);
    const originals = [document.documentElement, ...document.documentElement.querySelectorAll('*')];
    const copies = [clone, ...clone.querySelectorAll('*')];

    for (let index = 0; index < copies.length; index += 1) {
      const original = originals[index];
      const copy = copies[index];
      if (!original || !copy || copy.nodeType !== Node.ELEMENT_NODE) continue;

      for (const attribute of [...copy.attributes]) {
        const name = attribute.name;
        let value = attribute.value;
        const fieldKey = original.getAttribute('name') || original.getAttribute('id') || original.getAttribute('http-equiv') || '';
        if (SECRET_KEY.test(name)) value = '[REDACTED]';
        if (SECRET_KEY.test(fieldKey) && /^(?:value|content)$/i.test(name)) value = '[REDACTED]';
        if (/^(?:href|src|action|formaction|poster|cite)$/i.test(name)) value = sanitizeUrl(value);
        if (SECRET_KEY.test(original.getAttribute('name') || '') && name === 'value') value = '[REDACTED]';
        copy.setAttribute(name, redactString(value, name));
      }

      if (original instanceof HTMLInputElement) {
        const sensitive = original.type === 'password' || SECRET_KEY.test(original.name || original.id || '');
        copy.setAttribute('value', sensitive ? '[REDACTED]' : original.value);
        if (original.checked) copy.setAttribute('checked', '');
        else copy.removeAttribute('checked');
      } else if (original instanceof HTMLTextAreaElement) {
        copy.textContent = SECRET_KEY.test(original.name || original.id || '') ? '[REDACTED]' : original.value;
      } else if (original instanceof HTMLSelectElement) {
        for (let optionIndex = 0; optionIndex < copy.options.length; optionIndex += 1) {
          copy.options[optionIndex].toggleAttribute('selected', original.options[optionIndex]?.selected === true);
        }
      }

      if (original instanceof HTMLScriptElement && copy.textContent) {
        copy.textContent = sanitizeScriptSource(copy.textContent);
      }
    }
    return '<!doctype html>\n' + clone.outerHTML;
  }

  function sanitizeFragmentHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    for (const element of template.content.querySelectorAll('*')) {
      const sanitized = sanitizeAttributes(element);
      for (const attribute of [...element.attributes]) element.removeAttribute(attribute.name);
      for (const attribute of sanitized) element.setAttribute(attribute.name, attribute.value);
      if (element instanceof HTMLScriptElement && element.textContent) {
        element.textContent = sanitizeScriptSource(element.textContent);
      }
    }
    return template.innerHTML;
  }

  const siblingPositionCache = new WeakMap();
  const elementPathCache = new WeakMap();

  function siblingPosition(element) {
    const cached = siblingPositionCache.get(element);
    if (cached) return cached;
    const parent = element.parentElement;
    if (!parent) return { index: 1, total: 1 };
    const totals = new Map();
    for (const child of parent.children) totals.set(child.localName, (totals.get(child.localName) || 0) + 1);
    const positions = new Map();
    for (const child of parent.children) {
      const index = (positions.get(child.localName) || 0) + 1;
      positions.set(child.localName, index);
      siblingPositionCache.set(child, { index, total: totals.get(child.localName) || 1 });
    }
    return siblingPositionCache.get(element) || { index: 1, total: 1 };
  }

  function selectorSegment(element) {
    const escapedTag = element.localName || element.tagName?.toLowerCase() || 'unknown';
    if (element.id) return `${escapedTag}#${CSS.escape(element.id)}`;
    const position = siblingPosition(element);
    return position.total > 1 ? `${escapedTag}:nth-of-type(${position.index})` : escapedTag;
  }

  function elementPath(element) {
    const cached = elementPathCache.get(element);
    if (cached) return cached;
    const segment = selectorSegment(element);
    let path = segment;
    if (element.parentElement) {
      path = `${elementPath(element.parentElement)} > ${segment}`;
    } else {
      const root = element.getRootNode();
      if (root instanceof ShadowRoot) path = `${elementPath(root.host)} ::shadow ${segment}`;
    }
    elementPathCache.set(element, path);
    return path;
  }

  function queryAllOpenRoots(selector) {
    const results = [];
    const visit = (root) => {
      for (const element of root.querySelectorAll(selector)) results.push(element);
      for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot) visit(element.shadowRoot);
      }
    };
    visit(document);
    return results;
  }

  const STYLE_BUCKET_PROPERTIES = [
    'display', 'position', 'inset', 'z-index', 'visibility', 'opacity',
    'box-sizing', 'width', 'height', 'margin', 'padding', 'border',
    'border-radius', 'background', 'color', 'font', 'line-height',
    'flex', 'grid-template-columns', 'grid-template-rows', 'transform',
    'filter', 'box-shadow', 'content'
  ];

  function styleBucketFingerprint(style) {
    // This is only a bucket key. A property-by-property comparison below is
    // still authoritative, so a collision can never merge different styles.
    // Native string joining is much faster than hashing every character in JS.
    const values = new Array(STYLE_BUCKET_PROPERTIES.length + 1);
    values[0] = style.length;
    for (let index = 0; index < STYLE_BUCKET_PROPERTIES.length; index += 1) {
      values[index + 1] = style.getPropertyValue(STYLE_BUCKET_PROPERTIES[index]);
    }
    return values.join('\u001f');
  }

  function styleObject(style) {
    const result = {};
    for (let index = 0; index < style.length; index += 1) {
      const property = style[index];
      result[property] = style.getPropertyValue(property);
    }
    return result;
  }

  function computedStyleMatchesDeclaration(left, right) {
    for (let index = 0; index < right.length; index += 1) {
      const property = right[index];
      if (left[property] !== right.getPropertyValue(property)) return false;
    }
    return true;
  }

  function pseudoStyle(element, pseudo) {
    const style = getComputedStyle(element, pseudo);
    const content = style.getPropertyValue('content');
    if (!content || content === 'none' || content === 'normal') return null;
    return {
      content,
      display: style.display,
      position: style.position,
      color: style.color,
      background: style.background,
      font: style.font,
      width: style.width,
      height: style.height,
      inset: style.inset,
      transform: style.transform
    };
  }

  function directText(element) {
    return [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function collectElements(options = {}) {
    const records = [];
    const computedStyles = [];
    const computedStyleIds = new Map();
    const computedStylePropertyCounts = [];
    const shadowRoots = [];
    const seen = new WeakSet();
    const rangeStart = Math.max(0, Number(options.start) || 0);
    const rangeLimit = Number.isFinite(Number(options.limit)) ? Math.max(0, Number(options.limit)) : Number.POSITIVE_INFINITY;
    const rangeEnd = rangeStart + rangeLimit;
    const includeShadowMetadata = options.includeShadowMetadata !== false;
    let discoveredElements = 0;
    const snapshotSlot = '__LET_ME_SEE_CODE_ELEMENT_SNAPSHOT__';
    let stableSnapshot = null;

    // Element chunks must all refer to the same enumeration. On highly animated
    // pages, rebuilding querySelectorAll('*') for every chunk lets live mount/
    // unmount activity shift indices between calls and can make a complete walk
    // look incomplete. Retain only element references plus their open-root label
    // for the bounded duration of this page capture; the document phase releases
    // the snapshot after the final element chunk has been consumed.
    if (EXTRACTOR_PHASE === 'elements') {
      if (rangeStart === 0 || !Array.isArray(globalThis[snapshotSlot])) {
        const rows = [];
        const snapshotSeen = new WeakSet();
        const snapshotRoot = (root, rootLabel) => {
          const rootElements = root instanceof Document
            ? [root.documentElement, ...root.querySelectorAll('*')]
            : [...root.querySelectorAll('*')];
          for (const element of rootElements) {
            if (!element || snapshotSeen.has(element)) continue;
            snapshotSeen.add(element);
            rows.push({ element, rootLabel });
            if (element.shadowRoot) snapshotRoot(element.shadowRoot, `${elementPath(element)} ::shadow`);
          }
        };
        snapshotRoot(document, 'document');
        globalThis[snapshotSlot] = rows;
      }
      stableSnapshot = globalThis[snapshotSlot];
    }

    function internComputedStyle(element) {
      const declaration = getComputedStyle(element);
      if (QUICK_STYLE_MODE) {
        const compactStyle = Object.fromEntries(QUICK_STYLE_PROPERTIES.map((property) => [property, declaration.getPropertyValue(property)]));
        const compactFingerprint = JSON.stringify(compactStyle);
        const compactCandidates = computedStyleIds.get(compactFingerprint) || [];
        if (compactCandidates.length) return compactCandidates[0];
        const compactId = computedStyles.length;
        computedStyles.push(compactStyle);
        computedStylePropertyCounts.push(QUICK_STYLE_PROPERTIES.length);
        compactCandidates.push(compactId);
        computedStyleIds.set(compactFingerprint, compactCandidates);
        return compactId;
      }
      const fingerprint = styleBucketFingerprint(declaration);
      const candidates = computedStyleIds.get(fingerprint) || [];
      let id = candidates.find((candidateId) =>
        computedStylePropertyCounts[candidateId] === declaration.length &&
        computedStyleMatchesDeclaration(computedStyles[candidateId], declaration)
      );
      if (id === undefined) {
        id = computedStyles.length;
        computedStyles.push(styleObject(declaration));
        computedStylePropertyCounts.push(declaration.length);
        candidates.push(id);
        computedStyleIds.set(fingerprint, candidates);
      }
      return id;
    }

    function visitRoot(root, rootLabel) {
      if (stableSnapshot && !(root instanceof Document)) return;
      const snapshotRows = stableSnapshot && root instanceof Document ? stableSnapshot : null;
      const elements = snapshotRows
        ? snapshotRows.map((entry) => entry.element)
        : root instanceof Document
          ? [root.documentElement, ...root.querySelectorAll('*')]
          : [...root.querySelectorAll('*')];

      for (let elementOffset = 0; elementOffset < elements.length; elementOffset += 1) {
        const element = elements[elementOffset];
        const elementRootLabel = snapshotRows?.[elementOffset]?.rootLabel || rootLabel;
        if (!element || seen.has(element)) continue;
        seen.add(element);
        const elementIndex = discoveredElements;
        discoveredElements += 1;
        const selected = elementIndex >= rangeStart && elementIndex < rangeEnd;
        if (!selected) {
          if (!snapshotRows && element.shadowRoot) visitRoot(element.shadowRoot, `${elementPath(element)} ::shadow`);
          continue;
        }
        const rect = element.getBoundingClientRect();
        const clientRects = [...element.getClientRects()].map((item) => ({
          x: item.x,
          y: item.y,
          top: item.top,
          right: item.right,
          bottom: item.bottom,
          left: item.left,
          width: item.width,
          height: item.height
        }));
        const sensitive = element instanceof HTMLInputElement &&
          (element.type === 'password' || SECRET_KEY.test(element.name || element.id || ''));
        const aria = {};
        for (const attribute of element.attributes) {
          if (attribute.name.startsWith('aria-')) aria[attribute.name.slice(5)] = redactString(attribute.value, attribute.name);
        }
        const relationship = (name) => (element.getAttribute(name) || '').trim().split(/\s+/).filter(Boolean).slice(0, 200);
        const slotDetails = {
          name: element.getAttribute('slot') || null,
          assignedSlotPath: element.assignedSlot ? elementPath(element.assignedSlot) : null,
          assignedElementPaths: element instanceof HTMLSlotElement
            ? element.assignedElements({ flatten: true }).slice(0, 1000).map((assigned) => elementPath(assigned))
            : []
        };

        records.push({
          path: elementPath(element),
          root: elementRootLabel,
          tag: element.localName,
          namespace: element.namespaceURI,
          attributes: sanitizeAttributes(element),
          dataset: safeStructured({ ...element.dataset }),
          semantics: {
            role: element.getAttribute('role'),
            aria,
            relationships: {
              labelledBy: relationship('aria-labelledby'),
              describedBy: relationship('aria-describedby'),
              controls: relationship('aria-controls'),
              details: relationship('aria-details'),
              owns: relationship('aria-owns'),
              flowTo: relationship('aria-flowto'),
              errorMessage: relationship('aria-errormessage')
            },
            tabIndex: element.tabIndex,
            hidden: element.hidden,
            inert: Boolean(element.inert),
            contentEditable: element.contentEditable,
            slot: slotDetails
          },
          directText: sensitive
            ? '[REDACTED]'
            : element instanceof HTMLScriptElement
              ? sanitizeScriptSource(directText(element))
              : directText(element),
          box: {
            x: rect.x,
            y: rect.y,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            left: rect.left,
            width: rect.width,
            height: rect.height
          },
          clientRects,
          scroll: {
            top: element.scrollTop,
            left: element.scrollLeft,
            width: element.scrollWidth,
            height: element.scrollHeight,
            clientWidth: element.clientWidth,
            clientHeight: element.clientHeight
          },
          computedStyleId: internComputedStyle(element),
          pseudo: QUICK_STYLE_MODE ? null : {
            before: pseudoStyle(element, '::before'),
            after: pseudoStyle(element, '::after'),
            marker: pseudoStyle(element, '::marker')
          }
        });

        if (element.shadowRoot) {
          const shadowId = `${elementPath(element)} ::shadow`;
          if (includeShadowMetadata) {
            shadowRoots.push({
              hostPath: elementPath(element),
              mode: element.shadowRoot.mode,
              delegatesFocus: Boolean(element.shadowRoot.delegatesFocus),
              slotAssignment: element.shadowRoot.slotAssignment || 'named',
              adoptedStyleSheetCount: element.shadowRoot.adoptedStyleSheets?.length || 0,
              childElementCount: element.shadowRoot.querySelectorAll('*').length,
              html: sanitizeFragmentHtml(element.shadowRoot.innerHTML)
            });
          }
          if (!snapshotRows) visitRoot(element.shadowRoot, shadowId);
        }
      }
    }

    visitRoot(document, 'document');
    return { records, computedStyles, shadowRoots, totalElements: discoveredElements, rangeStart, rangeEnd: Math.min(discoveredElements, rangeEnd) };
  }

  function collectFormState() {
    return queryAllOpenRoots('input, textarea, select, button, [contenteditable]').map((element) => {
      const name = element.getAttribute('name') || '';
      const validity = element.validity ? {
        valid: element.validity.valid,
        badInput: element.validity.badInput,
        customError: element.validity.customError,
        patternMismatch: element.validity.patternMismatch,
        rangeOverflow: element.validity.rangeOverflow,
        rangeUnderflow: element.validity.rangeUnderflow,
        stepMismatch: element.validity.stepMismatch,
        tooLong: element.validity.tooLong,
        tooShort: element.validity.tooShort,
        typeMismatch: element.validity.typeMismatch,
        valueMissing: element.validity.valueMissing
      } : null;
      const controlState = element instanceof HTMLInputElement
        ? ['checkbox', 'radio'].includes(element.type)
          ? { checked: element.checked, defaultChecked: element.defaultChecked, indeterminate: element.indeterminate }
          : element.type === 'file'
            ? { selectedFileCount: element.files?.length || 0, fileNamesCaptured: false }
            : { liveTextValueCaptured: false }
        : element instanceof HTMLSelectElement
          ? {
            selectedIndexes: [...element.options].map((option, index) => option.selected ? index : -1).filter((index) => index >= 0),
            defaultSelectedIndexes: [...element.options].map((option, index) => option.defaultSelected ? index : -1).filter((index) => index >= 0),
            optionCount: element.options.length,
            optionValuesCaptured: false
          }
          : element instanceof HTMLTextAreaElement || element.isContentEditable
            ? { liveTextValueCaptured: false }
            : null;
      return {
        path: elementPath(element),
        tag: element.localName,
        type: element.getAttribute('type'),
        id: element.id || null,
        name: SECRET_KEY.test(name) ? '[REDACTED]' : name,
        disabled: Boolean(element.disabled),
        readOnly: Boolean(element.readOnly),
        required: Boolean(element.required),
        multiple: Boolean(element.multiple),
        min: element.getAttribute('min'),
        max: element.getAttribute('max'),
        step: element.getAttribute('step'),
        minLength: Number.isFinite(element.minLength) ? element.minLength : null,
        maxLength: Number.isFinite(element.maxLength) ? element.maxLength : null,
        pattern: element.getAttribute('pattern'),
        accept: element.getAttribute('accept'),
        inputMode: element.getAttribute('inputmode'),
        autocomplete: element.getAttribute('autocomplete'),
        willValidate: Boolean(element.willValidate),
        validity,
        form: element.form ? {
          path: elementPath(element.form),
          id: element.form.id || null,
          action: sanitizeUrl(element.form.action || ''),
          method: element.form.method || 'get',
          enctype: element.form.enctype || null,
          target: element.form.target || null,
          noValidate: element.form.noValidate
        } : null,
        labels: element.labels ? [...element.labels].slice(0, 100).map((label) => ({ path: elementPath(label), text: label.textContent.trim().slice(0, 2000) })) : [],
        listId: element.getAttribute('list'),
        relationships: {
          labelledBy: (element.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean),
          describedBy: (element.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean),
          controls: (element.getAttribute('aria-controls') || '').split(/\s+/).filter(Boolean),
          errorMessage: (element.getAttribute('aria-errormessage') || '').split(/\s+/).filter(Boolean)
        },
        controlState,
        enteredValueCaptured: false
      };
    });
  }

  async function collectSecurityMetadata() {
    const csrfPattern = /csrf|xsrf|requestverificationtoken|authenticity[_-]?token/i;
    const csrfFields = [];
    const passwordFields = [];
    const candidates = queryAllOpenRoots('input,textarea,meta');

    for (const element of candidates) {
      const name = element.getAttribute('name') || '';
      const id = element.getAttribute('id') || '';
      const httpEquiv = element.getAttribute('http-equiv') || '';
      const key = `${name} ${id} ${httpEquiv}`;
      if (csrfPattern.test(key)) {
        const rawValue = element instanceof HTMLMetaElement
          ? element.content
          : ('value' in element ? String(element.value || '') : String(element.textContent || ''));
        csrfFields.push({
          path: elementPath(element),
          tag: element.localName,
          name: name || null,
          id: id || null,
          httpEquiv: httpEquiv || null,
          type: element.getAttribute('type') || null,
          location: element instanceof HTMLMetaElement ? 'document-head-meta' : element.closest('form') ? 'form-field' : 'document-field',
          valueLength: rawValue.length,
          sha256: await sha256Hex(rawValue)
        });
      }

      if (element instanceof HTMLInputElement && element.type === 'password') {
        const form = element.form;
        const style = getComputedStyle(element);
        passwordFields.push({
          path: elementPath(element),
          name: name || null,
          id: id || null,
          autocomplete: element.autocomplete || null,
          required: element.required,
          minLength: element.minLength,
          maxLength: element.maxLength,
          pattern: element.pattern || null,
          inputMode: element.inputMode || null,
          disabled: element.disabled,
          readOnly: element.readOnly,
          multiple: element.multiple,
          visible: Boolean(element.getClientRects().length) && style.display !== 'none' && style.visibility !== 'hidden',
          validation: {
            willValidate: element.willValidate,
            valid: element.validity?.valid ?? null,
            validationMessagePresent: Boolean(element.validationMessage)
          },
          form: form ? {
            path: elementPath(form),
            method: form.method,
            action: sanitizeUrl(form.action),
            enctype: form.enctype,
            noValidate: form.noValidate
          } : null
        });
      }
    }

    return {
      policy: {
        csrfValuesIncluded: false,
        passwordValuesIncluded: false,
        note: 'Only field metadata and one-way SHA-256 fingerprints are retained.'
      },
      csrfFields,
      passwordFields
    };
  }

  function collectHardwareProfile() {
    const profile = {
      viewport: {
        innerWidth,
        innerHeight,
        outerWidth,
        outerHeight,
        devicePixelRatio,
        visualViewportScale: visualViewport?.scale ?? null
      },
      screen: {
        width: screen.width,
        height: screen.height,
        availWidth: screen.availWidth,
        availHeight: screen.availHeight,
        colorDepth: screen.colorDepth,
        pixelDepth: screen.pixelDepth,
        orientationType: screen.orientation?.type || null,
        orientationAngle: screen.orientation?.angle ?? null
      },
      browser: {
        platform: navigator.platform,
        userAgent: navigator.userAgent,
        language: navigator.language,
        languages: [...(navigator.languages || [])],
        hardwareConcurrency: navigator.hardwareConcurrency || null,
        deviceMemoryGiB: navigator.deviceMemory || null,
        maxTouchPoints: navigator.maxTouchPoints || 0,
        cookieEnabled: navigator.cookieEnabled,
        online: navigator.onLine
      },
      connection: navigator.connection ? {
        effectiveType: navigator.connection.effectiveType || null,
        downlinkMbps: navigator.connection.downlink ?? null,
        rttMs: navigator.connection.rtt ?? null,
        saveData: navigator.connection.saveData ?? null
      } : null,
      webgpuSupported: Boolean(navigator.gpu),
      webgl: null
    };

    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (gl) {
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        profile.webgl = {
          context: gl instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl',
          vendor: gl.getParameter(gl.VENDOR),
          renderer: gl.getParameter(gl.RENDERER),
          unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
          unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
          version: gl.getParameter(gl.VERSION),
          shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
          maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
          maxCubeMapTextureSize: gl.getParameter(gl.MAX_CUBE_MAP_TEXTURE_SIZE),
          maxRenderbufferSize: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
          maxViewportDimensions: [...gl.getParameter(gl.MAX_VIEWPORT_DIMS)],
          maxVertexAttribs: gl.getParameter(gl.MAX_VERTEX_ATTRIBS),
          extensions: (gl.getSupportedExtensions() || []).sort()
        };
      }
    } catch (error) {
      profile.webgl = { error: error?.message || String(error) };
    }
    return profile;
  }

  function collectMediaState() {
    const ranges = (value) => {
      const output = [];
      for (let index = 0; index < Math.min(value?.length || 0, 100); index += 1) {
        try { output.push({ start: value.start(index), end: value.end(index) }); } catch {}
      }
      return output;
    };
    return queryAllOpenRoots('audio, video').map((media) => ({
      path: elementPath(media),
      tag: media.localName,
      src: sanitizeUrl(media.currentSrc || media.src),
      currentTime: media.currentTime,
      duration: Number.isFinite(media.duration) ? media.duration : null,
      paused: media.paused,
      ended: media.ended,
      muted: media.muted,
      volume: media.volume,
      playbackRate: media.playbackRate,
      defaultPlaybackRate: media.defaultPlaybackRate,
      preservesPitch: media.preservesPitch ?? null,
      autoplay: media.autoplay,
      loop: media.loop,
      controls: media.controls,
      preload: media.preload,
      crossOrigin: media.crossOrigin || null,
      seeking: media.seeking,
      readyState: media.readyState,
      networkState: media.networkState,
      buffered: ranges(media.buffered),
      seekable: ranges(media.seekable),
      played: ranges(media.played),
      textTracks: [...(media.textTracks || [])].slice(0, 100).map((track) => ({ kind: track.kind, label: track.label, language: track.language, mode: track.mode })),
      audioTrackCount: media.audioTracks?.length ?? null,
      videoTrackCount: media.videoTracks?.length ?? null,
      videoWidth: media.videoWidth,
      videoHeight: media.videoHeight
    }));
  }

  function collectAnimationState() {
    try {
      return document.getAnimations({ subtree: true }).map((animation, index) => {
        const effect = animation.effect;
        const target = effect?.target instanceof Element ? elementPath(effect.target) : null;
        let timing = null;
        let computedTiming = null;
        let keyframes = null;
        try { timing = effect?.getTiming?.() || null; } catch {}
        try { computedTiming = effect?.getComputedTiming?.() || null; } catch {}
        try { keyframes = effect?.getKeyframes?.() || null; } catch {}
        return {
          index,
          id: animation.id,
          type: animation.constructor?.name,
          target,
          playState: animation.playState,
          replaceState: animation.replaceState,
          pending: animation.pending,
          currentTime: animation.currentTime,
          startTime: animation.startTime,
          playbackRate: animation.playbackRate,
          timelineType: animation.timeline?.constructor?.name || null,
          timing,
          computedTiming,
          keyframes
        };
      });
    } catch (error) {
      return [{ error: error?.message || String(error) }];
    }
  }

  function collectCanvasState() {
    let retainedCharacters = 0;
    return queryAllOpenRoots('canvas').slice(0, 100).map((canvas) => {
      let dataUrl = null;
      let error = null;
      const pixels = Math.max(0, Number(canvas.width) || 0) * Math.max(0, Number(canvas.height) || 0);
      try {
        if (pixels > MAX_CANVAS_SNAPSHOT_PIXELS) {
          error = `Canvas pixel area ${pixels} exceeded the ${MAX_CANVAS_SNAPSHOT_PIXELS}-pixel renderer-safety boundary.`;
        } else if (retainedCharacters >= MAX_CANVAS_SNAPSHOT_CHARACTERS) {
          error = `Canvas snapshot character boundary ${MAX_CANVAS_SNAPSHOT_CHARACTERS} was reached.`;
        } else {
          dataUrl = canvas.toDataURL('image/png');
          if (dataUrl.length + retainedCharacters > MAX_CANVAS_SNAPSHOT_CHARACTERS) {
            dataUrl = null;
            error = `Canvas snapshot would exceed the ${MAX_CANVAS_SNAPSHOT_CHARACTERS}-character renderer-safety boundary.`;
          } else {
            retainedCharacters += dataUrl.length;
          }
        }
      } catch (reason) {
        error = reason?.message || String(reason);
      }
      return { path: elementPath(canvas), width: canvas.width, height: canvas.height, pixels, dataUrl, error };
    });
  }

  function collectStyleSheets() {
    const entries = [];
    const seen = new Set();
    const addSheet = (sheet, scope, kind) => {
      if (!sheet || seen.has(sheet)) return;
      seen.add(sheet);
      const index = entries.length;
      const base = {
        index,
        scope,
        kind,
        href: sanitizeUrl(sheet.href),
        title: sheet.title,
        disabled: sheet.disabled,
        media: sheet.media?.mediaText || '',
        ownerPath: sheet.ownerNode instanceof Element ? elementPath(sheet.ownerNode) : null
      };
      try {
        entries.push({ ...base, rules: [...sheet.cssRules].map((rule) => rule.cssText) });
      } catch (error) {
        entries.push({ ...base, rules: null, inaccessibleReason: error?.message || String(error) });
      }
    };

    for (const sheet of document.styleSheets) addSheet(sheet, 'document', 'styleSheets');
    for (const sheet of document.adoptedStyleSheets || []) addSheet(sheet, 'document', 'adoptedStyleSheets');
    for (const host of queryAllOpenRoots('*')) {
      if (!host.shadowRoot) continue;
      const scope = `${elementPath(host)} ::shadow`;
      for (const sheet of host.shadowRoot.styleSheets || []) addSheet(sheet, scope, 'styleSheets');
      for (const sheet of host.shadowRoot.adoptedStyleSheets || []) addSheet(sheet, scope, 'adoptedStyleSheets');
    }
    return entries;
  }

  function collectCssIntelligence(styleSheets) {
    const customProperties = new Map();
    const registeredProperties = [];
    const cascadeLayers = [];
    const containerQueries = [];
    const containerDeclarations = [];
    const scopes = [];
    const fontFaces = [];
    const addCustomProperty = (name, value, source) => {
      const entry = customProperties.get(name) || { name, declarations: [] };
      if (entry.declarations.length < 100) entry.declarations.push({ value: SECRET_KEY.test(name) ? '[REDACTED]' : redactString(value.trim().slice(0, 4000), name), ...source });
      customProperties.set(name, entry);
    };

    for (const sheet of styleSheets) {
      for (const [ruleIndex, cssText] of (sheet.rules || []).entries()) {
        const source = { sheetIndex: sheet.index, ruleIndex, scope: sheet.scope, href: sheet.href };
        for (const match of cssText.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) addCustomProperty(match[1], match[2], source);
        for (const match of cssText.matchAll(/@layer\s+([^;{]+)/gi)) cascadeLayers.push({ names: match[1].split(',').map((name) => name.trim()).filter(Boolean), ...source });
        for (const match of cssText.matchAll(/@container\s*([^\{]*)\{/gi)) containerQueries.push({ condition: match[1].trim().slice(0, 4000), ...source });
        for (const match of cssText.matchAll(/@scope\s*([^\{]*)\{/gi)) scopes.push({ prelude: match[1].trim().slice(0, 4000), ...source });
        for (const match of cssText.matchAll(/@property\s+(--[\w-]+)\s*\{([^}]*)\}/gi)) {
          const body = match[2];
          const field = (name) => body.match(new RegExp(`${name}\\s*:\\s*([^;]+)`, 'i'))?.[1]?.trim() || null;
          registeredProperties.push({ name: match[1], syntax: field('syntax'), inherits: field('inherits'), initialValue: field('initial-value'), ...source });
        }
        for (const match of cssText.matchAll(/@font-face\s*\{([^}]*)\}/gi)) {
          const body = match[1];
          const field = (name) => body.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i'))?.[1]?.trim() || null;
          fontFaces.push({
            family: field('font-family'),
            source: field('src'),
            style: field('font-style'),
            weight: field('font-weight'),
            stretch: field('font-stretch'),
            unicodeRange: field('unicode-range'),
            variationSettings: field('font-variation-settings'),
            featureSettings: field('font-feature-settings'),
            display: field('font-display'),
            ...source
          });
        }
        for (const match of cssText.matchAll(/(?:^|[;{])\s*(container(?:-name|-type)?)\s*:\s*([^;}]+)/gi)) {
          containerDeclarations.push({ property: match[1], value: match[2].trim().slice(0, 2000), ...source });
        }
      }
    }

    try {
      const rootStyle = getComputedStyle(document.documentElement);
      for (const property of rootStyle) {
        if (!property.startsWith('--')) continue;
        addCustomProperty(property, rootStyle.getPropertyValue(property), { source: 'computed-root' });
      }
    } catch {}

    return {
      customProperties: [...customProperties.values()].slice(0, 10_000),
      registeredProperties: registeredProperties.slice(0, 5000),
      cascadeLayers: cascadeLayers.slice(0, 5000),
      containerQueries: containerQueries.slice(0, 5000),
      containerDeclarations: containerDeclarations.slice(0, 5000),
      scopes: scopes.slice(0, 5000),
      fontFaces: fontFaces.slice(0, 5000),
      styleSheetCollection: {
        collectedOncePerSheet: true,
        total: styleSheets.length,
        accessible: styleSheets.filter((sheet) => Array.isArray(sheet.rules)).length,
        inaccessible: styleSheets.filter((sheet) => !Array.isArray(sheet.rules)).length
      }
    };
  }

  function collectStorage(storage) {
    const output = {};
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key === null) continue;
        const value = storage.getItem(key) || '';
        output[key] = SECRET_KEY.test(key)
          ? '[REDACTED]'
          : redactString(value.slice(0, MAX_STORAGE_VALUE), key) + (value.length > MAX_STORAGE_VALUE ? '\n[TRUNCATED]' : '');
      }
    } catch (error) {
      return { _error: error?.message || String(error) };
    }
    return output;
  }

  function collectMeta() {
    const selection = getSelection();
    return {
      capturedAt: new Date().toISOString(),
      url: sanitizeUrl(location.href),
      origin: location.origin,
      title: document.title,
      readyState: document.readyState,
      characterSet: document.characterSet,
      contentType: document.contentType,
      compatMode: document.compatMode,
      referrer: sanitizeUrl(document.referrer),
      language: document.documentElement.lang,
      viewport: {
        innerWidth,
        innerHeight,
        outerWidth,
        outerHeight,
        devicePixelRatio,
        visualViewport: window.visualViewport ? {
          width: visualViewport.width,
          height: visualViewport.height,
          offsetLeft: visualViewport.offsetLeft,
          offsetTop: visualViewport.offsetTop,
          pageLeft: visualViewport.pageLeft,
          pageTop: visualViewport.pageTop,
          scale: visualViewport.scale
        } : null
      },
      scroll: { x: scrollX, y: scrollY, maxX: document.documentElement.scrollWidth, maxY: document.documentElement.scrollHeight },
      selection: selection ? { text: selection.toString(), rangeCount: selection.rangeCount } : null,
      colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      userAgent: navigator.userAgent,
      platform: navigator.platform
    };
  }

  function collectResources() {
    return performance.getEntriesByType('resource').map((entry) => ({
      name: sanitizeUrl(entry.name),
      initiatorType: entry.initiatorType,
      startTime: entry.startTime,
      duration: entry.duration,
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize,
      nextHopProtocol: entry.nextHopProtocol,
      renderBlockingStatus: entry.renderBlockingStatus || null
    }));
  }

  function collectDocumentIntelligence() {
    const metaTags = [...document.querySelectorAll('meta')].slice(0, 1000).map((meta) => {
      const key = meta.name || meta.getAttribute('property') || meta.httpEquiv || meta.getAttribute('charset') || '';
      const content = meta.content || '';
      return {
        name: meta.name || null,
        property: meta.getAttribute('property'),
        httpEquiv: meta.httpEquiv || null,
        charset: meta.getAttribute('charset'),
        content: SECRET_KEY.test(key) ? '[REDACTED]' : redactString(content.slice(0, 4000), key)
      };
    });
    const linkTags = [...document.querySelectorAll('link')].slice(0, 2000).map((link) => ({
      rel: link.rel || null,
      href: sanitizeUrl(link.href || link.getAttribute('href') || ''),
      as: link.as || null,
      type: link.type || null,
      media: link.media || null,
      sizes: link.sizes?.value || null,
      crossOrigin: link.crossOrigin || null,
      integrity: link.integrity || null,
      fetchPriority: link.fetchPriority || null,
      disabled: Boolean(link.disabled)
    }));
    const scriptElements = [...document.scripts].slice(0, 2000).map((script) => ({
      src: sanitizeUrl(script.src || ''),
      type: script.type || 'text/javascript',
      async: script.async,
      defer: script.defer,
      noModule: script.noModule,
      crossOrigin: script.crossOrigin || null,
      integrity: script.integrity || null,
      referrerPolicy: script.referrerPolicy || null,
      fetchPriority: script.fetchPriority || null,
      inlineCharacters: script.src ? 0 : (script.textContent || '').length
    }));
    const imageAssets = [...document.images].slice(0, 5000).map((image) => ({
      src: sanitizeUrl(image.src || ''),
      currentSrc: sanitizeUrl(image.currentSrc || ''),
      srcset: (image.srcset || '').slice(0, 8000),
      sizes: (image.sizes || '').slice(0, 2000),
      alt: (image.alt || '').slice(0, 2000),
      width: image.width,
      height: image.height,
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      loading: image.loading || null,
      decoding: image.decoding || null,
      fetchPriority: image.fetchPriority || null,
      complete: image.complete,
      pictureSources: image.closest('picture') ? [...image.closest('picture').querySelectorAll('source')].slice(0, 100).map((source) => ({
        srcset: (source.srcset || '').slice(0, 8000),
        sizes: (source.sizes || '').slice(0, 2000),
        media: source.media || null,
        type: source.type || null
      })) : []
    }));
    const mediaAssets = [...document.querySelectorAll('audio,video')].slice(0, 1000).map((media) => ({
      tag: media.localName,
      src: sanitizeUrl(media.currentSrc || media.src || ''),
      poster: sanitizeUrl(media.poster || ''),
      preload: media.preload,
      controls: media.controls,
      autoplay: media.autoplay,
      loop: media.loop,
      muted: media.muted,
      defaultMuted: media.defaultMuted,
      volume: media.volume,
      currentTime: media.currentTime,
      paused: media.paused,
      ended: media.ended,
      seeking: media.seeking,
      readyState: media.readyState,
      networkState: media.networkState,
      duration: Number.isFinite(media.duration) ? media.duration : null,
      playbackRate: media.playbackRate,
      defaultPlaybackRate: media.defaultPlaybackRate,
      preservesPitch: media.preservesPitch ?? null,
      crossOrigin: media.crossOrigin || null,
      sources: [...media.querySelectorAll('source')].slice(0, 100).map((source) => ({
        src: sanitizeUrl(source.src || ''),
        type: source.type || null,
        media: source.media || null,
        codecSupport: source.type ? media.canPlayType(source.type) : ''
      })),
      tracks: [...media.querySelectorAll('track')].slice(0, 100).map((track) => ({
        kind: track.kind,
        label: track.label,
        language: track.srclang,
        src: sanitizeUrl(track.src || ''),
        default: track.default,
        readyState: track.readyState,
        mode: track.track?.mode || null
      }))
    }));
    const customElementNames = [...new Set([...document.querySelectorAll('*')].map((element) => element.localName).filter((name) => name.includes('-')))].slice(0, 1000);
    const customElements = customElementNames.map((name) => {
      let constructorName = null;
      try { constructorName = window.customElements?.get(name)?.name || null; } catch {}
      return { name, defined: Boolean(constructorName), constructorName };
    });

    const structuredData = [];
    let structuredDataCharacters = 0;
    for (const script of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 100)) {
      const source = script.textContent || '';
      if (structuredDataCharacters + source.length > 1_000_000) {
        structuredData.push({ omitted: true, reason: 'Structured-data character boundary reached.', characters: source.length });
        continue;
      }
      structuredDataCharacters += source.length;
      try {
        structuredData.push({ data: safeStructured(JSON.parse(source)), characters: source.length });
      } catch (error) {
        structuredData.push({ parseError: error?.message || String(error), text: sanitizePayloadText(source.slice(0, 20_000), 'application/ld+json'), characters: source.length });
      }
    }
    const metaValue = (predicate) => metaTags.filter(predicate).map((meta) => meta.content);
    const socialMetadata = {
      openGraph: metaTags.filter((meta) => (meta.property || '').toLowerCase().startsWith('og:')),
      twitterCards: metaTags.filter((meta) => (meta.name || meta.property || '').toLowerCase().startsWith('twitter:')),
      themeColors: metaTags.filter((meta) => (meta.name || '').toLowerCase() === 'theme-color'),
      descriptions: metaValue((meta) => ['description', 'application-name', 'author'].includes((meta.name || '').toLowerCase()))
    };
    const canonicalLinks = linkTags.filter((link) => (link.rel || '').split(/\s+/).includes('canonical'));
    const alternateLinks = linkTags.filter((link) => (link.rel || '').split(/\s+/).includes('alternate'));
    const resourceHints = linkTags.filter((link) => /(?:^|\s)(?:preload|modulepreload|prefetch|preconnect|dns-prefetch|prerender)(?:\s|$)/i.test(link.rel || ''));
    const icons = linkTags.filter((link) => /(?:^|\s)(?:icon|apple-touch-icon|mask-icon)(?:\s|$)/i.test(link.rel || ''));
    return {
      counts: {
        metaTags: document.querySelectorAll('meta').length,
        linkTags: document.querySelectorAll('link').length,
        scriptElements: document.scripts.length,
        images: document.images.length,
        media: document.querySelectorAll('audio,video').length,
        structuredDataBlocks: document.querySelectorAll('script[type="application/ld+json"]').length,
        customElements: customElementNames.length
      },
      metaTags,
      linkTags,
      scriptElements,
      imageAssets,
      mediaAssets,
      customElements,
      structuredData,
      socialMetadata,
      canonicalLinks,
      alternateLinks,
      resourceHints,
      icons,
      limits: { structuredDataCharacters: 1_000_000 }
    };
  }

  function collectNavigationIntelligence() {
    let navigationApi = null;
    try {
      navigationApi = window.navigation ? {
        currentEntry: window.navigation.currentEntry ? safeStructured({
          id: window.navigation.currentEntry.id,
          key: window.navigation.currentEntry.key,
          url: sanitizeUrl(window.navigation.currentEntry.url),
          index: window.navigation.currentEntry.index,
          sameDocument: window.navigation.currentEntry.sameDocument,
          state: window.navigation.currentEntry.getState?.()
        }) : null,
        entries: window.navigation.entries().slice(0, 1000).map((entry) => ({
          id: entry.id,
          key: entry.key,
          url: sanitizeUrl(entry.url),
          index: entry.index,
          sameDocument: entry.sameDocument
        })),
        canGoBack: window.navigation.canGoBack,
        canGoForward: window.navigation.canGoForward
      } : null;
    } catch (error) {
      navigationApi = { error: error?.message || String(error) };
    }
    return {
      history: {
        length: history.length,
        scrollRestoration: history.scrollRestoration,
        state: safeStructured(history.state)
      },
      navigationApi,
      legacyNavigationType: performance.navigation?.type ?? null,
      navigationTiming: performance.getEntriesByType('navigation').slice(0, 10).map((entry) => {
        const value = entry.toJSON ? entry.toJSON() : { name: entry.name, startTime: entry.startTime, duration: entry.duration };
        if (value.name) value.name = sanitizeUrl(value.name);
        return safeStructured(value);
      })
    };
  }

  function collectPolicyIntelligence() {
    const permissionsPolicy = document.permissionsPolicy || document.featurePolicy || null;
    let allowedFeatures = [];
    try { allowedFeatures = permissionsPolicy?.allowedFeatures?.() || permissionsPolicy?.features?.() || []; } catch {}
    return {
      referrerPolicy: document.referrerPolicy || null,
      contentSecurityPolicyMeta: [...document.querySelectorAll('meta[http-equiv]')]
        .filter((meta) => (meta.httpEquiv || '').toLowerCase() === 'content-security-policy')
        .map((meta) => redactString((meta.content || '').slice(0, 50_000), 'content-security-policy')),
      permissionsPolicy: permissionsPolicy ? {
        allowedFeatures: allowedFeatures.slice(0, 1000),
        featureAllowlist: allowedFeatures.slice(0, 1000).map((feature) => {
          try { return { feature, origins: (permissionsPolicy.getAllowlistForFeature?.(feature) || []).map((origin) => sanitizeUrl(origin)) }; }
          catch { return { feature, origins: [] }; }
        })
      } : null,
      crossOriginIsolation: {
        crossOriginIsolated: self.crossOriginIsolated,
        originAgentCluster: self.originAgentCluster ?? null
      },
      secureContext: self.isSecureContext
    };
  }

  function collectFrameworkBootstrapIntelligence() {
    const markerIds = ['__NEXT_DATA__', '__NUXT_DATA__', '__APOLLO_STATE__', '__remixContext', '__sveltekit'];
    const globals = ['__NEXT_DATA__', '__NUXT__', '__INITIAL_STATE__', '__APOLLO_STATE__', '__REMIX_CONTEXT', '__reactRouterContext', '__webpack_require__', 'webpackChunk_N_E'];
    return {
      domMarkers: markerIds.map((id) => {
        const element = document.getElementById(id);
        return element ? { id, tag: element.localName, type: element.getAttribute('type'), characters: (element.textContent || '').length } : null;
      }).filter(Boolean),
      globalMarkers: globals.filter((name) => name in window).map((name) => ({ name, type: typeof window[name] })),
      rootMarkers: [...document.querySelectorAll('[data-reactroot],[data-reactid],[data-v-app],[data-server-rendered],[ng-version],[data-svelte-h],[data-astro-cid],[data-remix-run]')]
        .slice(0, 1000).map((element) => ({ path: elementPath(element), tag: element.localName, attributes: sanitizeAttributes(element) })),
      routeManifestScripts: [...document.scripts].filter((script) => /(?:route|build|asset|manifest|webpack|next|nuxt|remix)/i.test(script.src || script.id || script.type || ''))
        .slice(0, 1000).map((script) => ({ id: script.id || null, src: sanitizeUrl(script.src || ''), type: script.type || null, characters: script.src ? 0 : (script.textContent || '').length }))
    };
  }

  function collectPerformanceIntelligence() {
    const collectTimelineEntries = (type, limit) => {
      try {
        return performance.getEntriesByType(type).slice(0, limit).map((entry) => {
          const value = entry.toJSON ? entry.toJSON() : { name: entry.name, entryType: entry.entryType, startTime: entry.startTime, duration: entry.duration };
          if (value?.name && /^(?:https?:|file:)/i.test(value.name)) value.name = sanitizeUrl(value.name);
          else if (value?.name) value.name = redactString(String(value.name).slice(0, 2000), 'performance-entry-name');
          return safeStructured(value);
        });
      } catch { return []; }
    };
    const observed = safeStructured(globalThis.__LET_ME_SEE_CODE_INSTRUMENTATION__?.performance || {
      collection: 'PerformanceObserver unavailable',
      supportedEntryTypes: [...(globalThis.PerformanceObserver?.supportedEntryTypes || [])],
      observedTypes: [],
      unsupportedTypes: ['longtask', 'layout-shift', 'largest-contentful-paint', 'event'],
      droppedByType: {},
      entries: { longtask: [], 'layout-shift': [], 'largest-contentful-paint': [], event: [] }
    });
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return {
      timeOrigin: performance.timeOrigin,
      now: performance.now(),
      lifecycle: { visibilityState: document.visibilityState, wasDiscarded: document.wasDiscarded || false, prerendering: document.prerendering || false },
      connection: connection ? { effectiveType: connection.effectiveType, type: connection.type || null, downlink: connection.downlink, rtt: connection.rtt, saveData: connection.saveData } : null,
      memory: performance.memory ? { jsHeapSizeLimit: performance.memory.jsHeapSizeLimit, totalJSHeapSize: performance.memory.totalJSHeapSize, usedJSHeapSize: performance.memory.usedJSHeapSize } : null,
      collectionPolicy: {
        timelineApi: ['navigation', 'paint', 'mark', 'measure'],
        bufferedObserverApi: ['longtask', 'layout-shift', 'largest-contentful-paint', 'event'],
        deprecatedEntryTypeQueriesUsed: false
      },
      navigation: collectTimelineEntries('navigation', 10),
      paint: collectTimelineEntries('paint', 100),
      marks: collectTimelineEntries('mark', 2000),
      measures: collectTimelineEntries('measure', 2000),
      longTasks: observed.entries?.longtask || [],
      layoutShifts: observed.entries?.['layout-shift'] || [],
      largestContentfulPaint: observed.entries?.['largest-contentful-paint'] || [],
      events: observed.entries?.event || [],
      observer: {
        supportedEntryTypes: observed.supportedEntryTypes || [],
        observedTypes: observed.observedTypes || [],
        unsupportedTypes: observed.unsupportedTypes || [],
        droppedByType: observed.droppedByType || {}
      }
    };
  }

  async function collectApplicationState() {
    const result = { forensicMode: FORENSIC_MODE, indexedDB: [], cacheStorage: [], serviceWorkers: [] };
    let capturedAppBytes = 0;

    try {
      const databases = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
      for (const databaseInfo of databases) {
        if (!databaseInfo.name) continue;
        const database = await new Promise((resolve, reject) => {
          const request = indexedDB.open(databaseInfo.name);
          const timeout = setTimeout(() => reject(new Error('Timed out opening IndexedDB metadata.')), 3000);
          request.onsuccess = () => { clearTimeout(timeout); resolve(request.result); };
          request.onerror = () => { clearTimeout(timeout); reject(request.error || new Error('IndexedDB open failed.')); };
          request.onblocked = () => { clearTimeout(timeout); reject(new Error('IndexedDB open was blocked.')); };
        });
        const stores = [];
        for (const storeName of database.objectStoreNames) {
          try {
            const transaction = database.transaction(storeName, 'readonly');
            const store = transaction.objectStore(storeName);
            const count = await new Promise((resolve) => {
              const request = store.count();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => resolve(null);
            });
            const storeResult = {
              name: storeName,
              keyPath: store.keyPath,
              autoIncrement: store.autoIncrement,
              count,
              indexes: [...store.indexNames].map((indexName) => {
                const index = store.index(indexName);
                return { name: indexName, keyPath: index.keyPath, multiEntry: index.multiEntry, unique: index.unique };
              })
            };

            if (FORENSIC_MODE && INCLUDE_APPLICATION_CONTENTS && capturedAppBytes < MAX_APP_BYTES) {
              storeResult.records = await new Promise((resolve) => {
                const records = [];
                let transaction;
                try { transaction = database.transaction(storeName, 'readonly'); }
                catch (error) { resolve([{ error: error?.message || String(error) }]); return; }
                const cursorRequest = transaction.objectStore(storeName).openCursor();
                cursorRequest.onsuccess = () => {
                  const cursor = cursorRequest.result;
                  if (!cursor || records.length >= MAX_APP_RECORDS || capturedAppBytes >= MAX_APP_BYTES) {
                    resolve(records);
                    return;
                  }
                  const record = { key: safeStructured(cursor.key), primaryKey: safeStructured(cursor.primaryKey), value: safeStructured(cursor.value) };
                  const estimated = JSON.stringify(record).length;
                  if (capturedAppBytes + estimated <= MAX_APP_BYTES) {
                    records.push(record);
                    capturedAppBytes += estimated;
                    cursor.continue();
                  } else resolve(records);
                };
                cursorRequest.onerror = () => resolve([{ error: cursorRequest.error?.message || 'Cursor read failed.' }]);
              });
              storeResult.recordsTruncated = storeResult.records.length < count ? true : false;
            }
            stores.push(storeResult);
          } catch (error) {
            stores.push({ name: storeName, error: error?.message || String(error) });
          }
        }
        result.indexedDB.push({ name: databaseInfo.name, version: database.version, stores });
        database.close();
      }
    } catch (error) {
      result.indexedDBError = error?.message || String(error);
    }

    try {
      if ('caches' in window) {
        for (const cacheName of await caches.keys()) {
          const cache = await caches.open(cacheName);
          const requests = await cache.keys();
          const entries = [];
          // Read cache entries sequentially. Loading every cached response with
          // Promise.all can transiently allocate the whole cache and crash the
          // renderer even though the final archive has a byte limit.
          for (let requestIndex = 0; requestIndex < requests.length; requestIndex += 1) {
            const request = requests[requestIndex];
            // Same-origin Cache Storage contents and response metadata are
            // authoritative on the Max entry page. Later crawl pages retain the
            // request inventory without repeating one cache lookup per entry.
            const response = INCLUDE_APPLICATION_CONTENTS ? await cache.match(request) : null;
            const entry = {
              method: request.method,
              url: sanitizeUrl(request.url),
              requestHeaders: [...request.headers].map(([name, value]) => ({ name, value: SECRET_KEY.test(name) ? '[REDACTED]' : redactString(value, name) })),
              response: response ? {
                status: response.status,
                statusText: response.statusText,
                type: response.type,
                url: sanitizeUrl(response.url),
                headers: [...response.headers].map(([name, value]) => ({ name, value: SECRET_KEY.test(name) ? '[REDACTED]' : redactString(value, name) }))
              } : (INCLUDE_APPLICATION_CONTENTS ? null : { metadataOmitted: 'Captured on the Max entry page; request inventory retained here.' })
            };
            if (FORENSIC_MODE && INCLUDE_APPLICATION_CONTENTS && response && capturedAppBytes < MAX_APP_BYTES) {
              try {
                const remainingBytes = MAX_APP_BYTES - capturedAppBytes;
                const captured = await readResponseBytesBounded(response.clone(), remainingBytes);
                if (captured.bytes) {
                  const bytes = captured.bytes;
                  const mimeType = response.headers.get('content-type') || '';
                  if (/text|json|javascript|xml|svg|css|html|graphql/i.test(mimeType)) {
                    entry.response.body = sanitizePayloadText(new TextDecoder().decode(bytes), mimeType);
                    entry.response.bodyEncoding = 'utf8';
                  } else {
                    entry.response.body = bytesToBase64(bytes);
                    entry.response.bodyEncoding = 'base64';
                  }
                  entry.response.bodyByteLength = bytes.byteLength;
                  capturedAppBytes += bytes.byteLength;
                } else {
                  entry.response.bodyOmitted = captured.omitted || 'Application-data byte limit reached.';
                }
              } catch (error) {
                entry.response.bodyOmitted = error?.message || String(error);
              }
            } else if (FORENSIC_MODE && response) {
              entry.response.bodyOmitted = INCLUDE_APPLICATION_CONTENTS ? 'Application-data byte limit reached.' : 'Content bytes captured once on the Max entry page; metadata retained for this page.';
            }
            entries.push(entry);
            if (requestIndex % 25 === 24) await new Promise((resolve) => { setTimeout(resolve, 0); });
          }
          result.cacheStorage.push({
            name: cacheName,
            entries
          });
        }
      }
    } catch (error) {
      result.cacheStorageError = error?.message || String(error);
    }

    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        result.serviceWorkers = registrations.map((registration) => ({
          scope: sanitizeUrl(registration.scope),
          updateViaCache: registration.updateViaCache,
          active: registration.active ? { scriptURL: sanitizeUrl(registration.active.scriptURL), state: registration.active.state } : null,
          waiting: registration.waiting ? { scriptURL: sanitizeUrl(registration.waiting.scriptURL), state: registration.waiting.state } : null,
          installing: registration.installing ? { scriptURL: sanitizeUrl(registration.installing.scriptURL), state: registration.installing.state } : null
        }));
      }
    } catch (error) {
      result.serviceWorkersError = error?.message || String(error);
    }

    result.capturedAppBytes = capturedAppBytes;
    result.contentsIncluded = INCLUDE_APPLICATION_CONTENTS;
    result.limits = { maxRecordsPerStore: MAX_APP_RECORDS, maxBytesPerFrame: MAX_APP_BYTES };
    return result;
  }

  function collectDesignTokens(elements, computedStyles) {
    const colors = new Map();
    const fonts = new Map();
    const radii = new Map();
    const shadows = new Map();
    const increment = (map, value) => {
      if (!value || value === 'none' || value === 'normal' || value === '0px') return;
      map.set(value, (map.get(value) || 0) + 1);
    };
    for (const element of elements) {
      const style = computedStyles[element.computedStyleId];
      increment(colors, style.color);
      increment(colors, style['background-color']);
      increment(colors, style['border-top-color']);
      increment(fonts, `${style['font-family']} | ${style['font-size']} | ${style['font-weight']} | ${style['line-height']}`);
      increment(radii, style['border-radius']);
      increment(shadows, style['box-shadow']);
    }
    const ranked = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
    return { colors: ranked(colors), typography: ranked(fonts), borderRadii: ranked(radii), shadows: ranked(shadows) };
  }

  const extractorStartedAt = performance.now();
  const extractorTimingsMs = {};
  let stageStartedAt = extractorStartedAt;
  const finishStage = (name) => {
    const now = performance.now();
    extractorTimingsMs[name] = Math.round((now - stageStartedAt) * 10) / 10;
    stageStartedAt = now;
  };

  if (EXTRACTOR_PHASE === 'elements') {
    const elementData = collectElements({
      start: ELEMENT_CHUNK_START,
      limit: ELEMENT_CHUNK_LIMIT,
      includeShadowMetadata: true
    });
    return {
      extractorPhase: 'elements',
      elements: elementData.records,
      computedStyles: elementData.computedStyles,
      openShadowRoots: elementData.shadowRoots,
      designTokens: collectDesignTokens(elementData.records, elementData.computedStyles),
      totalElements: elementData.totalElements,
      rangeStart: elementData.rangeStart,
      rangeEnd: elementData.rangeEnd,
      complete: elementData.rangeEnd >= elementData.totalElements
    };
  }

  if (EXTRACTOR_PHASE === 'document') {
    try { delete globalThis.__LET_ME_SEE_CODE_ELEMENT_SNAPSHOT__; } catch { globalThis.__LET_ME_SEE_CODE_ELEMENT_SNAPSHOT__ = null; }
  }

  const elementData = EXTRACTOR_PHASE === 'document'
    ? { records: [], computedStyles: [], shadowRoots: [], totalElements: queryAllOpenRoots('*').length }
    : collectElements();
  finishStage('elementsAndComputedStyles');
  const applicationState = await collectApplicationState();
  finishStage('applicationState');
  const securityMetadata = await collectSecurityMetadata();
  finishStage('securityMetadata');
  const links = queryAllOpenRoots('a[href], area[href]').map((link) => ({ text: link.textContent.trim(), href: sanitizeUrl(link.href), rel: link.rel, target: link.target }));
  const headings = queryAllOpenRoots('h1,h2,h3,h4,h5,h6').map((heading) => ({ level: Number(heading.localName.slice(1)), text: heading.textContent.trim(), path: elementPath(heading) }));
  finishStage('documentStructure');
  const renderedHtml = sanitizeHtml();
  finishStage('renderedHtml');
  const styleSheets = collectStyleSheets();
  const cssIntelligence = collectCssIntelligence(styleSheets);
  const formState = collectFormState();
  const mediaState = collectMediaState();
  const animationState = collectAnimationState();
  const canvasState = collectCanvasState();
  const resources = collectResources();
  const documentIntelligence = collectDocumentIntelligence();
  const performanceIntelligence = collectPerformanceIntelligence();
  const navigationIntelligence = collectNavigationIntelligence();
  const policyIntelligence = collectPolicyIntelligence();
  const frameworkBootstrapIntelligence = collectFrameworkBootstrapIntelligence();
  const hardwareProfile = collectHardwareProfile();
  const designTokens = collectDesignTokens(elementData.records, elementData.computedStyles);
  finishStage('remainingPageState');
  extractorTimingsMs.total = Math.round((performance.now() - extractorStartedAt) * 10) / 10;

  return {
    meta: collectMeta(),
    renderedHtml,
    elements: elementData.records,
    computedStyles: elementData.computedStyles,
    openShadowRoots: elementData.shadowRoots,
    styleSheets,
    cssIntelligence,
    formState,
    mediaState,
    animationState,
    canvasState,
    storage: { localStorage: collectStorage(localStorage), sessionStorage: collectStorage(sessionStorage) },
    applicationState,
    securityMetadata,
    hardwareProfile,
    resources,
    documentIntelligence,
    performanceIntelligence,
    navigationIntelligence,
    policyIntelligence,
    frameworkBootstrapIntelligence,
    documentStructure: { headings, links },
    designTokens,
    extractorDiagnostics: {
      timingsMs: extractorTimingsMs,
      elementCount: elementData.records.length,
      uniqueComputedStyles: elementData.computedStyles.length
    }
  };
})();
