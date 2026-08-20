import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(`../../${relative}`, import.meta.url), "utf8");

function ordered(source, values) {
  const positions = values.map((value) => source.indexOf(value));
  assert.ok(positions.every((position) => position >= 0), `missing catalog value: ${values[positions.indexOf(-1)]}`);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
}

test("homepage presents all four games in public order", async () => {
  const homepage = await read("index.html");
  ordered(homepage, [
    "Game 01 · Multiplayer",
    "Game 02 · Single player",
    "Game 03 · Single player",
    "Game 04 · Single player",
  ]);
  ordered(homepage, [
    "NEBULA<br>MURDERBALL",
    "ORBIT<i>//</i>SHIFT",
    "NEXT<i>.</i>",
    "BALLS <i>OUT</i>",
  ]);
  assert.match(homepage, /START WITH A PATHETIC PEA SHOOTER/);
  assert.match(homepage, /EVERY KILL[\s\S]*upgrades it one level/);
  assert.match(homepage, /EVERY DEATH[\s\S]*drops it one level/);
});

test("game titles, account cards, and leaderboards follow the public game order", async () => {
  const [murderball, orbit, next, ballsOut, account, overall, leaderboard] = await Promise.all([
    read("games/game-03/index.html"),
    read("games/orbit-shift/index.html"),
    read("games/next/index.html"),
    read("games/balls-out/index.html"),
    read("account/index.html"),
    read("leaderboard/index.html"),
    read("js/leaderboard.js"),
  ]);
  assert.match(murderball, /Poopcade Game 01/);
  assert.match(orbit, /Poopcade Game 02/);
  assert.match(next, /Poopcade Game 03/);
  assert.match(ballsOut, /Poopcade Game 04/);
  ordered(account, ["NEBULA MURDERBALL best", "ORBIT//SHIFT bests", "NEXT. best", "BALLS OUT best"]);
  ordered(overall, ["<th>Nebula Murderball</th>", "<th>Orbit Shift</th>", "<th>Next</th>", "<th>Balls Out</th>"]);
  ordered(leaderboard, ["entry.dusty_orbit_rank", "entry.orbit_shift_rank", "entry.next_rank", "entry.balls_out_rank"]);
});
