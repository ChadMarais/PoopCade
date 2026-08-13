const DUSTY_DIFFICULTY = "Arena";

export function dustyOrbitRunFromPlayer(player, now = Date.now(), cryptoApi = globalThis.crypto) {
  const score = Math.max(0, Math.trunc(Number(player?.killScore) || 0));
  const kills = Math.max(score, Math.trunc(Number(player?.kills) || 0));
  const deaths = Math.max(0, Math.trunc(Number(player?.deaths) || 0));
  const joinedAt = Number(player?.joinedAt);
  const durationMs = Math.max(1000, Math.trunc(Number.isFinite(joinedAt) ? now - joinedAt : 1000));
  return {
    clientRunId: cryptoApi.randomUUID(),
    score,
    difficulty: DUSTY_DIFFICULTY,
    // The shared run schema requires a positive level. For DUSTY ORBIT this
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
  }

  reset() {
    this.observedScore = null;
    this.submittedScore = 0;
    this.pendingScore = 0;
    this.onStatus(this.authenticated ? "READY" : "SIGN IN TO SAVE");
  }

  observe(player) {
    if (!player) return;
    const score = Math.max(0, Math.trunc(Number(player.killScore) || 0));
    if (this.observedScore === null) {
      this.observedScore = score;
      if (score === 0) return;
    }
    this.observedScore = Math.max(this.observedScore, score);
    if (score <= 0 || score <= this.submittedScore || score <= this.pendingScore) return;
    this.pendingScore = score;
    const run = dustyOrbitRunFromPlayer(player, this.now(), this.cryptoApi);
    if (!this.authenticated) {
      this.pendingScore = 0;
      this.submittedScore = score;
      if (typeof this.recordGuest === "function") void this.recordGuest({ clientRunId: run.clientRunId, gameSlug: "dusty-orbit", score: run.score, durationMs: run.durationMs });
      this.onStatus("SIGN IN TO SAVE");
      return;
    }
    if (typeof this.submit !== "function") { this.pendingScore = 0; this.onStatus("SAVE UNAVAILABLE"); return; }
    this.onStatus("SAVING…");
    void this.submit(run).then((result) => {
      this.pendingScore = 0;
      if (result?.skipped) { this.onStatus("SIGN IN TO SAVE"); return; }
      this.submittedScore = Math.max(this.submittedScore, score);
      this.onStatus(result?.newPersonalBest ? "NEW PERSONAL BEST" : "SAVED");
      if (this.observedScore > this.submittedScore) this.observe({ ...player, killScore: this.observedScore });
    }).catch(() => {
      this.pendingScore = 0;
      this.onStatus("SAVE RETRY PENDING");
    });
  }
}
