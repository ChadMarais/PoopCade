(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const THEMES = Object.freeze({
    'NEON HORIZON': { bpm:112, root:45, scale:[0,2,3,7,9], lead:'sawtooth', bass:'square', cutoff:4200, mood:'synthwave', chords:[[0,3,7],[2,7,9],[3,7,10],[0,3,9]] },
    'ORBITAL STATIC': { bpm:120, root:38, scale:[0,2,5,7,9], lead:'triangle', bass:'sawtooth', cutoff:5100, mood:'space pulse', chords:[[0,5,9],[2,7,12],[5,9,14],[0,7,12]] },
    'MIDNIGHT CITY': { bpm:126, root:41, scale:[0,3,5,7,10], lead:'square', bass:'sawtooth', cutoff:3300, mood:'dark club', chords:[[0,3,7],[3,7,10],[5,10,12],[0,5,10]] },
    'WARP MALFUNCTION': { bpm:134, root:43, scale:[0,2,3,7,10], lead:'sawtooth', bass:'square', cutoff:6800, mood:'glitch drive', chords:[[0,3,10],[2,7,12],[3,10,14],[0,7,10]] },
    'REACTOR ROOM': { bpm:140, root:36, scale:[0,2,3,5,7,10], lead:'square', bass:'sawtooth', cutoff:2700, mood:'industrial', chords:[[0,3,7],[2,5,10],[3,7,12],[0,5,10]] },
    'VOID BLOOM': { bpm:116, root:40, scale:[0,2,5,6,9], lead:'triangle', bass:'sine', cutoff:3900, mood:'alien bloom', chords:[[0,5,9],[2,6,11],[5,9,14],[0,6,11]] },
  });

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const midiToHz = (note) => 440 * Math.pow(2, (note - 69) / 12);

  class DynamicMusicEngine {
    constructor(context, { output, worldWidth=1000, debug=false }={}) {
      this.ctx=context;this.output=output||context.destination;this.worldWidth=worldWidth;this.debug=debug;
      this.enabled=true;this.muted=false;this.running=false;this.paused=false;this.gameOver=false;
      this.theme=THEMES['NEON HORIZON'];this.themeName='NEON HORIZON';this.wave=1;
      this.intensity=0.08;this.targetIntensity=0.08;this.combo=1;this.ballCount=1;this.step=0;
      this.clockOrigin=context.currentTime+.04;this.nextStepTime=this.clockOrigin;this.timer=0;
      this.voiceCount=0;this.maxVoices=22;this.percussionTimes=[];this.melodicSlots=new Map();
      this.destroyQueue=[];this.destroyTimer=0;this.lastUpdate=0;this.powerups=new Set();
      this.noiseBuffer=this.makeNoiseBuffer(1);this.shaperCurve=this.makeSaturationCurve();
      this.buildMix();
    }

    buildMix(){
      const c=this.ctx;
      this.master=c.createGain();this.master.gain.value=.72;
      this.musicFilter=c.createBiquadFilter();this.musicFilter.type='lowpass';this.musicFilter.frequency.value=18000;this.musicFilter.Q.value=.3;
      this.compressor=c.createDynamicsCompressor();this.compressor.threshold.value=-15;this.compressor.knee.value=14;this.compressor.ratio.value=5;this.compressor.attack.value=.008;this.compressor.release.value=.19;
      this.drums=c.createGain();this.drums.gain.value=.88;
      this.bass=c.createGain();this.bass.gain.value=.72;
      this.melody=c.createGain();this.melody.gain.value=.56;
      this.ambience=c.createGain();this.ambience.gain.value=.25;
      this.fx=c.createGain();this.fx.gain.value=.62;
      [this.drums,this.bass,this.melody,this.ambience,this.fx].forEach(bus=>bus.connect(this.musicFilter));
      this.musicFilter.connect(this.master);this.master.connect(this.compressor);this.compressor.connect(this.output);
    }

    makeNoiseBuffer(seconds){
      const length=Math.floor(this.ctx.sampleRate*seconds),buffer=this.ctx.createBuffer(1,length,this.ctx.sampleRate),data=buffer.getChannelData(0);
      let last=0;for(let i=0;i<length;i++){const white=Math.random()*2-1;last=last*.78+white*.22;data[i]=white*.62+last*.38;}return buffer;
    }

    makeSaturationCurve(){
      const curve=new Float32Array(256);for(let i=0;i<curve.length;i++){const x=i*2/(curve.length-1)-1;curve[i]=Math.tanh(x*2.2);}return curve;
    }

    start(themeName='NEON HORIZON',wave=1){
      if(!this.enabled)return;this.running=true;this.paused=false;this.gameOver=false;this.step=0;this.intensity=.08;this.targetIntensity=.08;this.combo=1;this.ballCount=1;
      this.setTheme(themeName,wave,true);this.clockOrigin=this.ctx.currentTime+.035;this.nextStepTime=this.clockOrigin;
      if(!this.timer)this.timer=setInterval(()=>this.scheduler(),25);
      this.rampMaster(.72,.08);this.onWaveStart(themeName,wave,true);
    }

    stop(){this.running=false;if(this.timer){clearInterval(this.timer);this.timer=0;}this.rampMaster(.0001,.12);}
    setMuted(muted){this.muted=!!muted;this.rampMaster(this.muted?.0001:.72,this.muted?.04:.12);}
    pause(){if(!this.running||this.paused)return;this.paused=true;this.rampMaster(.035,.09);}
    resume(){if(!this.running||!this.paused)return;this.paused=false;this.nextStepTime=this.ctx.currentTime+.035;this.rampMaster(this.muted?.0001:.72,.16);}
    rampMaster(value,duration){const t=this.ctx.currentTime,g=this.master.gain;g.cancelScheduledValues(t);g.setTargetAtTime(value,t,Math.max(.008,duration/4));}

    setTheme(name,wave=this.wave,immediate=false){
      const next=THEMES[name]||THEMES['NEON HORIZON'];const changed=next!==this.theme;this.theme=next;this.themeName=THEMES[name]?name:'NEON HORIZON';this.wave=wave;
      if(changed&&!immediate){const t=this.ctx.currentTime,f=this.musicFilter.frequency;f.cancelScheduledValues(t);f.setValueAtTime(f.value,t);f.exponentialRampToValueAtTime(650,t+.28);f.exponentialRampToValueAtTime(next.cutoff*2.8,t+1.05);this.transitionSweep(t);}
    }

    scheduler(){
      if(!this.enabled||!this.running||this.paused||this.muted||this.ctx.state!=='running')return;
      const horizon=this.ctx.currentTime+.14,stepLength=60/this.theme.bpm/4;
      if(this.nextStepTime<this.ctx.currentTime-.2)this.nextStepTime=this.ctx.currentTime+.025;
      while(this.nextStepTime<horizon){this.scheduleStep(this.step,this.nextStepTime);this.step=(this.step+1)%16;this.nextStepTime+=stepLength;}
      const cutoff=this.ctx.currentTime-.5;this.percussionTimes=this.percussionTimes.filter(t=>t>cutoff);for(const [key] of this.melodicSlots)if(Number(key)<cutoff)this.melodicSlots.delete(key);
    }

    scheduleStep(step,time){
      const i=this.gameOver?Math.min(.12,this.intensity):this.intensity;
      const disco=this.powerups.has('laserDisco'),panic=this.powerups.has('panic');
      if(step===0||step===8||(i>.64&&(step===4||step===12))||disco&&step%4===0)this.kick(time,step===0?1:.82);
      if(step===4||step===12)this.snare(time,i>.35?.72:.48);
      if((i>.22&&step%4===2)||(i>.48&&step%2===0)||(i>.78||panic)&&step%2===1)this.hat(time,i>.72?.32:.22,step%4===2);
      const bassEvery=i>.58?2:i>.2?4:8;if(step%bassEvery===0)this.bassPulse(time,this.bassNote(step),.28+i*.34);
      if(step===0)this.padChord(time,this.theme.chords[Math.floor((this.wave+step/4)%this.theme.chords.length)],60/this.theme.bpm*3.8,.12+i*.08);
      if(i>.52&&(step%2===0||i>.82)){const degree=(step*3+this.wave)%this.theme.scale.length;this.pluck(time,this.theme.root+12+this.theme.scale[degree],.12+i*.12,(step/15)*1.2-.6,{short:true,bright:true});}
    }

    bassNote(step){const progression=[0,0,7,5],offset=progression[Math.floor(step/4)%4];return this.theme.root+offset;}
    quantized(divisions=4){const unit=60/this.theme.bpm/divisions,now=this.ctx.currentTime+.006,index=Math.ceil((now-this.clockOrigin)/unit);return Math.max(now,this.clockOrigin+index*unit);}
    slot(time,limit=4){const key=time.toFixed(3),used=this.melodicSlots.get(key)||0;if(used>=limit)return false;this.melodicSlots.set(key,used+1);return true;}
    allowPercussion(){const now=this.ctx.currentTime;this.percussionTimes=this.percussionTimes.filter(t=>t>now-.09);if(this.percussionTimes.length>=8)return false;this.percussionTimes.push(now);return true;}
    panNode(value){if(this.ctx.createStereoPanner){const p=this.ctx.createStereoPanner();p.pan.value=clamp(value,-.72,.72);return p;}return this.ctx.createGain();}
    track(source){this.voiceCount++;source.addEventListener('ended',()=>{this.voiceCount=Math.max(0,this.voiceCount-1);},{once:true});}
    canVoice(count=1){return this.voiceCount+count<=this.maxVoices;}

    pluck(time,note,velocity=.2,pan=0,{short=false,bright=false,angry=false}={}){
      if(!this.canVoice(2)||!this.slot(time))return;const c=this.ctx,dur=short?.16:.34,frequency=midiToHz(note),p=this.panNode(pan),filter=c.createBiquadFilter(),gain=c.createGain(),drive=c.createWaveShaper();
      filter.type='lowpass';filter.Q.value=bright?5.2:3.2;filter.frequency.setValueAtTime(Math.min(11000,this.theme.cutoff*(bright?1.65:1)),time);filter.frequency.exponentialRampToValueAtTime(480,time+dur);
      drive.curve=this.shaperCurve;drive.oversample='2x';gain.gain.setValueAtTime(.0001,time);gain.gain.exponentialRampToValueAtTime(velocity*(.92+Math.random()*.12),time+.008);gain.gain.exponentialRampToValueAtTime(.0001,time+dur);
      p.connect(filter);filter.connect(drive);drive.connect(gain);gain.connect(this.melody);
      const a=c.createOscillator(),b=c.createOscillator();a.type=angry?'sawtooth':this.theme.lead;b.type='triangle';a.frequency.value=frequency;b.frequency.value=frequency*2;a.detune.value=-5+Math.random()*3;b.detune.value=5+Math.random()*4;
      a.connect(p);b.connect(p);a.start(time);b.start(time);a.stop(time+dur+.02);b.stop(time+dur+.02);this.track(a);this.track(b);
    }

    kick(time,velocity=.8){
      if(!this.allowPercussion()||!this.canVoice())return;const c=this.ctx,o=c.createOscillator(),g=c.createGain();o.type=this.themeName==='REACTOR ROOM'?'square':'sine';o.frequency.setValueAtTime(this.themeName==='REACTOR ROOM'?155:132,time);o.frequency.exponentialRampToValueAtTime(42,time+.12);g.gain.setValueAtTime(Math.min(.72,velocity*.64),time);g.gain.exponentialRampToValueAtTime(.0001,time+.22);o.connect(g);g.connect(this.drums);o.start(time);o.stop(time+.24);this.track(o);
    }

    snare(time,velocity=.55){
      if(!this.allowPercussion()||!this.canVoice(2))return;const c=this.ctx,n=c.createBufferSource(),filter=c.createBiquadFilter(),g=c.createGain(),tone=c.createOscillator(),tg=c.createGain();n.buffer=this.noiseBuffer;filter.type='bandpass';filter.frequency.value=this.themeName==='REACTOR ROOM'?980:1750;filter.Q.value=.75;g.gain.setValueAtTime(velocity*.34,time);g.gain.exponentialRampToValueAtTime(.0001,time+.16);n.connect(filter);filter.connect(g);g.connect(this.drums);tone.type='triangle';tone.frequency.value=this.themeName==='ORBITAL STATIC'?210:165;tg.gain.setValueAtTime(velocity*.16,time);tg.gain.exponentialRampToValueAtTime(.0001,time+.11);tone.connect(tg);tg.connect(this.drums);n.start(time,Math.random()*.4,.18);tone.start(time);tone.stop(time+.13);this.track(n);this.track(tone);
    }

    hat(time,velocity=.22,open=false){
      if(!this.allowPercussion()||!this.canVoice())return;const c=this.ctx,n=c.createBufferSource(),hp=c.createBiquadFilter(),g=c.createGain();n.buffer=this.noiseBuffer;hp.type='highpass';hp.frequency.value=this.themeName==='VOID BLOOM'?5200:7200;g.gain.setValueAtTime(velocity,time);g.gain.exponentialRampToValueAtTime(.0001,time+(open?.1:.045));n.connect(hp);hp.connect(g);g.connect(this.drums);n.start(time,Math.random()*.7,open?.12:.06);this.track(n);
    }

    bassPulse(time,note,velocity=.42,{sub=false,acid=false}={}){
      if(!this.canVoice())return;const c=this.ctx,o=c.createOscillator(),filter=c.createBiquadFilter(),g=c.createGain(),drive=c.createWaveShaper();o.type=sub?'sine':this.theme.bass;o.frequency.value=midiToHz(note+(sub?-12:0));filter.type='lowpass';filter.Q.value=acid?11:2.2;filter.frequency.setValueAtTime(acid?950:680,time);filter.frequency.exponentialRampToValueAtTime(acid?180:240,time+.28);drive.curve=this.shaperCurve;g.gain.setValueAtTime(.0001,time);g.gain.exponentialRampToValueAtTime(Math.min(.55,velocity),time+.014);g.gain.exponentialRampToValueAtTime(.0001,time+(sub?.75:.34));o.connect(filter);filter.connect(drive);drive.connect(g);g.connect(this.bass);o.start(time);o.stop(time+(sub?.8:.38));this.track(o);
    }

    padChord(time,intervals,duration=1.8,velocity=.15){
      if(!this.canVoice(3))return;const c=this.ctx,g=c.createGain(),filter=c.createBiquadFilter();filter.type='lowpass';filter.frequency.value=this.themeName==='VOID BLOOM'?1650:1150;g.gain.setValueAtTime(.0001,time);g.gain.linearRampToValueAtTime(velocity,time+.3);g.gain.setValueAtTime(velocity,time+Math.max(.35,duration-.4));g.gain.exponentialRampToValueAtTime(.0001,time+duration);filter.connect(g);g.connect(this.ambience);
      intervals.slice(0,3).forEach((offset,index)=>{const o=c.createOscillator();o.type=index===0?'triangle':'sawtooth';o.frequency.value=midiToHz(this.theme.root+12+offset);o.detune.value=(index-1)*8;o.connect(filter);o.start(time);o.stop(time+duration+.02);this.track(o);});
    }

    metallic(time,velocity=.25,pan=0){
      if(!this.canVoice(2)||!this.allowPercussion())return;const c=this.ctx,p=this.panNode(pan),g=c.createGain();g.gain.setValueAtTime(velocity,time);g.gain.exponentialRampToValueAtTime(.0001,time+.18);p.connect(g);g.connect(this.drums);[1,1.414].forEach((ratio,index)=>{const o=c.createOscillator();o.type='square';o.frequency.value=(index?620:438)*ratio;o.connect(p);o.start(time);o.stop(time+.2);this.track(o);});
    }

    noiseImpact(time,velocity=.35,duration=.24){
      if(!this.canVoice()||!this.allowPercussion())return;const c=this.ctx,n=c.createBufferSource(),filter=c.createBiquadFilter(),g=c.createGain();n.buffer=this.noiseBuffer;filter.type='lowpass';filter.frequency.setValueAtTime(7000,time);filter.frequency.exponentialRampToValueAtTime(240,time+duration);g.gain.setValueAtTime(velocity,time);g.gain.exponentialRampToValueAtTime(.0001,time+duration);n.connect(filter);filter.connect(g);g.connect(this.fx);n.start(time,Math.random()*.4,duration);this.track(n);
    }

    noteFromPosition(x,y=0){const normalized=clamp(x/this.worldWidth,0,1),index=Math.min(this.theme.scale.length-1,Math.floor(normalized*this.theme.scale.length)),octave=y<250?24:12;return this.theme.root+octave+this.theme.scale[index];}
    panFromX(x){return clamp((x/this.worldWidth-.5)*1.25,-.62,.62);}

    update({ balls=1,combo=1,effects={} }={}){
      const now=performance.now();if(now-this.lastUpdate<90)return;this.lastUpdate=now;this.ballCount=balls;this.combo=combo;
      this.powerups=new Set(Object.entries(effects).filter(([,value])=>value>0).map(([key])=>key));
      const ballEnergy=clamp((balls-1)/20,0,1),comboEnergy=combo>=15?1:combo>=10?.82:combo>=8?.68:combo>=5?.52:combo>=3?.32:combo>=2?.18:0,powerEnergy=clamp(this.powerups.size*.055,0,.3);
      this.targetIntensity=this.gameOver?.1:clamp(.08+ballEnergy*.52+comboEnergy*.38+powerEnergy,.08,1);
      this.intensity+=(this.targetIntensity-this.intensity)*.16;
    }

    onPaddleHit(ball){const t=this.quantized(4);this.kick(t,clamp((Math.hypot(ball?.vx||0,ball?.vy||0)-400)/500,.52,1));this.bassPulse(t,this.theme.root,.28+this.intensity*.16,{sub:!!ball?.chungus});}
    onWallHit(ball,wall){const t=this.quantized(4);if(wall==='top'){this.hat(t,.26,true);this.pluck(t,this.noteFromPosition(ball?.x||500,0),.13,this.panFromX(ball?.x||500),{short:true,bright:true});}else this.hat(t,.14,false);}
    onObstacleHit(ball){this.metallic(this.quantized(4),.2+this.intensity*.12,this.panFromX(ball?.x||500));}
    onBrickHit(brick,ball){const t=this.quantized(4);this.pluck(t,this.noteFromPosition(brick?.x+(brick?.w||0)/2,brick?.y),.09+this.intensity*.05,this.panFromX(brick?.x||500),{short:true,bright:(brick?.maxHp||1)>1,angry:this.powerups.has('angry')});}

    onBrickDestroyed(brick,ball){
      this.destroyQueue.push({x:(brick?.x||0)+(brick?.w||0)/2,y:brick?.y||0,tough:brick?.maxHp||1,speed:Math.hypot(ball?.vx||0,ball?.vy||0)});
      if(!this.destroyTimer)this.destroyTimer=setTimeout(()=>this.flushDestroyed(),72);
    }

    flushDestroyed(){
      this.destroyTimer=0;const group=this.destroyQueue.splice(0);if(!group.length||!this.running)return;const count=group.length,x=group.reduce((s,e)=>s+e.x,0)/count,y=group.reduce((s,e)=>s+e.y,0)/count,tough=Math.max(...group.map(e=>e.tough)),t=this.quantized(count>5?2:4),note=this.noteFromPosition(x,y),pan=this.panFromX(x);
      if(count===1)this.pluck(t,note,.2+(tough-1)*.05,pan,{bright:tough>1,angry:this.powerups.has('angry')});
      else if(count<=5){this.pluck(t,note,.25,pan,{bright:true});this.pluck(t,note+7,.17,-pan*.35,{short:true});}
      else {this.pluck(t,note,.3,pan,{bright:true,angry:true});this.pluck(t,note+7,.2,0,{short:true});this.bassPulse(t,this.theme.root,count>10?.52:.4,{sub:count>9});this.noiseImpact(t,count>10?.35:.22,count>10?.38:.22);}
      if(count>5)this.kick(t,count>10?1:.82);
    }

    onExplosion(brickCount=1,position={x:500},strength=1){const t=this.quantized(2),x=position?.x??500;this.bassPulse(t,this.theme.root,clamp(.34+strength*.12,.34,.56),{sub:strength>1.1});this.noiseImpact(t,clamp(.18+strength*.12,.18,.48),.2+strength*.1);if(brickCount>3)this.pluck(t,this.noteFromPosition(x,250),.24,this.panFromX(x),{bright:true,angry:true});}
    onComboChanged(combo){this.combo=combo;}

    onPowerupCollected(id){
      const t=this.quantized(4),root=this.theme.root+12;
      if(id==='moreBalls'||id==='multiballer'){[0,2,7,12].forEach((n,i)=>this.pluck(t+i*.045,root+n,.16+i*.025,(i-1.5)*.18,{short:true,bright:true}));}
      else if(id==='unit'||id==='bigBall')this.bassPulse(t,this.theme.root,.5,{sub:true});
      else if(id==='tinyHands')this.pluck(t,root+24,.16,.2,{short:true,bright:true});
      else if(id==='fart'||id==='worm')this.bassPulse(t,this.theme.root+7,.42,{acid:true});
      else if(id==='portal'){this.glide(t,root,root+12,.28);}
      else if(id==='gravity'){this.glide(t,root+7,root+2,.4);}
      else if(id==='shotgun'){for(let i=0;i<3;i++)this.snare(t+i*.035,.35-i*.06);}
      else this.pluck(t,root+this.theme.scale[Math.floor(Math.random()*this.theme.scale.length)],.18,0,{short:true,bright:true});
    }

    onPowerupActivated(id){this.onPowerupCollected(id);}
    onLaser(kind,x){if(Math.random()>.22)return;this.pluck(this.quantized(4),this.theme.root+24+(kind==='ballLaser'?7:2),.065,this.panFromX(x),{short:true,bright:true});}
    onPortal(ball,from,to){const t=this.quantized(4);this.glide(t,this.noteFromPosition(from?.x||0,300),this.noteFromPosition(to?.x||1000,100)+12,.27,this.panFromX(to?.x||500));}

    glide(time,fromNote,toNote,duration=.3,pan=0){
      if(!this.canVoice())return;const c=this.ctx,o=c.createOscillator(),filter=c.createBiquadFilter(),g=c.createGain(),p=this.panNode(pan);o.type='sawtooth';o.frequency.setValueAtTime(midiToHz(fromNote),time);o.frequency.exponentialRampToValueAtTime(midiToHz(toNote),time+duration);filter.type='lowpass';filter.frequency.value=2100;filter.Q.value=6;g.gain.setValueAtTime(.0001,time);g.gain.exponentialRampToValueAtTime(.18,time+.012);g.gain.exponentialRampToValueAtTime(.0001,time+duration);o.connect(p);p.connect(filter);filter.connect(g);g.connect(this.fx);o.start(time);o.stop(time+duration+.02);this.track(o);
    }

    onSmashEvent(name){
      const t=this.quantized(2);this.rampMaster(.16,.06);setTimeout(()=>{if(!this.paused&&!this.muted)this.rampMaster(.72,.11);},name==='BIG CHUNGUS'?180:120);
      if(name==='BIG CHUNGUS'){this.bassPulse(t+.16,this.theme.root,.56,{sub:true});this.kick(t+.16,1);this.noiseImpact(t+.16,.35,.32);}
      else if(name==='LASER DISCO'){this.powerups.add('laserDisco');this.kick(t,1);this.pluck(t,this.theme.root+24,.28,0,{bright:true});}
      else if(name==='BALL STORM'){[0,.06,.12,.18].forEach((d,i)=>this.snare(t+d,.42-i*.05));}
      else if(name==='BRICKPOCALYPSE'){this.bassPulse(t,this.theme.root,.54,{sub:true});this.noiseImpact(t,.46,.4);this.metallic(t+.04,.34,0);}
      else {this.powerups.add('panic');for(let i=0;i<4;i++)this.hat(t+i*.04,.3,i===3);}
    }

    onWaveStart(themeName,wave,initial=false){this.setTheme(themeName,wave,initial);this.gameOver=false;this.targetIntensity=.08;const t=this.quantized(2);this.padChord(t,this.theme.chords[wave%this.theme.chords.length],60/this.theme.bpm*1.8,.18);this.bassPulse(t+.03,this.theme.root,.38,{sub:true});this.pluck(t+60/this.theme.bpm/2,this.theme.root+24,.22,0,{bright:true});}
    onWaveClear(){const t=this.quantized(2),root=this.theme.root+12;[0,3,7,12].forEach((n,i)=>this.pluck(t+i*.07,root+n,.18+i*.02,(i-1.5)*.12,{bright:true}));this.targetIntensity=.12;}
    onLifeLost(){this.targetIntensity=.06;this.powerups.clear();const t=this.ctx.currentTime+.012;this.musicFilter.frequency.cancelScheduledValues(t);this.musicFilter.frequency.setValueAtTime(Math.max(600,this.musicFilter.frequency.value),t);this.musicFilter.frequency.exponentialRampToValueAtTime(180,t+.32);this.musicFilter.frequency.exponentialRampToValueAtTime(this.theme.cutoff*2,t+.82);this.glide(t,this.theme.root+12,this.theme.root-5,.45);this.bassPulse(t+.04,this.theme.root,.4,{sub:true});}
    onBallRelaunch(){this.targetIntensity=.08;this.pluck(this.quantized(2),this.theme.root+12,.16,0,{bright:false});}

    onGameOver(){this.paused=false;this.nextStepTime=this.ctx.currentTime+.035;this.gameOver=true;this.targetIntensity=.08;this.powerups.clear();const t=this.quantized(2),root=this.theme.root+12;[7,3,0,-5].forEach((n,i)=>this.pluck(t+i*.16,root+n,.2-i*.02,0,{bright:i===0}));this.padChord(t+.5,this.theme.chords[0],3.2,.11);}
    duckForScare(duration=.9){const t=this.ctx.currentTime,g=this.master.gain;g.cancelScheduledValues(t);g.setTargetAtTime(.09,t,.015);g.setTargetAtTime(this.muted?.0001:.72,t+duration,.16);}
    transitionSweep(time){this.noiseImpact(time+.12,.16,.55);this.glide(time+.18,this.theme.root-5,this.theme.root+12,.48);}

    debugState(){return {bpm:this.theme.bpm,theme:this.themeName,intensity:Number(this.intensity.toFixed(2)),voices:this.voiceCount,combo:this.combo,balls:this.ballCount,root:this.theme.root,scale:[...this.theme.scale],mood:this.theme.mood};}
  }

  window.DynamicMusicEngine=DynamicMusicEngine;
  window.BALLS_OUT_MUSIC_THEMES=THEMES;
})();
