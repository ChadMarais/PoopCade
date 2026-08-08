import { supabase } from "./supabase-config.js";
import { getCurrentUser, getMyBests } from "./auth.js";

const ALLOWED_DIFFICULTIES = new Set(["All", "Easy", "Medium", "Hard"]);

export async function getLeaderboard(difficulty = "All", limit = 50) {
  const selectedDifficulty = ALLOWED_DIFFICULTIES.has(difficulty) ? difficulty : "All";
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const { data, error } = await supabase.rpc("get_leaderboard", {
    game_slug: "orbit-shift",
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

function renderRows(body, entries) {
  body.replaceChildren();
  entries.forEach((entry) => {
    const row = document.createElement("tr");
    addCell(row, `#${entry.rank}`, "rank-cell");
    addCell(row, entry.display_name, "name-cell");
    addCell(row, Number(entry.score).toLocaleString(), "score-cell");
    addCell(row, entry.level, "level-cell");
    addCell(row, entry.difficulty, "difficulty-cell");
    body.append(row);
  });
}

async function renderOwnBest(page, difficulty) {
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

    const bests = await getMyBests();
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
    meta.textContent = `${best.difficulty} · Level ${best.level}`;
  } catch {
    setVisible(signedOut, true);
  }
}

async function loadLeaderboard(page, difficulty) {
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
    const entries = await getLeaderboard(difficulty);
    if (!entries.length) {
      setVisible(empty, true);
    } else {
      renderRows(body, entries);
      setVisible(table, true);
    }
  } catch {
    setVisible(errorState, true);
  } finally {
    setVisible(loading, false);
  }

  await renderOwnBest(page, difficulty);
}

function initLeaderboardPage(page) {
  let selectedDifficulty = "All";
  page.querySelectorAll("[data-difficulty]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedDifficulty = button.dataset.difficulty;
      void loadLeaderboard(page, selectedDifficulty);
    });
  });
  page.querySelector("[data-retry]")?.addEventListener("click", () => {
    void loadLeaderboard(page, selectedDifficulty);
  });
  void loadLeaderboard(page, selectedDifficulty);
}

const leaderboardPage = document.querySelector("[data-leaderboard-page]");
if (leaderboardPage) initLeaderboardPage(leaderboardPage);
