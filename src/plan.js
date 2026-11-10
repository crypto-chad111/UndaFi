'use strict';

// The floor plan: rooms drawn by the owner, plus where the router and the PC
// are. WiFi Sentinel does not discover walls; the owner draws them once.

const MAX_ROOMS = 40;

function num(value, lo, hi, fallback) {
  const n = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n * 2) / 2)); // snap to half units
}

function text(value, max, fallback = '') {
  if (typeof value !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) || fallback;
}

function defaultPlan() {
  return {
    width: 20,
    height: 14,
    example: true, // shown as "example layout" until the owner saves their own
    rooms: [
      { id: 'r1', name: 'Living room', x: 1, y: 1, w: 9, h: 7 },
      { id: 'r2', name: 'Kitchen', x: 10, y: 1, w: 9, h: 5 },
      { id: 'r3', name: 'Hallway', x: 10, y: 6, w: 9, h: 2 },
      { id: 'r4', name: 'Bedroom', x: 1, y: 8, w: 9, h: 5 },
      { id: 'r5', name: 'Office', x: 10, y: 8, w: 9, h: 5 },
    ],
    router: { x: 3, y: 3 },
    pc: { x: 16, y: 11 },
  };
}

function sanitizePlan(input) {
  const src = input && typeof input === 'object' ? input : {};
  const width = num(src.width, 6, 60, 20);
  const height = num(src.height, 6, 60, 14);
  const rooms = [];
  const seen = new Set();
  for (const r of Array.isArray(src.rooms) ? src.rooms.slice(0, MAX_ROOMS) : []) {
    if (!r || typeof r !== 'object') continue;
    let id = text(r.id, 24, '').replace(/[^A-Za-z0-9_-]/g, '');
    if (!id || seen.has(id)) id = `r${rooms.length + 1}_${Math.random().toString(36).slice(2, 7)}`;
    seen.add(id);
    const w = num(r.w, 1, width, 4);
    const h = num(r.h, 1, height, 3);
    rooms.push({
      id,
      name: text(r.name, 40, 'Room'),
      x: num(r.x, 0, width - w, 0),
      y: num(r.y, 0, height - h, 0),
      w,
      h,
    });
  }
  const point = (p, fx, fy) => ({ x: num(p && p.x, 0, width, fx), y: num(p && p.y, 0, height, fy) });
  return {
    width,
    height,
    example: Boolean(src.example),
    rooms,
    router: point(src.router, 3, 3),
    pc: point(src.pc, width - 3, height - 3),
  };
}

// Does the straight line a->b pass through the rectangle? (Liang-Barsky)
function segmentHitsRect(a, b, r) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const edges = [
    [-dx, a.x - r.x],
    [dx, r.x + r.w - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.h - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return t0 <= t1;
}

// The rooms the signal travels through between the PC and the router. Movement
// that V1 senses is somewhere in these rooms.
function roomsOnLink(plan) {
  return plan.rooms.filter((room) => segmentHitsRect(plan.pc, plan.router, room));
}

module.exports = { defaultPlan, sanitizePlan, roomsOnLink, segmentHitsRect, text };
