'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { defaultPlan, sanitizePlan, roomsOnLink } = require('../src/plan');

test('finds the rooms the signal passes through', () => {
  const names = roomsOnLink(defaultPlan()).map((r) => r.name);
  assert.ok(names.includes('Living room'));
  assert.ok(names.includes('Office'));
  assert.ok(!names.includes('Kitchen'));
});

test('cleans up a layout sent by the dashboard', () => {
  const plan = sanitizePlan({
    width: 20,
    height: 14,
    rooms: [
      { id: 'a', name: '  Küche\n ', x: 1.26, y: 2, w: 500, h: 3 },
      { id: 'a', name: 5, x: 'nope', y: -4, w: 2, h: 2 },
      'junk',
    ],
    router: { x: 99, y: 2 },
    pc: null,
  });
  assert.strictEqual(plan.rooms.length, 2);
  assert.strictEqual(plan.rooms[0].name, 'Küche');
  assert.strictEqual(plan.rooms[0].w, 20);
  assert.strictEqual(plan.rooms[0].x, 0);
  assert.notStrictEqual(plan.rooms[1].id, 'a');
  assert.strictEqual(plan.rooms[1].name, 'Room');
  assert.strictEqual(plan.router.x, 20);
  assert.deepStrictEqual(plan.pc, { x: 17, y: 11 });
});

test('never accepts more than 40 rooms', () => {
  const rooms = Array.from({ length: 100 }, (_, i) => ({ id: `r${i}`, name: 'x', x: 0, y: 0, w: 1, h: 1 }));
  assert.strictEqual(sanitizePlan({ rooms }).rooms.length, 40);
});
