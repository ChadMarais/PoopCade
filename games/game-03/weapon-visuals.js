function freezeVisual(definition) {
  return Object.freeze({
    ...definition,
    drawSize: Object.freeze({ ...definition.drawSize }),
    pivot: Object.freeze({ ...definition.pivot }),
    muzzle: Object.freeze({ ...definition.muzzle }),
  });
}

// Keep the module on the outer shoulder rim. This is intentionally shared by
// every weapon tier and by the authoritative server muzzle calculation.
export const SHOULDER_SIDE_OFFSET = 31;

// Every tier uses the same right-side gravitic docking convention and a
// production sprite whose muzzle anchor is shared with server simulation.
export const WEAPON_VISUALS = Object.freeze({
  // Sprite muzzle anchors sit on the last visible midline pixel of each
  // production crop, rather than an approximate point inset into the artwork.
  1: freezeVisual({ tier: 1, id: "pea-shooter", kind: "sprite", asset: "peaShooter", drawSize: { width: 42, height: 33 }, pivot: { x: .40, y: .52 }, forwardOffset: 13.3, sideOffset: SHOULDER_SIDE_OFFSET, muzzle: { x: .985, y: .52 }, recoilDistance: 2.2, recoilMs: 135, flashSize: 3.6, accent: "#8ffcff", barrels: 1 }),
  2: freezeVisual({ tier: 2, id: "pistol", kind: "sprite", asset: "pistol", drawSize: { width: 54, height: 31 }, pivot: { x: .31, y: .50 }, forwardOffset: 6.0, sideOffset: SHOULDER_SIDE_OFFSET, muzzle: { x: .997, y: .50 }, recoilDistance: 3, recoilMs: 145, flashSize: 4.2, accent: "#68f7ff", barrels: 1 }),
  3: freezeVisual({ tier: 3, id: "burst", kind: "sprite", asset: "burst", drawSize: { width: 44, height: 22.88 }, pivot: { x: .30, y: .50 }, forwardOffset: 5.33, sideOffset: SHOULDER_SIDE_OFFSET, muzzle: { x: .997, y: .50 }, recoilDistance: 3.4, recoilMs: 150, flashSize: 4.8, accent: "#ff4fe8", barrels: 3 }),
  4: freezeVisual({ tier: 4, id: "smg", kind: "sprite", asset: "smg", drawSize: { width: 46, height: 25.10 }, pivot: { x: .30, y: .50 }, forwardOffset: 3.94, sideOffset: SHOULDER_SIDE_OFFSET, muzzle: { x: .997, y: .50 }, recoilDistance: 2.6, recoilMs: 105, flashSize: 4.5, accent: "#9cff3f", barrels: 2 }),
  5: freezeVisual({ tier: 5, id: "shotgun", kind: "sprite", asset: "shotgun", drawSize: { width: 48, height: 26.64 }, pivot: { x: .31, y: .50 }, forwardOffset: 3.02, sideOffset: SHOULDER_SIDE_OFFSET, muzzle: { x: .997, y: .50 }, recoilDistance: 5, recoilMs: 180, flashSize: 7, accent: "#5ff7ff", barrels: 2 }),
  6: freezeVisual({ tier: 6, id: "plasma-cannon", kind: "sprite", asset: "plasmaCannon", drawSize: { width: 54, height: 31.66 }, pivot: { x: .30, y: .50 }, forwardOffset: 4.36, sideOffset: SHOULDER_SIDE_OFFSET, muzzle: { x: .997, y: .50 }, recoilDistance: 6.5, recoilMs: 190, flashSize: 9, accent: "#5beeff", barrels: 1 }),
});

export function weaponVisualForTier(tier) {
  const key = Number.isFinite(Number(tier)) ? Math.round(Number(tier)) : 1;
  return WEAPON_VISUALS[key] || WEAPON_VISUALS[1];
}

export function weaponPose(player, visual = weaponVisualForTier(player?.weaponTier), options = {}) {
  const rawAimX = Number.isFinite(player?.aimX) ? player.aimX : 1;
  const rawAimY = Number.isFinite(player?.aimY) ? player.aimY : 0;
  const aimLength = Math.hypot(rawAimX, rawAimY);
  const fx = aimLength > .0001 ? rawAimX / aimLength : 1;
  const fy = aimLength > .0001 ? rawAimY / aimLength : 0;
  const px = -fy;
  const py = fx;
  const scale = Number.isFinite(options.scale) ? Math.max(0, options.scale) : 1;
  const verticalOffset = Number.isFinite(options.verticalOffset) ? options.verticalOffset : 0;
  const recoil = Number.isFinite(options.recoil) ? Math.max(0, options.recoil) * scale : 0;
  const mount = options.weaponMount || {};
  const forwardOffset = (visual.forwardOffset + (Number.isFinite(mount.forwardOffset) ? mount.forwardOffset : 0)) * scale;
  const sideOffset = (visual.sideOffset + (Number.isFinite(mount.sideOffset) ? mount.sideOffset : 0)) * scale;
  const drawWidth = visual.drawSize.width * scale;
  const drawHeight = visual.drawSize.height * scale;
  const pivotWorld = {
    x: player.x + fx * forwardOffset + px * sideOffset - fx * recoil,
    y: player.y + fy * forwardOffset + py * sideOffset - fy * recoil + verticalOffset,
  };
  const localMuzzleX = (visual.muzzle.x - visual.pivot.x) * drawWidth;
  const localMuzzleY = (visual.muzzle.y - visual.pivot.y) * drawHeight;
  const muzzleWorld = {
    x: pivotWorld.x + fx * localMuzzleX - fy * localMuzzleY,
    y: pivotWorld.y + fy * localMuzzleX + fx * localMuzzleY,
  };
  return {
    visual,
    angle: Math.atan2(fy, fx),
    forward: { x: fx, y: fy },
    perpendicular: { x: px, y: py },
    pivotWorld,
    muzzleWorld,
    drawWidth,
    drawHeight,
    depthOffset: fy * forwardOffset + py * sideOffset,
    recoil,
  };
}
