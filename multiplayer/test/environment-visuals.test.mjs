import assert from "node:assert/strict";
import test from "node:test";
import { DustyOrbitMultiplayerRenderer } from "../../games/game-03/renderer.js";

test("east relay renders as a horizontal mirror around its world anchor", () => {
  const calls = [];
  const renderer = Object.create(DustyOrbitMultiplayerRenderer.prototype);
  renderer.camera = { x: 0, y: 0 };
  renderer.viewport = { width: 3200, height: 2000 };
  renderer.ctx = {
    save: () => calls.push(["save"]),
    translate: (x, y) => calls.push(["translate", x, y]),
    scale: (x, y) => calls.push(["scale", x, y]),
    drawImage: (...args) => calls.push(["drawImage", ...args]),
    restore: () => calls.push(["restore"]),
  };
  const image = {};
  renderer.drawEnvironmentObject({
    id: "SATELLITE RELAY EAST", kind: "satellite", x: 2700, y: 1200,
    width: 460, height: 460, image, definition: { render: { flipX: true } },
  }, false);
  assert.deepEqual(calls, [
    ["save"],
    ["translate", 2700, 1200],
    ["scale", -1, 1],
    ["drawImage", image, -230, -230, 460, 460],
    ["restore"],
  ]);
});
