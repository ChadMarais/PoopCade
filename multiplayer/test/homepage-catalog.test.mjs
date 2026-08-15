import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(`../../${relative}`, import.meta.url), "utf8");

function ordered(source, values) {
  const positions = values.map((value) => source.indexOf(value));
  assert.ok(positions.every((position) => position >= 0), `missing catalog value: ${values[positions.indexOf(-1)]}`);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
}

test("homepage promotes Nebula Murderball as Game 01 ahead of Orbit Shift and NEXT", async () => {
  const homepage = await read("index.html");
  ordered(homepage, [
    "Game 01 · Multiplayer",
    "Game 02 · Single player",
    "Game 03 · Single player",
  ]);
  ordered(homepage, [
    "NEBULA<br>MURDERBALL",
    "ORBIT<i>//</i>SHIFT",
    "NEXT<i>.</i>",
  ]);
});

test("game titles, account cards, and leaderboards follow the public game order", async () => {
  const [murderball, orbit, next, account, overall, leaderboard] = await Promise.all([
    read("games/game-03/index.html"),
    read("games/orbit-shift/index.html"),
    read("games/next/index.html"),
    read("account/index.html"),
    read("leaderboard/index.html"),
    read("js/leaderboard.js"),
  ]);
  assert.match(murderball, /Poopcade Game 01/);
  assert.match(orbit, /Poopcade Game 02/);
  assert.match(next, /Poopcade Game 03/);
  ordered(account, ["NEBULA MURDERBALL best", "ORBIT//SHIFT bests", "NEXT. best"]);
  ordered(overall, ["<th>Nebula Murderball</th>", "<th>Orbit Shift</th>", "<th>Next</th>"]);
  ordered(leaderboard, ["entry.dusty_orbit_rank", "entry.orbit_shift_rank", "entry.next_rank"]);
});
