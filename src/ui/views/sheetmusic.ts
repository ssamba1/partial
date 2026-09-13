import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { uid } from '../../core/format';
import { formatCents } from '../../core/format';
import { noteName, prettyName } from '../../core/notes';
import { db, type ScoreEntry } from '../../store/db';
import { getSettings } from '../../store/settings';
import { errorBox, h } from '../dom';
import { createTracker, metronome } from '../shared';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

type PdfDoc = Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;

export function mountSheetMusic(root: HTMLElement) {
  let doc: PdfDoc | null = null;
  let loadingTask: ReturnType<typeof pdfjs.getDocument> | null = null;
  let score: ScoreEntry | null = null;
  let page = 1;
  let twoUp = false;
  let renderToken = 0;
  const tracker = createTracker();

  const libraryList = h('ul', { class: 'score-list' });
  const errorSlot = h('div');
  const fileInput = h('input', {
    type: 'file',
    accept: 'application/pdf',
    multiple: true,
    class: 'visually-hidden',
    id: 'score-file',
    onchange: (e: Event) => void importFiles((e.target as HTMLInputElement).files),
  });

  const pagesEl = h('div', { class: 'pages' });
  const pageLabel = h('span', { class: 'muted' });
  const titleEl = h('strong', { class: 'score-title' });
  const bpmEl = h('span', { class: 'mini-bpm' });
  const tunerEl = h('span', { class: 'mini-tuner' }, '');
  const clickBtn = h('button', { onclick: () => metronome.toggle() }, 'Metronome');
  const tunerBtn = h('button', { onclick: () => void toggleTuner() }, 'Tuner');
  const viewer = h(
    'div',
    { class: 'viewer', hidden: true },
    h(
      'div',
      { class: 'viewer-bar' },
      h('button', { onclick: closeScore, 'aria-label': 'Back to library' }, '← Library'),
      titleEl,
      h('div', { class: 'row tight' }, clickBtn, bpmEl, tunerBtn, tunerEl),
      h(
        'div',
        { class: 'row tight' },
        h('button', { onclick: () => go(-1), 'aria-label': 'Previous page' }, '‹'),
        pageLabel,
        h('button', { onclick: () => go(1), 'aria-label': 'Next page' }, '›'),
        h('button', { onclick: () => { twoUp = !twoUp; void renderPages(); }, title: 'One or two pages' }, '1|2'),
        h('button', { onclick: () => document.fullscreenElement ? void document.exitFullscreen() : void viewer.requestFullscreen?.(), title: 'Full screen' }, '⛶'),
      ),
    ),
    pagesEl,
    h('p', { class: 'muted small center' }, 'Turn pages with the arrow keys, Page Up/Down, space, or a Bluetooth page-turner pedal. Tap the left or right side of the page too.'),
  );

  const library = h(
    'div',
    { class: 'library' },
    h('p', { class: 'muted' }, 'Import PDF sheet music. Files stay on this device.'),
    h('label', { class: 'button primary', for: 'score-file' }, 'Import PDF'),
    fileInput,
    errorSlot,
    libraryList,
  );

  async function importFiles(files: FileList | null) {
    if (!files) return;
    errorSlot.replaceChildren();
    for (const file of Array.from(files)) {
      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        errorSlot.append(errorBox(`${file.name} is not a PDF.`));
        continue;
      }
      try {
        await db.put('scores', { id: uid(), name: file.name.replace(/\.pdf$/i, ''), added: Date.now(), lastPage: 1, blob: file });
      } catch (err) {
        errorSlot.append(errorBox(`Could not save ${file.name}: ${(err as Error).message}`));
      }
    }
    fileInput.value = '';
    await renderLibrary();
  }

  async function renderLibrary() {
    let scores: ScoreEntry[];
    try {
      scores = await db.list<ScoreEntry>('scores');
    } catch (err) {
      libraryList.replaceChildren(h('li', null, errorBox((err as Error).message)));
      return;
    }
    scores.sort((a, b) => a.name.localeCompare(b.name));
    libraryList.replaceChildren(
      ...(scores.length
        ? scores.map((s) =>
            h(
              'li',
              { class: 'score-item' },
              h('button', { class: 'link', onclick: () => void openScore(s) }, s.name),
              h('span', { class: 'muted small' }, `page ${s.lastPage}`),
              h(
                'button',
                {
                  class: 'icon danger',
                  'aria-label': `Delete ${s.name}`,
                  onclick: async () => {
                    if (!confirm(`Remove "${s.name}" from this device?`)) return;
                    await db.delete('scores', s.id);
                    await renderLibrary();
                  },
                },
                '✕',
              ),
            ),
          )
        : [h('li', { class: 'muted' }, 'No sheet music yet.')]),
    );
  }

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
    page = Math.min(Math.max(1, s.lastPage), doc.numPages);
    titleEl.textContent = s.name;
    library.hidden = true;
    viewer.hidden = false;
    await renderPages();
  }

  function closeScore() {
    void loadingTask?.destroy();
    loadingTask = null;
    doc = null;
    score = null;
    viewer.hidden = true;
    library.hidden = false;
    if (document.fullscreenElement) void document.exitFullscreen();
    void renderLibrary();
  }

  function go(delta: number) {
    if (!doc) return;
    const step = twoUp ? 2 : 1;
    const next = Math.min(Math.max(1, page + delta * step), doc.numPages);
    if (next === page) return;
    page = next;
    void renderPages();
    if (score) {
      score.lastPage = page;
      void db.put('scores', score);
    }
  }

  async function renderPages() {
    if (!doc) return;
    const token = ++renderToken;
    const count = twoUp ? Math.min(2, doc.numPages - page + 1) : 1;
    pageLabel.textContent = count === 2 ? `${page}-${page + 1} / ${doc.numPages}` : `${page} / ${doc.numPages}`;
    const available = pagesEl.clientWidth || window.innerWidth - 32;
    const maxHeight = (document.fullscreenElement ? window.innerHeight - 60 : window.innerHeight - 140);
    const canvases: HTMLCanvasElement[] = [];
    for (let i = 0; i < count; i++) {
      const p = await doc.getPage(page + i);
      if (token !== renderToken) return;
      const base = p.getViewport({ scale: 1 });
      let scale = Math.min((available / count - 8) / base.width, maxHeight / base.height);
      // A hidden or not-yet-laid-out window reports zero size; fall back to natural size.
      if (!Number.isFinite(scale) || scale <= 0.05) scale = 1;
      const dpr = window.devicePixelRatio || 1;
      const viewport = p.getViewport({ scale: scale * dpr });
      const canvas = h('canvas', { class: 'page' });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${viewport.width / dpr}px`;
      canvas.style.height = `${viewport.height / dpr}px`;
      await p.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
      if (token !== renderToken) return;
      canvases.push(canvas);
    }
    pagesEl.replaceChildren(...canvases);
  }

  pagesEl.addEventListener('click', (e) => {
    const rect = pagesEl.getBoundingClientRect();
    go(e.clientX - rect.left < rect.width / 2 ? -1 : 1);
  });

  async function toggleTuner() {
    if (tracker.running) {
      tracker.stop();
      tunerEl.textContent = '';
      tunerBtn.classList.remove('active');
      return;
    }
    try {
      await tracker.start();
      tunerBtn.classList.add('active');
    } catch (err) {
      tunerEl.textContent = (err as Error).message;
    }
  }

  const offFrame = tracker.onFrame((f) => {
    const s = getSettings();
    if (!f.note) {
      tunerEl.textContent = '·';
      tunerEl.className = 'mini-tuner';
      return;
    }
    tunerEl.textContent = `${prettyName(noteName(f.note.midi, s.flats))} ${formatCents(f.note.cents)}`;
    tunerEl.className = `mini-tuner ${Math.abs(f.note.cents) <= s.tolerance ? 'good' : 'off'}`;
  });

  const renderClick = () => {
    bpmEl.textContent = metronome.playing ? `${metronome.settings.bpm} BPM` : '';
    clickBtn.classList.toggle('active', metronome.playing);
  };
  const offState = metronome.onState(renderClick);
  renderClick();

  const onKey = (e: KeyboardEvent) => {
    if (viewer.hidden || e.target instanceof HTMLInputElement) return;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) {
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
    resizeTimer = window.setTimeout(() => void renderPages(), 150);
  };
  window.addEventListener('resize', onResize);
  document.addEventListener('fullscreenchange', onResize);

  root.append(h('section', { class: 'view sheetmusic' }, library, viewer));
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
