// script.js
// Важные комментарии и инструкции можно найти в этом файле.
// Реализованы: парсинг входа, отрисовка системы координат, алгоритмы:
//  - Cohen-Sutherland (прямоугольное окно)
//  - Cyrus-Beck (отрезок vs выпуклый многоугольник)

(() => {
  // DOM
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const inputText = document.getElementById('inputText');
  const loadExampleBtn = document.getElementById('loadExample');
  const parseBtn = document.getElementById('parseBtn');
  const clipBtn = document.getElementById('clipBtn');
  const status = document.getElementById('status');
  const resetViewBtn = document.getElementById('resetView');
  const clearPolyBtn = document.getElementById('clearPoly');

  // state
  let segments = []; // [{x1,y1,x2,y2}, ...]
  let rectWindow = null; // {xmin,ymin,xmax,ymax}
  let view = { // world coordinate bounding box (auto)
    xmin: -10, ymin: -10, xmax: 10, ymax: 10
  };
  let polygon = []; // array of points {x,y} in world coords (user-drawn convex polygon)
  let mode = 'rect'; // 'rect' or 'convex'

  // visual settings
  const colors = {
    axes: '#999',
    grid: '#e9eef8',
    rectFill: 'rgba(0,128,0,0.12)',
    rectStroke: 'rgb(0,128,0)',
    origSeg: 'rgb(200,50,50)',
    clippedSeg: 'rgb(0,120,255)',
    polyStroke: 'rgb(160,80,200)'
  };

  function windowToCanvasPixels(clientX, clientY) {
    const rect = canvas.getBoundingClientRect(); // CSS-проекция
    const xCss = clientX - rect.left;
    const yCss = clientY - rect.top;
    // масштаб между CSS-пикселями и реальными пикселями буфера
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: xCss * scaleX, y: yCss * scaleY };
  }

  // coordinate transform: world -> canvas
  function worldToCanvas(x, y) {
    const cw = canvas.width, ch = canvas.height;
    const sx = cw / (view.xmax - view.xmin);
    const sy = ch / (view.ymax - view.ymin);
    return {
      x: (x - view.xmin) * sx,
      y: ch - (y - view.ymin) * sy
    };
  }

  function canvasToWorld(cx, cy) {
    const cw = canvas.width, ch = canvas.height;
    const sx = cw / (view.xmax - view.xmin);
    const sy = ch / (view.ymax - view.ymin);
    return {
      x: cx / sx + view.xmin,
      y: (ch - cy) / sy + view.ymin
    };
  }

  // draw coordinate axes + grid
  function drawAxes() {
    ctx.clearRect(0,0,canvas.width,canvas.height);

    // grid lines every integer unit (if scale allows)
    const dx = 1, dy = 1;
    const stepX = dx, stepY = dy;
    ctx.lineWidth = 1;

    // vertical grid
    ctx.beginPath();
    for (let x = Math.ceil(view.xmin); x <= Math.floor(view.xmax); x += stepX) {
      const p1 = worldToCanvas(x, view.ymin);
      const p2 = worldToCanvas(x, view.ymax);
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    }
    ctx.strokeStyle = colors.grid;
    ctx.stroke();

    // horizontal grid
    ctx.beginPath();
    for (let y = Math.ceil(view.ymin); y <= Math.floor(view.ymax); y += stepY) {
      const p1 = worldToCanvas(view.xmin, y);
      const p2 = worldToCanvas(view.xmax, y);
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    }
    ctx.strokeStyle = colors.grid;
    ctx.stroke();

    // axes
    ctx.beginPath();
    const ox1 = worldToCanvas(view.xmin, 0);
    const ox2 = worldToCanvas(view.xmax, 0);
    ctx.moveTo(ox1.x, ox1.y);
    ctx.lineTo(ox2.x, ox2.y);

    const oy1 = worldToCanvas(0, view.ymin);
    const oy2 = worldToCanvas(0, view.ymax);
    ctx.moveTo(oy1.x, oy1.y);
    ctx.lineTo(oy2.x, oy2.y);

    ctx.strokeStyle = colors.axes;
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // axis ticks and labels
    ctx.fillStyle = colors.axes;
    ctx.font = '12px Arial';
    for (let x = Math.ceil(view.xmin); x <= Math.floor(view.xmax); x++) {
      const p = worldToCanvas(x, 0);
      ctx.fillText(String(x), p.x + 2, p.y - 4);
    }
    for (let y = Math.ceil(view.ymin); y <= Math.floor(view.ymax); y++) {
      const p = worldToCanvas(0, y);
      ctx.fillText(String(y), p.x + 4, p.y - 2);
    }
  }

  // Draw everything (called after parsing or user actions)
  function renderAll(highlightClipped = []) {
    drawAxes();

    // draw clipping rectangle if exists
    if (rectWindow) {
      const { xmin, ymin, xmax, ymax } = rectWindow;
      const p1 = worldToCanvas(xmin, ymin);
      const p2 = worldToCanvas(xmax, ymax);
      const w = p2.x - p1.x;
      const h = p1.y - p2.y;
      ctx.fillStyle = colors.rectFill;
      ctx.fillRect(p1.x, p2.y, w, h);
      ctx.strokeStyle = colors.rectStroke;
      ctx.lineWidth = 2;
      ctx.strokeRect(p1.x, p2.y, w, h);
    }

    // draw polygon (if any)
    if (polygon.length > 0) {
      ctx.beginPath();
      polygon.forEach((pt, idx) => {
        const p = worldToCanvas(pt.x, pt.y);
        if (idx === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      });
      // if closed
      if (polygon.length >= 3) {
        ctx.closePath();
        ctx.fillStyle = 'rgba(160,80,200,0.06)';
        ctx.fill();
      }
      ctx.strokeStyle = colors.polyStroke;
      ctx.lineWidth = 2;
      ctx.stroke();
      // draw vertices
      polygon.forEach(pt => {
        const p = worldToCanvas(pt.x, pt.y);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI*2);
        ctx.fillStyle = colors.polyStroke;
        ctx.fill();
      });
    }

    // draw original segments
    ctx.lineWidth = 2;
    ctx.strokeStyle = colors.origSeg;
    segments.forEach(s => {
      const p1 = worldToCanvas(s.x1, s.y1);
      const p2 = worldToCanvas(s.x2, s.y2);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    });

    // draw clipped segments if any provided in highlightClipped
    ctx.lineWidth = 3;
    ctx.strokeStyle = colors.clippedSeg;
    highlightClipped.forEach(s => {
      const p1 = worldToCanvas(s.x1, s.y1);
      const p2 = worldToCanvas(s.x2, s.y2);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    });
  }

  // -----------------------
  // Parsing input
  // -----------------------
  function parseInput(text) {
    // Expected format:
    // n
    // x1 y1 x2 y2
    // ...
    // xmin ymin xmax ymax
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l !== '');
    if (lines.length < 2) throw new Error('Недостаточно строк во входном файле.');
    let idx = 0;
    const n = parseInt(lines[idx++], 10);
    if (isNaN(n) || n < 0) throw new Error('Неверно задано n.');
    if (lines.length < 1 + n + 1) throw new Error('Недостаточно данных: ожидаются строки с отрезками и окно.');
    const segs = [];
    for (let i = 0; i < n; i++) {
      const parts = lines[idx++].split(/\s+/).map(Number);
      if (parts.length < 4 || parts.some(isNaN)) throw new Error(`Ошибка в строке отрезка ${i+1}.`);
      segs.push({ x1: parts[0], y1: parts[1], x2: parts[2], y2: parts[3] });
    }
    const rectParts = lines[idx++].split(/\s+/).map(Number);
    if (rectParts.length < 4 || rectParts.some(isNaN)) throw new Error('Ошибка в строке прямоугольного окна.');
    const xmin = Math.min(rectParts[0], rectParts[2]);
    const xmax = Math.max(rectParts[0], rectParts[2]);
    const ymin = Math.min(rectParts[1], rectParts[3]);
    const ymax = Math.max(rectParts[1], rectParts[3]);
    return { segs, rectWindow: { xmin, ymin, xmax, ymax } };
  }

  // -----------------------
  // Cohen–Sutherland (прямоугольное окно)
  // -----------------------
  // region codes
  const INSIDE = 0; // 0000
  const LEFT = 1;   // 0001
  const RIGHT = 2;  // 0010
  const BOTTOM = 4; // 0100
  const TOP = 8;    // 1000

  function computeOutCode(x, y, rect) {
    let code = INSIDE;
    if (x < rect.xmin) code |= LEFT;
    else if (x > rect.xmax) code |= RIGHT;
    if (y < rect.ymin) code |= BOTTOM;
    else if (y > rect.ymax) code |= TOP;
    return code;
  }

  // returns clipped segment or null
  function cohenSutherlandClip(s, rect) {
    let x0 = s.x1, y0 = s.y1, x1 = s.x2, y1 = s.y2;
    let outcode0 = computeOutCode(x0, y0, rect);
    let outcode1 = computeOutCode(x1, y1, rect);
    let accept = false;

    while (true) {
      if (!(outcode0 | outcode1)) {
        // both inside
        accept = true;
        break;
      } else if (outcode0 & outcode1) {
        // both share an outside zone -> trivially reject
        break;
      } else {
        // choose one point outside
        let outcodeOut = outcode0 ? outcode0 : outcode1;
        let x, y;

        if (outcodeOut & TOP) {
          x = x0 + (x1 - x0) * (rect.ymax - y0) / (y1 - y0);
          y = rect.ymax;
        } else if (outcodeOut & BOTTOM) {
          x = x0 + (x1 - x0) * (rect.ymin - y0) / (y1 - y0);
          y = rect.ymin;
        } else if (outcodeOut & RIGHT) {
          y = y0 + (y1 - y0) * (rect.xmax - x0) / (x1 - x0);
          x = rect.xmax;
        } else if (outcodeOut & LEFT) {
          y = y0 + (y1 - y0) * (rect.xmin - x0) / (x1 - x0);
          x = rect.xmin;
        }

        // replace outside point
        if (outcodeOut === outcode0) {
          x0 = x; y0 = y; outcode0 = computeOutCode(x0, y0, rect);
        } else {
          x1 = x; y1 = y; outcode1 = computeOutCode(x1, y1, rect);
        }
      }
    }

    if (accept) return { x1: x0, y1: y0, x2: x1, y2: y1 };
    return null;
  }

  // -----------------------
  // Cyrus–Beck (отрезок vs выпуклый многоугольник)
  // Параметрическое представление P(t) = P0 + t*(P1-P0), t in [0,1]
  // Для каждой грани: n_i dot (P(t) - PEi) >= 0 (внешняя/внутренняя ориентация)
  // -----------------------
  // Helper: edge normal (outward) for convex polygon
  function edgeNormal(p1, p2) {
    // direction edge = p2 - p1
    // outward normal depends on polygon orientation; we'll compute normals pointing outward by using polygon area sign
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    // unnormalized normal (perp): (dy, -dx) or (-dy, dx)
    return { nx: dy, ny: -dx };
  }

  function polygonArea(poly) {
    let A = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i+1) % poly.length];
      A += (a.x * b.y - b.x * a.y);
    }
    return A / 2;
  }

  function cyrusBeckClip(seg, poly) {
    if (poly.length < 3) return null;

    const P0 = { x: seg.x1, y: seg.y1 };
    const P1 = { x: seg.x2, y: seg.y2 };
    const d = { x: P1.x - P0.x, y: P1.y - P0.y };

    let tE = 0;
    let tL = 1;

    // центроид
    let cx = 0, cy = 0;
    for (const p of poly) { cx += p.x; cy += p.y; }
    cx /= poly.length; cy /= poly.length;

    for (let i = 0; i < poly.length; i++) {
      const PEi = poly[i];
      const PEi1 = poly[(i+1)%poly.length];

      const ex = PEi1.x - PEi.x;
      const ey = PEi1.y - PEi.y;
      let nx = ey;
      let ny = -ex;

      // проверка наружности
      const midX = 0.5*(PEi.x+PEi1.x);
      const midY = 0.5*(PEi.y+PEi1.y);
      const cross = (cx - midX)*nx + (cy - midY)*ny;
      if (cross < 0) { nx *= -1; ny *= -1; }

      const wX = P0.x - PEi.x;
      const wY = P0.y - PEi.y;
      const num = -(nx*wX + ny*wY);
      const den = nx*d.x + ny*d.y;

      if (Math.abs(den) < 1e-12) {
        if (num < 0) return null;
        else continue;
      }

      const t = num/den;
      if (den > 0) tE = Math.max(tE, t);
      else tL = Math.min(tL, t);

      if (tE > tL) return null;
    }

    return {
      x1: P0.x + d.x*tE,
      y1: P0.y + d.y*tE,
      x2: P0.x + d.x*tL,
      y2: P0.y + d.y*tL
    };
}



  // -----------------------
  // UI handlers and interactions
  // -----------------------
  loadExampleBtn.addEventListener('click', () => {
    const example = [
      '6',
      '-9 -6 -3 6',
      '-8 8 8 -6',
      '-12 0 -2 0',
      '0 -9 0 9',
      '-3 -3 3 3',
      '6 -8 12 8',
      '-10 -10 10 10'
    ].join('\n');
    inputText.value = example;
    status.textContent = 'Пример загружен. Нажмите "Применить входные данные".';
  });

  parseBtn.addEventListener('click', () => {
    try {
      const parsed = parseInput(inputText.value);
      segments = parsed.segs;
      rectWindow = parsed.rectWindow;
      // auto set view to include everything plus margin
      autoFitView();
      polygon = []; // сбросим
      renderAll([]);
      status.textContent = `Данные распарсены: ${segments.length} отрезков. Окно: [${rectWindow.xmin},${rectWindow.ymin}] — [${rectWindow.xmax},${rectWindow.ymax}]`;
    } catch (e) {
      status.textContent = 'Ошибка парсинга: ' + e.message;
    }
  });

  // change mode radio
  document.querySelectorAll('input[name="mode"]').forEach(r => {
    r.addEventListener('change', (ev) => {
      mode = ev.target.value;
      status.textContent = `Режим: ${mode === 'rect' ? 'прямоугольное окно (Cohen–Sutherland)' : 'выпуклый многоугольник (Cyrus–Beck)'}`;
      renderAll([]);
    });
  });

  // clip button
  clipBtn.addEventListener('click', () => {
    if (mode === 'rect') {
      if (!rectWindow) { status.textContent = 'Нет заданного прямоугольного окна.'; return; }
      const clipped = [];
      for (let s of segments) {
        const cs = cohenSutherlandClip(s, rectWindow);
        if (cs) clipped.push(cs);
      }
      renderAll(clipped);
      status.textContent = `Cohen–Sutherland: показано ${clipped.length} видимых фрагментов.`;
    } else {
      // convex polygon mode
      if (polygon.length < 3) { status.textContent = 'Нарисуйте (или задайте) выпуклый многоугольник клиппинга (>=3 точек).'; return; }
      // NOTE: algorithm требует выпуклости; не проверяем строго — пользователь должен обеспечить.
      const clipped = [];
      for (let s of segments) {
        const cs = cyrusBeckClip(s, polygon);
        if (cs) clipped.push(cs);
      }
      renderAll(clipped);
      status.textContent = `Cyrus–Beck: показано ${clipped.length} видимых фрагментов.`;
    }
  });

  resetViewBtn.addEventListener('click', () => {
    autoFitView();
    renderAll([]);
    status.textContent = 'Вид сброшен.';
  });

  clearPolyBtn.addEventListener('click', () => {
    polygon = [];
    renderAll([]);
    status.textContent = 'Многоугольник очищен.';
  });

  // auto fit view to extents of segments/window/polygon
  function autoFitView() {
    let xs = [], ys = [];
    segments.forEach(s => { xs.push(s.x1, s.x2); ys.push(s.y1, s.y2); });
    if (rectWindow) xs.push(rectWindow.xmin, rectWindow.xmax), ys.push(rectWindow.ymin, rectWindow.ymax);
    if (polygon.length > 0) polygon.forEach(p=>{ xs.push(p.x); ys.push(p.y); });
    if (xs.length === 0) { view = { xmin: -10, ymin: -10, xmax: 10, ymax: 10 }; return; }
    const minx = Math.min(...xs), maxx = Math.max(...xs);
    const miny = Math.min(...ys), maxy = Math.max(...ys);
    const padX = Math.max(1, (maxx - minx) * 0.12);
    const padY = Math.max(1, (maxy - miny) * 0.12);
    view = { xmin: minx - padX, xmax: maxx + padX, ymin: miny - padY, ymax: maxy + padY };
  }

  // -----------------------
  // canvas interactions for drawing polygon
  // -----------------------

  canvas.addEventListener('click', (ev) => {
    if (mode !== 'convex') return;
    const cp = windowToCanvasPixels(ev.clientX, ev.clientY); // canvas-пиксели
    const wp = canvasToWorld(cp.x, cp.y);                    // теперь корректно
    polygon.push({ x: wp.x, y: wp.y });
    autoFitView(); // по желанию — если хочешь авто-подгонку
    renderAll([]);
    status.textContent = `Добавлена вершина полигона (${wp.x.toFixed(2)}, ${wp.y.toFixed(2)}). Всего вершин: ${polygon.length}.`;
  });

  // allow dragging to pan (simple)
  let isPanning = false;
  let panStart = null;
  canvas.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    if (ev.shiftKey) {
      isPanning = true;
      const cp = windowToCanvasPixels(ev.clientX, ev.clientY);
      panStart = {
        clientXCanvas: cp.x,
        clientYCanvas: cp.y,
        view: { ...view }
      };
      canvas.style.cursor = 'grab';
    }
  });
  window.addEventListener('mousemove', (ev) => {
    if (!isPanning) return;
    const cp = windowToCanvasPixels(ev.clientX, ev.clientY);
    const dxCanvas = cp.x - panStart.clientXCanvas;
    const dyCanvas = cp.y - panStart.clientYCanvas;

    const cw = canvas.width, ch = canvas.height;
    const sx = (panStart.view.xmax - panStart.view.xmin) / cw;
    const sy = (panStart.view.ymax - panStart.view.ymin) / ch;

    view.xmin = panStart.view.xmin - dxCanvas * sx;
    view.xmax = panStart.view.xmax - dxCanvas * sx;
    view.ymin = panStart.view.ymin + dyCanvas * sy;
    view.ymax = panStart.view.ymax + dyCanvas * sy;
    renderAll([]);
  });
  window.addEventListener('mouseup', (ev) => {
    if (isPanning) {
      isPanning = false;
      canvas.style.cursor = 'crosshair';
    }
  });

  // wheel to zoom
  canvas.addEventListener('wheel', (ev) => {
    const factor = Math.exp(ev.deltaY * -0.0012);
    const cp = windowToCanvasPixels(ev.clientX, ev.clientY);
    const mouse = canvasToWorld(cp.x, cp.y);
    const wx = mouse.x, wy = mouse.y;
    const newWidth = (view.xmax - view.xmin) * factor;
    const newHeight = (view.ymax - view.ymin) * factor;
    view.xmin = wx - (wx - view.xmin) * factor;
    view.xmax = view.xmin + newWidth;
    view.ymin = wy - (wy - view.ymin) * factor;
    view.ymax = view.ymin + newHeight;
    renderAll([]);
    ev.preventDefault();
  });

  // initial rendering
  autoFitView();
  renderAll([]);

  // expose for debugging (optional)
  window._lab5 = {
    segments, rectWindow, polygon, renderAll, cohenSutherlandClip, cyrusBeckClip
  };

  // initial status
  status.textContent = 'Готово. Загрузите входные данные или используйте пример.';
})();
