import assert from "node:assert/strict";
import test from "node:test";
import { mobileOptimizedAssetUrl, prefersMobileMapAssets } from "../../games/game-03/assets.js";

test("mobile Hell Moon artwork uses lightweight WebP derivatives", () => {
  const source = "/games/game-03/maps/hell-moon/objects/imported/building1/building1.png?v=7";
  assert.equal(
    mobileOptimizedAssetUrl(source, true),
    "/games/game-03/maps/hell-moon/objects/imported/building1/building1.mobile.webp?v=7",
  );
  assert.equal(mobileOptimizedAssetUrl(source, false), source);
  assert.equal(mobileOptimizedAssetUrl("/games/game-03/assets/powerups/health.png?v=7", true), "/games/game-03/assets/powerups/health.png?v=7");
});

test("mobile asset profile covers phones, coarse pointers, and narrow app windows", () => {
  assert.equal(prefersMobileMapAssets({ navigator: { userAgentData: { mobile: true } } }), true);
  assert.equal(prefersMobileMapAssets({ matchMedia: () => ({ matches: true }) }), true);
  assert.equal(prefersMobileMapAssets({ innerWidth: 720 }), true);
  assert.equal(prefersMobileMapAssets({ innerWidth: 1280, matchMedia: () => ({ matches: false }) }), false);
});

test("Murderball cache fallback never ignores version query strings", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../../service-worker.js", import.meta.url), "utf8"));
  assert.match(source, /shell-v23/);
  assert.match(source, /new Request\(request, \{ cache: 'no-store' \}\)/);
  assert.doesNotMatch(source, /caches\.match\(request, \{ ignoreSearch: true \}\)/);
  assert.match(source, /if \(request\.mode === 'navigate'\).*caches\.match\('\/index\.html'\)/);
});
