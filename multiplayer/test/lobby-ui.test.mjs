import assert from "node:assert/strict";
import test from "node:test";
import { formatSessionDuration, initialSkinId } from "../../games/game-03/lobby.js";

test("session timer formats locally from authoritative joinedAt", () => {
  assert.equal(formatSessionDuration(1000, 48000), "00:47");
  assert.equal(formatSessionDuration(1000, 204000), "03:23");
  assert.equal(formatSessionDuration(1000, 3979000), "1:06:18");
});

test("stored skin selection persists when enabled and safely falls back when removed", () => {
  const registry = [
    { id: "first", enabled: true },
    { id: "second", enabled: true },
    { id: "disabled", enabled: false },
  ];
  assert.equal(initialSkinId({ getItem: () => "second" }, registry), "second");
  assert.equal(initialSkinId({ getItem: () => "disabled" }, registry), "first");
  assert.equal(initialSkinId({ getItem: () => "missing" }, registry), "first");
});
