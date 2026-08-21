import assert from "node:assert/strict";
import test from "node:test";
import { mobileOptimizedAssetUrl, prefersMobileAssets } from "../../games/game-03/asset-profile.js";

test("mobile Hell Moon artwork uses lightweight WebP derivatives", () => {
  const source = "/games/game-03/maps/hell-moon/objects/imported/building1/building1.png?v=7";
  assert.equal(
    mobileOptimizedAssetUrl(source, true),
    "/games/game-03/maps/hell-moon/objects/imported/building1/building1.mobile.webp?v=7",
  );
  assert.equal(mobileOptimizedAssetUrl(source, false), source);
  assert.equal(mobileOptimizedAssetUrl("/games/game-03/assets/powerups/health.png?v=7", true), "/games/game-03/assets/powerups/health.mobile.webp?v=7");
  assert.equal(mobileOptimizedAssetUrl("./assets/characters/moon-blob-01/moon-blob-01.png", true), "./assets/characters/moon-blob-01/moon-blob-01.mobile.webp");
});

test("mobile asset profile covers phones, coarse pointers, and narrow app windows", () => {
  assert.equal(prefersMobileAssets({ navigator: { userAgentData: { mobile: true } } }), true);
  assert.equal(prefersMobileAssets({ matchMedia: () => ({ matches: true }) }), true);
  assert.equal(prefersMobileAssets({ innerWidth: 720 }), true);
  assert.equal(prefersMobileAssets({ innerWidth: 1280, matchMedia: () => ({ matches: false }) }), false);
});

test("mobile derivatives use explicitly lossless WebP encoding", async () => {
  const optimizer = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../../tools/optimize-murderball-mobile-assets.py", import.meta.url), "utf8"));
  assert.match(optimizer, /lossless=True, quality=100, method=6/);
  assert.match(optimizer, /Original PNG masters are never modified/);
});

test("cross-map auto-join hides the lobby before modules and artwork load", async () => {
  const [html, game] = await import("node:fs/promises").then(({ readFile }) => Promise.all([
    readFile(new URL("../../games/game-03/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../games/game-03/game.js", import.meta.url), "utf8"),
  ]));
  assert.match(html, /get\('autojoin'\)===['"]1['"].*arena-transition/);
  assert.match(html, /\.arena-transition #lobby \{ display: none; \}/);
  assert.match(game, /else if \(autoJoinRequested && !joined\) \{/);
  assert.doesNotMatch(game, /autoJoinRequested && !joined && applicationState !== "JOINING"/);
});

test("Murderball cache fallback never ignores version query strings", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../../service-worker.js", import.meta.url), "utf8"));
  assert.match(source, /shell-v29/);
  assert.match(source, /new Request\(request, \{ cache: 'no-store' \}\)/);
  assert.doesNotMatch(source, /caches\.match\(request, \{ ignoreSearch: true \}\)/);
  assert.match(source, /if \(request\.mode === 'navigate'\).*caches\.match\('\/index\.html'\)/);
});
