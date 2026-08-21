import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const read = (relative) => readFile(new URL(`../../${relative}`, import.meta.url), "utf8");

test("beatbox-riddim engine keeps every stage on one 132 BPM D-minor clock", async () => {
  const source = await read("games/balls-out/dynamic-music.js");
  for (const name of ["NEON HORIZON", "ORBITAL STATIC", "MIDNIGHT CITY", "WARP MALFUNCTION", "REACTOR ROOM", "VOID BLOOM"])
    assert.ok(source.includes(`'${name}'`), `missing stage identity ${name}`);
  assert.match(source, /const BPM = 132/);
  assert.match(source, /const PITCHES = \[0,3,5,7,10,12\]/);
  assert.doesNotMatch(source, /progressions|padChord|performArp|melodyBuffer/);
  assert.doesNotThrow(() => new vm.Script(source));
});

test("music uses buffered sixteenth windows, two-bar phrase memory, STOPs, and capped buses", async () => {
  const source = await read("games/balls-out/dynamic-music.js");
  assert.match(source, /class MusicalClock/);
  assert.match(source, /class GameplayEventBuffer/);
  assert.match(source, /STEPS_PER_BAR = 16/);
  assert.match(source, /BARS_PER_PHRASE = 2/);
  assert.match(source, /LOOK_AHEAD_SECONDS = \.14/);
  assert.match(source, /SCHEDULER_INTERVAL_MS = 25/);
  assert.match(source, /currentPhrase:phrase,previousPhrase:clonePhrase\(phrase\)/);
  assert.match(source, /voiceLimits=\{drum:8,tech:12,bass:6,atmosphere:2,impact:4\}/);
  assert.match(source, /slot\.stop\)return/);
  assert.match(source, /stopSteps=.*BIG CHUNGUS.*NUCLEAR OPTION.*\?2:1/);
  assert.match(source, /createDynamicsCompressor/);
  assert.match(source, /sidechain\(time,impact=false\)/);
  assert.match(source, /formants/);
  assert.match(source, /enforcePhraseCaps/);
});

test("gameplay emits semantic events and only SMASH choreography delays a designed effect", async () => {
  const game = await read("games/balls-out/index.html");
  for (const hook of [
    "onPaddleHit", "onWallHit", "onObstacleHit", "onBrickHit", "onBrickDestroyed",
    "onExplosion", "onComboChanged", "onPowerupActivated", "onSmashEvent",
    "onWaveStart", "onWaveClear", "onLifeLost", "onGameOver",
  ]) assert.ok(game.includes(`music?.${hook}`), `missing semantic hook ${hook}`);
  assert.doesNotMatch(game, /await music\?/);
  assert.match(game, /cue\?\.delayMs/);
  assert.match(game, /function landSmash\(name\)/);
  assert.match(game, /smashReady:state\.smashReady/);
  assert.match(game, /musicDebugEnabled&&\/\^Digit\[1-7\]\$\//);
});

class Param {
  constructor(value=1){this.value=value;}
  setValueAtTime(value){this.value=value;}
  exponentialRampToValueAtTime(value){this.value=value;}
  linearRampToValueAtTime(value){this.value=value;}
  setTargetAtTime(value){this.value=value;}
  cancelScheduledValues(){}
}
class AudioNode {
  constructor(){
    this.gain=new Param();this.frequency=new Param(440);this.detune=new Param();this.pan=new Param();
    this.Q=new Param();this.threshold=new Param();this.knee=new Param();this.ratio=new Param();this.attack=new Param();this.release=new Param();
  }
  connect(){return this;}
  start(){}
  stop(){}
  addEventListener(){}
}
class AudioContext {
  constructor(){this.currentTime=1;this.sampleRate=48_000;this.state="running";this.destination=new AudioNode();}
  createGain(){return new AudioNode();}
  createBiquadFilter(){return new AudioNode();}
  createDynamicsCompressor(){return new AudioNode();}
  createStereoPanner(){return new AudioNode();}
  createWaveShaper(){return new AudioNode();}
  createOscillator(){return new AudioNode();}
  createBufferSource(){return new AudioNode();}
  createBuffer(_channels,length){const data=new Float32Array(length);return {getChannelData:()=>data};}
}

async function createMusic(options={}) {
  const source = await read("games/balls-out/dynamic-music.js");
  const sandbox={window:{},Math,performance,setTimeout,clearTimeout,setInterval,clearInterval};
  vm.createContext(sandbox);new vm.Script(source).runInContext(sandbox);
  return new sandbox.window.DynamicMusicEngine(new AudioContext(),{worldWidth:1000,...options});
}

test("reactive events aggregate without creating immediate voices", async () => {
  const music=await createMusic();music.running=true;const before={...music.voiceCounts};
  for(let i=0;i<8;i++)music.onBrickDestroyed({x:100+i*50,y:120,w:40,maxHp:2},{vx:500,vy:500},"chainBoom",8);
  for(let i=0;i<6;i++)music.onLaser("pew",500);
  music.onPaddleHit({x:400,vx:400,vy:-700});music.onWallHit({x:900},"top");music.onObstacleHit({x:300});music.onExplosion(12,{x:500},1.8,"chainBoom");
  assert.deepEqual(Object.entries(music.voiceCounts),Object.entries(before),"reactive callbacks must only report information");
  assert.equal(music.events.buckets.size,1,"same sixteenth's chaos must aggregate into one bucket");
  const bucket=[...music.events.buckets.values()][0];
  assert.equal(bucket.destroyed,8);assert.equal(bucket.lasers,6);assert.equal(bucket.explosions,12);assert.equal(bucket.maxChain,3);assert.ok(bucket.count<32,"event window remains capped");
});

test("phrase mutation preserves anchors while multiball and destruction increase technicality", async () => {
  const music=await createMusic();music.running=true;const original=music.composition.currentPhrase.map(step=>JSON.stringify(step));
  music.update({balls:18,combo:10,effects:{pew:2,bigBall:1},smashReady:true});
  for(let i=0;i<10;i++)music.onBrickDestroyed({x:i*90,y:100,w:50,maxHp:1},{vx:600,vy:400},"ball",10);
  music.evolvePhrase(32);const phrase=music.composition.currentPhrase;
  assert.equal(phrase.length,32);for(const step of [0,8,16,24])assert.equal(phrase[step].kick,true);for(const step of [4,12,20,28])assert.equal(phrase[step].snare,true);
  const changed=phrase.filter((step,index)=>JSON.stringify(step)!==original[index]).length;
  assert.ok(changed>=3&&changed<=13,`expected controlled phrase retention, changed ${changed}`);
  assert.ok(phrase.some(step=>step.tech),"busy play must add technical percussion");assert.ok(music.composition.targetEnergy>.7);
  for(let i=0;i<16;i++)music.evolvePhrase(64+i*32);
  assert.ok(music.composition.currentPhrase.filter(step=>step.kick||step.snare||step.tech||step.bass).length<=24,"even extreme play must retain at least one quarter of the grid as space");
});

test("major cues reserve grid-aligned silence and impact without changing section early", async () => {
  const music=await createMusic();music.running=true;music.clock.absoluteStep=3;
  const cue=music.onSmashEvent("BIG CHUNGUS");
  assert.equal(cue.absoluteStep%4,0,"SMASH must land on a strong beat");assert.ok(cue.delayMs>=0);
  assert.equal(music.punctuation.get(cue.absoluteStep-2).stop,true);assert.equal(music.punctuation.get(cue.absoluteStep-1).stop,true);assert.equal(music.punctuation.get(cue.absoluteStep).impact,true);
  assert.equal(music.composition.section,"SPARSE","section must not jump before the scheduled landing");
});

test("life loss collapses phrase energy and pause offsets the same musical clock", async () => {
  const music=await createMusic();music.running=true;music.composition.energy=.9;music.composition.section="DROP";
  const origin=music.clock.origin;music.pause();music.ctx.currentTime+=2;music.resume();assert.equal(music.clock.origin,origin+2);
  music.onLifeLost();assert.equal(music.composition.energy,.08);assert.equal(music.composition.section,"RELEASE");assert.equal(music.composition.currentPhrase.length,32);assert.equal(music.activeEffects.size,0);
});

test("all synthesized drum, technical, bass, impact, and atmosphere voices honor the Web Audio contract", async () => {
  for (const voice of ["stab","wobble","growl","hold","stutter","acid","glide"]) {
    const music=await createMusic();music.running=true;
    assert.doesNotThrow(()=>music.performBass(1.1,{voice,pitch:voice==='acid'?10:0,repeats:3},.9),voice);
  }
  const music=await createMusic();music.running=true;
  assert.doesNotThrow(()=>{music.kick(1.1,1);music.kah(1.2,.9,true);music.technical(1.3,"tk",.4);music.hugeImpact(1.5,"BIG CHUNGUS",1);music.drone(1.7,26,1,.05);});
});
