(async () => {
  const fixture = document.querySelector('#fixture');
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 6000; index += 1) {
    const element = document.createElement(index % 17 === 0 ? 'button' : 'div');
    element.className = `fixture-item fixture-${index % 31}`;
    element.dataset.index = String(index);
    element.textContent = `Renderer-safe evidence node ${index}`;
    element.style.setProperty('--fixture-tone', String(index % 12));
    if (index % 17 === 0) element.setAttribute('aria-controls', `panel-${index}`);
    fragment.append(element);
  }
  fixture.append(fragment);
  const canvas = document.createElement('canvas');
  canvas.width = 2400;
  canvas.height = 1800;
  fixture.append(canvas);

  const source = await (await fetch('../page_extractor.js')).text();
  const run = async (options) => {
    globalThis.__PAGE_MIRROR_OPTIONS__ = options;
    return await (0, eval)(source);
  };
  let start = 0;
  let captured = 0;
  let chunks = 0;
  let total = Number.POSITIVE_INFINITY;
  while (start < total) {
    const result = await run({ extractorPhase: 'elements', elementChunkStart: start, elementChunkLimit: 750, maxCanvasSnapshotPixels: 4_000_000 });
    total = result.totalElements;
    captured += result.elements.length;
    chunks += 1;
    start += 750;
  }
  const documentResult = await run({ extractorPhase: 'document', includeApplicationContents: false, maxCanvasSnapshotPixels: 4_000_000, maxCanvasSnapshotCharacters: 12_000_000 });
  const summary = {
    ok: captured === total && chunks > 1 && documentResult.renderedHtml.includes('Renderer-safe evidence node 5999'),
    captured,
    total,
    chunks,
    documentPhaseElementRecords: documentResult.elements.length,
    oversizedCanvasSkipped: documentResult.canvasState.some((entry) => /renderer-safety boundary/.test(entry.error || ''))
  };
  document.querySelector('#result').textContent = JSON.stringify(summary, null, 2);
  document.documentElement.dataset.testStatus = summary.ok && summary.oversizedCanvasSkipped ? 'passed' : 'failed';
})().catch((error) => {
  document.querySelector('#result').textContent = error?.stack || String(error);
  document.documentElement.dataset.testStatus = 'failed';
});
