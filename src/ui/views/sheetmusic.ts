import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { formatCents, uid } from '../../core/format';
import { hitStroke, simplify, stepHalfTurn, type PageView, type Stroke } from '../../core/ink';
import { noteName, prettyName } from '../../core/notes';
import { db, type ScoreEntry } from '../../store/db';
import { getSettings, updateSettings } from '../../store/settings';
import { iconButton, segmented, toast } from '../components';
import { errorBox, h } from '../dom';
import { icon, type IconName } from '../icons';
import { createTracker, metronome } from '../shared';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type PdfDoc = Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;
type Layout = 'single' | 'two' | 'half';
type Tool = 'pen' | 'highlight' | 'eraser';

const PEN_COLORS = ['#111418', '#d6404b', '#2f76e0', '#0f9f68'];
const HIGHLIGHT_COLOR = '#ffd166';

async function makeThumb(data: Uint8Array): Promise<{ thumb: string; pageCount: number }> {
  const task = pdfjs.getDocument({ data });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 360 / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
    return { thumb: canvas.toDataURL('image/jpeg', 0.72), pageCount: doc.numPages };
  } finally {
    void task.destroy();
  }
}

export function mountSheetMusic(root: HTMLElement) {
  let doc: PdfDoc | null = null;
  let loadingTask: ReturnType<typeof pdfjs.getDocument> | null = null;
  let score: ScoreEntry | null = null;
  let view: PageView = { kind: 'single', page: 1 };
  let layout: Layout = 'single';
  let night = false;
  let annotating = false;
  let tool: Tool = 'pen';
  let penColor = PEN_COLORS[0];
  let renderToken = 0;
  const pageCache = new Map<string, HTMLCanvasElement>();
  const ink = new Map<number, Stroke[]>();
  const undoStack: { page: number; strokes: Stroke[] }[] = [];
  const tracker = createTracker();

  /* ---------- Library ---------- */

  const errorSlot = h('div');
  const grid = h('div', { class: 'score-grid' });
  const fileInput = h('input', {
    type: 'file',
    accept: 'application/pdf',
    multiple: true,
    class: 'visually-hidden',
    id: 'score-file',
    onchange: (e: Event) => void importFiles((e.target as HTMLInputElement).files),
  });
  const library = h(
    'div',
    { class: 'library' },
    h(
      'label',
      { class: 'drop-zone', for: 'score-file' },
      icon('upload', 26),
      h('b', null, 'Import sheet music'),
      h('span', null, 'Drop PDFs here or click to choose. Files stay on this device.'),
    ),
    fileInput,
    errorSlot,
    grid,
  );
  library.addEventListener('dragover', (e) => {
    e.preventDefault();
    library.classList.add('dragging');
  });
  library.addEventListener('dragleave', () => library.classList.remove('dragging'));
  library.addEventListener('drop', (e) => {
    e.preventDefault();
    library.classList.remove('dragging');
    void importFiles(e.dataTransfer?.files ?? null);
  });

  async function importFiles(files: FileList | null) {
    if (!files) return;
    errorSlot.replaceChildren();
    let added = 0;
    for (const file of Array.from(files)) {
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        errorSlot.append(errorBox(`${file.name} is not a PDF.`));
        continue;
      }
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        let meta: { thumb?: string; pageCount?: number } = {};
        try {
          meta = await makeThumb(data);
        } catch {
          // Still import; the thumbnail is optional.
        }
        await db.put('scores', { id: uid(), name: file.name.replace(/\.pdf$/i, ''), added: Date.now(), lastPage: 1, blob: file, ...meta });
        added++;
      } catch (err) {
        errorSlot.append(errorBox(`Could not save ${file.name}: ${(err as Error).message}`));
      }
    }
    fileInput.value = '';
    if (added) toast(`Imported ${added} score${added > 1 ? 's' : ''}`);
    await renderLibrary();
  }

  async function renderLibrary() {
    let scores: ScoreEntry[];
    try {
      scores = await db.list('scores');
    } catch (err) {
      grid.replaceChildren(errorBox((err as Error).message));
      return;
    }
    scores.sort((a, b) => a.name.localeCompare(b.name));
    grid.replaceChildren(
      ...scores.map((s) =>
        h(
          'article',
          { class: 'score-card' },
          h(
            'button',
            { class: 'score-open', onclick: () => void openScore(s), 'aria-label': `Open ${s.name}` },
            s.thumb ? h('img', { src: s.thumb, alt: '', loading: 'lazy' }) : h('span', { class: 'score-thumb-empty' }, icon('sheet', 30)),
          ),
          h(
            'div',
            { class: 'score-meta' },
            h('b', { title: s.name }, s.name),
            h('span', null, `${s.pageCount ? `Page ${s.lastPage} of ${s.pageCount}` : `Page ${s.lastPage}`}${s.bpm ? ` · ${s.bpm} BPM` : ''}`),
          ),
          iconButton('trash', `Remove ${s.name}`, async () => {
            if (!confirm(`Remove "${s.name}" and its annotations from this device?`)) return;
            await db.delete('scores', s.id);
            await db.deleteAnnotationsFor(s.id).catch(() => undefined);
            await renderLibrary();
          }, 'danger score-delete'),
        ),
      ),
    );
    if (!scores.length) grid.append(h('p', { class: 'muted center small' }, 'Your library is empty.'));
  }

  /* ---------- Reader ---------- */

  const pagesEl = h('div', { class: 'pages' });
  const pageLabel = h('span', { class: 'page-label' });
  const titleEl = h('strong', { class: 'score-title' });
  const tunerReadout = h('span', { class: 'mini-tuner' });
  const clickBtn = h(
    'button',
    {
      class: 'tool-btn',
      title: 'Metronome (remembers the tempo for this piece)',
      onclick: () => {
        const starting = !metronome.playing;
        metronome.toggle();
        if (starting && score) {
          score.bpm = getSettings().metronome.bpm;
          void db.put('scores', score);
        }
      },
    },
    icon('metronome', 18),
    h('span', { class: 'mini-bpm' }),
  );
  const tunerBtn = h('button', { class: 'tool-btn', onclick: () => void toggleTuner(), title: 'Tuner' }, icon('tuner', 18), tunerReadout);
  const nightBtn = h('button', { class: 'tool-btn', title: 'Night mode', 'aria-pressed': 'false', onclick: () => { night = !night; nightBtn.setAttribute('aria-pressed', String(night)); viewerEl.classList.toggle('night', night); } }, icon('moon', 18));
  const annotateBtn = h('button', { class: 'tool-btn', title: 'Annotate', 'aria-pressed': 'false', onclick: () => setAnnotating(!annotating) }, icon('pen', 18));
  const layoutSeg = segmented<Layout>(
    [
      { value: 'single', label: 'Page', icon: 'page' },
      { value: 'two', label: 'Two', icon: 'pages' },
      { value: 'half', label: 'Half turn', icon: 'half' },
    ],
    layout,
    (v) => {
      layout = v;
      if (view.kind === 'half') view = { kind: 'single', page: view.bottom };
      void renderPages();
    },
    'Page layout',
  );

  const toolBtn = (t: Tool, name: IconName, label: string) =>
    h('button', { class: 'tool-btn', 'data-tool': t, title: label, 'aria-label': label, onclick: () => { tool = t; renderInkBar(); } }, icon(name, 18));
  const colorBtns = PEN_COLORS.map((c) => h('button', { class: 'swatch', style: `--swatch:${c}`, 'aria-label': `Pen colour ${c}`, onclick: () => { penColor = c; tool = 'pen'; renderInkBar(); } }));
  const inkBar = h(
    'div',
    { class: 'ink-bar', hidden: true },
    toolBtn('pen', 'pen', 'Pen'),
    ...colorBtns,
    h('span', { class: 'ink-sep' }),
    toolBtn('highlight', 'highlighter', 'Highlighter'),
    toolBtn('eraser', 'eraser', 'Eraser'),
    h('span', { class: 'ink-sep' }),
    iconButton('undo', 'Undo', undo, 'tool-btn plain'),
    h('button', { class: 'chip ghost', onclick: clearPage }, 'Clear page'),
    h('button', { class: 'chip on', onclick: () => setAnnotating(false) }, 'Done'),
  );

  function renderInkBar() {
    inkBar.querySelectorAll<HTMLElement>('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
    colorBtns.forEach((b, i) => b.classList.toggle('on', tool === 'pen' && PEN_COLORS[i] === penColor));
    viewerEl.dataset.tool = tool;
  }

  function setAnnotating(on: boolean) {
    annotating = on;
    if (on && view.kind === 'half') view = { kind: 'single', page: view.bottom };
    annotateBtn.setAttribute('aria-pressed', String(on));
    inkBar.hidden = !on;
    viewerEl.classList.toggle('annotating', on);
    renderInkBar();
    void renderPages();
  }

  const viewerEl = h(
    'div',
    { class: 'viewer', hidden: true },
    h(
      'div',
      { class: 'viewer-bar' },
      h('button', { class: 'tool-btn', onclick: closeScore, 'aria-label': 'Back to library', title: 'Library' }, icon('chevronLeft', 18), h('span', null, 'Library')),
      titleEl,
      h('div', { class: 'viewer-tools' }, clickBtn, tunerBtn, nightBtn, annotateBtn, layoutSeg),
      h(
        'div',
        { class: 'viewer-nav' },
        h('button', { class: 'tool-btn', onclick: () => go(-1), 'aria-label': 'Previous page' }, icon('chevronLeft', 18)),
        pageLabel,
        h('button', { class: 'tool-btn', onclick: () => go(1), 'aria-label': 'Next page' }, icon('chevronRight', 18)),
        // iPhone Safari only allows full screen for video, so the button is left out where it would do nothing.
        document.fullscreenEnabled
          ? h('button', { class: 'tool-btn', title: 'Full screen', 'aria-label': 'Full screen', onclick: () => (document.fullscreenElement ? void document.exitFullscreen() : void viewerEl.requestFullscreen?.()) }, icon('fullscreen', 18))
          : null,
      ),
    ),
    inkBar,
    pagesEl,
    h('p', { class: 'hint-line' }, 'Tap the right or left side to turn. Arrow keys, Page Up/Down, space and Bluetooth page-turner pedals work too.'),
  );

  async function openScore(s: ScoreEntry) {
    errorSlot.replaceChildren();
    try {
      const data = new Uint8Array(await s.blob.arrayBuffer());
      void loadingTask?.destroy();
      loadingTask = pdfjs.getDocument({ data });
      doc = await loadingTask.promise;
    } catch (err) {
      errorSlot.append(errorBox(`Could not open this PDF: ${(err as Error).message}`));
      return;
    }
    score = s;
    pageCache.clear();
    ink.clear();
    undoStack.length = 0;
    try {
      const all = await db.list('annotations');
      all.filter((a) => a.scoreId === s.id).forEach((a) => ink.set(a.page, a.strokes));
    } catch {
      // Annotations are optional.
    }
    if (!s.pageCount || !s.thumb) {
      s.pageCount = doc.numPages;
      void db.put('scores', s);
    }
    view = { kind: 'single', page: Math.min(Math.max(1, s.lastPage), doc.numPages) };
    titleEl.textContent = s.name;
    if (s.bpm && s.bpm !== getSettings().metronome.bpm) {
      updateSettings((st) => ({ metronome: { ...st.metronome, bpm: s.bpm! } }));
      toast(`Metronome set to ${s.bpm} BPM, the tempo you used with this piece`);
    }
    library.hidden = true;
    viewerEl.hidden = false;
    await renderPages();
  }

  function closeScore() {
    void loadingTask?.destroy();
    loadingTask = null;
    doc = null;
    score = null;
    setAnnotating(false);
    viewerEl.hidden = true;
    library.hidden = false;
    if (document.fullscreenElement) void document.exitFullscreen();
    void renderLibrary();
  }

  function currentPage(): number {
    return view.kind === 'single' ? view.page : view.bottom;
  }

  function go(direction: 1 | -1) {
    if (!doc) return;
    const count = doc.numPages;
    if (layout === 'half' && !annotating) {
      view = stepHalfTurn(view, direction, count);
    } else {
      const step = layout === 'two' ? 2 : 1;
      const next = Math.min(Math.max(1, currentPage() + direction * step), count);
      if (next === currentPage()) return;
      view = { kind: 'single', page: next };
    }
    void renderPages();
    if (score && view.kind === 'single') {
      score.lastPage = view.page;
      void db.put('scores', score);
    }
  }

  async function renderPage(p: number, fitW: number, fitH: number): Promise<HTMLCanvasElement> {
    const key = `${p}|${Math.round(fitW)}|${Math.round(fitH)}`;
    const hit = pageCache.get(key);
    if (hit) return hit;
    const page = await doc!.getPage(p);
    const base = page.getViewport({ scale: 1 });
    let scale = Math.min(fitW / base.width, fitH / base.height);
    // A hidden or not-yet-laid-out window reports zero size; fall back to natural size.
    if (!Number.isFinite(scale) || scale <= 0.05) scale = 1;
    const dpr = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: scale * dpr });
    const canvas = document.createElement('canvas');
    canvas.className = 'page';
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${viewport.width / dpr}px`;
    canvas.style.height = `${viewport.height / dpr}px`;
    await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
    pageCache.set(key, canvas);
    return canvas;
  }

  async function renderPages() {
    if (!doc) return;
    const token = ++renderToken;
    const count = doc.numPages;
    const available = pagesEl.clientWidth || window.innerWidth - 32;
    const maxH = document.fullscreenElement ? window.innerHeight - 70 : Math.max(420, window.innerHeight - 200);

    if (view.kind === 'half') {
      pageLabel.textContent = `${view.bottom}½ / ${count}`;
      const [top, bottom] = await Promise.all([renderPage(view.top, available, maxH), renderPage(view.bottom, available, maxH)]);
      if (token !== renderToken) return;
      const c = document.createElement('canvas');
      c.className = 'page composite';
      c.width = Math.max(top.width, bottom.width);
      c.height = bottom.height;
      c.style.width = bottom.style.width;
      c.style.height = bottom.style.height;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      const half = Math.floor(c.height / 2);
      ctx.drawImage(top, 0, 0, top.width, top.height / 2, 0, 0, top.width, half);
      ctx.drawImage(bottom, 0, bottom.height / 2, bottom.width, bottom.height / 2, 0, half, bottom.width, c.height - half);
      ctx.fillStyle = 'rgba(106, 90, 224, 0.55)';
      ctx.fillRect(0, half - 2, c.width, 4);
      pagesEl.replaceChildren(h('div', { class: 'page-wrap' }, c, h('span', { class: 'half-badge' }, `top: page ${view.top}`)));
      return;
    }

    const pages = layout === 'two' && !annotating ? [view.page, view.page + 1].filter((p) => p <= count) : [view.page];
    pageLabel.textContent = pages.length === 2 ? `${pages[0]}-${pages[1]} / ${count}` : `${pages[0]} / ${count}`;
    const canvases = await Promise.all(pages.map((p) => renderPage(p, available / pages.length - 8, maxH)));
    if (token !== renderToken) return;
    pagesEl.replaceChildren(...canvases.map((c, i) => pageWrap(pages[i], c)));
  }

  function pageWrap(pageNum: number, canvas: HTMLCanvasElement): HTMLElement {
    const overlay = document.createElement('canvas');
    overlay.className = 'ink';
    overlay.width = canvas.width;
    overlay.height = canvas.height;
    overlay.style.width = canvas.style.width;
    overlay.style.height = canvas.style.height;
    drawInk(overlay, ink.get(pageNum) ?? []);
    if (annotating) attachInk(overlay, pageNum);
    return h('div', { class: 'page-wrap' }, canvas, overlay);
  }

  function drawInk(overlay: HTMLCanvasElement, strokes: Stroke[], live?: Stroke) {
    const ctx = overlay.getContext('2d')!;
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    const W = overlay.width;
    const H = overlay.height;
    for (const s of live ? [...strokes, live] : strokes) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width * W;
      if (s.tool === 'highlight') {
        ctx.globalAlpha = 0.38;
        ctx.globalCompositeOperation = 'multiply';
        ctx.lineCap = 'butt';
      }
      ctx.beginPath();
      s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)));
      if (s.points.length === 1) ctx.lineTo(s.points[0][0] * W + 0.1, s.points[0][1] * H);
      ctx.stroke();
      ctx.restore();
    }
  }

  function saveInk(pageNum: number) {
    if (!score) return;
    const strokes = ink.get(pageNum) ?? [];
    void db.put('annotations', { id: `${score.id}:${pageNum}`, scoreId: score.id, page: pageNum, strokes }).catch(() => toast('Could not save annotations'));
  }

  function attachInk(overlay: HTMLCanvasElement, pageNum: number) {
    let live: Stroke | null = null;
    const pos = (e: PointerEvent): [number, number] => {
      const r = overlay.getBoundingClientRect();
      return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
    };
    const erase = (p: [number, number]) => {
      const strokes = ink.get(pageNum) ?? [];
      const i = hitStroke(strokes, p, 0.012);
      if (i >= 0) {
        undoStack.push({ page: pageNum, strokes: strokes.slice() });
        strokes.splice(i, 1);
        ink.set(pageNum, strokes);
        drawInk(overlay, strokes);
        saveInk(pageNum);
      }
    };
    overlay.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try {
        overlay.setPointerCapture(e.pointerId);
      } catch {
        // Capture is optional.
      }
      if (tool === 'eraser') {
        erase(pos(e));
        live = { tool: 'pen', color: '', width: 0, points: [] };
        return;
      }
      live = tool === 'highlight'
        ? { tool: 'highlight', color: HIGHLIGHT_COLOR, width: 0.018, points: [pos(e)] }
        : { tool: 'pen', color: penColor, width: 0.0028, points: [pos(e)] };
    });
    overlay.addEventListener('pointermove', (e) => {
      if (!live) return;
      if (tool === 'eraser') return erase(pos(e));
      live.points.push(pos(e));
      drawInk(overlay, ink.get(pageNum) ?? [], live);
    });
    const end = () => {
      if (!live) return;
      if (tool !== 'eraser' && live.points.length) {
        const strokes = ink.get(pageNum) ?? [];
        undoStack.push({ page: pageNum, strokes: strokes.slice() });
        strokes.push({ ...live, points: simplify(live.points, 0.0015) });
        ink.set(pageNum, strokes);
        drawInk(overlay, strokes);
        saveInk(pageNum);
      }
      live = null;
    };
    overlay.addEventListener('pointerup', end);
    overlay.addEventListener('pointercancel', end);
  }

  function undo() {
    const last = undoStack.pop();
    if (!last) return toast('Nothing to undo');
    ink.set(last.page, last.strokes);
    saveInk(last.page);
    void renderPages();
  }

  function clearPage() {
    const p = currentPage();
    if (!(ink.get(p) ?? []).length) return;
    undoStack.push({ page: p, strokes: (ink.get(p) ?? []).slice() });
    ink.set(p, []);
    saveInk(p);
    void renderPages();
  }

  pagesEl.addEventListener('click', (e) => {
    if (annotating) return;
    const rect = pagesEl.getBoundingClientRect();
    go(e.clientX - rect.left < rect.width / 2 ? -1 : 1);
  });

  /* ---------- Tuner and metronome in the toolbar ---------- */

  async function toggleTuner() {
    if (tracker.running) {
      tracker.stop();
      tunerReadout.textContent = '';
      tunerBtn.classList.remove('on');
      return;
    }
    try {
      await tracker.start();
      tunerBtn.classList.add('on');
    } catch (err) {
      toast((err as Error).message);
    }
  }

  const offFrame = tracker.onFrame((f) => {
    const s = getSettings();
    if (!f.note) {
      tunerReadout.textContent = '·';
      tunerReadout.className = 'mini-tuner';
      return;
    }
    tunerReadout.textContent = `${prettyName(noteName(f.note.midi, s.flats))} ${formatCents(f.note.cents)}`;
    tunerReadout.className = `mini-tuner ${Math.abs(f.note.cents) <= s.tolerance ? 'good' : f.note.cents > 0 ? 'sharp' : 'flat'}`;
  });

  const renderClick = () => {
    (clickBtn.querySelector('.mini-bpm') as HTMLElement).textContent = metronome.playing ? String(metronome.settings.bpm) : '';
    clickBtn.classList.toggle('on', metronome.playing);
  };
  const offState = metronome.onState(renderClick);
  renderClick();

  const onKey = (e: KeyboardEvent) => {
    if (viewerEl.hidden || e.target instanceof HTMLInputElement) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && annotating) {
      e.preventDefault();
      undo();
    } else if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) {
      e.preventDefault();
      go(1);
    } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) {
      e.preventDefault();
      go(-1);
    }
  };
  window.addEventListener('keydown', onKey);
  let resizeTimer = 0;
  const onResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      pageCache.clear();
      void renderPages();
    }, 150);
  };
  window.addEventListener('resize', onResize);
  document.addEventListener('fullscreenchange', onResize);

  root.append(h('section', { class: 'view sheetmusic' }, library, viewerEl));
  void renderLibrary();

  return () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('fullscreenchange', onResize);
    offFrame();
    offState();
    tracker.stop();
    void loadingTask?.destroy();
  };
}
