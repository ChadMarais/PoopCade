export function prefersMobileAssets(scope = globalThis) {
  return scope.navigator?.userAgentData?.mobile === true
    || scope.matchMedia?.("(pointer: coarse)")?.matches === true
    || (Number(scope.innerWidth) > 0 && Number(scope.innerWidth) <= 900);
}

export function mobileOptimizedAssetUrl(url, mobile = prefersMobileAssets()) {
  if (!mobile || !/\.png(?:[?#]|$)/.test(url)) return url;
  const murderballAsset = url.includes("/games/game-03/") || url.startsWith("./assets/");
  return murderballAsset ? url.replace(/\.png(?=([?#]|$))/, ".mobile.webp") : url;
}
