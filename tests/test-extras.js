/* Feature tests: Eva orb, real screenshots, custom pose lab, voice routines, PWA shell */
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath:'/usr/local/bin/chromium', args:[
    '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required','--no-sandbox' ]});
  const ctx = await b.newContext({ viewport:{width:1440,height:900}, permissions:['camera','microphone'] });
  const page = await ctx.newPage();
  const errs=[]; let pass=0, fail=0;
  page.on('console', m => { if(m.type()==='error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR '+e.message));
  const check = (name, ok) => { ok ? pass++ : fail++; console.log((ok?'PASS  ':'FAIL  ')+name); };

  await page.goto('http://127.0.0.1:8899/tosseos-preview.html');
  await page.waitForTimeout(900);
  await page.click('#bootEnter'); await page.waitForTimeout(600);

  /* ── Eva orb ── */
  check('orb mounted', await page.locator('#evaOrb').count() === 1);
  await page.evaluate(() => setSpeaking(true));
  check('orb speaks', await page.locator('#evaOrb').getAttribute('data-state') === 'speak');
  await page.evaluate(() => setSpeaking(false));
  const st = await page.locator('#evaOrb').getAttribute('data-state');
  check('orb settles to listen/idle', st === 'listen' || st === 'idle');
  await page.click('#evaOrb'); await page.waitForTimeout(300);
  check('orb opens Eva panel', await page.locator('#voice.open').count() === 1);
  await page.keyboard.press('Escape'); await page.evaluate(() => closeAll());

  /* ── gesture test harness (same as test-gest.js) ── */
  await page.evaluate(() => {
    window.__mk = (opt) => {
      const o = Object.assign({index:1,middle:0,ring:0,pinky:0,thumb:0,dir:'up',pinch:false,wrist:[0.5,0.20]}, opt);
      const P=new Array(21), W=o.wrist, put=(i,x,y)=>P[i]=[x,y,0];
      P[0]=[W[0],W[1],0];
      const X=W[0], Y=W[1];
      const cols={index:X-0.08,middle:X,ring:X+0.075,pinky:X+0.145};
      put(1,X-0.06,Y+0.05);put(2,X-0.08,Y+0.06);
      if(o.thumb){put(3,X-0.145,Y+0.10);put(4,X-0.225,Y+0.105)}
      else       {put(3,X-0.100,Y+0.07);put(4,X-0.065,Y+0.110)}
      const chain=(base,x,on)=>{
        put(base,x,Y+0.15);put(base+1,x,Y+0.25);
        if(on){
          if(o.dir==='up'){put(base+2,x,Y+0.33);put(base+3,x,Y+0.42)}
        } else {put(base+2,x,Y+0.215);put(base+3,x,Y+0.175)}
      };
      chain(5,cols.index,!!o.index);chain(9,cols.middle,!!o.middle);
      chain(13,cols.ring,!!o.ring);chain(17,cols.pinky,!!o.pinky);
      if(o.pinch){put(4,X-0.048,Y+0.102);put(8,X-0.058,Y+0.096)}
      return P.map(p=>({x:1-p[0],y:1-p[1],z:p[2]}));
    };
    window.__send=(opt,frames=6)=>{const lm=window.__mk(opt);for(let i=0;i<frames;i++)onHand({multiHandLandmarks:[lm]})};
    window.__arm=()=>{tracking=true;smooth=null;lastFire=0;lastPose='';stable=0;paused=false;pinchDown=false;trail=[];palmSince=null;};
  });

  /* ── Pose Lab: teach "call me" (shaka) end-to-end through the UI ── */
  // stop the real (fake) camera first: its empty frames would reset the stability gate
  await page.evaluate(() => { stopCamera(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { __arm(); openAppWindow('Pose Lab'); });
  await page.waitForTimeout(300);
  check('pose lab renders', await page.locator('.win #plCap').count() === 1);
  await page.fill('#plName', 'call me');
  await page.selectOption('#plAct', 'mute');
  for (let s = 0; s < 3; s++) {
    await page.click('#plCap');
    await page.evaluate(() => __send({index:0,pinky:1,thumb:1}, 8));
    await page.waitForTimeout(850);
  }
  check('3 samples captured', await page.locator('#plSave').isEnabled());
  await page.click('#plSave'); await page.waitForTimeout(200);
  check('pose persisted', await page.evaluate(() => loadPoses().length === 1 && loadPoses()[0].name === 'call me'));
  // fire it: shaka in, mute should trip (volume -> 0) and tag shows the custom name
  await page.evaluate(() => { volume = 50; __arm(); __send({index:0,pinky:1,thumb:1}, 8); });
  await page.waitForTimeout(300);
  check('custom pose fires action (mute)', await page.evaluate(() => volume === 0));
  check('custom pose labeled', await page.evaluate(() => document.querySelector('#gtag').textContent.includes('call me')));
  // built-ins still win: point up must NOT match the custom pose
  await page.evaluate(() => { volume = 50; __arm(); __send({index:1,dir:'up'}, 8); });
  await page.waitForTimeout(200);
  check('built-in poses unaffected', await page.evaluate(() => volume > 50));
  // toggle off
  await page.evaluate(() => { localStorage.setItem('tosseos.posesOn','0'); __arm(); __send({index:0,pinky:1,thumb:1}, 8); });
  check('posesOn=0 disables customs', await page.evaluate(() => pose === 'none' || !pose.startsWith('custom:')));
  await page.evaluate(() => localStorage.removeItem('tosseos.posesOn'));

  /* ── Voice routines ── */
  await page.evaluate(() => {
    saveMacros([{id:'r1', phrase:'cinema mode', steps:['volume down','next workspace']}]);
  });
  await page.evaluate(() => { volume = 60; document.body.dataset.ws = '0'; wsIndex = 0; runCommand('cinema mode'); });
  await page.waitForTimeout(2400);
  check('routine ran both steps', await page.evaluate(() => volume < 60 && wsIndex === 1));

  /* routines app UI */
  await page.evaluate(() => openAppWindow('Routines'));
  await page.fill('#rtPhrase', 'desk reset');
  await page.locator('.rtsteps input[value="mute"]').check();
  await page.locator('.rtsteps input[value="open terminal"]').check();
  await page.click('#rtSave'); await page.waitForTimeout(200);
  check('routine saved via UI', await page.evaluate(() => loadMacros().some(m => m.phrase === 'desk reset' && m.steps.length === 2)));

  /* ── real screenshot (victory gesture path) ── */
  const shotLen = await page.evaluate(() => takeScreenshot());
  check('screenshot produced PNG data', shotLen > 20000);

  /* ── PWA shell ── */
  await page.waitForTimeout(1200);
  const swOk = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    return !!reg && !!reg.active;
  });
  check('service worker active', swOk);
  const man = await page.evaluate(async () => (await fetch('manifest.webmanifest')).ok);
  check('manifest served', man);

  console.log('console errors:', errs.length ? errs.slice(0,6) : 'none');
  console.log(`RESULT: ${pass} pass, ${fail} fail`);
  await b.close(); process.exit(fail ? 1 : 0);
})()
