export const FART_CLOUD_GROW_MS = 420;

export function fartCloudGrowth(createdAt, now, growMs = FART_CLOUD_GROW_MS) {
  const duration = Math.max(1, Number.isFinite(growMs) ? growMs : FART_CLOUD_GROW_MS);
  const amount = Math.max(0, Math.min(1, (now - createdAt) / duration));
  return 1 - Math.pow(1 - amount, 3);
}
