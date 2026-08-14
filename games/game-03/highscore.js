const DUSTY_DIFFICULTY = "Arena";

export function dustyOrbitRunFromPlayer(player, now = Date.now(), cryptoApi = globalThis.crypto) {
  const score = Math.max(0, Math.trunc(Number(player?.killScore) || 0), Math.trunc(Number(player?.highScore) || 0));
  const kills = Math.max(score, Math.trunc(Number(player?.kills) || 0));
  const deaths = Math.max(0, Math.trunc(Number(player?.deaths) || 0));
  const joinedAt = Number(player?.joinedAt);
  const durationMs = Math.max(1000, Math.trunc(Number.isFinite(joinedAt) ? now - joinedAt : 1000));
  return {
    clientRunId: cryptoApi.randomUUID(),
    score,
    difficulty: DUSTY_DIFFICULTY,
    // The shared run schema requires a positive level. For NEBULA MURDERBALL this
    // stores total authoritative kills as level - 1 and deaths as gates.
    level: kills + 1,
    gates: deaths,
    styleBonuses: 0,
    durationMs,
  };
}

export class DustyOrbitHighscoreTracker {
  constructor({ authenticated, submit = null, recordGuest = null, now = () => Date.now(), cryptoApi = globalThis.crypto, onStatus = () => {} }) {
    this.authenticated = Boolean(authenticated);
    this.submit = submit;
    this.recordGuest = recordGuest;
    this.now = now;
    this.cryptoApi = cryptoApi;
    this.onStatus = onStatus;
    this.observedScore = null;
    this.submittedScore = 0;
    this.pendingScore = 0;
    this.pendingPromise = null;
    this.latestPlayer = null;
    this.retryAfter = 0;
  }

  reset() {
    this.observedScore = null;
    this.latestPlayer = null;
    if (!this.pendingPromise) this.pendingScore = 0;
    this.onStatus(this.authenticated ? (this.pendingPromise ? "SAVING..." : "READY") : "SIGN IN TO SAVE");
  }

  observe(player) {
    if (!player) return;
    const score = Math.max(0, Math.trunc(Number(player.killScore) || 0), Math.trunc(Number(player.highScore) || 0));
    if (this.observedScore === null) {
      this.observedScore = score;
      if (score === 0) return;
    }
    this.observedScore = Math.max(this.observedScore, score);
    this.latestPlayer = { ...player, killScore: this.observedScore };
    if (this.observedScore <= 0 || this.observedScore <= this.submittedScore) return this.pendingPromise;
    if (!this.authenticated) {
      const run = dustyOrbitRunFromPlayer(this.latestPlayer, this.now(), this.cryptoApi);
      this.submittedScore = this.observedScore;
      if (typeof this.recordGuest === "function") void this.recordGuest({ clientRunId: run.clientRunId, gameSlug: "dusty-orbit", score: run.score, durationMs: run.durationMs });
      this.onStatus("SIGN IN TO SAVE");
      return;
    }
    return this.startSave();
  }

  startSave(force = false) {
    if (this.pendingPromise) return this.pendingPromise;
    const score = Math.max(0, Math.trunc(Number(this.observedScore) || 0));
    if (score <= 0 || score <= this.submittedScore) return Promise.resolve(true);
    if (!force && this.now() < this.retryAfter) return Promise.resolve(false);
    if (typeof this.submit !== "function") { this.onStatus("SAVE UNAVAILABLE"); return Promise.resolve(false); }
    const run = dustyOrbitRunFromPlayer({ ...this.latestPlayer, killScore: score }, this.now(), this.cryptoApi);
    this.pendingScore = score;
    this.onStatus("SAVING...");
    let saved = false;
    const pending = Promise.resolve().then(() => this.submit(run)).then((result) => {
      if (result?.skipped) { this.onStatus("SIGN IN TO SAVE"); return false; }
      const personalBest = Number(result?.personalBest);
      if (result?.accepted !== true || !Number.isFinite(personalBest) || personalBest < score) {
        throw new Error("Score backend did not confirm persistence.");
      }
      saved = true;
      this.submittedScore = Math.max(this.submittedScore, score);
      this.onStatus(result?.newPersonalBest ? "NEW PERSONAL BEST" : "SAVED");
      return true;
    }).catch(() => {
      this.retryAfter = this.now() + 2_000;
      this.onStatus("SAVE RETRY PENDING");
      return false;
    }).finally(() => {
      if (this.pendingPromise !== pending) return;
      this.pendingPromise = null;
      this.pendingScore = 0;
      if (saved && this.observedScore > this.submittedScore) void this.startSave();
    });
    this.pendingPromise = pending;
    return pending;
  }

  async flush(player) {
    if (player) this.observe(player);
    if (!this.authenticated) return true;
    if (this.pendingPromise) await this.pendingPromise;
    if (this.observedScore > this.submittedScore) await this.startSave(true);
    return this.observedScore <= this.submittedScore;
  }
}
