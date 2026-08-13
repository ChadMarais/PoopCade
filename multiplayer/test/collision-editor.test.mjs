import assert from "node:assert/strict";
import test from "node:test";
import {
  applyCollisionDraft,
  applyPlacementDraft,
  editorCameraPanVector,
  normalizedCollisionPoints,
  rotationHandlePosition,
  serializeMapPlacement,
  serializeCollisionDefinition,
  worldToNormalized,
} from "../../games/game-03/collision-editor.js";
import { depthSortY } from "../../games/game-03/collision-geometry.js";
import { transformNormalizedPolygon } from "../../games/game-03/collision-geometry.js";

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

test("collision editor camera pans at a stable normalized speed", () => {
  assert.deepEqual(editorCameraPanVector(new Set(["ArrowRight"]), .5, 400), { x: 200, y: 0 });
  const diagonal = editorCameraPanVector(new Set(["ArrowLeft", "ArrowUp"]), .5, 400);
  assert.ok(Math.abs(diagonal.x + Math.SQRT1_2 * 200) < 1e-9);
  assert.ok(Math.abs(diagonal.y + Math.SQRT1_2 * 200) < 1e-9);
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
