import { supabase } from "./supabase-config.js";
import { getCurrentUser, getMyBests } from "./auth.js";

const ALLOWED_DIFFICULTIES = new Set(["All", "Easy", "Medium", "Hard"]);

export async function getLeaderboard(gameSlug = "orbit-shift", difficulty = "All", limit = 50) {
  const selectedDifficulty = ALLOWED_DIFFICULTIES.has(difficulty) ? difficulty : "All";
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const { data, error } = await supabase.rpc("get_leaderboard", {
    game_slug: gameSlug,
    difficulty_filter: selectedDifficulty,
    result_limit: safeLimit,
  });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function setVisible(element, visible) {
  if (element) element.hidden = !visible;
}

function addCell(row, value, className = "") {
  const cell = document.createElement("td");
  cell.textContent = String(value);
  if (className) cell.className = className;
  row.append(cell);
}

function formatAchievedAt(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function renderRows(body, entries, gameSlug) {
  body.replaceChildren();
  entries.forEach((entry) => {
    const row = document.createElement("tr");
    addCell(row, `#${entry.rank}`, "rank-cell");
    addCell(row, entry.display_name, "name-cell");
    addCell(row, Number(entry.score).toLocaleString(), "score-cell");
    if (gameSlug === "next") {
      addCell(row, formatAchievedAt(entry.achieved_at), "difficulty-cell");
    } else {
      addCell(row, entry.level, "level-cell");
      addCell(row, entry.difficulty, "difficulty-cell");
    }
    body.append(row);
  });
}

async function renderOwnBest(page, difficulty, gameSlug) {
  const signedOut = page.querySelector("[data-own-best-signed-out]");
  const signedIn = page.querySelector("[data-own-best-signed-in]");
  const score = page.querySelector("[data-own-best-score]");
  const meta = page.querySelector("[data-own-best-meta]");

  setVisible(signedOut, false);
  setVisible(signedIn, false);

  try {
    const user = await getCurrentUser();
    if (!user) {
      setVisible(signedOut, true);
      return;
    }

    const bests = await getMyBests(gameSlug);
    const candidates = difficulty === "All"
      ? bests
      : bests.filter((best) => best.difficulty === difficulty);
    candidates.sort((a, b) => Number(b.score) - Number(a.score));
    const best = candidates[0];

    setVisible(signedIn, true);
    if (!best) {
      score.textContent = "—";
      meta.textContent = difficulty === "All" ? "No saved run yet" : `No ${difficulty} run yet`;
      return;
    }
    score.textContent = Number(best.score).toLocaleString();
    meta.textContent = gameSlug === "next" ? `Challenge ${best.level} reached` : `${best.difficulty} · Level ${best.level}`;
  } catch {
    setVisible(signedOut, true);
  }
}

async function loadLeaderboard(page, difficulty, gameSlug) {
  const loading = page.querySelector("[data-loading]");
  const empty = page.querySelector("[data-empty]");
  const errorState = page.querySelector("[data-error]");
  const table = page.querySelector("[data-table]");
  const body = page.querySelector("[data-leaderboard-body]");

  setVisible(loading, true);
  setVisible(empty, false);
  setVisible(errorState, false);
  setVisible(table, false);

  page.querySelectorAll("[data-difficulty]").forEach((button) => {
    const selected = button.dataset.difficulty === difficulty;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });

  try {
    const entries = await getLeaderboard(gameSlug, difficulty);
    if (!entries.length) {
      setVisible(empty, true);
    } else {
      renderRows(body, entries, gameSlug);
      setVisible(table, true);
    }
  } catch {
    setVisible(errorState, true);
  } finally {
    setVisible(loading, false);
  }

  await renderOwnBest(page, difficulty, gameSlug);
}

function initLeaderboardPage(page) {
  const gameSlug = page.dataset.gameSlug || "orbit-shift";
  let selectedDifficulty = "All";
  page.querySelectorAll("[data-difficulty]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedDifficulty = button.dataset.difficulty;
      void loadLeaderboard(page, selectedDifficulty, gameSlug);
    });
  });
  page.querySelector("[data-retry]")?.addEventListener("click", () => {
    void loadLeaderboard(page, selectedDifficulty, gameSlug);
  });
  void loadLeaderboard(page, selectedDifficulty, gameSlug);
}

const leaderboardPage = document.querySelector("[data-leaderboard-page]");
if (leaderboardPage) initLeaderboardPage(leaderboardPage);
