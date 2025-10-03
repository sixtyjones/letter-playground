/*  Letter Playground — single-file sketch.js for editor.p5js.org
    - No HTML needed, all UI is built with p5 DOM.
    - Left: interactive editor with draggable anchors/handles.
    - Right: live black preview ~50 pt by default, Zoom + Fit.
    - Upload TTF/OTF, randomize with seed, undo/redo, export SVG/PNG.
    - Counters (holes) render correctly via Canvas 2D + even-odd fill.
*/
console.log('JS loaded');

/* =================== Load external libs (opentype.js, FileSaver) =================== */
function loadScript(url) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load ' + url));
    document.head.appendChild(s);
  });
}
const LIBS = Promise.all([
  loadScript('https://cdnjs.cloudflare.com/ajax/libs/opentype.js/1.3.4/opentype.min.js'),
  loadScript('https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js')
]);

/* =================== Layout constants =================== */
let PREVIEW_W = 360;     // right panel width
let UI_W = 290;          // left floating UI width
let MIN_CANVAS_H = 560;

/* =================== Global state =================== */
let font = null;         // opentype.Font
let glyphModel = null;
let ui = null;
let editor = null;
let preview = null;
let initialized = false;
let fpsSmoothed = 0;

/* =================== p5 entry points =================== */
function setup() {
  createCanvas(Math.max(windowWidth, UI_W + PREVIEW_W + 100), Math.max(windowHeight, MIN_CANVAS_H));
  frameRate(60);
  textFont('system-ui');
  noLoop();

  ui = new UI(); // show panel immediately

  LIBS.then(() => {
    // Try loading a default font. If it fails, upload will still work.
    opentype.load('https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-400-normal.otf', (err, f) => {
      if (!err) font = f;
      initializeApp();
    });
  }).catch(() => {
    initializeApp();
  });
}

function draw() {
  if (!initialized) {
    background(248);
    fill(40); noStroke(); textAlign(CENTER, CENTER);
    text('Loading…', width / 2, height / 2);
    return;
  }

  background(233);

  // Layout rectangles
  const editorArea = { x: UI_W + 10, y: 10, w: width - (UI_W + PREVIEW_W + 30), h: height - 20 };
  const previewArea = { x: width - PREVIEW_W - 10, y: 10, w: PREVIEW_W, h: height - 20 };

  // Update the editor area (used by interaction helpers)
  editor._lastEditorArea = editorArea;

  // Draw editor and preview
  editor.draw(editorArea);
  preview.draw(previewArea);

  // Status
  fpsSmoothed = lerp(fpsSmoothed, frameRate(), 0.2);
  push();
  fill(0, 120); noStroke(); textAlign(RIGHT, BOTTOM); textSize(10);
  text(`FPS ${fpsSmoothed.toFixed(1)}, Nodes ${glyphModel.nodeCount()}`, width - 6, height - 6);
  pop();
}

function mousePressed()  { if (initialized) editor.mousePressed(); }
function mouseDragged()  { if (initialized) editor.mouseDragged(); }
function mouseReleased() { if (initialized) editor.mouseReleased(); }
function mouseMoved()    { if (initialized) editor.mouseMoved(); }
function keyPressed()    { if (initialized) ui.handleKey(keyCode); }
function windowResized() {
  resizeCanvas(Math.max(windowWidth, UI_W + PREVIEW_W + 100), Math.max(windowHeight, MIN_CANVAS_H));
  redraw();
}

/* =================== Initialize app =================== */
function initializeApp() {
  glyphModel = new GlyphModel();
  editor = new Editor();
  preview = new Preview();
  ui.hookModel(glyphModel, editor, preview);

  glyphModel.generate('A'); // default

  noLoop();
  window.addEventListener('modelChanged', () => redraw());

  initialized = true;
  redraw();
}

/* =================== MODEL =================== */
class GlyphModel {
  constructor() {
    this.originalPath = newPath();      // opentype.Path
    this.path = newPath();              // working path
    this.char = 'A';
    this.params = { width: 1, height: 1, weight: 0, slant: 0, roundness: 0 };
    this.undoStack = [];
    this.redoStack = [];
    this.maxHist = 60;
  }

  nodeCount() { return this.path?.commands?.length || 0; }

  generate(ch) {
    if (!ch) return;
    this.char = ch[0];
    if (font && typeof opentype !== 'undefined') {
      const g = font.charToGlyph(this.char);
      const p = g.getPath(0, 0, 72); // nominal size
      this.originalPath = newPath(copyCommands(p.commands));
    } else {
      // minimal fallback "A-like" triangle if no font loaded
      const p = newPath();
      p.moveTo(0, 0); p.lineTo(40, 120); p.lineTo(80, 0); p.close();
      this.originalPath = newPath(copyCommands(p.commands));
    }
    this.reset();
  }

  reset() {
    this.path = newPath(copyCommands(this.originalPath.commands));
    this.params = { width: 1, height: 1, weight: 0, slant: 0, roundness: 0 };
    this.undoStack = []; this.redoStack = [];
    this.saveState();
    this._emitChanged();
  }

  applyParams() {
    const cmds = copyCommands(this.originalPath.commands);

    // slant
    if (this.params.slant !== 0) {
      const tanv = Math.tan(this.params.slant * (Math.PI / 4));
      for (const c of cmds) {
        if ('x'  in c && 'y'  in c) c.x  += c.y  * tanv;
        if ('x1' in c && 'y1' in c) c.x1 += c.y1 * tanv;
        if ('x2' in c && 'y2' in c) c.x2 += c.y2 * tanv;
      }
    }

    // scale to bbox
    const bb = bboxOf(cmds);
    if (bb.w > 0 && bb.h > 0) {
      for (const c of cmds) {
        if ('x'  in c) c.x  = (c.x  - bb.x) * this.params.width  + bb.x;
        if ('x1' in c) c.x1 = (c.x1 - bb.x) * this.params.width  + bb.x;
        if ('x2' in c) c.x2 = (c.x2 - bb.x) * this.params.width  + bb.x;

        if ('y'  in c) c.y  = (c.y  - bb.y) * this.params.height + bb.y;
        if ('y1' in c) c.y1 = (c.y1 - bb.y) * this.params.height + bb.y;
        if ('y2' in c) c.y2 = (c.y2 - bb.y) * this.params.height + bb.y;
      }
    }

    // roundness: pull handles toward anchors
    if (this.params.roundness > 0) {
      const t = this.params.roundness;
      for (const c of cmds) {
        if (c.type === 'C') {
          c.x1 = lerp(c.x1, c.x, t); c.y1 = lerp(c.y1, c.y, t);
          c.x2 = lerp(c.x2, c.x, t); c.y2 = lerp(c.y2, c.y, t);
        } else if (c.type === 'Q') {
          c.x1 = lerp(c.x1, c.x, t); c.y1 = lerp(c.y1, c.y, t);
        }
      }
    }

    this.path.commands = cmds;
    this.saveState();
    this._emitChanged();
  }

  randomize(seed = 42) {
    randomSeed(seed);
    const s = 20;
    for (const c of this.path.commands) {
      if (c.type !== 'Z') {
        if ('x' in c) c.x += (random() - 0.5) * s;
        if ('y' in c) c.y += (random() - 0.5) * s;
      }
      if (c.type === 'C') {
        c.x1 += (random() - 0.5) * s; c.y1 += (random() - 0.5) * s;
        c.x2 += (random() - 0.5) * s; c.y2 += (random() - 0.5) * s;
      } else if (c.type === 'Q') {
        c.x1 += (random() - 0.5) * s; c.y1 += (random() - 0.5) * s;
      }
    }
    this.saveState();
    this._emitChanged();
  }

  // History
  saveState() {
    const snap = { path: newPath(copyCommands(this.path.commands)), params: { ...this.params } };
    this.undoStack.push(snap);
    if (this.undoStack.length > this.maxHist) this.undoStack.shift();
    this.redoStack = [];
  }
  _load(state) {
    if (!state) return;
    this.path = newPath(copyCommands(state.path.commands));
    this.params = { ...state.params };
    ui.syncFromModel();
    this._emitChanged();
  }
  undo() {
    if (this.undoStack.length > 1) {
      this.redoStack.push(this.undoStack.pop());
      this._load(this.undoStack[this.undoStack.length - 1]);
    }
  }
  redo() {
    if (this.redoStack.length) {
      const s = this.redoStack.pop();
      this.undoStack.push(s);
      this._load(s);
    }
  }

  bbox() { return bboxOf(this.path.commands); }
  _emitChanged() { window.dispatchEvent(new Event('modelChanged')); }
}

/* =================== EDITOR (left canvas) =================== */
class Editor {
  constructor() {
    this.cam = { x: 0, y: 0, z: 1 };
    this.dragMode = null;      // 'canvas' or point ref
    this.dragOff = { x: 0, y: 0 };
    this.selected = [];        // [{index, type}]
    this.hover = null;
    this.view = { wire: true, fill: false, grid: false, lock: false };
    this._initCam = false;
    this._lastEditorArea = { x: UI_W + 10, y: 10, w: width - (UI_W + PREVIEW_W + 30), h: height - 20 };
  }

  draw(area) {
    if (!this._initCam) { this.fitTo(area); this._initCam = true; }

    // panel bg
    push();
    noStroke(); fill(245);
    rectMode(CORNER);
    rect(area.x, area.y, area.w, area.h, 8);
    pop();

    // clip to area
    clipPush(area);

    // world transform via p5
    push();
    translate(area.x + area.w / 2 + this.cam.x, area.y + area.h / 2 + this.cam.y);
    scale(this.cam.z);

    // grid
    if (this.view.grid) {
      stroke(0, 20); strokeWeight(1 / this.cam.z);
      for (let x = -2000; x <= 2000; x += 10) line(x, -2000, x, 2000);
      for (let y = -2000; y <= 2000; y += 10) line(-2000, y, 2000, y);
    }

    // --- GLYPH SHAPE WITH HOLES (Canvas 2D + even-odd) ---
    const ctx = drawingContext;
    ctx.save();
    canvasDrawCommands(ctx, glyphModel.path.commands);

    if (this.view.fill) {
      ctx.fillStyle = 'rgba(120,140,220,0.55)';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1 / this.cam.z;
      ctx.fill('evenodd'); // carve out counters
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(0,0,0,0.47)';
      ctx.lineWidth = 1 / this.cam.z;
      ctx.stroke();
    }
    ctx.restore();

    // Handles on top (p5 primitives)
    if (this.view.wire) this.drawHandles(glyphModel.path.commands);

    pop();        // end world transform
    clipPop();    // end clip
  }

  drawHandles(cmds) {
    let lastAnchor = null;
    stroke(0, 100); strokeWeight(1 / this.cam.z);

    for (let i = 0; i < cmds.length; i++) {
      const c = cmds[i];
      if (c.type === 'Z') { lastAnchor = null; continue; }

      if (c.type === 'C') {
        if (lastAnchor) line(lastAnchor.x, lastAnchor.y, c.x1, c.y1);
        line(c.x, c.y, c.x2, c.y2);
        this.drawCtrl(c.x1, c.y1, i, 'c1');
        this.drawCtrl(c.x2, c.y2, i, 'c2');
      } else if (c.type === 'Q') {
        if (lastAnchor) line(lastAnchor.x, lastAnchor.y, c.x1, c.y1);
        this.drawCtrl(c.x1, c.y1, i, 'q');
      }
      this.drawAnchor(c.x, c.y, i, 'anchor');
      lastAnchor = c;
    }
  }

  drawAnchor(x, y, idx, type) {
    const sel = this.selected.some(s => s.index === idx && s.type === type);
    const hov = this.hover && this.hover.index === idx && this.hover.type === type;
    push();
    stroke(0); strokeWeight(1 / this.cam.z);
    fill(hov ? color(255, 255, 0) : sel ? color(255, 0, 0) : 255);
    ellipse(x, y, 8 / this.cam.z, 8 / this.cam.z);
    pop();
  }
  drawCtrl(x, y, idx, type) {
    const sel = this.selected.some(s => s.index === idx && s.type === type);
    const hov = this.hover && this.hover.index === idx && this.hover.type === type;
    push();
    stroke(0, 150); strokeWeight(0.5 / this.cam.z);
    fill(hov ? color(255, 255, 0) : sel ? color(255, 0, 0) : color(180, 180, 255));
    rectMode(CENTER);
    rect(x, y, 6 / this.cam.z, 6 / this.cam.z);
    pop();
  }

  // Interaction helpers
  worldMouse(area) {
    return {
      x: (mouseX - (area.x + area.w / 2) - this.cam.x) / this.cam.z,
      y: (mouseY - (area.y + area.h / 2) - this.cam.y) / this.cam.z
    };
  }

  pointHit(mx, my, hit = 10) {
    const cmds = glyphModel.path.commands;
    const r = hit / this.cam.z;
    for (let i = cmds.length - 1; i >= 0; i--) {
      const c = cmds[i];
      if (c.type === 'C') {
        if (dist(mx, my, c.x1, c.y1) < r) return { index: i, type: 'c1' };
        if (dist(mx, my, c.x2, c.y2) < r) return { index: i, type: 'c2' };
      } else if (c.type === 'Q') {
        if (dist(mx, my, c.x1, c.y1) < r) return { index: i, type: 'q' };
      }
      if (c.type !== 'Z' && dist(mx, my, c.x, c.y) < r) return { index: i, type: 'anchor' };
    }
    return null;
  }

  mousePressed() {
    if (!mouseInRect(this._lastEditorArea)) return;
    const m = this.worldMouse(this._lastEditorArea);
    const t = this.pointHit(m.x, m.y);

    if (t) {
      this.dragMode = t;
      const p = this.getPoint(t);
      this.dragOff = { x: p.x - m.x, y: p.y - m.y };
      const isSel = this.selected.some(s => s.index === t.index && s.type === t.type);
      if (keyIsDown(SHIFT)) {
        if (isSel) this.selected = this.selected.filter(s => !(s.index === t.index && s.type === t.type));
        else this.selected.push(t);
      } else if (!isSel) {
        this.selected = [t];
      }
    } else {
      this.selected = [];
      this.dragMode = 'canvas';
      this.dragOff = { x: mouseX, y: mouseY };
    }
    redraw();
  }

  mouseDragged() {
    if (!this.dragMode) return;
    if (this.dragMode === 'canvas') {
      this.cam.x += mouseX - this.dragOff.x;
      this.cam.y += mouseY - this.dragOff.y;
      this.dragOff = { x: mouseX, y: mouseY };
      redraw();
      return;
    }
    const m = this.worldMouse(this._lastEditorArea);
    let nx = m.x + this.dragOff.x;
    let ny = m.y + this.dragOff.y;
    if (this.view.grid) { nx = round(nx / 10) * 10; ny = round(ny / 10) * 10; }

    const ref = this.getPoint(this.dragMode);
    const dx = nx - ref.x, dy = ny - ref.y;
    this.selected.forEach(sel => {
      const o = this.getPoint(sel);
      this.setPoint(sel, o.x + dx, o.y + dy, this.view.lock);
    });
    redraw();
  }

  mouseReleased() {
    if (this.dragMode && this.dragMode !== 'canvas') glyphModel.saveState();
    this.dragMode = null;
  }

  mouseMoved() {
    const m = this.worldMouse(this._lastEditorArea);
    this.hover = mouseInRect(this._lastEditorArea) ? this.pointHit(m.x, m.y) : null;
    redraw();
  }

  getPoint(ref) {
    const c = glyphModel.path.commands[ref.index];
    if (ref.type === 'anchor') return { x: c.x, y: c.y };
    if (ref.type === 'c1')    return { x: c.x1, y: c.y1 };
    if (ref.type === 'c2')    return { x: c.x2, y: c.y2 };
    if (ref.type === 'q')     return { x: c.x1, y: c.y1 };
    return { x: 0, y: 0 };
  }

  setPoint(ref, x, y, lockCollinear) {
    const cmds = glyphModel.path.commands;
    const c = cmds[ref.index];
    if (ref.type === 'anchor') {
      const dx = x - c.x, dy = y - c.y;
      c.x = x; c.y = y;
      if (c.type === 'C') { c.x2 += dx; c.y2 += dy; }
      const ni = this.nextCurve(ref.index);
      if (ni !== -1) { cmds[ni].x1 += dx; cmds[ni].y1 += dy; }
      return;
    }
    if (ref.type === 'c1') { c.x1 = x; c.y1 = y; }
    else if (ref.type === 'c2') { c.x2 = x; c.y2 = y; }
    else if (ref.type === 'q') { c.x1 = x; c.y1 = y; }

    if (lockCollinear && (ref.type === 'c1' || ref.type === 'c2')) {
      let anchor, opp;
      if (ref.type === 'c2') {
        anchor = c;
        const ni = this.nextCurve(ref.index);
        if (ni !== -1) opp = { cmd: cmds[ni], key: 'c1' };
      } else if (ref.type === 'c1') {
        const pi = this.prevCurve(ref.index);
        if (pi !== -1) { anchor = cmds[pi]; opp = { cmd: cmds[pi], key: 'c2' }; }
      }
      if (anchor && opp) {
        const ax = anchor.x, ay = anchor.y;
        const dx = x - ax, dy = y - ay;
        const ol = dist(ax, ay, opp.key === 'c1' ? opp.cmd.x1 : opp.cmd.x2, opp.key === 'c1' ? opp.cmd.y1 : opp.cmd.y2);
        const len = Math.hypot(dx, dy) || 1;
        const nx = ax - dx / len * ol, ny = ay - dy / len * ol;
        if (opp.key === 'c1') { opp.cmd.x1 = nx; opp.cmd.y1 = ny; }
        else { opp.cmd.x2 = nx; opp.cmd.y2 = ny; }
      }
    }
  }

  prevCurve(i) { for (let k = i; k >= 0; k--) if (glyphModel.path.commands[k].type === 'C') return k; return -1; }
  nextCurve(i) { for (let k = i + 1; k < glyphModel.path.commands.length; k++) if (glyphModel.path.commands[k].type === 'C') return k; return -1; }

  fitTo(area) {
    const bb = glyphModel.bbox();
    if (bb.w <= 0 || bb.h <= 0) return;
    const pad = 50;
    const sx = (area.w - pad * 2) / bb.w;
    const sy = (area.h - pad * 2) / bb.h;
    this.cam.z = Math.min(sx, sy) * 0.9;
    this.cam.x = - (bb.x + bb.w / 2) * this.cam.z;
    this.cam.y = - (bb.y + bb.h / 2) * this.cam.z;
  }
}

/* =================== PREVIEW (right panel) =================== */
class Preview {
  constructor() { this.zoom = 1; this.doFit = false; }

  draw(area) {
    // panel
    push();
    noStroke(); fill(250);
    rectMode(CORNER);
    rect(area.x, area.y, area.w, area.h, 8);
    // title
    fill(40); textAlign(CENTER, TOP); textSize(14);
    text('Live Preview', area.x + area.w / 2, area.y + 8);

    // inner square
    const sq = Math.floor(Math.min(area.w - 24, area.h - 36));
    const cx = area.x + area.w / 2, cy = area.y + area.h / 2 + 6;
    const px = cx - sq / 2, py = cy - sq / 2;
    stroke(204); fill(255); rect(px, py, sq, sq, 8);

    // draw glyph
    const bb = glyphModel.bbox();
    if (bb.w > 0 && bb.h > 0) {
      push();
      let scaleTo = (50 / bb.h) * this.zoom; // ~50 px tall at zoom=1
      if (this.doFit) {
        const pad = sq * 0.15;
        const fx = (sq - pad * 2) / bb.w;
        const fy = (sq - pad * 2) / bb.h;
        scaleTo = Math.min(fx, fy);
        this.doFit = false;
      }
      translate(cx, cy);
      scale(scaleTo);
      translate(-(bb.x + bb.w / 2), -(bb.y + bb.h / 2));

      const ctx = drawingContext;
      ctx.save();
      canvasDrawCommands(ctx, glyphModel.path.commands);
      // weight approximation: stroke on top if non-zero
      const w = glyphModel.params.weight;
      ctx.fillStyle = '#000';
      if (w !== 0) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.abs(w);
        ctx.strokeStyle = '#000';
      } else {
        ctx.lineWidth = 0;
      }
      ctx.fill('evenodd');
      if (w !== 0) ctx.stroke();
      ctx.restore();

      pop();
    }
    pop();
  }
}

/* =================== UI (left floating panel) =================== */
class UI {
  constructor() {
    this.injectCSS();

    // Panel container
    this.panel = createDiv().id('ui').style(`
      position:fixed; left:10px; top:10px; width:${UI_W - 20}px;
      background:#fff; border:1px solid #ddd; border-radius:8px;
      box-shadow:0 4px 15px rgba(0,0,0,.08); padding:12px;
      max-height:${height - 20}px; overflow:auto; font-size:12px;`);

    const H = (t)=> createElement('h3', t).parent(this.panel).style('margin:6px 0 8px 0; font-size:13px; color:#444;');

    // Character & Font
    H('Character & Font');
    this.charInput = createInput('A').parent(this.panel).attribute('maxlength','1').style('width:100%; padding:6px;');
    this.fileInput = createFileInput(this.onFile.bind(this), false).parent(this.panel).style('width:100%; margin-top:6px;');

    // Transform
    H('Transform');
    this.width = this.makeSlider('Width', 0.1, 3, 1, 0.01);
    this.height = this.makeSlider('Height', 0.1, 3, 1, 0.01);
    this.weight = this.makeSlider('Weight', -50, 100, 0, 1);
    this.slant  = this.makeSlider('Slant', -1, 1, 0, 0.01);
    this.round  = this.makeSlider('Roundness', 0, 1, 0, 0.01);

    // Random
    H('Randomness');
    this.seed = createInput('42', 'number').parent(this.panel).style('width:100%; padding:6px;');
    this.randBtn = this.makeBtn('Surprise Me', () => glyphModel.randomize(parseInt(this.seed.value()||'42',10)));

    // History
    H('History');
    const row = createDiv().parent(this.panel).style('display:flex; gap:6px;');
    this.undo = this.makeBtn('Undo (Z)', () => glyphModel.undo(), true).parent(row);
    this.redo = this.makeBtn('Redo (Y)', () => glyphModel.redo(), true).parent(row);
    this.reset = this.makeBtn('Reset Glyph', () => { glyphModel.reset(); this.syncFromModel(); });

    // View
    H('View & Display');
    this.wire = this.makeChk('Wireframe (W)', true);
    this.fill = this.makeChk('Fill', false);
    this.grid = this.makeChk('Snap to Grid (G)', false);
    this.lock = this.makeChk('Lock Handles (L)', false);
    this.zoom = this.makeSlider('Preview Zoom', 0.1, 5, 1, 0.01, (v)=>{ preview.zoom = v; redraw(); });
    this.fit  = this.makeBtn('Fit to View (F)', ()=>{ editor.fitTo(editor._lastEditorArea); preview.doFit = true; redraw(); });

    // Export
    H('Export');
    const er = createDiv().parent(this.panel).style('display:flex; gap:6px;');
    this.svg = this.makeBtn('Export SVG', ()=> this.exportSVG()).parent(er);
    this.png = this.makeBtn('Export PNG', ()=> saveCanvas(`letter_playground_${glyphModel?.char||'A'}`, 'png')).parent(er);

    // Events
    this.charInput.input(()=> glyphModel.generate(this.charInput.value()));
    this.width.slider.input(()=> this.paramChange('width', this.width.slider));
    this.height.slider.input(()=> this.paramChange('height', this.height.slider));
    this.weight.slider.input(()=> this.paramChange('weight', this.weight.slider));
    this.slant.slider.input(()=> this.paramChange('slant', this.slant.slider));
    this.round.slider.input(()=> this.paramChange('roundness', this.round.slider));
    this.wire.input(()=> { editor.view.wire = this.wire.checked(); redraw(); });
    this.fill.input(()=> { editor.view.fill = this.fill.checked(); redraw(); });
    this.grid.input(()=> { editor.view.grid = this.grid.checked(); redraw(); });
    this.lock.input(()=> { editor.view.lock = this.lock.checked(); redraw(); });
  }

  hookModel(m, e, p) { this.model = m; this.editor = e; this.preview = p; }

  syncFromModel() {
    this.width.slider.value(this.model.params.width);
    this.height.slider.value(this.model.params.height);
    this.weight.slider.value(this.model.params.weight);
    this.slant.slider.value(this.model.params.slant);
    this.round.slider.value(this.model.params.roundness);
    this.width.readout.html(nfc(this.model.params.width, 2));
    this.height.readout.html(nfc(this.model.params.height, 2));
    this.weight.readout.html(String(this.model.params.weight));
    this.slant.readout.html(nfc(this.model.params.slant, 2));
    this.round.readout.html(nfc(this.model.params.roundness, 2));
  }

  handleKey(k) {
    if (document.activeElement && ['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) return;
    if      (k === 90) this.model.undo();        // Z
    else if (k === 89) this.model.redo();        // Y
    else if (k === 87) { this.wire.checked(!this.wire.checked()); this.editor.view.wire = this.wire.checked(); } // W
    else if (k === 71) { this.grid.checked(!this.grid.checked()); this.editor.view.grid = this.grid.checked(); } // G
    else if (k === 82) this.model.randomize(parseInt(this.seed.value()||'42',10)); // R
    else if (k === 70) { this.editor.fitTo(this.editor._lastEditorArea); this.preview.doFit = true; } // F
    else if (k === 76) { this.lock.checked(!this.lock.checked()); this.editor.view.lock = this.lock.checked(); } // L
    redraw();
  }

  paramChange(name, slider) {
    this.model.params[name] = parseFloat(slider.value());
    const ro = { width:this.width.readout, height:this.height.readout,
      weight:this.weight.readout, slant:this.slant.readout, roundness:this.round.readout }[name];
    if (ro) ro.html(name==='weight' ? String(this.model.params[name]) : nfc(this.model.params[name],2));
    this.model.applyParams();
  }

  // Properly parse uploaded fonts using FileReader(ArrayBuffer)
  onFile(file) {
    if (!file || !file.file) return;
    const ok = /\.ttf$|\.otf$/i.test(file.name);
    if (!ok) { alert('Please upload a .ttf or .otf'); return; }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        font = opentype.parse(e.target.result); // ArrayBuffer -> font
        console.log('Loaded font:', font.names?.fullName?.en || file.name);
        glyphModel.generate(this.charInput.value()); // regenerate current letter
      } catch (err) {
        console.error('Font parsing error:', err);
        alert('Could not parse the font file. Try another .ttf or .otf.');
      }
    };
    reader.onerror = (e) => {
      console.error('FileReader error:', e);
      alert('Failed to read the font file.');
    };
    reader.readAsArrayBuffer(file.file);
  }

  exportSVG() {
    if (typeof opentype === 'undefined') { alert('opentype.js not loaded'); return; }
    if (!glyphModel?.path) return;
    const p = newPath(copyCommands(glyphModel.path.commands));
    const d = p.toPathData(5);
    const bb = bboxOf(glyphModel.path.commands);
    const pad = 20;
    // Use even-odd so counters are preserved in the SVG
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bb.x - pad} ${bb.y - pad} ${bb.w + pad*2} ${bb.h + pad*2}">
  <path d="${d}" fill="black" fill-rule="evenodd"/>
</svg>`;
    const blob = new Blob([svg], {type:'image/svg+xml;charset=utf-8'});
    if (typeof saveAs === 'function') saveAs(blob, `${glyphModel.char}_playground.svg`);
    else alert('FileSaver not available');
  }

  // small helpers to build UI
  makeSlider(label, min, max, value, step, onInput) {
    const wrap = createDiv().parent(this.panel).style('margin:6px 0;');
    createSpan(`${label}: `).parent(wrap);
    const read = createSpan(nfc(value, 2)).parent(wrap).style('float:right; color:#555;');
    const s = createSlider(min, max, value, step).parent(this.panel).style('width:100%;');
    s.input(()=>{ read.html(label==='Weight'? String(s.value()) : nfc(s.value(),2)); if (onInput) onInput(parseFloat(s.value())); });
    return { slider: s, readout: read };
  }
  makeBtn(txt, fn, half=false) {
    const w = half ? 'calc(50% - 3px)' : '100%';
    const b = createButton(txt).style(`width:${w}; padding:8px; margin-top:6px; background:#007bff; color:#fff; border:none; border-radius:4px;`);
    b.mousePressed(fn);
    return b;
  }
  makeChk(txt, val=false) { const c = createCheckbox(' '+txt, val); c.parent(this.panel); c.style('display:block; margin:6px 0;'); return c; }
  injectCSS() {
    const css = `#ui h3{border-bottom:1px solid #eee; padding-bottom:4px;} input,button{font-size:12px;}`;
    const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
  }
}

/* =================== Utilities =================== */
function newPath(cmds=[]) { const p = typeof opentype!=='undefined' ? new opentype.Path() : { commands: [] }; p.commands = cmds; return p; }
function copyCommands(cmds) { return JSON.parse(JSON.stringify(cmds||[])); }
function bboxOf(cmds) {
  if (typeof opentype === 'undefined') return { x:0, y:0, w:100, h:100 };
  const p = new opentype.Path(); p.commands = copyCommands(cmds);
  const b = p.getBoundingBox?.();
  if (!b || !isFinite(b.x1) || !isFinite(b.y1) || !isFinite(b.x2) || !isFinite(b.y2))
    return { x:0, y:0, w:0, h:0 };
  return { x:b.x1, y:b.y1, w:b.x2 - b.x1, h:b.y2 - b.y1 };
}
function mouseInRect(r){ return mouseX>=r.x && mouseX<=r.x+r.w && mouseY>=r.y && mouseY<=r.y+r.h; }

// Canvas path builder from opentype commands (supports counters)
function canvasDrawCommands(ctx, commands) {
  ctx.beginPath();
  for (const c of commands) {
    if (c.type === 'M') ctx.moveTo(c.x, c.y);
    else if (c.type === 'L') ctx.lineTo(c.x, c.y);
    else if (c.type === 'C') ctx.bezierCurveTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y);
    else if (c.type === 'Q') ctx.quadraticCurveTo(c.x1, c.y1, c.x, c.y);
    else if (c.type === 'Z') ctx.closePath();
  }
}

// Simple clipping helpers
function clipPush(r){ drawingContext.save(); drawingContext.beginPath(); drawingContext.rect(r.x, r.y, r.w, r.h); drawingContext.clip(); }
function clipPop(){ drawingContext.restore(); }
