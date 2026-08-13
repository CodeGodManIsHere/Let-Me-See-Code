import { Zip, ZipDeflate, ZipPassThrough } from './vendor/fflate.js';

const captures = new Map();
const objectUrls = new Map();
let wabtPromise = null;

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function createStreamingCapture(captureId) {
  const outputChunks = [];
  const openFiles = new Map();
  let outputBytes = 0;
  let settle;
  let reject;
  const completion = new Promise((resolve, rejectPromise) => {
    settle = resolve;
    reject = rejectPromise;
  });
  // Prevent an abandoned session from producing an unhandled rejection. The
  // original promise still rejects for FINALIZE to report.
  completion.catch(() => {});

  const capture = {
    captureId,
    outputChunks,
    openFiles,
    outputBytes,
    completion,
    zip: null,
    finished: false,
    aborted: false,
    storageMode: 'memory',
    stagingDirectory: null,
    stagingFileName: null,
    stagingFileHandle: null,
    writer: null,
    pendingWriteBytes: 0,
    writeChain: Promise.resolve()
  };

  try {
    const root = await navigator.storage?.getDirectory?.();
    if (root) {
      const directory = await root.getDirectoryHandle('let-me-see-code-zip-staging', { create: true });
      const fileName = `${captureId}.zip.part`;
      await directory.removeEntry(fileName).catch(() => {});
      const fileHandle = await directory.getFileHandle(fileName, { create: true });
      capture.writer = await fileHandle.createWritable({ keepExistingData: false });
      capture.storageMode = 'opfs';
      capture.stagingDirectory = directory;
      capture.stagingFileName = fileName;
      capture.stagingFileHandle = fileHandle;
    }
  } catch {
    // OPFS is an optimization. Older or restricted contexts retain the
    // in-memory fallback so packaging still works.
  }

  capture.zip = new Zip((error, data, final) => {
    if (error) {
      reject(error);
      return;
    }
    if (data?.length) {
      // fflate may recycle callback buffers after the callback returns. Always
      // retain an owned copy before an asynchronous OPFS write or memory queue.
      const chunk = data.slice();
      if (capture.writer) {
        capture.pendingWriteBytes += chunk.byteLength;
        capture.writeChain = capture.writeChain.then(async () => {
          if (!capture.aborted) await capture.writer.write(chunk);
        }).finally(() => {
          capture.pendingWriteBytes = Math.max(0, capture.pendingWriteBytes - chunk.byteLength);
        });
      } else {
        outputChunks.push(chunk);
      }
      capture.outputBytes += data.length;
    }
    if (final) {
      capture.finished = true;
      settle();
    }
  });
  return capture;
}

async function discardCapture(capture) {
  if (!capture) return;
  capture.aborted = true;
  try { capture.zip?.terminate?.(); } catch {}
  capture.openFiles.clear();
  capture.outputChunks.length = 0;
  await capture.writeChain.catch(() => {});
  if (capture.writer) {
    try { await capture.writer.abort(); } catch {}
  }
  if (capture.stagingDirectory && capture.stagingFileName) {
    await capture.stagingDirectory.removeEntry(capture.stagingFileName).catch(() => {});
  }
}

async function handleMessage(message) {
  if (message.action === 'WASM_TO_WAT') {
    const bytes = base64ToBytes(message.base64 || '');
    if (bytes.byteLength > Math.max(1, Number(message.maxInputBytes) || 4 * 1024 * 1024)) {
      throw new Error('Wasm input exceeded the configured conversion boundary.');
    }
    if (!globalThis.WabtModule) throw new Error('Bundled WABT module did not initialize.');
    wabtPromise ||= globalThis.WabtModule();
    const wabt = await wabtPromise;
    let module = null;
    try {
      module = wabt.readWasm(bytes, { readDebugNames: true });
      module.generateNames();
      module.applyNames();
      const wat = module.toText({ foldExprs: false, inlineExport: false });
      const maximumCharacters = Math.max(1024, Number(message.maxOutputCharacters) || 16 * 1024 * 1024);
      if (wat.length > maximumCharacters) throw new Error(`Generated WAT exceeded ${maximumCharacters} characters.`);
      return { ok: true, wat, inputBytes: bytes.byteLength, outputCharacters: wat.length };
    } finally {
      try { module?.destroy?.(); } catch {}
    }
  }

  if (message.action === 'START') {
    if (captures.has(message.captureId)) throw new Error('ZIP streaming session already exists.');
    const capture = await createStreamingCapture(message.captureId);
    captures.set(message.captureId, capture);
    return { ok: true, storageMode: capture.storageMode };
  }

  if (message.action === 'FILE_CHUNK') {
    const capture = captures.get(message.captureId);
    if (!capture) throw new Error('ZIP staging session was not found.');
    let fileState = capture.openFiles.get(message.path);
    if (message.index === 0) {
      if (fileState) throw new Error(`Duplicate first chunk for ${message.path}.`);
      // Browser response bodies, screenshots, fonts, audio, Wasm and other
      // binary evidence are already compact byte streams. Storing them avoids
      // streamed-Deflate corruption and needless recompression.
      const stream = message.store === true
        ? new ZipPassThrough(message.path)
        : new ZipDeflate(message.path, { level: 6, mem: 8 });
      capture.zip.add(stream);
      fileState = { stream, nextIndex: 0, receivedChunks: 0, receivedBytes: 0 };
      capture.openFiles.set(message.path, fileState);
    }
    if (!fileState) throw new Error(`Missing first chunk for ${message.path}.`);
    if (message.index !== fileState.nextIndex) throw new Error(`Out-of-order ZIP chunk for ${message.path}: expected ${fileState.nextIndex}, received ${message.index}.`);
    const final = message.final === true || message.index === message.total - 1;
    const bytes = base64ToBytes(message.data);
    fileState.stream.push(bytes, final);
    fileState.nextIndex += 1;
    fileState.receivedChunks += 1;
    fileState.receivedBytes += bytes.byteLength;
    if (final) capture.openFiles.delete(message.path);
    if (capture.writer && capture.pendingWriteBytes > 16 * 1024 * 1024) await capture.writeChain;
    return { ok: true };
  }

  if (message.action === 'FINALIZE') {
    const capture = captures.get(message.captureId);
    if (!capture) throw new Error('ZIP staging session was not found.');
    // Runtime messaging acknowledges every FILE_CHUNK before the service worker
    // advances its staging queue. If a browser edge case loses only the final
    // boolean while retaining the acknowledged bytes, close that stream with an
    // empty final marker instead of discarding the entire capture. Sequence
    // validation above still rejects missing, duplicated, or reordered chunks.
    const recoveredFinalMarkers = [];
    for (const [path, fileState] of capture.openFiles) {
      fileState.stream.push(new Uint8Array(0), true);
      recoveredFinalMarkers.push({
        path,
        receivedChunks: fileState.receivedChunks,
        receivedBytes: fileState.receivedBytes,
        recovery: 'empty-final-marker-after-acknowledged-sequential-chunks'
      });
    }
    capture.openFiles.clear();
    if (recoveredFinalMarkers.length) {
      const diagnostic = new TextEncoder().encode(`${JSON.stringify({ recoveredFinalMarkers }, null, 2)}\n`);
      const diagnosticFile = new ZipDeflate('diagnostics/zip_final_marker_recovery.json', { level: 6, mem: 8 });
      capture.zip.add(diagnosticFile);
      diagnosticFile.push(diagnostic, true);
    }
    capture.zip.end();
    await capture.completion;
    await capture.writeChain;
    let blob;
    if (capture.writer) {
      await capture.writer.close();
      capture.writer = null;
      // OPFS preserves the temporary `.zip.part` file without a ZIP MIME type.
      // Chrome may then override the requested download suffix and save it as `.txt`.
      // Wrapping the completed File supplies the authoritative MIME type without
      // rebuilding the archive in memory.
      const stagedFile = await capture.stagingFileHandle.getFile();
      blob = new Blob([stagedFile], { type: 'application/zip' });
    } else {
      blob = new Blob(capture.outputChunks, { type: 'application/zip' });
    }
    const blobUrl = URL.createObjectURL(blob);
    objectUrls.set(blobUrl, {
      directory: capture.stagingDirectory,
      fileName: capture.stagingFileName
    });
    captures.delete(message.captureId);
    const byteLength = capture.outputBytes;
    capture.outputChunks.length = 0;
    return { ok: true, blobUrl, byteLength, storageMode: capture.storageMode, recoveredFinalMarkers };
  }

  if (message.action === 'ABORT') {
    const capture = captures.get(message.captureId);
    if (capture) {
      captures.delete(message.captureId);
      await discardCapture(capture);
    }
    return { ok: true };
  }

  if (message.action === 'REVOKE') {
    const staged = objectUrls.get(message.blobUrl);
    if (staged) {
      URL.revokeObjectURL(message.blobUrl);
      objectUrls.delete(message.blobUrl);
      if (staged.directory && staged.fileName) await staged.directory.removeEntry(staged.fileName).catch(() => {});
    }
    return { ok: true };
  }

  throw new Error(`Unknown offscreen action: ${message.action}`);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'offscreen') return undefined;
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});
