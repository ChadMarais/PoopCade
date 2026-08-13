import assert from "node:assert/strict";
import test from "node:test";
import { consumeFixedStep, convergeVisualPosition } from "../../games/game-03/timing.js";

function simulateFrames(frameRate, seconds = 1) {
  const step = 1 / 30;
  let remainder = 0;
  let consumed = 0;
  for (let frame = 0; frame < frameRate * seconds; frame++) {
    const timing = consumeFixedStep(remainder, 1 / frameRate, step);
    remainder = timing.remainder;
    if (timing.consumed) consumed++;
  }
  return { consumed, remainder };
}

test("fixed-step pacing retains fractional frame time at high refresh rates", () => {
  for (const frameRate of [60, 72, 80, 120, 144]) {
    const result = simulateFrames(frameRate);
    assert.equal(result.consumed, 30, `${frameRate} Hz should still produce 30 movement steps`);
    assert.ok(result.remainder < 1e-7);
  }
});

test("fixed-step pacing consumes at most one movement step per rendered frame", () => {
  const result = consumeFixedStep(1 / 40, .05, 1 / 30);
  assert.equal(result.consumed, true);
  assert.ok(result.remainder > 1 / 30);
});

test("visual convergence softens a fixed-tick strafe jump without delaying integrated input", () => {
  const integrated = { x: 1, y: -3 };
  const fixedTickTarget = { x: 4, y: -3 };
  const result = convergeVisualPosition(integrated, fixedTickTarget, 1 / 60, 8);
  assert.ok(result.x > integrated.x, "the render still follows authoritative prediction");
  assert.ok(result.x < 1.5, `the first rendered strafe correction was ${result.x}`);
  assert.equal(result.y, integrated.y);
});

test("visual convergence leaves an already-correct responsive path untouched", () => {
  assert.deepEqual(
    convergeVisualPosition({ x: 18, y: 27 }, { x: 18, y: 27 }, 1 / 60, 8),
    { x: 18, y: 27 },
  );
});

test("visual convergence snaps only for genuine discontinuities such as teleports", () => {
  assert.deepEqual(
    convergeVisualPosition({ x: 100, y: 100 }, { x: 700, y: 500 }, 1 / 60, 8),
    { x: 700, y: 500 },
  );
});
