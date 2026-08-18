import assert from "node:assert/strict";
import test from "node:test";
import { InputNetworkScheduler, INPUT_NETWORK_POLICY, reconcilePredictionHistory } from "../../games/game-03/input-network.js";

function input(overrides = {}) {
  return { type: "input", seq: 1, moveX: 0, moveY: 0, aimX: 1, aimY: 0, fire: false, nuke: false, fireIntents: [], ...overrides };
}

function offer(scheduler, value, now) {
  scheduler.noteLocalStep(now);
  const decision = scheduler.decide(value, now);
  if (decision.send) scheduler.recordSent(value, now, decision);
  return decision;
}

function simulate(seconds, sampleAt) {
  const scheduler = new InputNetworkScheduler();
  const sends = [];
  const stepMs = 1000 / 30;
  for (let tick = 0; tick < seconds * 30; tick++) {
    const now = tick * stepMs;
    const value = input({ seq: tick + 1, ...sampleAt(now, tick) });
    const decision = offer(scheduler, value, now);
    if (decision.send) sends.push({ now, decision, value });
  }
  return { scheduler, sends };
}

test("constant active movement keeps 30 Hz local steps while sending about 10 Hz", () => {
  const { scheduler, sends } = simulate(10, () => ({ moveX: 1 }));
  const stats = scheduler.stats(10_000 - 1000 / 30);
  assert.ok(stats.localHz >= 29 && stats.localHz <= 31);
  assert.ok(sends.length >= 99 && sends.length <= 101, `sent ${sends.length} inputs in 10 seconds`);
  assert.ok(stats.averageSendHz >= 9.5 && stats.averageSendHz <= 10.5, `average was ${stats.averageSendHz}`);
  assert.ok(Math.max(...sends.slice(1).map((entry, index) => entry.now - sends[index].now)) <= INPUT_NETWORK_POLICY.activeRefreshMs + 1);
});

test("movement start and stop bypass the periodic timer", () => {
  const scheduler = new InputNetworkScheduler();
  offer(scheduler, input(), 0);
  const start = offer(scheduler, input({ moveX: 1 }), 20);
  const stop = offer(scheduler, input({ moveX: 0 }), 40);
  assert.deepEqual({ send: start.send, immediate: start.immediate, reason: start.reason }, { send: true, immediate: true, reason: "movement-start" });
  assert.deepEqual({ send: stop.send, immediate: stop.immediate, reason: stop.reason }, { send: true, immediate: true, reason: "movement-stop" });
  assert.equal(offer(scheduler, input(), 80).send, false);
  assert.equal(offer(scheduler, input(), 140).reason, "active-refresh", "neutral stop is redundantly refreshed for loss recovery");
});

test("physical movement release sends each short smoothing step instead of leaving stale drift", () => {
  const scheduler = new InputNetworkScheduler();
  offer(scheduler, input({ moveX: 1, moveIntentActive: true }), 0);
  assert.equal(offer(scheduler, input({ moveX: .2, moveIntentActive: false }), 10).reason, "movement-stop");
  assert.equal(offer(scheduler, input({ moveX: .04, moveIntentActive: false }), 43).reason, "movement-settle");
  assert.equal(offer(scheduler, input({ moveX: .008, moveIntentActive: false }), 76).send, false);
});

test("fire press, fire intent, release, and nuke transitions send immediately", () => {
  const scheduler = new InputNetworkScheduler();
  offer(scheduler, input(), 0);
  assert.equal(offer(scheduler, input({ fire: true }), 10).reason, "fire-press");
  const intent = input({ fire: true, fireIntents: [{ id: 1 }, { id: 2 }] });
  assert.equal(offer(scheduler, intent, 20).reason, "fire-intent");
  assert.equal(offer(scheduler, input({ fire: false }), 30).reason, "fire-release");
  assert.equal(offer(scheduler, input({ nuke: true }), 40).reason, "nuke-press");
  assert.equal(offer(scheduler, input({ nuke: false }), 50).reason, "nuke-release");
  assert.equal(scheduler.stats(50).fireIntentCount, 2, "batched intents count as intents, not extra frames");
});

test("heavy aim remains full precision locally but network sends are capped near 15 Hz", () => {
  const { sends } = simulate(10, (_now, tick) => {
    const radians = tick * 10 * Math.PI / 180;
    return { aimX: Math.cos(radians), aimY: Math.sin(radians) };
  });
  assert.ok(sends.length >= 145 && sends.length <= 151, `heavy aim sent ${sends.length} frames`);
  assert.ok(sends.slice(1).every((entry, index) => entry.now - sends[index].now + 1e-6 >= INPUT_NETWORK_POLICY.adaptiveMinMs));
  assert.ok(Math.abs(sends[7].value.aimX - Math.cos(14 * 10 * Math.PI / 180)) < 1e-12, "wire aim is not quantized");
});

test("held fire coalesces heavy aim with immediate shot-intent packets", () => {
  const scheduler = new InputNetworkScheduler();
  const sends = [];
  let nextShotAt = 0, intentId = 0;
  for (let tick = 0; tick < 30 * 10; tick++) {
    const now = tick * 1000 / 30;
    const radians = tick * 10 * Math.PI / 180;
    const fireIntents = now + 1e-6 >= nextShotAt ? [{ id: ++intentId }] : [];
    if (fireIntents.length) nextShotAt = now + 220;
    const value = input({ seq: tick + 1, moveX: 1, aimX: Math.cos(radians), aimY: Math.sin(radians), fire: true, fireIntents });
    const decision = offer(scheduler, value, now);
    if (decision.send) sends.push({ now, decision });
  }
  const rate = sends.length / 10;
  assert.ok(rate >= 12 && rate <= 15, `combined heavy aim + SMG rate was ${rate}/s`);
  assert.equal(scheduler.stats(10_000 - 1000 / 30).fireIntentCount, intentId);
});

test("microscopic aim changes wait for the bounded refresh instead of creating frames", () => {
  const { sends } = simulate(2, (_now, tick) => {
    const radians = tick * .1 * Math.PI / 180;
    return { moveX: 1, aimX: Math.cos(radians), aimY: Math.sin(radians) };
  });
  assert.ok(sends.length >= 19 && sends.length <= 21, `small aim changes sent ${sends.length} frames`);
});

test("true idle is kept alive at a low bounded refresh rate", () => {
  const { sends } = simulate(16, () => ({}));
  assert.deepEqual(sends.map((entry) => Math.round(entry.now)), [0, 5000, 10000, 15000]);
});

test("reconciliation replays 30 Hz local history after the RTT-adjusted snapshot cutoff without double-counting retained server input", () => {
  const pending = [
    { seq: 11, moveX: 1, predictionAt: 1033, transmitted: false },
    { seq: 12, moveX: 1, predictionAt: 1066, transmitted: false },
    { seq: 13, moveX: -1, predictionAt: 1099, transmitted: true },
    { seq: 14, moveX: -1, predictionAt: 1132, transmitted: false },
  ];
  const result = reconcilePredictionHistory(pending, 10, { x: 100, y: 0 },
    (position, entry) => ({ x: position.x + entry.moveX, y: 0 }), 1100);
  assert.deepEqual(result.pending.map((entry) => entry.seq), [13, 14], "old unsent ticks are already represented by the snapshot");
  assert.equal(result.replayed.x, 98);

  const acknowledged = reconcilePredictionHistory(pending, 13, { x: 99, y: 0 },
    (position, entry) => ({ x: position.x + entry.moveX, y: 0 }), 1100);
  assert.deepEqual(acknowledged.pending.map((entry) => entry.seq), [14]);
  assert.equal(acknowledged.replayed.x, 98);
});
