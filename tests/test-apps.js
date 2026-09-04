const { chromium } = require('playwright');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const b=await chromium.launch({executablePath:'/usr/local/bin/chromium',args:[
    '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required','--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:1440,height:900},permissions:['camera','microphone']});
  // this suite is about the apps, so it starts from the "continue without them"
  // state instead of paying for the camera and the speech model
  await ctx.addInitScript(()=>{try{localStorage.setItem('tosseos.setup','1');
    localStorage.setItem('tosseos.declined','1')}catch(_){}});
  const page=await ctx.newPage();
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  page.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  await page.goto('http://127.0.0.1:8899/tosseos-preview.html'); await sleep(900);
  await sleep(200);

  // ---- every launcher app opens a window ----
  const names=await page.evaluate(()=>apps.map(a=>a[0]));
  let opened=0,failed=[];
  for(const n of names){
    const ok=await page.evaluate(async n=>{
      openAppWindow(n); await new Promise(r=>setTimeout(r,90));
      if(n==='Eva')return document.querySelector('#voice').classList.contains('open');
      if(n==='Gestures')return document.querySelector('#gesture').classList.contains('open');
      const w=openWins.get(n);
      return !!w && w.body.children.length>0 && w.el.offsetHeight>60;
    },n);
    ok?opened++:failed.push(n);
    await page.evaluate(n=>{closeAppWindow(n);closeAll()},n);
  }
  console.log(`APPS OPEN: ${opened}/${names.length}`, failed.length?('failed: '+failed):'');

  // ---- calculator does real arithmetic ----
  const calc=await page.evaluate(async()=>{
    openAppWindow('Calculator'); await new Promise(r=>setTimeout(r,120));
    const w=openWins.get('Calculator');
    const key=t=>[...w.body.querySelectorAll('.ckey')].find(b=>b.textContent===t).click();
    const out=()=>w.body.querySelector('#calcOut').textContent;
    '12'.split('').forEach(key); key('x'); '8'.split('').forEach(key); key('=');
    const a=out();
    key('C'); '9'.split('').forEach(key); key('/'); '4'.split('').forEach(key); key('=');
    const c=out();
    key('C'); '5'.split('').forEach(key); key('+'); '7'.split('').forEach(key); key('=');
    const d=out();
    key('C'); '5'.split('').forEach(key); key('/'); '0'.split('').forEach(key); key('=');
    const e=out();
    return {mul:a,div:c,add:d,zero:e};
  });
  console.log('CALCULATOR 12x8='+calc.mul+' 9/4='+calc.div+' 5+7='+calc.add+' 5/0='+calc.zero,
    calc.mul==='96'&&calc.div==='2.25'&&calc.add==='12'&&calc.zero==='Error'?'PASS':'FAIL');

  // ---- music: random track, simulated playback ----
  const mus=await page.evaluate(async()=>{
    openAppWindow('Music'); await new Promise(r=>setTimeout(r,150));
    const w=openWins.get('Music');
    const t1=w.body.querySelector('#mTitle').textContent;
    const playing1=w.body.querySelector('#mPlay').dataset.state;
    await new Promise(r=>setTimeout(r,2300));
    const now=w.body.querySelector('#mNow').textContent;
    const fill=w.body.querySelector('#mFill').style.width;
    w.body.querySelector('#mPlay').click();
    const playing2=w.body.querySelector('#mPlay').dataset.state;
    w.body.querySelector('#mNext').click();
    const t2=w.body.querySelector('#mTitle').textContent;
    const audio=document.querySelectorAll('audio').length;
    return {t1,t2,playing1,playing2,now,fill,audio,
            meta:w.body.querySelector('#mMeta').textContent};
  });
  console.log('MUSIC track:"'+mus.t1+'" -> next:"'+mus.t2+'" | clock '+mus.now+' | bar '+mus.fill+
    ' | audio elements '+mus.audio,
    mus.t1!==mus.t2 && mus.now!=='0:00' && mus.playing1==='playing' && mus.playing2==='paused' && mus.audio===0
    ? 'PASS (plays visually, no audio)':'FAIL');

  // ---- weather: random details, refresh re-rolls ----
  const wx=await page.evaluate(async()=>{
    openAppWindow('Weather'); await new Promise(r=>setTimeout(r,150));
    const w=openWins.get('Weather');
    const snap=()=>({city:w.body.querySelector('#wCity').textContent,
      temp:w.body.querySelector('#wTemp').textContent,
      cond:w.body.querySelector('#wCond').textContent,
      stats:[...w.body.querySelectorAll('#wGrid b')].map(x=>x.textContent),
      days:w.body.querySelectorAll('#wCast div').length});
    const a=snap(); const rolls=new Set();
    for(let i=0;i<8;i++){w.body.querySelector('#wRefresh').click();rolls.add(snap().city+snap().temp)}
    return {a,varied:rolls.size};
  });
  console.log('WEATHER '+wx.a.city+' '+wx.a.temp+' · '+wx.a.cond+' | stats '+wx.a.stats.length+
    ' | forecast days '+wx.a.days+' | distinct refreshes '+wx.varied,
    wx.a.stats.length===6&&wx.a.days===5&&wx.varied>3?'PASS':'FAIL');

  // ---- terminal, notes, settings, accessibility, focus, privacy, files ----
  const misc=await page.evaluate(async()=>{
    const out={};
    openAppWindow('Terminal'); await new Promise(r=>setTimeout(r,120));
    let w=openWins.get('Terminal'); let i=w.body.querySelector('#tIn');
    const cmd=t=>{i.value=t;i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))};
    cmd('help'); cmd('ls'); cmd('uname'); cmd('bogus'); cmd('echo hi there');
    out.term={lines:w.body.querySelectorAll('#tOut div').length,
      hasErr:!!w.body.querySelector('#tOut .err'),
      text:w.body.querySelector('#tOut').textContent.includes('Tosse OS 0.1')};

    openAppWindow('Notes'); await new Promise(r=>setTimeout(r,120));
    w=openWins.get('Notes'); const ta=w.body.querySelector('#nText');
    ta.value='alpha beta gamma'; ta.dispatchEvent(new Event('input'));
    out.notes={count:w.body.querySelector('#nCount').textContent,
      saved:localStorage.getItem('tosseos.notes')==='alpha beta gamma'};

    openAppWindow('Settings'); await new Promise(r=>setTimeout(r,120));
    w=openWins.get('Settings'); const v=w.body.querySelector('#sVol');
    v.value='33'; v.dispatchEvent(new Event('input'));
    out.settings={vol:volume};
    w.body.querySelector('#sWs button[data-i="2"]').click();
    out.settings.ws=document.querySelector('#wsName').textContent;
    w.body.querySelector('#sAcc button').click();
    out.settings.accent=getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();

    openAppWindow('Accessibility'); await new Promise(r=>setTimeout(r,120));
    w=openWins.get('Accessibility');
    const cb=w.body.querySelector('input[data-k="a11y-large"]');
    cb.checked=true; cb.dispatchEvent(new Event('change'));
    out.a11y=document.body.classList.contains('a11y-large');

    openAppWindow('Focus'); await new Promise(r=>setTimeout(r,120));
    w=openWins.get('Focus'); const t0=w.body.querySelector('#fT').textContent;
    w.body.querySelector('#fGo').click(); await new Promise(r=>setTimeout(r,2200));
    out.focus={t0,t1:w.body.querySelector('#fT').textContent,
      label:w.body.querySelector('#fGo').textContent};

    openAppWindow('Privacy'); await new Promise(r=>setTimeout(r,120));
    w=openWins.get('Privacy');
    out.privacy={rows:w.body.querySelectorAll('#pList li').length,
      text:w.body.querySelector('#pList').textContent.slice(0,40)};

    openAppWindow('Files'); await new Promise(r=>setTimeout(r,120));
    w=openWins.get('Files');
    const before=w.body.querySelector('#fPath').textContent;
    w.body.querySelector('#fList button[data-t="dir"]').click();
    out.files={before,after:w.body.querySelector('#fPath').textContent,
      rows:w.body.querySelectorAll('#fList li').length};
    return out;
  });
  console.log('TERMINAL lines '+misc.term.lines+' | unknown-cmd error '+misc.term.hasErr+
    ' | uname output '+misc.term.text, misc.term.lines>6&&misc.term.hasErr&&misc.term.text?'PASS':'FAIL');
  console.log('NOTES "'+misc.notes.count+'" | persisted '+misc.notes.saved,
    /3 words/.test(misc.notes.count)&&misc.notes.saved?'PASS':'FAIL');
  console.log('SETTINGS volume->'+misc.settings.vol+' | '+misc.settings.ws+' | accent '+misc.settings.accent,
    misc.settings.vol===33&&misc.settings.ws==='Workspace 3'&&misc.settings.accent?'PASS':'FAIL');
  console.log('ACCESSIBILITY large-text applied '+misc.a11y, misc.a11y?'PASS':'FAIL');
  console.log('FOCUS '+misc.focus.t0+' -> '+misc.focus.t1+' ('+misc.focus.label+')',
    misc.focus.t0==='25:00'&&misc.focus.t1!=='25:00'&&misc.focus.label==='Pause'?'PASS':'FAIL');
  console.log('PRIVACY rows '+misc.privacy.rows+' | '+misc.privacy.text, misc.privacy.rows===5?'PASS':'FAIL');
  console.log('FILES '+misc.files.before+' -> '+misc.files.after+' ('+misc.files.rows+' rows)',
    misc.files.after!==misc.files.before?'PASS':'FAIL');

  // ---- window manager: drag, focus order, close ----
  const wm=await page.evaluate(async()=>{
    document.querySelectorAll('.win').forEach(w=>w.remove()); openWins.clear();
    openAppWindow('Calculator'); openAppWindow('Weather');
    await new Promise(r=>setTimeout(r,150));
    const a=openWins.get('Calculator').el, c=openWins.get('Weather').el;
    const zA=+a.style.zIndex, zC=+c.style.zIndex;
    a.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    const zA2=+a.style.zIndex;
    const bar=a.querySelector('.wbar'), x0=parseFloat(a.style.left);
    bar.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:400,clientY:100,pointerId:1}));
    bar.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:520,clientY:180,pointerId:1}));
    bar.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:520,clientY:180,pointerId:1}));
    const moved=parseFloat(a.style.left)-x0;
    a.querySelector('.wclose').click();
    await new Promise(r=>setTimeout(r,80));
    return {raised:zA2>zC, moved:Math.round(moved), closed:!openWins.has('Calculator'),
            left:document.querySelectorAll('.win').length};
  });
  console.log('WINDOWS focus-raise '+wm.raised+' | dragged '+wm.moved+'px | close works '+wm.closed+
    ' | remaining '+wm.left, wm.raised&&wm.moved>100&&wm.closed&&wm.left===1?'PASS':'FAIL');

  // ---- voice opens apps ----
  const vo=await page.evaluate(async()=>{
    document.querySelectorAll('.win').forEach(w=>w.remove()); openWins.clear();
    runCommand('open calculator'); await new Promise(r=>setTimeout(r,140));
    const a=openWins.has('Calculator');
    runCommand('launch the weather app'); await new Promise(r=>setTimeout(r,140));
    const c=openWins.has('Weather');
    runCommand('open musick'); await new Promise(r=>setTimeout(r,140));
    return {calc:a,weather:c,music:openWins.has('Music')};
  });
  console.log('VOICE->APPS calculator '+vo.calc+' | weather '+vo.weather+' | misspelt music '+vo.music,
    vo.calc&&vo.weather&&vo.music?'PASS':'FAIL');

  // ---- gesture pinch opens an app from the launcher ----
  const gp=await page.evaluate(async()=>{
    document.querySelectorAll('.win').forEach(w=>w.remove()); openWins.clear();
    openLauncher(); await new Promise(r=>setTimeout(r,140));
    const btn=[...document.querySelectorAll('[data-app]')].find(b=>b.dataset.app==='Photos');
    const r=btn.getBoundingClientRect();
    tracking=true; smooth=null; lastFire=0;
    px=tx=r.x+r.width/2; py=ty=r.y+r.height/2;
    gestureClick();
    await new Promise(res=>setTimeout(res,160));
    tracking=false;
    return openWins.has('Photos');
  });
  console.log('GESTURE pinch-click opens Photos:', gp, gp?'PASS':'FAIL');

  console.log('console errors:', errs.length?errs.slice(0,8):'none');
  await page.screenshot({path:'a1-apps.png'});
  await page.close(); await b.close(); process.exit(0);
})();
