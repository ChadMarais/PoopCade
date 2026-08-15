import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyCollisionBehaviorDraft,
  applyCollisionDraft,
  applyPlacementDraft,
  collisionBehavior,
  editorCameraPanVector,
  editorCameraFocus,
  normalizedCollisionPoints,
  removeEnvironmentInstance,
  insertCollisionPoint,
  rotationHandlePosition,
  serializeMapPlacement,
  serializeCollisionDefinition,
  worldToNormalized,
} from "../../games/game-03/collision-editor.js";
import { collisionBlocksMovement, collisionBlocksProjectiles, depthSortY, transformNormalizedPolygon } from "../../games/game-03/collision-geometry.js";
import { clampDraggablePanelPosition } from "../../games/game-03/draggable-panel.js";
import { ASSET_DEFINITION_URLS } from "../../games/game-03/maps/lunar-liability/map.js";

function instance(id, assetId, definition, x, width) {
  const item = { id, assetId, definition, x, y: 500, width, height: width };
  item.polygon = transformNormalizedPolygon(definition, item);
  return item;
}

test("collision drafts update every instance that shares an asset definition", () => {
  const definition = {
    id: "rock",
    anchor: { x: .5, y: .5 },
    collision: { points: [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .5, y: .9 }] },
  };
  const environment = [
    instance("ROCK A", "rock", definition, 200, 100),
    instance("ROCK B", "rock", definition, 800, 300),
  ];
  const draft = [{ x: .2, y: .2 }, { x: .8, y: .2 }, { x: .5, y: .8 }];

  assert.equal(applyCollisionDraft("rock", draft, environment), 2);
  assert.deepEqual(environment[0].polygon[0], { x: 170, y: 470 });
  assert.deepEqual(environment[1].polygon[0], { x: 710, y: 410 });
  assert.deepEqual(normalizedCollisionPoints(definition), draft);
});

test("relay drafts remain isolated by asset id", () => {
  const westDefinition = { id: "relay-west", anchor: { x: .5, y: .5 }, collisionPolygon: [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .5, y: .9 }] };
  const eastDefinition = { id: "relay-east", render: { flipX: true }, anchor: { x: .5, y: .5 }, collisionPolygon: [{ x: .9, y: .1 }, { x: .5, y: .9 }, { x: .1, y: .1 }] };
  const west = instance("WEST", "relay-west", westDefinition, 200, 100);
  const east = instance("EAST", "relay-east", eastDefinition, 800, 100);
  const eastBefore = east.polygon.map((point) => ({ ...point }));

  applyCollisionDraft("relay-west", [{ x: .2, y: .2 }, { x: .8, y: .2 }, { x: .5, y: .8 }], [west, east]);

  assert.deepEqual(east.polygon, eastBefore);
  assert.equal(east.definition.render.flipX, true);
});

test("world edits normalize to the selected instance and export the original schema", () => {
  const definition = {
    id: "relay-east",
    orientation: "left",
    render: { flipX: true },
    anchor: { x: .5, y: .5 },
    collisionPolygon: [{ x: .1, y: .2 }, { x: .8, y: .2 }, { x: .4, y: .9 }],
  };
  const selected = instance("EAST", "relay-east", definition, 1000, 400);

  assert.deepEqual(worldToNormalized({ x: 900, y: 420 }, definition, selected), { x: .25, y: .3 });
  const exported = JSON.parse(serializeCollisionDefinition(definition, [{ x: .123456, y: .654321 }, { x: .8, y: .2 }, { x: .4, y: .9 }]));
  assert.equal(exported.render.flipX, true);
  assert.deepEqual(exported.collisionPolygon[0], { x: .1235, y: .6543 });
  assert.equal(exported.collision, undefined);
});

test("solid objects block shots by default while an explicit editor opt-out lets shots pass", () => {
  const nested = {
    id: "lava-ditch",
    anchor: { x: .5, y: .5 },
    collision: {
      points: [{ x: .1, y: .2 }, { x: .9, y: .2 }, { x: .5, y: .8 }],
      blocksMovement: true,
    },
  };
  assert.equal(collisionBlocksMovement(nested), true);
  assert.equal(collisionBlocksProjectiles(nested), true, "movement-blocking objects block shots unless explicitly changed");

  const environment = [instance("DITCH A", "lava-ditch", nested, 400, 200)];
  const passThrough = { blocksMovement: true, blocksProjectiles: false };
  assert.equal(applyCollisionBehaviorDraft("lava-ditch", passThrough, environment), 1);
  assert.deepEqual(collisionBehavior(nested), passThrough);
  assert.equal(collisionBlocksProjectiles(nested), false);

  const exported = JSON.parse(serializeCollisionDefinition(nested, nested.collision.points, passThrough));
  assert.equal(exported.collision.blocksMovement, true);
  assert.equal(exported.collision.blocksProjectiles, false);
});

test("all current Lunar Liability objects retain the default solid shot collision", async () => {
  const definitions = await Promise.all(ASSET_DEFINITION_URLS.map(async (url) => JSON.parse(await readFile(new URL(`../../${url.slice(1)}`, import.meta.url), "utf8"))));
  assert.ok(definitions.length > 0);
  for (const definition of definitions) {
    assert.equal(collisionBlocksMovement(definition), true, `${definition.id} must block players`);
    assert.equal(collisionBlocksProjectiles(definition), true, `${definition.id} must block shots`);
  }
});

test("collision editor camera pans at a stable normalized speed", () => {
  assert.deepEqual(editorCameraPanVector(new Set(["ArrowRight"]), .5, 400), { x: 200, y: 0 });
  const diagonal = editorCameraPanVector(new Set(["ArrowLeft", "ArrowUp"]), .5, 400);
  assert.ok(Math.abs(diagonal.x + Math.SQRT1_2 * 200) < 1e-9);
  assert.ok(Math.abs(diagonal.y + Math.SQRT1_2 * 200) < 1e-9);
});

test("collision editor can focus and pan an empty map", () => {
  assert.deepEqual(editorCameraFocus(null, { x: 300, y: 200 }, { width: 1000, height: 700 }), { x: 800, y: 550 });
  assert.deepEqual(editorCameraFocus({ x: 1200, y: 900 }, { x: 0, y: 0 }, { width: 1000, height: 700 }), { x: 1200, y: 900 });
});

test("draggable debug panels remain inside the visible viewport", () => {
  assert.deepEqual(clampDraggablePanelPosition(-40, 900, 340, 260, 1280, 720), { left: 8, top: 452 });
  assert.deepEqual(clampDraggablePanelPosition(500, 240, 340, 260, 1280, 720), { left: 500, top: 240 });
});

test("instance placement moves and rotates artwork collision around its world anchor", () => {
  const definition = {
    id: "rock",
    anchor: { x: .5, y: .5 },
    depthSortAnchor: { x: .5, y: .8 },
    collision: { points: [{ x: .25, y: .25 }, { x: .75, y: .25 }, { x: .5, y: .75 }] },
  };
  const selected = instance("ROCK A", "rock", definition, 200, 100);
  selected.depthY = depthSortY(definition, selected);

  applyPlacementDraft(selected, { x: 600, y: 400, rotation: 90 });

  assert.deepEqual(selected.polygon[0], { x: 625, y: 375 });
  assert.equal(selected.depthY, 400);
  assert.deepEqual(worldToNormalized(selected.polygon[0], definition, selected), { x: .25, y: .25 });
  assert.equal(serializeMapPlacement(selected), '{ id: "ROCK A", x: 600, y: 400, rotation: 90 }');
  assert.deepEqual(rotationHandlePosition(selected), { x: 696, y: 400 });
});

test("collision points can be inserted at an edge midpoint", () => {
  const draft = [{ x: .1, y: .2 }, { x: .9, y: .2 }, { x: .5, y: .9 }];
  assert.equal(insertCollisionPoint(draft, 0), 1);
  assert.deepEqual(draft, [{ x: .1, y: .2 }, { x: .5, y: .2 }, { x: .9, y: .2 }, { x: .5, y: .9 }]);
});

test("deleting a placed object removes its render and collision references only", () => {
  const definition = {
    id: "lava",
    anchor: { x: .5, y: .5 },
    collision: { points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
  };
  const first = instance("FAULT A", "lava", definition, 200, 100);
  const second = instance("FAULT B", "lava", definition, 500, 100);
  const assets = {
    environment: [first, second],
    rocks: [first],
    satellites: [second],
    polygons: [first.polygon, second.polygon, [{ x: 0, y: 0 }]],
  };

  assert.deepEqual(removeEnvironmentInstance(assets, "FAULT A"), { removed: first, environmentIndex: 0 });
  assert.deepEqual(assets.environment, [second]);
  assert.deepEqual(assets.rocks, []);
  assert.deepEqual(assets.satellites, [second]);
  assert.equal(assets.polygons.includes(first.polygon), false);
  assert.equal(assets.polygons.includes(second.polygon), true);
  assert.equal(removeEnvironmentInstance(assets, "MISSING"), null);
});
