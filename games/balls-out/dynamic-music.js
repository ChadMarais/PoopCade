(() => {
  'use strict';

  const BPM = 132;
  const STEPS_PER_BEAT = 4;
  const STEPS_PER_BAR = 16;
  const BARS_PER_PHRASE = 2;
  const STEPS_PER_PHRASE = STEPS_PER_BAR * BARS_PER_PHRASE;
  const LOOK_AHEAD_SECONDS = .14;
  const SCHEDULER_INTERVAL_MS = 25;
  const SECTIONS = Object.freeze({SPARSE:'SPARSE',GROOVE:'GROOVE',PRESSURE:'PRESSURE',DROP:'DROP',RELEASE:'RELEASE'});
  const THEMES = Object.freeze({
    'NEON HORIZON': {bpm:BPM,root:38,formants:[430,1080,2380],color:'neon throat'},
    'ORBITAL STATIC': {bpm:BPM,root:38,formants:[380,1260,2500],color:'hollow static'},
    'MIDNIGHT CITY': {bpm:BPM,root:38,formants:[470,980,2180],color:'dark mouth'},
    'WARP MALFUNCTION': {bpm:BPM,root:38,formants:[520,1420,2640],color:'pinched machine'},
    'REACTOR ROOM': {bpm:BPM,root:38,formants:[350,920,2020],color:'industrial throat'},
    'VOID BLOOM': {bpm:BPM,root:38,formants:[410,1160,2260],color:'deep alien'},
  });
  const PITCHES = [0,3,5,7,10,12];
  const clamp = (value,min,max) => Math.max(min,Math.min(max,value));
  const choose = items => items[Math.floor(Math.random()*items.length)];
  const midiToHz = note => 440*Math.pow(2,(note-69)/12);
  const emptyStep = () => ({kick:false,snare:false,tech:null,bass:null,stop:false,impact:false});
  const clonePhrase = phrase => phrase.map(step => ({...step,bass:step.bass?{...step.bass}:null}));

  class MusicalClock {
    constructor(context,bpm=BPM){this.ctx=context;this.reset(bpm);this.pausedAt=0;}
    reset(bpm,delay=.045){this.bpm=bpm;this.origin=this.ctx.currentTime+delay;this.nextTime=this.origin;this.absoluteStep=0;this.pausedAt=0;}
    get stepDuration(){return 60/this.bpm/STEPS_PER_BEAT;}
    nextStrongStep(minLead=.18){const earliest=this.ctx.currentTime+minLead,raw=Math.ceil((earliest-this.origin)/this.stepDuration);return Math.ceil(Math.max(this.absoluteStep,raw)/STEPS_PER_BEAT)*STEPS_PER_BEAT;}
    timeForStep(step){return this.origin+step*this.stepDuration;}
    pause(){this.pausedAt=this.ctx.currentTime;}
    resume(){if(!this.pausedAt)return;const gap=this.ctx.currentTime-this.pausedAt;this.origin+=gap;this.nextTime+=gap;this.pausedAt=0;}
    advance(){const n=this.absoluteStep,tick={time:this.nextTime,absoluteStep:n,phraseStep:n%STEPS_PER_PHRASE,step:n%STEPS_PER_BAR,bar:Math.floor(n/STEPS_PER_BAR),beat:Math.floor((n%STEPS_PER_BAR)/STEPS_PER_BEAT),phrase:Math.floor(n/STEPS_PER_PHRASE)};this.absoluteStep++;this.nextTime+=this.stepDuration;return tick;}
  }

  class GameplayEventBuffer {
    constructor(clock){this.clock=clock;this.buckets=new Map();this.history=[];}
    report(event){
      const step=Math.max(this.clock.absoluteStep,Math.ceil((this.clock.ctx.currentTime-this.clock.origin)/this.clock.stepDuration)+1);
      const bucket=this.buckets.get(step)||{step,count:0,types:Object.create(null),strength:0,destroyed:0,explosions:0,lasers:0,paddles:0,walls:0,obstacles:0,maxChain:0,xTotal:0,xCount:0};
      bucket.count=Math.min(64,bucket.count+1);bucket.types[event.type]=(bucket.types[event.type]||0)+1;bucket.strength=clamp(bucket.strength+(event.strength||.1),0,12);
      bucket.destroyed+=event.type==='brick-destroyed'?1:0;bucket.explosions+=event.type==='explosion'?Math.max(1,event.brickCount||1):0;bucket.lasers+=event.type==='laser'?1:0;bucket.paddles+=event.type==='paddle'?1:0;bucket.walls+=event.type==='wall'?1:0;bucket.obstacles+=event.type==='obstacle'?1:0;bucket.maxChain=Math.max(bucket.maxChain,event.chainDepth||0);
      if(Number.isFinite(event.x)){bucket.xTotal+=event.x;bucket.xCount++;}this.buckets.set(step,bucket);this.history.push({...event,step});if(this.history.length>160)this.history.splice(0,this.history.length-160);
    }
    take(step){const bucket=this.buckets.get(step)||null;this.buckets.delete(step);return bucket;}
    summary(sinceStep){
      const events=this.history.filter(event=>event.step>=sinceStep),summary={count:events.length,destroyed:0,explosions:0,lasers:0,paddles:0,walls:0,obstacles:0,strength:0,maxChain:0,x:500};let xTotal=0,xCount=0;
      for(const event of events){summary.destroyed+=event.type==='brick-destroyed'?1:0;summary.explosions+=event.type==='explosion'?Math.max(1,event.brickCount||1):0;summary.lasers+=event.type==='laser'?1:0;summary.paddles+=event.type==='paddle'?1:0;summary.walls+=event.type==='wall'?1:0;summary.obstacles+=event.type==='obstacle'?1:0;summary.strength+=event.strength||0;summary.maxChain=Math.max(summary.maxChain,event.chainDepth||0);if(Number.isFinite(event.x)){xTotal+=event.x;xCount++;}}
      if(xCount)summary.x=xTotal/xCount;this.history=this.history.filter(event=>event.step>=sinceStep-STEPS_PER_PHRASE);return summary;
    }
    clear(){this.buckets.clear();this.history.length=0;}
  }

  class DynamicMusicEngine {
    constructor(context,{output,worldWidth=1000,debug=false}={}){
      this.ctx=context;this.output=output||context.destination;this.worldWidth=worldWidth;this.debug=debug;this.enabled=true;this.running=false;this.paused=false;this.muted=false;this.gameOver=false;this.timer=0;
      this.themeName='NEON HORIZON';this.theme=THEMES[this.themeName];this.wave=1;this.ballCount=1;this.combo=1;this.smashReady=false;this.clock=new MusicalClock(context,BPM);this.events=new GameplayEventBuffer(this.clock);this.activeEffects=new Set();
      this.voiceCounts={drum:0,tech:0,bass:0,atmosphere:0,impact:0};this.voiceLimits={drum:8,tech:12,bass:6,atmosphere:2,impact:4};this.noiseBuffer=this.makeNoiseBuffer(1);this.shaperCurve=this.makeSaturationCurve(3.4);this.hardCurve=this.makeSaturationCurve(6.2);
      this.composition=this.freshComposition();this.punctuation=new Map();this.buildMix();
    }
    freshComposition(){const phrase=this.basePhrase();return {bpm:BPM,currentBar:0,currentStep:0,phraseIndex:0,section:SECTIONS.SPARSE,energy:.1,targetEnergy:.1,density:.16,tension:0,phraseStartedStep:0,currentPhrase:phrase,previousPhrase:clonePhrase(phrase),bassMotif:[0,7,0,3,0,10],mutationCount:0,lastMajorEvent:null,lastEventSummary:{count:0},recentDeath:false};}
    basePhrase(){
      const phrase=Array.from({length:STEPS_PER_PHRASE},emptyStep);[0,8,16,24].forEach(step=>phrase[step].kick=true);[4,12,20,28].forEach(step=>phrase[step].snare=true);
      phrase[0].bass={voice:'stab',pitch:0};phrase[6].bass={voice:'wobble',pitch:7};phrase[11].bass={voice:'growl',pitch:0};phrase[16].bass={voice:'stab',pitch:0};phrase[22].bass={voice:'wobble',pitch:3};phrase[27].bass={voice:'stutter',pitch:0,repeats:2};phrase[30].bass={voice:'hold',pitch:7};phrase[2].tech='tk';phrase[18].tech='tk';return phrase;
    }
    buildMix(){
      const c=this.ctx;this.master=c.createGain();this.master.gain.value=.78;this.compressor=c.createDynamicsCompressor();this.compressor.threshold.value=-14;this.compressor.knee.value=8;this.compressor.ratio.value=8;this.compressor.attack.value=.003;this.compressor.release.value=.14;this.musicFilter=c.createBiquadFilter();this.musicFilter.type='lowpass';this.musicFilter.frequency.value=17500;this.musicFilter.Q.value=.35;this.musicSum=c.createGain();this.musicSum.gain.value=.9;
      this.drums=c.createGain();this.drums.gain.value=.92;this.tech=c.createGain();this.tech.gain.value=.54;this.sub=c.createGain();this.sub.gain.value=.72;this.bass=c.createGain();this.bass.gain.value=.63;this.atmosphere=c.createGain();this.atmosphere.gain.value=.12;this.impacts=c.createGain();this.impacts.gain.value=.78;this.bassDuck=c.createGain();this.bassDuck.gain.value=1;this.atmosphereDuck=c.createGain();this.atmosphereDuck.gain.value=1;
      this.bass.connect(this.bassDuck);this.sub.connect(this.bassDuck);this.bassDuck.connect(this.musicSum);this.atmosphere.connect(this.atmosphereDuck);this.atmosphereDuck.connect(this.musicSum);[this.drums,this.tech,this.impacts].forEach(bus=>bus.connect(this.musicSum));this.musicSum.connect(this.musicFilter);this.musicFilter.connect(this.master);this.master.connect(this.compressor);this.compressor.connect(this.output);
    }
    makeNoiseBuffer(seconds){const length=Math.floor(this.ctx.sampleRate*seconds),buffer=this.ctx.createBuffer(1,length,this.ctx.sampleRate),data=buffer.getChannelData(0);let brown=0;for(let i=0;i<length;i++){const white=Math.random()*2-1;brown=brown*.83+white*.17;data[i]=white*.75+brown*.25;}return buffer;}
    makeSaturationCurve(amount){const curve=new Float32Array(512);for(let i=0;i<curve.length;i++){const x=i*2/(curve.length-1)-1;curve[i]=Math.tanh(x*amount);}return curve;}
    start(themeName='NEON HORIZON',wave=1){if(!this.enabled)return;this.running=true;this.paused=false;this.gameOver=false;this.setTheme(themeName,wave);this.events.clear();this.composition=this.freshComposition();this.punctuation.clear();this.clock.reset(BPM,.05);if(!this.timer)this.timer=setInterval(()=>this.scheduler(),SCHEDULER_INTERVAL_MS);this.rampMaster(this.muted?.0001:.78,.08);this.onWaveStart(themeName,wave,true);}
    stop(){this.running=false;this.events.clear();if(this.timer){clearInterval(this.timer);this.timer=0;}this.rampMaster(.0001,.12);}
    setMuted(muted){this.muted=!!muted;this.rampMaster(this.muted?.0001:.78,this.muted?.04:.12);}
    pause(){if(!this.running||this.paused)return;this.paused=true;this.clock.pause();this.rampMaster(.025,.08);}
    resume(){if(!this.running||!this.paused)return;this.paused=false;this.clock.resume();this.rampMaster(this.muted?.0001:.78,.15);}
    rampMaster(value,duration){const t=this.ctx.currentTime,g=this.master.gain;g.cancelScheduledValues(t);g.setTargetAtTime(value,t,Math.max(.008,duration/4));}
    setTheme(name,wave=this.wave){this.themeName=THEMES[name]?name:'NEON HORIZON';this.theme=THEMES[this.themeName];this.wave=wave;}
    scheduler(){if(!this.enabled||!this.running||this.paused||this.ctx.state!=='running')return;if(this.clock.nextTime<this.ctx.currentTime-.2){const missed=Math.ceil((this.ctx.currentTime-this.clock.nextTime)/this.clock.stepDuration);this.clock.absoluteStep+=missed;this.clock.nextTime+=missed*this.clock.stepDuration;}const horizon=this.ctx.currentTime+LOOK_AHEAD_SECONDS;while(this.clock.nextTime<horizon)this.scheduleTick(this.clock.advance());}
    scheduleTick(tick){
      const c=this.composition;c.currentBar=tick.bar;c.currentStep=tick.step;c.phraseIndex=tick.phrase;if(tick.phraseStep===0&&tick.absoluteStep>0)this.evolvePhrase(tick.absoluteStep);
      const window=this.events.take(tick.absoluteStep),interpreted=this.interpretWindow(window,tick),punctuation=this.punctuation.get(tick.absoluteStep);if(punctuation)this.punctuation.delete(tick.absoluteStep);if(this.muted)return;if(punctuation?.stop)return;
      const slot={...c.currentPhrase[tick.phraseStep]};this.applySectionMask(slot,tick);if(slot.stop)return;if(interpreted.tech&&!slot.tech)slot.tech=interpreted.tech;if(interpreted.kick)slot.kick=true;if(interpreted.snare)slot.snare=true;if(interpreted.bass&&!slot.bass)slot.bass=interpreted.bass;if(punctuation?.fill)slot.tech=punctuation.fill;
      if(slot.kick&&slot.snare){if([4,12].includes(tick.step))slot.kick=false;else slot.snare=false;}
      if(slot.kick)this.kick(tick.time,tick.phraseStep%16===0?1:.82);if(slot.snare)this.kah(tick.time,c.section===SECTIONS.SPARSE?.68:.9,window?.obstacles>0);if(slot.tech)this.technical(tick.time,slot.tech,.34+c.energy*.18);if(slot.bass)this.performBass(tick.time,slot.bass,c.energy);
      if(punctuation?.impact){this.hugeImpact(tick.time,punctuation.kind||'major',punctuation.strength||1);c.section=SECTIONS.DROP;c.energy=Math.max(c.energy,.88);}if(tick.phraseStep===0&&tick.phrase%2===0&&!c.recentDeath)this.drone(tick.time,this.theme.root-12,this.clock.stepDuration*28,.055);
    }
    applySectionMask(slot,tick){const c=this.composition;if(c.section===SECTIONS.SPARSE){if(slot.tech&&tick.phraseStep%8!==2)slot.tech=null;if(slot.bass&&![0,11,16,27].includes(tick.phraseStep))slot.bass=null;}if(c.section===SECTIONS.RELEASE){slot.tech=null;if(![0,4,8,12].includes(tick.step))slot.bass=null;}if(this.activeEffects.has('laserDisco')&&tick.step%4===0)slot.kick=true;if(this.activeEffects.has('panic')&&tick.step%2===1&&!slot.tech)slot.tech=tick.step%4===1?'tk':'tss';if(this.activeEffects.has('pew')&&tick.step%2===1&&!slot.tech)slot.tech=tick.step%4===1?'tk':'k';}
    interpretWindow(window,tick){
      const result={kick:false,snare:false,tech:null,bass:null};if(!window)return result;const activity=window.destroyed+window.lasers*.35+window.obstacles*.6+window.walls*.12;
      if(window.paddles&&![4,12].includes(tick.step))result.kick=tick.step%2===0;if(window.obstacles)result.tech='k';else if(window.lasers>=2)result.tech=window.lasers>=5?'tss':'tk';else if(window.destroyed>=3)result.tech=window.destroyed>=6?'k':'tk';else if(window.walls>=3)result.tech='tss';if(window.destroyed>=5&&tick.step%4===0)result.snare=true;
      if(window.explosions>=8)result.bass={voice:'stutter',pitch:this.pitchFromX(window.xCount?window.xTotal/window.xCount:500),repeats:clamp(Math.ceil(window.explosions/7),2,3)};else if(window.maxChain>=2)result.bass={voice:'growl',pitch:window.maxChain>=4?7:0};if(activity>4)this.composition.energy=clamp(this.composition.energy+.018,0,1);return result;
    }
    evolvePhrase(absoluteStep){
      const c=this.composition,summary=this.events.summary(absoluteStep-STEPS_PER_PHRASE);c.lastEventSummary=summary;c.phraseStartedStep=absoluteStep;c.energy+=(c.targetEnergy-c.energy)*.5;c.section=this.sectionForEnergy(c.energy,c.recentDeath);c.density=clamp(.14+c.energy*.66,0,1);
      const previous=clonePhrase(c.currentPhrase),next=clonePhrase(c.currentPhrase),budget=Math.round(6+c.energy*6);let mutations=0;const candidates=[1,2,3,5,6,7,9,10,11,13,14,15,17,18,19,21,22,23,25,26,27,29,30,31];const mutate=(step,change)=>{if(mutations>=budget)return;change(next[step]);mutations++;};
      if(summary.paddles>2)mutate(choose([3,6,10,14,19,22,26,30]),slot=>slot.kick=true);if(summary.lasers>4||this.activeEffects.has('pew')||this.activeEffects.has('laserBall'))for(const step of choose([[1,2,3],[9,10,11],[25,26,27]]))mutate(step,slot=>slot.tech=step%2?'tk':'tss');
      if(summary.destroyed>=4){for(const step of choose([[5,6],[13,14],[21,22],[29,30]]))mutate(step,slot=>slot.tech='tk');mutate(choose([7,15,23,31]),slot=>slot.snare=true);}if(summary.explosions>=8||summary.maxChain>=2){const start=choose([6,10,22,26]);for(let i=0;i<Math.min(3,1+Math.ceil(summary.explosions/10)+summary.maxChain);i++)mutate(start+i,slot=>slot.bass={voice:'stutter',pitch:i%2?7:0,repeats:2});}
      if(this.ballCount>=3)for(const step of choose([[2,6,10,14],[18,22,26,30]]))mutate(step,slot=>{if(!slot.tech)slot.tech='tss';});if(this.ballCount>=11||this.combo>=8)for(const step of choose([[1,3,9,11],[17,19,25,27]]))mutate(step,slot=>{if(!slot.tech)slot.tech=step%2?'tk':'k';});
      if(c.energy>.72)mutate(choose([7,15,23,31]),slot=>slot.bass={voice:'growl',pitch:choose(c.bassMotif)});if(this.activeEffects.has('bigBall'))mutate(choose([11,15,27,30]),slot=>slot.bass={voice:'hold',pitch:0});if(this.activeEffects.has('fart')||this.activeEffects.has('worm'))mutate(choose([6,14,22,30]),slot=>slot.bass={voice:'acid',pitch:choose([0,7,10])});
      if(this.activeEffects.has('shotgun'))for(const step of choose([[5,6,7],[13,14,15],[21,22,23]]))mutate(step,slot=>slot.tech=step%3===0?'tss':'tk');
      if(this.activeEffects.has('magnet')||this.activeEffects.has('portal'))mutate(choose([6,14,22,30]),slot=>slot.bass={voice:'glide',pitch:this.activeEffects.has('portal')?12:choose([0,7])});
      if((summary.explosions>=14||c.energy>.86)&&Math.random()<.48){const stop=choose([14,15,29,31]);mutate(stop,slot=>{Object.assign(slot,emptyStep());slot.stop=true;});}if(summary.count<3&&Math.random()<.68){const removable=candidates.filter(step=>next[step].tech||next[step].bass&&!previous[step].kick&&!previous[step].snare);if(removable.length)mutate(choose(removable),slot=>{slot.tech=null;if(Math.random()<.55)slot.bass=null;});}
      this.enforcePhraseCaps(next,c.energy);c.previousPhrase=previous;c.currentPhrase=next;c.mutationCount=mutations;c.recentDeath=false;
    }
    enforcePhraseCaps(phrase,energy){
      const removeExtras=(field,limit)=>{const indices=phrase.map((slot,index)=>slot[field]?index:-1).filter(index=>index>=0&&!([0,4,8,12,16,20,24,28].includes(index)&&field!=='tech'));while(indices.length>limit){const index=indices.splice(Math.floor(Math.random()*indices.length),1)[0];phrase[index][field]=field==='stop'?false:null;}};
      removeExtras('tech',Math.round(4+energy*8));removeExtras('bass',Math.round(6+energy*5));removeExtras('stop',1);
      const maxOccupied=Math.round(18+energy*6),ornaments=phrase.map((slot,index)=>({slot,index})).filter(({slot,index})=>index%4!==0&&(slot.tech||slot.bass));
      let occupied=phrase.filter(slot=>slot.kick||slot.snare||slot.tech||slot.bass).length;
      while(occupied>maxOccupied&&ornaments.length){const {slot}=ornaments.splice(Math.floor(Math.random()*ornaments.length),1)[0];if(slot.tech)slot.tech=null;else slot.bass=null;occupied=phrase.filter(item=>item.kick||item.snare||item.tech||item.bass).length;}
    }
    sectionForEnergy(energy,recentDeath=false){if(recentDeath)return SECTIONS.RELEASE;if(energy<.22)return SECTIONS.SPARSE;if(energy<.55)return SECTIONS.GROOVE;if(energy<.8)return SECTIONS.PRESSURE;return SECTIONS.DROP;}
    pitchFromX(x){const index=Math.min(PITCHES.length-1,Math.floor(clamp(x/this.worldWidth,0,.999)*PITCHES.length));return PITCHES[index];}
    update({balls=1,combo=1,effects={},smashReady=false}={}){this.ballCount=balls;this.combo=combo;this.smashReady=!!smashReady;this.activeEffects=new Set(Object.entries(effects).filter(([,value])=>value>0).map(([key])=>key));const multiball=balls>=20?1:balls>=11?.82:balls>=6?.62:balls>=3?.34:0,comboEnergy=combo>=15?1:combo>=10?.84:combo>=8?.7:combo>=5?.5:combo>=3?.28:0,power=clamp(this.activeEffects.size*.055,0,.3),tension=this.smashReady?.14:0;this.composition.tension=tension;this.composition.targetEnergy=this.gameOver?.05:clamp(.1+multiball*.38+comboEnergy*.36+power+tension,0,1);this.composition.energy+=(this.composition.targetEnergy-this.composition.energy)*.1;}
    reportEvent(type,data={}){if(!this.running||this.gameOver)return;this.events.report({type,gameTime:performance.now(),...data});}
    onPaddleHit(ball={}){this.reportEvent('paddle',{strength:clamp(Math.hypot(ball.vx||0,ball.vy||0)/1000,.2,1.2),ballSpeed:Math.hypot(ball.vx||0,ball.vy||0),x:ball.x});}
    onWallHit(ball={},wall='side'){this.reportEvent('wall',{strength:wall==='top'?.22:.1,x:ball.x,wall});}
    onObstacleHit(ball={},obstacle={}){this.reportEvent('obstacle',{strength:.45,x:ball.x??obstacle.x,metallic:true});}
    onBrickHit(brick={},ball={}){this.reportEvent('brick-hit',{strength:.12,x:ball.x??brick.x});}
    onBrickDestroyed(brick={},ball={},cause='ball',combo=1){this.reportEvent('brick-destroyed',{strength:clamp((brick.maxHp||1)*.25,0,1),x:(brick.x||0)+(brick.w||0)/2,ballSpeed:Math.hypot(ball.vx||0,ball.vy||0),combo,chainDepth:['chainBoom','smashChain'].includes(cause)?2:0,cause});}
    onExplosion(brickCount=1,position={x:500},strength=1,cause='boom'){this.reportEvent('explosion',{brickCount:clamp(brickCount,1,32),strength:clamp(strength,.2,3),x:position?.x??500,chainDepth:cause==='chainBoom'?3:cause==='smashChain'?4:0,cause});if(brickCount>=10||strength>=1.8)this.planPunctuation(cause==='nuclear'?'NUCLEAR OPTION':'EXPLOSION',clamp(strength/2,.65,1));}
    onComboChanged(combo){this.combo=combo;if(combo>=15)this.reportEvent('combo-major',{strength:.9,combo});}
    onPowerupCollected(id){this.onPowerupActivated(id);}
    onPowerupActivated(id){this.reportEvent('powerup',{strength:.55,powerupType:id});if(['moreBalls','multiballer'].includes(id))this.reportEvent('multiball',{strength:.8,powerupType:id});else if(id==='nuclear')this.planPunctuation('NUCLEAR OPTION',1);else if(['boom','chain'].includes(id))this.reportEvent('explosion',{brickCount:id==='chain'?8:5,strength:.7,chainDepth:id==='chain'?2:0});}
    onLaser(kind='pew',x=500){this.reportEvent('laser',{strength:kind==='shot'?.2:.08,x,kind});}
    onPortal(_ball,_from,to){this.reportEvent('portal',{strength:.2,x:to?.x??500});}
    planPunctuation(kind,strength=1,minimumLead=.18){const landing=this.clock.nextStrongStep(minimumLead),stopSteps=kind==='BIG CHUNGUS'||kind==='NUCLEAR OPTION'?2:1;for(let i=stopSteps+3;i>stopSteps;i--){const step=landing-i;if(step>=this.clock.absoluteStep)this.punctuation.set(step,{fill:i%2?'tss':'tk',kind});}for(let i=stopSteps;i>0;i--)this.punctuation.set(landing-i,{stop:true,kind});this.punctuation.set(landing,{impact:true,kind,strength});this.composition.lastMajorEvent=kind;this.composition.targetEnergy=Math.max(this.composition.targetEnergy,.9);return {absoluteStep:landing,audioTime:this.clock.timeForStep(landing),delayMs:Math.max(0,(this.clock.timeForStep(landing)-this.ctx.currentTime)*1000)};}
    onSmashEvent(name){this.reportEvent('smash',{strength:1,powerupType:name});return this.planPunctuation(name,1,name==='BIG CHUNGUS'?.22:.18);}
    onWaveClear(){const cue=this.planPunctuation('WAVE CLEAR',.72,.12);this.composition.section=SECTIONS.RELEASE;this.composition.targetEnergy=.08;return cue;}
    onWaveStart(themeName,wave,initial=false){this.setTheme(themeName,wave);this.gameOver=false;this.composition.targetEnergy=.1;this.composition.section=SECTIONS.SPARSE;this.reportEvent('wave-start',{strength:initial?.25:.5});}
    onLifeLost(){this.events.clear();this.activeEffects.clear();this.punctuation.clear();const c=this.composition;c.targetEnergy=.04;c.energy=.08;c.section=SECTIONS.RELEASE;c.recentDeath=true;c.currentPhrase=this.basePhrase();const t=this.ctx.currentTime+.012;this.duckMusic(t,.36,.05);this.pitchFall(t);}
    onBallRelaunch(){this.composition.targetEnergy=.1;this.composition.section=SECTIONS.SPARSE;this.reportEvent('relaunch',{strength:.35});}
    onGameOver(){this.events.clear();this.gameOver=true;this.composition.targetEnergy=.03;this.composition.section=SECTIONS.RELEASE;this.pitchFall(this.ctx.currentTime+.02);}
    duckForScare(duration=.9){const t=this.ctx.currentTime,g=this.master.gain;g.cancelScheduledValues(t);g.setTargetAtTime(.045,t,.012);g.setTargetAtTime(this.muted?.0001:.78,t+duration,.14);}
    duckMusic(time,duration,depth=.2){const g=this.musicSum.gain;g.cancelScheduledValues(time);g.setTargetAtTime(depth,time,.01);g.setTargetAtTime(.9,time+duration,.055);}
    debugTrigger(kind){if(!this.debug)return null;if(kind==='LOW'||kind==='MEDIUM'||kind==='HIGH'){this.composition.energy={LOW:.12,MEDIUM:.5,HIGH:.88}[kind];this.composition.targetEnergy=this.composition.energy;this.evolvePhrase(this.clock.absoluteStep);return kind;}if(kind==='EXPLOSION'){this.onExplosion(18,{x:this.worldWidth/2},2.2);return kind;}if(kind==='MULTIBALL'){this.ballCount=16;this.reportEvent('multiball',{strength:1});this.composition.targetEnergy=.86;return kind;}if(kind==='SMASH'){this.onSmashEvent('BIG CHUNGUS');return kind;}if(kind==='DEATH'){this.onLifeLost();return kind;}return null;}
    allowVoice(kind,count=1){return (this.voiceCounts[kind]||0)+count<=this.voiceLimits[kind];}
    track(source,kind){this.voiceCounts[kind]=(this.voiceCounts[kind]||0)+1;source.addEventListener('ended',()=>{this.voiceCounts[kind]=Math.max(0,this.voiceCounts[kind]-1);},{once:true});}
    noiseSource(){const source=this.ctx.createBufferSource();source.buffer=this.noiseBuffer;return source;}
    panNode(value=0){if(this.ctx.createStereoPanner){const p=this.ctx.createStereoPanner();p.pan.value=clamp(value,-.7,.7);return p;}return this.ctx.createGain();}
    sidechain(time,impact=false){for(const bus of [this.bassDuck,this.atmosphereDuck]){const g=bus.gain;g.cancelScheduledValues(time);g.setValueAtTime(1,time);g.exponentialRampToValueAtTime(impact?.28:.62,time+.008);g.exponentialRampToValueAtTime(1,time+(impact?.24:.105));}}
    kick(time,velocity=.9){if(!this.allowVoice('drum',2))return;this.sidechain(time);const c=this.ctx,body=c.createOscillator(),bodyGain=c.createGain(),drive=c.createWaveShaper();body.type='sine';body.frequency.setValueAtTime(168,time);body.frequency.exponentialRampToValueAtTime(43,time+.105);bodyGain.gain.setValueAtTime(Math.min(.75,velocity*.62),time);bodyGain.gain.exponentialRampToValueAtTime(.0001,time+.2);drive.curve=this.shaperCurve;body.connect(drive);drive.connect(bodyGain);bodyGain.connect(this.drums);body.start(time);body.stop(time+.22);this.track(body,'drum');const click=this.noiseSource(),hp=c.createBiquadFilter(),cg=c.createGain();hp.type='highpass';hp.frequency.value=4800;cg.gain.setValueAtTime(velocity*.14,time);cg.gain.exponentialRampToValueAtTime(.0001,time+.018);click.connect(hp);hp.connect(cg);cg.connect(this.drums);click.start(time,Math.random()*.6,.025);this.track(click,'drum');}
    kah(time,velocity=.8,metallic=false){if(!this.allowVoice('drum',3))return;const c=this.ctx,noise=this.noiseSource(),bp=c.createBiquadFilter(),ng=c.createGain();bp.type='bandpass';bp.frequency.value=metallic?2350:1850;bp.Q.value=1.2;ng.gain.setValueAtTime(velocity*.42,time);ng.gain.exponentialRampToValueAtTime(.0001,time+.105);noise.connect(bp);bp.connect(ng);ng.connect(this.drums);noise.start(time,Math.random()*.7,.13);this.track(noise,'drum');const tone=c.createOscillator(),tg=c.createGain();tone.type='triangle';tone.frequency.setValueAtTime(metallic?240:188,time);tone.frequency.exponentialRampToValueAtTime(132,time+.075);tg.gain.setValueAtTime(velocity*.2,time);tg.gain.exponentialRampToValueAtTime(.0001,time+.095);tone.connect(tg);tg.connect(this.drums);tone.start(time);tone.stop(time+.11);this.track(tone,'drum');const mouth=c.createOscillator(),formant=c.createBiquadFilter(),mg=c.createGain();mouth.type='square';mouth.frequency.value=78;formant.type='bandpass';formant.frequency.value=this.theme.formants[1];formant.Q.value=8;mg.gain.setValueAtTime(velocity*.085,time);mg.gain.exponentialRampToValueAtTime(.0001,time+.055);mouth.connect(formant);formant.connect(mg);mg.connect(this.drums);mouth.start(time);mouth.stop(time+.065);this.track(mouth,'drum');}
    technical(time,kind='tk',velocity=.35){if(!this.allowVoice('tech'))return;const c=this.ctx,n=this.noiseSource(),filter=c.createBiquadFilter(),g=c.createGain(),p=this.panNode((Math.random()-.5)*.55);filter.type=kind==='tss'?'highpass':'bandpass';filter.frequency.value=kind==='tss'?7200:kind==='k'?3100:4800;filter.Q.value=kind==='tss'?.7:2.6;const duration=kind==='tss'?.055:kind==='k'?.026:.034;g.gain.setValueAtTime(velocity*(kind==='tss'?.65:.8),time);g.gain.exponentialRampToValueAtTime(.0001,time+duration);n.connect(filter);filter.connect(p);p.connect(g);g.connect(this.tech);n.start(time,Math.random()*.8,duration+.01);this.track(n,'tech');}
    performBass(time,instruction,energy){const pitch=this.theme.root+(instruction.pitch||0),weight=this.activeEffects.has('bigBall')?1.18:1;if(instruction.voice==='wobble')this.wobble(time,pitch,.42*weight,this.activeEffects.has('gravity')?4/3:energy>.65?1:2);else if(instruction.voice==='growl')this.growl(time,pitch,.5*weight,this.clock.stepDuration*(energy>.7?2:3));else if(instruction.voice==='hold')this.growl(time,pitch,.45*weight,this.clock.stepDuration*3.6,true);else if(instruction.voice==='stutter')this.bassStutter(time,pitch,instruction.repeats||2,.42*weight);else if(instruction.voice==='acid')this.acidBass(time,pitch,.42);else if(instruction.voice==='glide')this.bassGlide(time,pitch,.44,this.activeEffects.has('portal')?-12:3);else this.bassStab(time,pitch,.48*weight);}
    bassStab(time,note,velocity=.48){this.richBass(time,note,Math.min(.31,this.clock.stepDuration*1.8),velocity,{formant:false,wobbleRate:0});}
    wobble(time,note,velocity=.44,stepsPerCycle=2){this.richBass(time,note,this.clock.stepDuration*2.8,velocity,{formant:true,wobbleRate:1/(stepsPerCycle*this.clock.stepDuration)});}
    growl(time,note,velocity=.5,duration=.38,held=false){this.richBass(time,note,duration,velocity,{formant:true,wobbleRate:1/((held?4:2)*this.clock.stepDuration),growl:true});}
    bassStutter(time,note,repeats=2,velocity=.44){const spacing=this.clock.stepDuration/Math.min(2,repeats-1||1);for(let i=0;i<Math.min(3,repeats);i++)this.richBass(time+i*spacing,note+(i===repeats-1?7:0),spacing*.78,velocity*.9,{formant:true,growl:true});}
    acidBass(time,note,velocity=.42){this.richBass(time,note,this.clock.stepDuration*2.4,velocity,{acid:true,wobbleRate:1/this.clock.stepDuration});}
    bassGlide(time,note,velocity=.44,glideSemitones=3){this.richBass(time,note,this.clock.stepDuration*2.5,velocity,{formant:true,growl:true,glideSemitones});}
    richBass(time,note,duration,velocity,{formant=false,wobbleRate=0,growl=false,acid=false,glideSemitones=0}={}){
      if(!this.allowVoice('bass',3))return;const c=this.ctx,mix=c.createGain(),filter=c.createBiquadFilter(),drive=c.createWaveShaper(),gain=c.createGain();filter.type='lowpass';filter.Q.value=acid?12:growl?6:3;filter.frequency.setValueAtTime(acid?1500:growl?1050:820,time);filter.frequency.exponentialRampToValueAtTime(acid?210:growl?360:240,time+duration);drive.curve=growl||acid?this.hardCurve:this.shaperCurve;drive.oversample='2x';gain.gain.setValueAtTime(.0001,time);gain.gain.exponentialRampToValueAtTime(Math.min(.54,velocity),time+.009);gain.gain.setValueAtTime(Math.min(.54,velocity),time+Math.max(.012,duration*.55));gain.gain.exponentialRampToValueAtTime(.0001,time+duration);
      const oscA=c.createOscillator(),oscB=c.createOscillator(),sub=c.createOscillator();oscA.type='sawtooth';oscB.type='square';sub.type='sine';const hz=midiToHz(note);oscA.frequency.value=hz;oscB.frequency.value=hz;sub.frequency.value=hz/2;if(glideSemitones){const target=midiToHz(note+glideSemitones);oscA.frequency.exponentialRampToValueAtTime(target,time+duration);oscB.frequency.exponentialRampToValueAtTime(target,time+duration);sub.frequency.exponentialRampToValueAtTime(target/2,time+duration);}oscA.detune.value=-8;oscB.detune.value=7;oscA.connect(mix);oscB.connect(mix);mix.connect(filter);
      if(formant){const mouth=c.createGain();mouth.gain.value=.5;for(let i=0;i<2;i++){const f=c.createBiquadFilter();f.type='bandpass';f.Q.value=8-i*2;f.frequency.setValueAtTime(this.theme.formants[i],time);f.frequency.exponentialRampToValueAtTime(this.theme.formants[i]*(growl?1.5:.72),time+duration);mix.connect(f);f.connect(mouth);}mouth.connect(drive);}filter.connect(drive);drive.connect(gain);gain.connect(this.bass);
      const sg=c.createGain();sg.gain.setValueAtTime(velocity*.46,time);sg.gain.exponentialRampToValueAtTime(.0001,time+Math.min(duration,.48));sub.connect(sg);sg.connect(this.sub);if(wobbleRate&&c.createOscillator){const lfo=c.createOscillator(),lfoGain=c.createGain();lfo.type='sine';lfo.frequency.value=wobbleRate;lfoGain.gain.value=.32;lfo.connect(lfoGain);lfoGain.connect(gain.gain);lfo.start(time);lfo.stop(time+duration);}
      [oscA,oscB,sub].forEach(source=>{source.start(time);source.stop(time+duration+.025);this.track(source,'bass');});
    }
    hugeImpact(time,kind,strength=1){this.sidechain(time,true);this.duckMusic(time,.16,.38);this.kick(time,1);const note=this.theme.root+(kind==='BALL STORM'?7:0);this.growl(time,note,.58*strength,this.clock.stepDuration*(kind==='BIG CHUNGUS'?5:3.4),kind==='BIG CHUNGUS');this.subDrop(time,strength);this.kah(time+this.clock.stepDuration*2,.82,kind==='BRICKPOCALYPSE');}
    subDrop(time,strength=1){if(!this.allowVoice('impact'))return;const c=this.ctx,o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.setValueAtTime(72,time);o.frequency.exponentialRampToValueAtTime(29,time+.65);g.gain.setValueAtTime(Math.min(.7,.5*strength),time);g.gain.exponentialRampToValueAtTime(.0001,time+.72);o.connect(g);g.connect(this.impacts);o.start(time);o.stop(time+.75);this.track(o,'impact');}
    drone(time,note,duration,velocity=.05){if(!this.allowVoice('atmosphere'))return;const c=this.ctx,o=c.createOscillator(),filter=c.createBiquadFilter(),g=c.createGain();o.type='triangle';o.frequency.value=midiToHz(note);filter.type='lowpass';filter.frequency.value=380;g.gain.setValueAtTime(.0001,time);g.gain.linearRampToValueAtTime(velocity,time+.5);g.gain.setValueAtTime(velocity,time+Math.max(.6,duration-.5));g.gain.exponentialRampToValueAtTime(.0001,time+duration);o.connect(filter);filter.connect(g);g.connect(this.atmosphere);o.start(time);o.stop(time+duration+.03);this.track(o,'atmosphere');}
    pitchFall(time){if(!this.allowVoice('impact'))return;const c=this.ctx,o=c.createOscillator(),filter=c.createBiquadFilter(),g=c.createGain();o.type='sawtooth';o.frequency.setValueAtTime(midiToHz(this.theme.root+12),time);o.frequency.exponentialRampToValueAtTime(midiToHz(this.theme.root-7),time+.42);filter.type='lowpass';filter.frequency.setValueAtTime(1200,time);filter.frequency.exponentialRampToValueAtTime(160,time+.45);g.gain.setValueAtTime(.18,time);g.gain.exponentialRampToValueAtTime(.0001,time+.46);o.connect(filter);filter.connect(g);g.connect(this.impacts);o.start(time);o.stop(time+.48);this.track(o,'impact');}
    phraseText(){const tokens=this.composition.currentPhrase.map(step=>step.stop?'STOP':step.bass?({stab:'BRAP',wobble:'WUB',growl:'BRR',hold:'HOLD',stutter:'BR-BR',acid:'ACID',glide:'SLIDE'}[step.bass.voice]||'BASS'):step.snare?'KAH':step.kick?'K':step.tech?step.tech.toUpperCase():'.');return `${tokens.slice(0,16).join(' ')}\n${tokens.slice(16).join(' ')}`;}
    debugState(){const c=this.composition;return {bpm:BPM,theme:this.themeName,section:c.section,intensity:Number(c.energy.toFixed(2)),energy:Number(c.energy.toFixed(2)),density:Number(c.density.toFixed(2)),tension:Number(c.tension.toFixed(2)),voices:Object.values(this.voiceCounts).reduce((sum,n)=>sum+n,0),voiceCounts:{...this.voiceCounts},combo:this.combo||1,balls:this.ballCount||1,bar:c.currentBar+1,step:c.currentStep,phrase:c.phraseIndex+1,mutations:c.mutationCount,lastMajorEvent:c.lastMajorEvent,root:'D',scale:['D','F','G','A','C'],phraseText:this.phraseText()};}
  }

  window.DynamicMusicEngine=DynamicMusicEngine;
  window.BALLS_OUT_MUSIC_THEMES=THEMES;
})();
