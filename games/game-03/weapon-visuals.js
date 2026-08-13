function freezeVisual(definition) {
  return Object.freeze({
    ...definition,
    drawSize: Object.freeze({ ...definition.drawSize }),
    pivot: Object.freeze({ ...definition.pivot }),
    muzzle: Object.freeze({ ...definition.muzzle }),
  });
}

// Every tier uses the same right-side gravitic docking convention. Tiers 2-6
// are intentionally procedural placeholders until their production art lands;
// adding art only requires an asset key and a config change here.
export const WEAPON_VISUALS = Object.freeze({
  1: freezeVisual({ tier: 1, id: "pea-shooter", kind: "sprite", asset: "peaShooter", drawSize: { width: 42, height: 33 }, pivot: { x: .40, y: .52 }, forwardOffset: 13.3, sideOffset: 20, muzzle: { x: .94, y: .52 }, recoilDistance: 2.2, recoilMs: 135, flashSize: 3.6, accent: "#8ffcff", barrels: 1 }),
  2: freezeVisual({ tier: 2, id: "pistol-module", kind: "procedural", drawSize: { width: 38, height: 22 }, pivot: { x: .32, y: .50 }, forwardOffset: 12.4, sideOffset: 20, muzzle: { x: .94, y: .50 }, recoilDistance: 3, recoilMs: 145, flashSize: 4.2, accent: "#fff08a", barrels: 1 }),
  3: freezeVisual({ tier: 3, id: "burst-module", kind: "procedural", drawSize: { width: 44, height: 25 }, pivot: { x: .30, y: .50 }, forwardOffset: 7.0, sideOffset: 20, muzzle: { x: .96, y: .50 }, recoilDistance: 3.4, recoilMs: 150, flashSize: 4.8, accent: "#8ff8ff", barrels: 3 }),
  4: freezeVisual({ tier: 4, id: "smg-module", kind: "procedural", drawSize: { width: 46, height: 24 }, pivot: { x: .30, y: .50 }, forwardOffset: 5.2, sideOffset: 20, muzzle: { x: .97, y: .50 }, recoilDistance: 2.6, recoilMs: 105, flashSize: 4.5, accent: "#ff8edf", barrels: 2 }),
  5: freezeVisual({ tier: 5, id: "scatter-module", kind: "procedural", drawSize: { width: 48, height: 30 }, pivot: { x: .31, y: .50 }, forwardOffset: 4.8, sideOffset: 20, muzzle: { x: .96, y: .50 }, recoilDistance: 5, recoilMs: 180, flashSize: 7, accent: "#ffc66d", barrels: 3 }),
  6: freezeVisual({ tier: 6, id: "plasma-module", kind: "procedural", drawSize: { width: 54, height: 30 }, pivot: { x: .30, y: .50 }, forwardOffset: 6.4, sideOffset: 20, muzzle: { x: .96, y: .50 }, recoilDistance: 6.5, recoilMs: 190, flashSize: 9, accent: "#bf8cff", barrels: 1 }),
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
  const forwardOffset = visual.forwardOffset * scale;
  const sideOffset = visual.sideOffset * scale;
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

