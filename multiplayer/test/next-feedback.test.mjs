import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const next = await readFile(new URL("../../games/next/index.html", import.meta.url), "utf8");

test("NEXT shows a readable correct-answer phase before continuing after a spare-life failure", () => {
  assert.match(next, /eyebrow\.textContent='CORRECT ANSWER'/);
  assert.match(next, /setInstruction\(correctAnswer,reason \|\| 'Challenge failed\.'\)/);
  assert.match(next, /Correct answer: \$\{correctAnswer\}/);
  assert.match(next, /\},1800\);/);
  assert.match(next, /\.shell\.correction-mode \.instruction/);
});

test("NEXT records explicit answers for non-obvious challenge types", () => {
  for (const answer of [
    "THE CORRECT COLOUR WAS",
    "THERE WERE ${count} DOTS",
    "THE CORRECT ANSWER WAS ${same?'SAME':'DIFFERENT'}",
    "THE ORIGINAL POD FINISHED ON THE",
    "IGNORE THE MACHINE. SWIPE ${opposite}",
  ]) assert.ok(next.includes(answer), answer);
});

test("the zero-input taunt says I DARE YOU instead of the directional word RIGHT", () => {
  assert.match(next, /\['I DARE YOU!','No more nice machine\.'\]/);
  assert.doesNotMatch(next, /\['RIGHT\.','No more nice machine\.'\]/);
});

test("Murderball progression copy remains cheeky without profanity", async () => {
  const [homepage, lobby] = await Promise.all([
    readFile(new URL("../../index.html", import.meta.url), "utf8"),
    readFile(new URL("../../games/game-03/index.html", import.meta.url), "utf8"),
  ]);
  assert.match(homepage, /START WITH A PATHETIC PEA SHOOTER/);
  assert.match(lobby, /START WITH A PATHETIC PEA SHOOTER/);
  assert.doesNotMatch(`${homepage}\n${lobby}`, /\bshit\b/i);
});
