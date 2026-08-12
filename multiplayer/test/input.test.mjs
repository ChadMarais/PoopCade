import test from "node:test";
import assert from "node:assert/strict";

const { InputController, resolveKeyboardInput, smoothMovementVector, virtualDragVector } = await import("../../games/game-03/input.js");

function keys(...codes) { return new Set(codes); }
function close(actual, expected, tolerance = .002) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should be near ${expected}`);
}

test("WASD movement and arrow aim/fire resolve independently", () => {
  const input = resolveKeyboardInput(keys("KeyW", "ArrowRight"));
  assert.deepEqual({ x: input.movement.x, y: input.movement.y }, { x: 0, y: -1 });
  assert.deepEqual({ x: input.aim.x, y: input.aim.y }, { x: 1, y: 0 });
  assert.equal(input.fire, true);
});

test("movement and aim diagonals are normalized", () => {
  const input = resolveKeyboardInput(keys("KeyW", "KeyD", "ArrowUp", "ArrowRight"));
  close(input.movement.x, Math.SQRT1_2);
  close(input.movement.y, -Math.SQRT1_2);
  close(input.aim.x, Math.SQRT1_2);
  close(input.aim.y, -Math.SQRT1_2);
  assert.equal(input.fire, true);
  close(Math.hypot(input.movement.x, input.movement.y), 1);
  close(Math.hypot(input.aim.x, input.aim.y), 1);
});

test("opposing input resolves cleanly while the other axis remains active", () => {
  const input = resolveKeyboardInput(keys("KeyA", "KeyD", "KeyW", "ArrowDown"));
  assert.deepEqual({ x: input.movement.x, y: input.movement.y }, { x: 0, y: -1 });
  assert.deepEqual({ x: input.aim.x, y: input.aim.y }, { x: 0, y: 1 });
  assert.equal(input.fire, true);
});

test("A plus Down moves west while aiming and firing south", () => {
  const input = resolveKeyboardInput(keys("KeyA", "ArrowDown"));
  assert.deepEqual({ x: input.movement.x, y: input.movement.y }, { x: -1, y: 0 });
  assert.deepEqual({ x: input.aim.x, y: input.aim.y }, { x: 0, y: 1 });
  assert.equal(input.fire, true);
});

test("alternate arrows plus IJKL layout remains available", () => {
  const input = resolveKeyboardInput(keys("ArrowLeft", "ArrowDown", "KeyI", "KeyL"), "alternate");
  close(input.movement.x, -Math.SQRT1_2);
  close(input.movement.y, Math.SQRT1_2);
  close(input.aim.x, Math.SQRT1_2);
  close(input.aim.y, -Math.SQRT1_2);
});

test("movement response reaches near-full input in about 90ms and settles near zero in about 66ms", () => {
  let movement = { x: 0, y: 0 };
  for (let elapsed = 0; elapsed < .09; elapsed += .015) movement = smoothMovementVector(movement, { x: 1, y: 0 }, .015);
  assert.ok(movement.x > .94, `acceleration was ${movement.x}`);
  for (let elapsed = 0; elapsed < .066; elapsed += .011) movement = smoothMovementVector(movement, { x: 0, y: 0 }, .011);
  assert.ok(movement.x < .06, `deceleration was ${movement.x}`);
});

test("anywhere-drag touch movement uses a deadzone and normalized full-speed diagonals", () => {
  assert.deepEqual(virtualDragVector(100, 100, 105, 104), { x: 0, y: 0, length: 0 });
  const east = virtualDragVector(100, 100, 126, 100);
  close(east.x, .5);
  close(east.y, 0);
  const diagonal = virtualDragVector(100, 100, 200, 200);
  close(diagonal.x, Math.SQRT1_2);
  close(diagonal.y, Math.SQRT1_2);
  close(diagonal.length, 1);
});

test("mobile free-move and draggable fire controls work simultaneously", () => {
  class FakeElement {
    constructor() {
      this.listeners = new Map();
      this.children = new Map();
      this.style = { setProperty() {}, removeProperty() {} };
      this.classList = { add() {}, remove() {} };
      this.clientWidth = 800;
      this.clientHeight = 500;
      this.hidden = true;
    }
    addEventListener(type, callback) { this.listeners.set(type, [...(this.listeners.get(type) || []), callback]); }
    dispatch(type, event) {
      const value = { preventDefault() {}, stopPropagation() {}, pointerType: "touch", button: 0, ...event };
      for (const callback of this.listeners.get(type) || []) callback(value);
    }
    querySelector(selector) { return this.children.get(selector) || null; }
    setPointerCapture() {}
    releasePointerCapture() {}
    getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  }

  const fakeWindow = new FakeElement();
  globalThis.window = fakeWindow;
  globalThis.matchMedia = () => ({ matches: false });
  const canvas = new FakeElement();
  const guide = new FakeElement();
  guide.children.set(".mobile-move-knob", new FakeElement());
  const fireButton = new FakeElement();
  const controller = new InputController(canvas, null, null, {
    movementSurface: canvas, movementGuide: guide, fireButton,
  });
  controller.enabled = true;

  canvas.dispatch("pointerdown", { pointerId: 1, clientX: 100, clientY: 100 });
  canvas.dispatch("pointermove", { pointerId: 1, clientX: 152, clientY: 100 });
  fireButton.clientWidth = 80;
  fireButton.clientHeight = 80;
  fireButton.dispatch("pointerdown", { pointerId: 2, clientX: 40, clientY: 40 });
  fireButton.dispatch("pointermove", { pointerId: 2, clientX: 40, clientY: 0 });
  controller.lastSampleAt = performance.now() - 50;
  const simultaneous = controller.sample();
  assert.ok(simultaneous.moveX > .7);
  close(simultaneous.moveY, 0);
  close(simultaneous.aimX, 0);
  assert.ok(simultaneous.aimY < -.85);
  assert.equal(simultaneous.fire, true);
  assert.equal(guide.hidden, false);

  fireButton.dispatch("pointerup", { pointerId: 2, clientX: 40, clientY: 0 });
  controller.lastSampleAt = performance.now() - 20;
  assert.equal(controller.sample().fire, true, "a quick tap remains queued until the shot is acknowledged");
  controller.acknowledgeFire();
  controller.lastSampleAt = performance.now() - 50;
  const movementAim = controller.sample();
  assert.ok(movementAim.aimX > .99);
  close(movementAim.aimY, 0);
  assert.equal(movementAim.fire, false);
  canvas.dispatch("pointerup", { pointerId: 1, clientX: 152, clientY: 100 });
  assert.equal(guide.hidden, true);
});

test("a directional fire tap uses its new aim on the very first sample", () => {
  class FakeElement {
    constructor(width = 80, height = 80) {
      this.listeners = new Map();
      this.style = { setProperty() {}, removeProperty() {} };
      this.classList = { add() {}, remove() {} };
      this.clientWidth = width;
      this.clientHeight = height;
    }
    addEventListener(type, callback) { this.listeners.set(type, [...(this.listeners.get(type) || []), callback]); }
    dispatch(type, event) {
      const value = { preventDefault() {}, stopPropagation() {}, pointerType: "touch", button: 0, ...event };
      for (const callback of this.listeners.get(type) || []) callback(value);
    }
    querySelector() { return null; }
    setPointerCapture() {}
    releasePointerCapture() {}
    getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight }; }
  }

  const fakeWindow = new FakeElement(800, 500);
  globalThis.window = fakeWindow;
  globalThis.matchMedia = () => ({ matches: true });
  const canvas = new FakeElement(800, 500);
  const fireButton = new FakeElement();
  const controller = new InputController(canvas, null, null, { movementSurface: canvas, fireButton });
  controller.enabled = true;
  controller.aimTouch = { x: 0, y: -1, firing: false };

  fireButton.dispatch("pointerdown", { pointerId: 9, clientX: 40, clientY: 80 });
  controller.lastSampleAt = performance.now() - 20;
  const firstShot = controller.sample();

  close(firstShot.aimX, 0);
  assert.ok(firstShot.aimY > .85);
  assert.equal(firstShot.fire, true);
});
