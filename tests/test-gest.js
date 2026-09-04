const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath:'/usr/local/bin/chromium', args:[
    '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required','--no-sandbox'
  ]});
  const ctx = await b.newContext({ viewport:{width:1440,height:900}, permissions:['camera','microphone'] });
  const page = await ctx.newPage();
  const errs=[];
  page.on('console', m => { if(m.type()==='error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push('PAGEERROR '+e.message));
  await page.goto('http://127.0.0.1:8899/tosseos-preview.html');
  await page.waitForTimeout(900);

  console.log('boot visible:', await page.locator('#boot').isVisible().catch(()=>false));
  // nothing is clicked: the launch flow asks for both sensors by itself
  await page.waitForFunction(()=>tracking===true,null,{timeout:45000}).catch(()=>{});
  await page.waitForFunction(()=>!!micStream,null,{timeout:20000}).catch(()=>{});
  await page.waitForTimeout(600);
  console.log('boot cam:', await page.locator('#bootCam .st').innerText(),
              '| boot mic:', await page.locator('#bootMic .st').innerText());
  console.log('gStatus  :', await page.locator('#gStatus').innerText());
  console.log('MediaPipe onResults reached:', await page.evaluate(()=>tracking===true));
  await page.click('#bootEnter'); await page.waitForTimeout(500);
  console.log('CAM badge:', !(await page.locator('#camLive').getAttribute('hidden')),
              '| MIC badge:', !(await page.locator('#micLive').getAttribute('hidden')));

  // stop the real camera so injected frames aren't overwritten 30x/second,
  // then keep the tracking pipeline armed
  await page.evaluate(()=>{ stopCamera(); });
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    window.__mk = (opt) => {
      const o = Object.assign({index:1,middle:0,ring:0,pinky:0,thumb:0,dir:'up',
        pinch:false, wrist:[0.5,0.20]}, opt);
      const P=new Array(21), W=o.wrist, put=(i,x,y)=>P[i]=[x,y,0];
      P[0]=[W[0],W[1],0];
      const X=W[0], Y=W[1];                                  // whole hand rides the wrist
      const cols={index:X-0.08,middle:X,ring:X+0.075,pinky:X+0.145};
      put(1,X-0.06,Y+0.05);put(2,X-0.08,Y+0.06);
      if(o.thumb){put(3,X-0.145,Y+0.10);put(4,X-0.225,Y+0.105)}   // extended sideways
      else       {put(3,X-0.100,Y+0.07);put(4,X-0.065,Y+0.110)}   // tucked toward the palm
      const chain=(base,x,on)=>{
        put(base,x,Y+0.15);put(base+1,x,Y+0.25);
        if(on){
          if(o.dir==='up')   {put(base+2,x,Y+0.33);put(base+3,x,Y+0.42)}
          if(o.dir==='down') {put(base+1,x,Y-0.05);put(base+2,x,Y-0.14);put(base+3,x,Y-0.23)}
          if(o.dir==='left') {put(base+1,x-0.10,Y+0.04);put(base+2,x-0.19,Y+0.02);put(base+3,x-0.28,Y+0.01)}
          if(o.dir==='right'){put(base+1,x+0.10,Y+0.04);put(base+2,x+0.19,Y+0.02);put(base+3,x+0.28,Y+0.01)}
        } else {put(base+2,x,Y+0.215);put(base+3,x,Y+0.175)}
      };
      chain(5,cols.index,!!o.index);chain(9,cols.middle,!!o.middle);
      chain(13,cols.ring,!!o.ring);chain(17,cols.pinky,!!o.pinky);
      if(o.pinch){put(4,X-0.048,Y+0.102);put(8,X-0.058,Y+0.096)}
      if(o.gap!=null){put(4,X-0.048,Y+0.102);put(8,X-0.048,Y+0.102+o.gap*0.15)}
      return P.map(p=>({x:1-p[0],y:1-p[1],z:p[2]}));   // -> raw MediaPipe coords
    };
    // pure classifier call, exactly as the pipeline uses it
    window.__classify = (opt,held=false) => { smooth=null; return classifyHand(smoothHand(window.__mk(opt)),held) };
    window.__send = (opt,frames=6) => { const lm=window.__mk(opt);
      for(let i=0;i<frames;i++) onHand({multiHandLandmarks:[lm]}); };
    window.__arm = () => { tracking=true; smooth=null; lastFire=0; lastPose=''; stable=0; paused=false; pinchDown=false; trail=[]; palmSince=null; };
  });

  const cases = [
    ['point up',   {index:1,dir:'up'},                          'point_up'],
    ['point down', {index:1,dir:'down'},                        'point_down'],
    ['point left', {index:1,dir:'left'},                        'point_left'],
    ['point right',{index:1,dir:'right'},                       'point_right'],
    ['open palm',  {index:1,middle:1,ring:1,pinky:1},           'open_palm'],
    ['fist',       {index:0},                                    'fist'],
    ['victory',    {index:1,middle:1},                           'victory'],
    ['horns',      {index:1,pinky:1},                            'horns'],
    ['L-pose',     {index:1,thumb:1},                            'cursor'],
    ['pinch',      {index:1,pinch:true},                         'pinch'],
    ['ok sign',    {index:1,middle:1,ring:1,pinky:1,pinch:true}, 'ok_sign'],
  ];
  let pass=0;
  for (const [name,opt,want] of cases){
    const got = await page.evaluate(o=>window.__classify(o), opt);
    const ok = got===want; if(ok)pass++;
    console.log((ok?'PASS':'FAIL')+`  ${name.padEnd(11)} -> ${got} (want ${want})`);
  }
  console.log(`CLASSIFIER: ${pass}/${cases.length}`);

  // pinch hysteresis: released only past the wider threshold
  // gap 0.31 sits between the 0.27 entry and 0.36 release thresholds:
  // not a pinch when open, still a pinch while held -> no flicker
  const hyst = await page.evaluate(()=>({
    open:  window.__classify({index:1,gap:0.31}, false),
    held:  window.__classify({index:1,gap:0.31}, true),
    wide:  window.__classify({index:1,gap:0.45}, true)
  }));
  const hOK = hyst.open!=='pinch' && hyst.held==='pinch' && hyst.wide!=='pinch';
  console.log('pinch hysteresis:', JSON.stringify(hyst), hOK?'PASS':'FAIL');

  // ---- action pipeline (camera off, tracking armed) ----
  const ptr = await page.evaluate(async()=>{
    window.__arm();
    window.__send({index:1,dir:'up',wrist:[0.22,0.20]},4);
    await new Promise(r=>setTimeout(r,450)); const a={x:px,y:py};
    smooth=null; window.__send({index:1,dir:'up',wrist:[0.78,0.20]},4);
    await new Promise(r=>setTimeout(r,450)); const c={x:px,y:py};
    return {a,c};
  });
  // mirror view: hand moves right on screen -> pointer moves right
  console.log('pointer travel:', Math.round(ptr.a.x),'->',Math.round(ptr.c.x),
              ptr.c.x > ptr.a.x+700 ? 'PASS (absolute, full-width reach)' : 'FAIL');

  const clicked = await page.evaluate(async()=>{
    closeAll(); window.__arm();
    const r=document.querySelector('[data-action="launcher"]').getBoundingClientRect();
    window.__send({index:1,pinch:true},3);
    const down=pinchDown;
    // park the pointer on the launcher button, then release within the same task
    tx=px=r.x+r.width/2; ty=py=r.y+r.height/2; smooth=null;
    onHand({multiHandLandmarks:[window.__mk({index:1,dir:'up'})]});
    await new Promise(r2=>setTimeout(r2,240));
    return {down, open:document.querySelector('#launcher').classList.contains('open')};
  });
  console.log('pinch armed:',clicked.down,'| release clicked launcher:',clicked.open, clicked.down&&clicked.open?'PASS':'FAIL');

  const ws = await page.evaluate(async()=>{
    closeAll(); window.__arm();
    const before=document.querySelector('#wsName').textContent;
    for(let i=0;i<6;i++){ onHand({multiHandLandmarks:[window.__mk({index:1,dir:'up',wrist:[0.15+i*0.13,0.20]})]});
      await new Promise(r=>setTimeout(r,20)); }
    await new Promise(r=>setTimeout(r,150));
    return {before, after:document.querySelector('#wsName').textContent, ws:document.body.dataset.ws};
  });
  console.log('swipe -> workspace:',ws.before,'->',ws.after,'(theme',ws.ws+')', ws.before!==ws.after?'PASS':'FAIL');

  const vol = await page.evaluate(async()=>{
    window.__arm(); const v0=volume;
    window.__send({index:1,dir:'up'},4); await new Promise(r=>setTimeout(r,140));
    return {v0,v1:volume,osd:document.querySelector('#osd').classList.contains('show'),
            label:document.querySelector('#osd .osdlabel').textContent};
  });
  console.log('point up -> volume:',vol.v0,'->',vol.v1,'| OSD:',vol.osd,vol.label, vol.v1>vol.v0&&vol.osd?'PASS':'FAIL');

  const okl = await page.evaluate(async()=>{
    closeAll(); window.__arm();
    window.__send({index:1,middle:1,ring:1,pinky:1,pinch:true},4);
    await new Promise(r=>setTimeout(r,140));
    return document.querySelector('#launcher').classList.contains('open');
  });
  console.log('OK sign -> launcher:', okl, okl?'PASS':'FAIL');

  const fst = await page.evaluate(async()=>{
    openLauncher(); window.__arm();
    window.__send({index:0},4); await new Promise(r=>setTimeout(r,140));
    return !document.querySelector('#launcher').classList.contains('open');
  });
  console.log('fist -> close panels:', fst, fst?'PASS':'FAIL');

  const frz = await page.evaluate(async()=>{
    window.__arm();
    for(let i=0;i<34;i++){ onHand({multiHandLandmarks:[window.__mk({index:1,middle:1,ring:1,pinky:1})]});
      await new Promise(r=>setTimeout(r,18)); }
    return {paused, status:document.querySelector('#gStatus').textContent};
  });
  console.log('palm hold -> freeze:', frz.paused, '|', frz.status, frz.paused?'PASS':'FAIL');

  const skel = await page.evaluate(async()=>{
    document.querySelector('#gesture').classList.add('open');
    document.querySelector('#camview').classList.add('live');   // reveal the canvas without a camera
    await new Promise(r=>setTimeout(r,140));
    window.__arm(); window.__send({index:1,middle:1,ring:1,pinky:1},2);
    await new Promise(r=>setTimeout(r,140));
    const c=document.querySelector('#skel');
    const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let n=0; for(let i=3;i<d.length;i+=4) if(d[i]>10) n++;
    return {w:c.width,h:c.height,painted:n};
  });
  console.log('skeleton canvas:',skel.w+'x'+skel.h,'painted px',skel.painted, skel.painted>200?'PASS':'FAIL');

  console.log('console errors:', errs.length ? errs.slice(0,6) : 'none');
  await page.close(); await b.close(); process.exit(0);
})();
