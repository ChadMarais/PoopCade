import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const read = (relative) => readFile(new URL(`../../${relative}`, import.meta.url), "utf8");

test("dynamic music engine defines all six approved stage identities", async () => {
  const source = await read("games/balls-out/dynamic-music.js");
  for (const [name, bpm] of [
    ["NEON HORIZON",112],
    ["ORBITAL STATIC",120],
    ["MIDNIGHT CITY",126],
    ["WARP MALFUNCTION",134],
    ["REACTOR ROOM",140],
    ["VOID BLOOM",116],
  ]) {
    assert.ok(source.includes(`'${name}': { bpm:${bpm}`), `${name} must retain its approved BPM identity`);
  }
  assert.match(source, /class DynamicMusicEngine/);
  assert.doesNotThrow(() => new vm.Script(source));
});

test("music is quantized, density-limited, and aggregates brick destruction", async () => {
  const source = await read("games/balls-out/dynamic-music.js");
  assert.match(source, /quantized\(divisions=4\)/);
  assert.match(source, /maxVoices=22/);
  assert.match(source, /percussionTimes\.length>=8/);
  assert.match(source, /setTimeout\(\(\)=>this\.flushDestroyed\(\),72\)/);
  assert.match(source, /duckForScare\(duration=\.9\)/);
  assert.match(source, /createDynamicsCompressor/);
});

test("gameplay emits semantic music events without depending on audio callbacks", async () => {
  const game = await read("games/balls-out/index.html");
  for (const hook of [
    "onPaddleHit", "onWallHit", "onObstacleHit", "onBrickHit", "onBrickDestroyed",
    "onExplosion", "onComboChanged", "onPowerupActivated", "onSmashEvent",
    "onWaveStart", "onWaveClear", "onLifeLost", "onGameOver",
  ]) assert.ok(game.includes(`music?.${hook}`), `missing semantic hook ${hook}`);
  assert.doesNotMatch(game, /await music\?/);
});

test("dynamic music event methods run safely against the Web Audio contract", async () => {
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
  const source = await read("games/balls-out/dynamic-music.js");
  const sandbox={window:{},Math,performance,setTimeout,clearTimeout,setInterval,clearInterval};
  vm.createContext(sandbox);new vm.Script(source).runInContext(sandbox);
  const music=new sandbox.window.DynamicMusicEngine(new AudioContext(),{worldWidth:1000});
  assert.doesNotThrow(()=>{
    music.running=true;
    music.setTheme("REACTOR ROOM",5);
    music.update({balls:20,combo:15,effects:{panic:1,boom:2}});
    music.onPaddleHit({vx:400,vy:-700});
    music.onWallHit({x:900},"top");
    music.onObstacleHit({x:300});
    music.onBrickHit({x:400,y:120,w:60,maxHp:2},{vx:500,vy:500});
    music.onExplosion(12,{x:500,y:300},1.8);
    music.onPowerupActivated("fart");
    music.onSmashEvent("BIG CHUNGUS");
    music.onWaveClear(5);
    music.onLifeLost();
    music.onGameOver();
  });
});
