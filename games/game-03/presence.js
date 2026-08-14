export const RECRUITMENT_COOLDOWN_MS = 60_000;
export const RECRUITMENT_HREF = "/games/game-03/";

export function recruitmentMessage(rawName) {
  const name = typeof rawName === "string" && rawName.trim() ? rawName.trim() : "A suspicious pilot";
  return `${name} is banging on the DUSTY ORBIT airlock and needs backup. Click before they start recruiting moon rocks.`;
}

export function recruitmentCooldownRemaining(retryAt, now = Date.now()) {
  return Math.max(0, Math.ceil((Number(retryAt) - now) / 1000));
}

export function normalizedOnlinePlayers(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}
