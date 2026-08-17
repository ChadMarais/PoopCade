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

test("ordinary NEXT rounds mix honest and conflicting visual cues", () => {
  assert.match(next, /const opposite=\{LEFT:'RIGHT',RIGHT:'LEFT',UP:'DOWN',DOWN:'UP'\}\[dir\]/);
  assert.match(next, /const arrowDir=Math\.random\(\)<\.5\?dir:opposite/);
  assert.match(next, /Words outrank arrows\./);
  assert.match(next, /text:'BIG'.*size:small|size:small.*text:'BIG'/);
  assert.match(next, /text:'SMALL'.*size:big|size:big.*text:'SMALL'/);
  assert.match(next, /const misleadingLabels=cols\.map/);
  assert.match(next, /sideRound,sameDifferentRound,oppositeSwipeRound/);
  assert.match(next, /if\(score>=10\)pool\.push\(machineIsLyingRound\)/);
});

test("the do-not-press round uses tempting button copy", () => {
  assert.match(next, /text:choice\(\['PRESS ME','QUICK!'\]\)/);
  assert.doesNotMatch(next, /text:'DO NOT'/);
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
