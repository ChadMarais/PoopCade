const ACTIVE_REFRESH_MS = 100;
const IDLE_REFRESH_MS = 5000;
const ADAPTIVE_MIN_MS = 1000 / 15;
const AIM_CHANGE_RADIANS = 1.5 * Math.PI / 180;
const AIM_URGENT_RADIANS = 8 * Math.PI / 180;
const MOVE_CHANGE_DISTANCE = .12;
const MOVE_MAJOR_RADIANS = 35 * Math.PI / 180;
const MOVE_ACTIVE_EPSILON = .04;
const TRANSITION_RECOVERY_MS = 300;
const ROLLING_WINDOW_MS = 5000;

function finite(value, fallback = 0) { return Number.isFinite(value) ? value : fallback; }
function magnitude(x, y) { return Math.hypot(finite(x), finite(y)); }
function moving(input) {
  return typeof input?.moveIntentActive === "boolean"
    ? input.moveIntentActive
    : magnitude(input?.moveX, input?.moveY) >= MOVE_ACTIVE_EPSILON;
}
function angleBetween(ax, ay, bx, by) {
  const aLength = magnitude(ax, ay), bLength = magnitude(bx, by);
  if (aLength < .0001 || bLength < .0001) return 0;
  const cosine = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (aLength * bLength)));
  return Math.acos(cosine);
}
function movementDifference(before, after) {
  return magnitude(finite(after?.moveX) - finite(before?.moveX), finite(after?.moveY) - finite(before?.moveY));
}
function aimDifference(before, after) {
  return angleBetween(finite(before?.aimX, 1), finite(before?.aimY), finite(after?.aimX, 1), finite(after?.aimY));
}
function prune(times, now, windowMs) {
  while (times.length && now - times[0] > windowMs) times.shift();
}

export const INPUT_NETWORK_POLICY = Object.freeze({
  activeRefreshMs: ACTIVE_REFRESH_MS,
  idleRefreshMs: IDLE_REFRESH_MS,
  adaptiveMinMs: ADAPTIVE_MIN_MS,
  aimChangeRadians: AIM_CHANGE_RADIANS,
  aimUrgentRadians: AIM_URGENT_RADIANS,
  movementChangeDistance: MOVE_CHANGE_DISTANCE,
  movementMajorRadians: MOVE_MAJOR_RADIANS,
  transitionRecoveryMs: TRANSITION_RECOVERY_MS,
});

export class InputNetworkScheduler {
  constructor() { this.reset(); }

  reset() {
    this.lastSent = null;
    this.lastSentAt = Number.NEGATIVE_INFINITY;
    this.recoveryUntil = 0;
    this.localTimes = [];
    this.sendTimes = [];
    this.totalSends = 0;
    this.immediateSends = 0;
    this.periodicSends = 0;
    this.fireIntentCount = 0;
  }

  noteLocalStep(now) {
    this.localTimes.push(now);
    prune(this.localTimes, now, ROLLING_WINDOW_MS);
  }

  decide(input, now) {
    if (!this.lastSent) return { send: true, immediate: true, reason: "initial" };
    const elapsed = now - this.lastSentAt;
    const wasMoving = moving(this.lastSent), isMoving = moving(input);
    if (wasMoving !== isMoving) return { send: true, immediate: true, reason: isMoving ? "movement-start" : "movement-stop" };
    if (Boolean(input.fire) !== Boolean(this.lastSent.fire)) return { send: true, immediate: true, reason: input.fire ? "fire-press" : "fire-release" };
    if (Boolean(input.nuke) !== Boolean(this.lastSent.nuke)) return { send: true, immediate: true, reason: input.nuke ? "nuke-press" : "nuke-release" };
    if (Array.isArray(input.fireIntents) && input.fireIntents.length) return { send: true, immediate: true, reason: "fire-intent" };

    const moveAngle = angleBetween(this.lastSent.moveX, this.lastSent.moveY, input.moveX, input.moveY);
    if (!isMoving && magnitude(input.moveX, input.moveY) >= MOVE_ACTIVE_EPSILON && movementDifference(this.lastSent, input) >= .03) {
      return { send: true, immediate: true, reason: "movement-settle" };
    }
    if (wasMoving && isMoving && moveAngle >= MOVE_MAJOR_RADIANS) return { send: true, immediate: true, reason: "movement-major" };

    const aimAngle = aimDifference(this.lastSent, input);
    // A due fire intent already carries the exact full-precision aim and sends
    // immediately. While fire is held, keep ordinary aim updates on the 10 Hz
    // cadence so those critical shot packets do not stack on top of a separate
    // 15 Hz aim stream.
    if (!input.fire && elapsed + 1e-6 >= ADAPTIVE_MIN_MS && aimAngle >= AIM_URGENT_RADIANS) {
      return { send: true, immediate: false, reason: "aim-heavy" };
    }
    if (elapsed + 1e-6 >= ACTIVE_REFRESH_MS && aimAngle >= AIM_CHANGE_RADIANS) {
      return { send: true, immediate: false, reason: "aim-change" };
    }
    if (elapsed + 1e-6 >= ADAPTIVE_MIN_MS && movementDifference(this.lastSent, input) >= MOVE_CHANGE_DISTANCE) {
      return { send: true, immediate: false, reason: "movement-change" };
    }

    const active = isMoving || Boolean(input.fire) || Boolean(input.nuke) || now < this.recoveryUntil;
    const refreshMs = active ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS;
    if (elapsed + 1e-6 >= refreshMs) return { send: true, immediate: false, reason: active ? "active-refresh" : "idle-refresh" };
    return { send: false, immediate: false, reason: "unchanged" };
  }

  recordSent(input, now, decision) {
    this.lastSent = {
      moveX: finite(input.moveX), moveY: finite(input.moveY),
      aimX: finite(input.aimX, 1), aimY: finite(input.aimY),
      fire: Boolean(input.fire), nuke: Boolean(input.nuke),
      ...(typeof input.moveIntentActive === "boolean" ? { moveIntentActive: input.moveIntentActive } : {}),
    };
    this.lastSentAt = now;
    const recoveryTransition = decision?.reason === "movement-stop" || decision?.reason === "fire-release" ||
      decision?.reason === "nuke-press" || decision?.reason === "nuke-release";
    if (recoveryTransition) this.recoveryUntil = Math.max(this.recoveryUntil, now + TRANSITION_RECOVERY_MS);
    this.totalSends++;
    if (decision?.immediate) this.immediateSends++; else this.periodicSends++;
    this.fireIntentCount += Array.isArray(input.fireIntents) ? input.fireIntents.length : 0;
    this.sendTimes.push(now);
    prune(this.sendTimes, now, ROLLING_WINDOW_MS);
  }

  stats(now) {
    prune(this.localTimes, now, ROLLING_WINDOW_MS);
    prune(this.sendTimes, now, ROLLING_WINDOW_MS);
    const localRecent = this.localTimes.filter((at) => now - at <= 1000).length;
    const sendRecent = this.sendTimes.filter((at) => now - at <= 1000).length;
    const rollingSpan = this.sendTimes.length > 1 ? Math.max(1000, now - this.sendTimes[0]) : ROLLING_WINDOW_MS;
    return {
      localHz: localRecent,
      sendHz: sendRecent,
      averageSendHz: this.sendTimes.length * 1000 / rollingSpan,
      totalSends: this.totalSends,
      immediateSends: this.immediateSends,
      periodicSends: this.periodicSends,
      fireIntentCount: this.fireIntentCount,
      lastSendAgeMs: Number.isFinite(this.lastSentAt) ? Math.max(0, now - this.lastSentAt) : null,
    };
  }
}

export function reconcilePredictionHistory(pending, ack, authoritative, applyStep, snapshotTime = Number.NaN) {
  const unacknowledged = pending.filter((entry) => entry.seq > ack && (
    entry.transmitted === true || !Number.isFinite(snapshotTime) || !Number.isFinite(entry.predictionAt) || entry.predictionAt > snapshotTime
  ));
  let replayed = { x: authoritative.x, y: authoritative.y };
  for (const entry of unacknowledged) replayed = applyStep(replayed, entry);
  return { pending: unacknowledged, replayed };
}
