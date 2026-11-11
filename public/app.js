'use strict';

/* UndaFi dashboard. Talks to the app on this PC; nothing else. */

const $ = (id) => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';
const U = 40; // one floor-plan unit = 40 drawing units

let state = null; // latest snapshot from the app
let history = []; // recent signal samples for the chart
let clockOffset = 0; // app clock minus this device's clock
let edit = null; // { plan, selected } while the layout is being edited
let drag = null;
let view3d = false; // remembered per device
try {
  view3d = localStorage.getItem('undafi-3d') === '1';
} catch {
  /* storage blocked: start in 2D */
}

function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function post(path, body = {}) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'The app did not accept that.');
  if (data.state) applyState(data.state);
  return data;
}

function applyState(next) {
  if (next.history) history = next.history;
  clockOffset = next.now - Date.now();
  state = next;
  if (state.mode === 'off') history = [];
  render();
}

const appNow = () => Date.now() + clockOffset;

/* ---------- status ---------- */

function monitoring() {
  return state && state.mode !== 'off';
}

function sensorProblem() {
  return monitoring() && !['ok', 'starting', 'idle'].includes(state.sensor.status);
}

function renderStatus() {
  const status = $('statusLine');
  const btn = $('powerBtn');
  const m = state.mode;
  let line = 'OFF';
  let cls = 'status';
  let title = 'Monitoring is off';
  let sub = 'Press the button when you leave.';

  if (m === 'test') {
    line = state.motion ? 'MOVEMENT DETECTED (TEST)' : 'TEST MODE';
    cls = state.motion ? 'status alarm' : 'status on';
    title = 'Test mode';
    sub = 'Watching and drawing, but no alerts are sent.';
  } else if (m === 'arming') {
    const left = Math.max(0, Math.ceil((state.armAt - appNow()) / 1000));
    line = `ON IN ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    cls = 'status wait';
    title = 'Switching on';
    sub = 'Time to leave. Alerts start when the countdown ends.';
  } else if (m === 'armed') {
    line = state.motion ? 'MOVEMENT DETECTED' : 'ON · WATCHING';
    cls = state.motion ? 'status alarm' : 'status on';
    title = 'Monitoring is on';
    sub = 'Movement sends an alert.';
  }
  if (monitoring() && !state.motion && m !== 'arming') {
    if (sensorProblem()) {
      line = 'CANNOT READ WIFI';
      cls = 'status wait';
    } else if (!state.detector.ready) {
      line = 'LEARNING THE QUIET SIGNAL';
      cls = 'status wait';
    }
  }
  if (!connected) {
    line = 'NOT CONNECTED';
    cls = 'status wait';
  }
  status.textContent = state.demo ? `DEMO · ${line}` : line;
  status.className = cls;

  btn.className = `power-btn${m === 'armed' ? ' on' : m === 'arming' ? ' arming' : m === 'test' ? ' test' : ''}`;
  btn.setAttribute('aria-pressed', String(m === 'armed' || m === 'arming'));
  $('powerLabel').textContent = m === 'armed' || m === 'arming' ? 'ON' : 'OFF';
  $('powerTitle').textContent = title;
  $('powerSub').textContent = sub;
  const testBtn = $('testBtn');
  testBtn.hidden = m === 'armed' || m === 'arming';
  testBtn.textContent = m === 'test' ? 'Stop test' : 'Test at home (no alerts)';

  const warn = $('sensorWarn');
  const detail = monitoring() ? state.sensor.detail : '';
  warn.hidden = !detail;
  warn.textContent = detail;

  $('demoBadge').hidden = !state.demo;
  $('demoWarn').hidden = !state.demo;
  $('recalBtn').disabled = !monitoring();
}

/* ---------- floor plan ---------- */

// Outline of a standing person, drawn in a 40 x 100 box.
const PERSON =
  'M16 20 L7 25 L3 53 L9 54 L12 34 L12 59 L9 97 L18 97 L20 67 L22 97 L31 97 L28 59 L28 34 L31 54 L37 53 L33 25 L24 20 Z';
// Outline of a small four-legged animal, drawn in a 60 x 40 box.
const PET =
  'M5 6 C1 12 3 21 10 22 L10 36 L15 36 L16 28 L36 28 L37 36 L42 36 L42 23 C49 23 55 19 55 13 L57 4 L51 8 L47 8 L43 3 L42 11 C36 14 22 13 15 15 C10 15 9 11 9 6 Z';

function linkGeometry(plan) {
  const ax = plan.pc.x * U;
  const ay = plan.pc.y * U;
  const bx = plan.router.x * U;
  const by = plan.router.y * U;
  const len = Math.hypot(bx - ax, by - ay);
  return { ax, ay, bx, by, len, cx: (ax + bx) / 2, cy: (ay + by) / 2, angle: (Math.atan2(by - ay, bx - ax) * 180) / Math.PI };
}

function renderMap() {
  const map = $('map');
  const plan = edit ? edit.plan : state.plan;
  const W = plan.width * U;
  const H = plan.height * U;
  // Icons, labels and the figure keep their size on screen when the grid grows.
  const k = plan.width / 20;
  const narrow = window.matchMedia('(max-width: 920px)').matches;
  // 3D view: the same floor plan, turned and tilted, with the room outlines
  // raised into wireframe walls. Only the drawing changes. Editing is 2D.
  const three = view3d && !edit;
  const wallH = 0.9 * U;
  let m = [1, 0, 0, 1, 0, 0];
  let boxW = W;
  let boxH = H;
  if (three) {
    const turn = Math.PI / 6;
    const tilt = 0.55;
    const a = Math.cos(turn);
    const b = tilt * Math.sin(turn);
    const c = -Math.sin(turn);
    const d = tilt * Math.cos(turn);
    const xs = [0, a * W, c * H, a * W + c * H];
    const ys = [0, b * W, d * H, b * W + d * H];
    const pad = 30 * k;
    const head = wallH + 50 * k; // room above the far walls for labels
    m = [a, b, c, d, pad - Math.min(...xs), pad + head - Math.min(...ys)];
    boxW = Math.max(...xs) - Math.min(...xs) + 2 * pad;
    boxH = Math.max(...ys) - Math.min(...ys) + 2 * pad + head;
  }
  const at = (x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
  const floor = svg('g', three ? { transform: `matrix(${m.join(' ')})` } : {});
  const walls = svg('g');
  map.setAttribute('viewBox', `0 0 ${boxW} ${boxH}`);
  map.replaceChildren();

  const defs = svg('defs');
  const glow = svg('filter', { id: 'glow', x: '-40%', y: '-40%', width: '180%', height: '180%' });
  glow.append(svg('feGaussianBlur', { stdDeviation: 5 * k, result: 'b' }));
  const merge = svg('feMerge');
  merge.append(svg('feMergeNode', { in: 'b' }), svg('feMergeNode', { in: 'SourceGraphic' }));
  glow.append(merge);
  const grad = svg('radialGradient', { id: 'bandFill' });
  grad.append(svg('stop', { offset: '0', 'stop-color': '#3dff8f', 'stop-opacity': '0.20' }), svg('stop', { offset: '1', 'stop-color': '#3dff8f', 'stop-opacity': '0.02' }));
  const dots = svg('pattern', { id: 'dots', width: U, height: U, patternUnits: 'userSpaceOnUse' });
  dots.append(svg('circle', { class: 'grid-dot', cx: 0.5, cy: 0.5, r: 1.3 * k }));
  defs.append(glow, grad, dots);
  map.append(defs, floor, walls);
  floor.append(svg('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#dots)' }));

  const g = linkGeometry(plan);
  const watching = !edit && monitoring() && !sensorProblem();
  const motion = !edit && state.motion;
  const covered = new Set(edit ? [] : state.linkRooms);

  // The sensing zone: the band between the PC and the router.
  floor.append(
    svg('ellipse', {
      class: `band${motion ? ' hot' : watching ? ' watching' : ''}`,
      cx: g.cx,
      cy: g.cy,
      rx: g.len / 2 + 0.7 * U,
      ry: Math.max(1.3 * U, g.len * 0.17),
      transform: `rotate(${g.angle} ${g.cx} ${g.cy})`,
    }),
  );

  const baseFont = (narrow ? 24 : 15) * k;
  for (const room of plan.rooms) {
    const hot = motion && covered.has(room.id);
    const cls = ['room'];
    if (covered.has(room.id)) cls.push('covered');
    if (hot) cls.push('hot');
    if (edit) cls.push('draggable');
    if (edit && edit.selected === room.id) cls.push('selected');
    const rect = svg('rect', { class: cls.join(' '), x: room.x * U, y: room.y * U, width: room.w * U, height: room.h * U, 'data-room': room.id });
    // Shrink the name so it stays inside a small room.
    const fit = (room.w * U - 14 * k) / (0.68 * Math.max(1, room.name.length));
    const font = Math.max(5 * k, Math.min(baseFont, fit, room.h * U * 0.6));
    floor.append(rect);
    if (!three) {
      floor.append(svg('text', { class: `room-label${hot ? ' hot' : ''}`, x: room.x * U + 7 * k, y: room.y * U + font * 1.3 + 2 * k, 'font-size': font }, room.name));
    } else {
      // Walls: a post at each corner and the outline again at ceiling height.
      const corners = [
        at(room.x * U, room.y * U),
        at((room.x + room.w) * U, room.y * U),
        at((room.x + room.w) * U, (room.y + room.h) * U),
        at(room.x * U, (room.y + room.h) * U),
      ];
      const wallClass = `wall${hot ? ' hot' : covered.has(room.id) ? ' covered' : ''}`;
      for (const p of corners) walls.append(svg('line', { class: wallClass, x1: p.x, y1: p.y, x2: p.x, y2: p.y - wallH }));
      walls.append(svg('polygon', { class: `${wallClass} top`, points: corners.map((p) => `${p.x},${p.y - wallH}`).join(' ') }));
      const mid = at((room.x + room.w / 2) * U, (room.y + room.h / 2) * U);
      walls.append(svg('text', { class: `room-label${hot ? ' hot' : ''}`, x: mid.x, y: mid.y, 'text-anchor': 'middle', 'font-size': Math.min(font, baseFont * 0.85) }, room.name));
    }
  }

  floor.append(svg('line', { class: 'link', x1: g.ax, y1: g.ay, x2: g.bx, y2: g.by }));
  // Upright things stand on the floor at these points.
  const routerAt = at(g.bx, g.by);
  const pcAt = at(g.ax, g.ay);
  const midAt = at(g.cx, g.cy);
  const lift = three ? 1 : 0;

  if (watching) {
    // The WiFi pulse spreads from the router across the whole home, because
    // the WiFi itself does reach every room. (Where the app can notice
    // movement is the glowing band, not the rings.)
    const reach = Math.max(
      Math.hypot(g.bx, g.by),
      Math.hypot(W - g.bx, g.by),
      Math.hypot(g.bx, H - g.by),
      Math.hypot(W - g.bx, H - g.by),
    );
    for (const r of ['r1', 'r2', 'r3', 'r4']) floor.append(svg('circle', { class: `ring ${r}`, cx: g.bx, cy: g.by, r: reach }));
  }

  const router = svg('g', { class: edit ? 'draggable' : '', 'data-device': 'router', transform: `translate(${routerAt.x} ${routerAt.y - lift * 14 * k}) scale(${k})` });
  router.append(
    svg('circle', { class: 'device', cx: 0, cy: 0, r: 13 }),
    svg('path', { class: 'device-mark', d: 'M-7 -2 a10 10 0 0 1 14 0 M-3.5 2 a5 5 0 0 1 7 0' }),
    svg('circle', { cx: 0, cy: 6, r: 1.6, fill: '#3dff8f' }),
    svg('text', { class: 'device-label', x: 0, y: !three && g.by < 46 * k ? 30 : -20, 'text-anchor': 'middle' }, 'ROUTER'),
  );
  const pc = svg('g', { class: edit ? 'draggable' : '', 'data-device': 'pc', transform: `translate(${pcAt.x} ${pcAt.y - lift * 15 * k}) scale(${k})` });
  pc.append(
    svg('rect', { class: 'device', x: -14, y: -11, width: 28, height: 19, rx: 2 }),
    svg('path', { class: 'device-mark', d: 'M-7 13 h14 M0 8 v5' }),
    svg('text', { class: 'device-label', x: 0, y: !three && g.ay < 46 * k ? 30 : -18, 'text-anchor': 'middle' }, 'PC'),
  );
  map.append(router, pc);

  if (motion) {
    // The figure is a marker for "movement somewhere in this band". It does
    // not follow the person: the app cannot know where in the band they are.
    const small = state.motion.size === 'small';
    const patrol = svg('g', { class: 'figure-still' });
    // In 3D the figure stands with its feet on the floor.
    const fig = svg('g', { transform: `translate(${midAt.x} ${midAt.y - lift * (small ? 16 : 45) * k}) scale(${k})` });
    if (small) {
      fig.append(svg('path', { class: 'figure', d: PET, transform: 'translate(-30 -20)' }));
    } else {
      const body = svg('g', { transform: 'translate(-20 -52)' });
      body.append(svg('circle', { class: 'figure', cx: 20, cy: 9, r: 8 }), svg('path', { class: 'figure', d: PERSON }));
      fig.append(body);
    }
    fig.append(svg('text', { class: 'figure-label', x: 0, y: small ? -32 : -64 }, small ? 'SMALL MOVEMENT SOMEWHERE IN THIS BAND' : 'MOVEMENT SOMEWHERE IN THIS BAND'));
    patrol.append(fig);
    map.append(patrol);
  }

  if (edit && edit.selected) {
    const room = plan.rooms.find((r) => r.id === edit.selected);
    const size = 18 * k;
    if (room) map.append(svg('rect', { class: 'handle', x: (room.x + room.w) * U - size / 2, y: (room.y + room.h) * U - size / 2, width: size, height: size, 'data-handle': room.id }));
  }

  renderCaption(plan, covered);
}

function renderCaption(plan, covered) {
  const caption = $('caption');
  if (edit) {
    caption.textContent = 'Drag rooms to move them, drag the white corner to resize, and drag ROUTER and PC to where they really are. Out of space? Raise the two "Grid" numbers: you get more squares and everything is drawn smaller. Then save.';
    return;
  }
  const names = plan.rooms.filter((r) => covered.has(r.id)).map((r) => r.name);
  const zone = names.length ? `Sensing zone: ${names.join(', ')}.` : 'Sensing zone: the band between PC and router.';
  const example = plan.example ? ' This is an example layout: press "Edit layout" to draw your own home.' : '';
  caption.textContent = `The rings show your WiFi reaching the whole home. ${zone} That glowing band is where this version can notice movement; movement in other rooms is mostly missed. The figure is only a marker: it does not follow the person, and the app cannot tell which room in the band. It appears a second or two after movement starts and stays about ten seconds after it stops. Its size is a guess from how strong the disturbance was.${example}`;
}

/* ---------- layout editor ---------- */

function mapPoint(evt) {
  const map = $('map');
  const pt = map.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  const p = pt.matrixTransform(map.getScreenCTM().inverse());
  return { x: p.x / U, y: p.y / U };
}

const snap = (n) => Math.round(n * 4) / 4;
const within = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function renderEditBar() {
  $('editBar').hidden = !edit;
  $('editBtn').hidden = Boolean(edit);
  $('view3dBtn').hidden = Boolean(edit);
  $('view3dBtn').textContent = view3d ? '2D view' : '3D view';
  $('view3dBtn').setAttribute('aria-pressed', String(view3d));
  if (!edit) return;
  const room = edit.plan.rooms.find((r) => r.id === edit.selected);
  const name = $('roomName');
  name.disabled = !room;
  if (document.activeElement !== name) name.value = room ? room.name : '';
  $('delRoomBtn').disabled = !room;
  if (document.activeElement !== $('gridW')) $('gridW').value = edit.plan.width;
  if (document.activeElement !== $('gridH')) $('gridH').value = edit.plan.height;
}

// The grid can never shrink past what is already drawn on it.
function resizeGrid() {
  const plan = edit.plan;
  let minW = Math.max(6, plan.router.x, plan.pc.x);
  let minH = Math.max(6, plan.router.y, plan.pc.y);
  for (const r of plan.rooms) {
    minW = Math.max(minW, r.x + r.w);
    minH = Math.max(minH, r.y + r.h);
  }
  plan.width = within(Math.round(Number($('gridW').value) || plan.width), Math.ceil(minW), 80);
  plan.height = within(Math.round(Number($('gridH').value) || plan.height), Math.ceil(minH), 80);
  $('gridW').value = plan.width;
  $('gridH').value = plan.height;
  renderMap();
}

function startEdit() {
  edit = { plan: JSON.parse(JSON.stringify(state.plan)), selected: null };
  render();
}

$('map').addEventListener('pointerdown', (evt) => {
  if (!edit) return;
  const target = evt.target;
  const p = mapPoint(evt);
  const handle = target.getAttribute('data-handle');
  const roomId = target.getAttribute('data-room');
  const deviceNode = target.closest('[data-device]');
  if (handle) {
    drag = { kind: 'resize', id: handle };
  } else if (deviceNode) {
    drag = { kind: 'device', id: deviceNode.getAttribute('data-device') };
  } else if (roomId) {
    const room = edit.plan.rooms.find((r) => r.id === roomId);
    edit.selected = roomId;
    drag = { kind: 'move', id: roomId, dx: p.x - room.x, dy: p.y - room.y };
  } else {
    edit.selected = null;
  }
  if (drag) $('map').setPointerCapture(evt.pointerId);
  renderEditBar();
  renderMap();
});

$('map').addEventListener('pointermove', (evt) => {
  if (!edit || !drag) return;
  const plan = edit.plan;
  const p = mapPoint(evt);
  if (drag.kind === 'device') {
    plan[drag.id] = { x: within(snap(p.x), 0, plan.width), y: within(snap(p.y), 0, plan.height) };
  } else {
    const room = plan.rooms.find((r) => r.id === drag.id);
    if (!room) return;
    if (drag.kind === 'move') {
      room.x = within(snap(p.x - drag.dx), 0, plan.width - room.w);
      room.y = within(snap(p.y - drag.dy), 0, plan.height - room.h);
    } else {
      room.w = within(snap(p.x - room.x), 0.5, plan.width - room.x);
      room.h = within(snap(p.y - room.y), 0.5, plan.height - room.y);
    }
  }
  renderMap();
});

for (const type of ['pointerup', 'pointercancel']) {
  $('map').addEventListener(type, () => {
    drag = null;
  });
}

$('editBtn').addEventListener('click', startEdit);
$('view3dBtn').addEventListener('click', () => {
  view3d = !view3d;
  try {
    localStorage.setItem('undafi-3d', view3d ? '1' : '0');
  } catch {
    /* not remembered, still works */
  }
  render();
});
$('gridW').addEventListener('change', resizeGrid);
$('gridH').addEventListener('change', resizeGrid);
$('cancelEditBtn').addEventListener('click', () => {
  edit = null;
  render();
});
$('addRoomBtn').addEventListener('click', () => {
  const id = `r${Date.now().toString(36)}`;
  const n = edit.plan.rooms.length;
  edit.plan.rooms.push({ id, name: `Room ${n + 1}`, x: (n % 4) * 0.5, y: (n % 4) * 0.5, w: 4, h: 3 });
  edit.selected = id;
  render();
  $('roomName').focus();
  $('roomName').select();
});
$('delRoomBtn').addEventListener('click', () => {
  edit.plan.rooms = edit.plan.rooms.filter((r) => r.id !== edit.selected);
  edit.selected = null;
  render();
});
$('roomName').addEventListener('input', (evt) => {
  const room = edit && edit.plan.rooms.find((r) => r.id === edit.selected);
  if (!room) return;
  room.name = evt.target.value;
  renderMap();
});
$('saveEditBtn').addEventListener('click', async () => {
  try {
    const plan = edit.plan;
    edit = null;
    await post('/api/plan', plan);
  } catch (err) {
    alert(err.message);
  }
});

/* ---------- signal chart ---------- */

function renderChart() {
  const canvas = $('chart');
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w) return;
  if (canvas.width !== Math.round(w * ratio)) {
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, w, h);

  ctx.strokeStyle = '#0f2c1c';
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i += 1) {
    ctx.beginPath();
    ctx.moveTo(0, (h * i) / 4);
    ctx.lineTo(w, (h * i) / 4);
    ctx.stroke();
  }

  const last = history[history.length - 1];
  $('signalNow').textContent = last && monitoring() ? `${last.dbm} dBm` : '';
  const level = last && monitoring() ? last.level : 0;
  const threshold = state ? state.detector.threshold : 3;
  const fill = $('meterFill');
  fill.style.width = `${Math.min(100, (level / (threshold * 2)) * 100)}%`;
  fill.className = level >= threshold ? 'over' : '';

  renderDiag();
  if (history.length < 2 || !monitoring()) return;
  const end = last.t;
  const span = 120000;
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of history) {
    lo = Math.min(lo, s.dbm);
    hi = Math.max(hi, s.dbm);
  }
  const pad = Math.max(0, 10 - (hi - lo)) / 2 + 1;
  lo -= pad;
  hi += pad;
  const x = (t) => w - ((end - t) / span) * w;
  const y = (v) => h - ((v - lo) / (hi - lo)) * h;

  // Link speed (PC to router) as a dim dotted line, on its own scale.
  const speeds = history.filter((s) => Number.isFinite(s.tx));
  if (speeds.length > 1) {
    let slo = Infinity;
    let shi = -Infinity;
    for (const s of speeds) {
      slo = Math.min(slo, s.tx);
      shi = Math.max(shi, s.tx);
    }
    const mid = (slo + shi) / 2;
    const range = Math.max(shi - slo, mid * 0.5, 1);
    const ys = (v) => h / 2 - ((v - mid) / range) * h * 0.8;
    ctx.strokeStyle = '#17703f';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    speeds.forEach((s, i) => (i ? ctx.lineTo(x(s.t), ys(s.tx)) : ctx.moveTo(x(s.t), ys(s.tx))));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  for (let i = 1; i < history.length; i += 1) {
    const a = history[i - 1];
    const b = history[i];
    const hot = b.level >= threshold;
    ctx.strokeStyle = hot ? '#3dff8f' : '#23b866';
    ctx.lineWidth = hot ? 2.2 : 1.3;
    ctx.shadowColor = '#3dff8f';
    ctx.shadowBlur = hot ? 8 : 0;
    ctx.beginPath();
    ctx.moveTo(x(a.t), y(a.dbm));
    ctx.lineTo(x(b.t), y(b.dbm));
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

// Plain facts about what the WiFi card is reporting. Useful for judging how
// well this PC can sense movement at all.
function renderDiag() {
  const box = $('diag');
  box.replaceChildren();
  if (!state || !monitoring() || history.length < 2) return;
  let changes = 0;
  for (let i = 1; i < history.length; i += 1) if (history[i].dbm !== history[i - 1].dbm) changes += 1;
  const seconds = Math.max(1, Math.round((history[history.length - 1].t - history[0].t) / 1000));
  const lines = [`Signal reading changed ${changes} time${changes === 1 ? '' : 's'} in the last ${seconds}s`];
  const last = history[history.length - 1];
  if (Number.isFinite(last.tx) || Number.isFinite(last.rx)) {
    lines.push(`Link speed (dotted line): down ${Number.isFinite(last.rx) ? last.rx : '?'} / up ${Number.isFinite(last.tx) ? last.tx : '?'} Mbps`);
  } else if (!state.demo) {
    lines.push('Link speed: not reported by this WiFi card');
  }
  const d = state.detector.levels;
  if (d) lines.push(`Movement level now: signal ${d.signal.toFixed(1)} · speed ${d.speed.toFixed(1)} · alarm at ${state.detector.threshold.toFixed(1)}`);
  const probe = state.diag && state.diag.probe;
  if (probe && !state.demo) {
    lines.push(probe.state === 'on' ? `Keeping the link busy: on (router ${probe.targets.join(', ')})` : probe.state === 'no-router' ? 'Keeping the link busy: could not find the router' : 'Keeping the link busy: off');
  }
  for (const text of lines) box.append(el('div', '', text));
  if (seconds >= 60 && changes <= 2) {
    box.append(el('div', 'warnline', 'This WiFi card refreshes its signal reading very rarely. Movement is hard to see with it.'));
  }
}

/* ---------- walk test ---------- */

function renderWalkTest() {
  const box = $('walkBox');
  const w = state.walkTest;
  const running = w && w.phase !== 'done';
  $('walkBtn').textContent = running ? 'Stop walk test' : 'Walk test (calibrate)';
  $('walkBtn').disabled = state.mode === 'armed' || state.mode === 'arming';
  box.hidden = !w;
  if (!w) return;
  const left = Math.max(0, Math.ceil((w.phaseEndsAt - appNow()) / 1000));
  let title = '';
  let text = '';
  let wait = true;
  if (w.phase === 'still') {
    title = `Step 1 of 2: sit completely still · ${left}s`;
    text = 'Nobody should move near the PC or the router. Pets too, if you can.';
  } else if (w.phase === 'walk') {
    title = `Step 2 of 2: walk now · ${left}s`;
    text = 'Walk back and forth between the PC and the router, at a normal pace, until this reaches 0.';
  } else {
    wait = false;
    const r = w.result;
    const nums = r.verdict === 'failed' ? '' : ` Sitting still scored ${r.still}, walking scored ${r.walking}.`;
    const speed = r.useSpeed ? 'Link speed is used.' : 'Link speed is not used (it did not help).';
    if (r.verdict === 'good') {
      title = 'Result: good';
      text = `Walking stands out clearly from sitting still.${nums} Sensitivity set to ${r.sensitivity} (alarm at ${r.alarmAt}). ${speed}`;
    } else if (r.verdict === 'weak') {
      title = 'Result: weak';
      text = `Walking shows only a little above sitting still.${nums} Sensitivity set to ${r.sensitivity} (alarm at ${r.alarmAt}). ${speed} Expect some false alarms and some misses.`;
      wait = true;
    } else if (r.verdict === 'disturbed') {
      title = 'Result: try again';
      text = `Something disturbed the readings during the sitting-still step (it scored ${r.still}; a still house scores about 1). Run the test again when nobody is moving.`;
      wait = true;
    } else if (r.verdict === 'none') {
      title = 'Result: this PC cannot tell the difference';
      text = `Walking looked the same as sitting still.${nums} With this WiFi card the app cannot sense movement here. Settings were left as they were.`;
      wait = true;
    } else {
      title = 'Result: not enough readings';
      text = 'The WiFi signal could not be read for long enough. Check the warning above the map and try again.';
      wait = true;
    }
  }
  box.className = `walk${wait ? ' wait' : ''}`;
  $('walkTitle').textContent = title;
  $('walkText').textContent = text;
}

/* ---------- movement log ---------- */

function renderEvents() {
  const list = $('eventList');
  list.replaceChildren();
  if (!state.events.length) {
    list.append(el('li', 'empty', 'No movement recorded yet.'));
    return;
  }
  const today = new Date().toDateString();
  for (const e of state.events) {
    const li = el('li');
    const start = new Date(e.start);
    const day = start.toDateString() === today ? '' : `${start.toLocaleDateString([], { day: 'numeric', month: 'short' })} `;
    const when = el('span', 'when', `${day}${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`);
    const length = e.end ? `${Math.max(1, Math.round((e.end - e.start) / 1000))}s` : 'now';
    const size = e.size === 'large' ? 'large' : 'small';
    const by = e.trigger === 'speed' ? ' · seen in link speed' : e.trigger === 'signal' ? ' · seen in signal' : '';
    li.append(when, el('span', 'meta', `  ${length} · ${size}${by}${e.demo ? ' · demo' : ''}`));
    if (e.rooms && e.rooms.length) li.append(el('div', 'meta', e.rooms.join(', ')));
    const note = el('div', 'meta');
    if (!e.armed) note.textContent = 'test mode, no alert';
    else if (!e.alert) note.textContent = 'no new alert (too soon after the last one, or still sending)';
    else {
      const parts = Object.entries(e.alert).map(([k, v]) => (k === 'none' ? v : `${k === 'ntfy' ? 'push' : k} ${v}`));
      note.textContent = parts.join(' · ');
      if (parts.some((p) => p.includes('failed') || p.includes('No alert'))) note.className = 'fail';
    }
    li.append(note);
    list.append(li);
  }
}

/* ---------- settings ---------- */

function fillSettings() {
  const s = state.settings;
  $('sensitivity').value = s.sensitivity;
  $('sensOut').textContent = s.sensitivity;
  $('useSpeed').checked = s.useSpeed;
  $('keepBusy').checked = s.keepBusy;
  $('confirmSec').value = s.confirmSec;
  $('quietSec').value = s.quietSec;
  $('armDelaySec').value = s.armDelaySec;
  $('alertCooldownSec').value = s.alertCooldownSec;
  $('ntfyEnabled').checked = s.ntfy.enabled;
  $('ntfyTopic').value = s.ntfy.topic;
  $('ntfyServer').value = s.ntfy.server;
  $('emailEnabled').checked = s.email.enabled;
  $('emailHost').value = s.email.host;
  $('emailPort').value = s.email.port;
  $('emailUser').value = s.email.user;
  $('emailPass').value = '';
  $('passState').textContent = s.email.passSet ? '(saved)' : '(none saved)';
  $('emailFrom').value = s.email.from;
  $('emailTo').value = s.email.to;
}

function readSettings() {
  const email = {
    enabled: $('emailEnabled').checked,
    host: $('emailHost').value,
    port: $('emailPort').value,
    user: $('emailUser').value,
    from: $('emailFrom').value,
    to: $('emailTo').value,
  };
  if ($('emailPass').value) email.pass = $('emailPass').value;
  return {
    sensitivity: $('sensitivity').value,
    useSpeed: $('useSpeed').checked,
    keepBusy: $('keepBusy').checked,
    confirmSec: $('confirmSec').value,
    quietSec: $('quietSec').value,
    armDelaySec: $('armDelaySec').value,
    alertCooldownSec: $('alertCooldownSec').value,
    ntfy: { enabled: $('ntfyEnabled').checked, topic: $('ntfyTopic').value, server: $('ntfyServer').value },
    email,
  };
}

function settingsMsg(text, bad) {
  const msg = $('settingsMsg');
  msg.textContent = text;
  msg.className = `hint msg${bad ? ' bad' : ''}`;
}

$('settingsBtn').addEventListener('click', () => {
  fillSettings();
  settingsMsg('');
  $('settingsDlg').showModal();
});
$('closeSettingsBtn').addEventListener('click', () => $('settingsDlg').close());
$('sensitivity').addEventListener('input', (evt) => {
  $('sensOut').textContent = evt.target.value;
});
$('genTopicBtn').addEventListener('click', () => {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  $('ntfyTopic').value = `undafi-${[...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20)}`;
});
$('saveSettingsBtn').addEventListener('click', async () => {
  try {
    await post('/api/settings', readSettings());
    fillSettings();
    settingsMsg('Saved.');
  } catch (err) {
    settingsMsg(err.message, true);
  }
});
$('testAlertBtn').addEventListener('click', async () => {
  try {
    settingsMsg('Saving and sending a test alert…');
    await post('/api/settings', readSettings());
    fillSettings();
    const { result } = await post('/api/test-alert');
    const parts = Object.entries(result).map(([k, v]) => (k === 'none' ? 'Switch on push or email first.' : `${k === 'ntfy' ? 'Push' : 'Email'}: ${v}`));
    settingsMsg(parts.join('  ·  '), parts.some((p) => p.includes('failed') || p.includes('Switch on')));
  } catch (err) {
    settingsMsg(err.message, true);
  }
});

/* ---------- main buttons ---------- */

async function act(fn) {
  try {
    await fn();
  } catch (err) {
    alert(err.message);
  }
}

$('powerBtn').addEventListener('click', () =>
  act(() => post('/api/mode', { mode: state.mode === 'armed' || state.mode === 'arming' ? 'off' : 'armed' })),
);
$('testBtn').addEventListener('click', () => act(() => post('/api/mode', { mode: state.mode === 'test' ? 'off' : 'test' })));
$('recalBtn').addEventListener('click', () => act(() => post('/api/recalibrate')));
$('walkBtn').addEventListener('click', () => {
  const running = state.walkTest && state.walkTest.phase !== 'done';
  act(() => post('/api/walk-test', { action: running ? 'cancel' : 'start' }));
});
$('clearBtn').addEventListener('click', () => {
  if (confirm('Clear the whole movement log?')) act(() => post('/api/events/clear'));
});

/* ---------- render + live updates ---------- */

function render() {
  if (!state) return;
  renderStatus();
  renderWalkTest();
  renderEditBar();
  if (!drag) renderMap();
  renderChart();
  renderEvents();
  const remote = state.urls.filter((u) => !u.includes('localhost'));
  $('urls').textContent = remote.length
    ? `From your other Tailscale devices: ${remote.join('  ')}`
    : 'Tailscale address not found on this PC yet. Start Tailscale to open this page from your phone.';
}

// When the app on the PC stops (or the link to it drops), the page must not
// go on looking as if it were watching: everything on it is then old.
let connected = true;
function setConnected(ok) {
  connected = ok;
  $('connDot').className = `dot${ok ? ' ok' : ''}`;
  $('connText').textContent = ok ? 'Connected' : 'Not connected';
  $('offlineWarn').hidden = ok;
  document.body.classList.toggle('offline', !ok);
  if (state) renderStatus();
}

async function load() {
  const res = await fetch('/api/state');
  applyState(await res.json());
}

function connect() {
  const stream = new EventSource('/api/stream');
  stream.addEventListener('open', () => {
    setConnected(true);
    load().catch(() => {});
  });
  stream.addEventListener('error', () => setConnected(false));
  stream.addEventListener('state', (evt) => applyState(JSON.parse(evt.data)));
  stream.addEventListener('sample', (evt) => {
    const sample = JSON.parse(evt.data);
    history.push(sample);
    while (history.length && history[0].t < sample.t - 120000) history.shift();
    renderChart();
  });
}

setInterval(() => {
  if (state && state.mode === 'arming') renderStatus();
  if (state && state.walkTest && state.walkTest.phase !== 'done') renderWalkTest();
}, 500);
window.addEventListener('resize', () => {
  renderChart();
  if (state && !drag) renderMap();
});

load().catch(() => {});
connect();
