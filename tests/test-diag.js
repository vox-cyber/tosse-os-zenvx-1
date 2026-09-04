const { chromium } = require('playwright');
const wait=(p,ms)=>p.waitForTimeout(ms);
(async () => {
  const b = await chromium.launch({ executablePath:'/usr/local/bin/chromium', args:[
    '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required','--no-sandbox'
  ]});
  const ctx = await b.newContext({ viewport:{width:1440,height:900}, permissions:['camera','microphone'] });
  const page = await ctx.newPage();
  const errs=[]; page.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  page.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  await page.goto('http://127.0.0.1:8899/tosseos-preview.html');
  await wait(page,900);
  await page.waitForFunction(()=>!!micStream,null,{timeout:20000}).catch(()=>{});
  await page.evaluate(()=>{try{stopCamera()}catch(_){}});
  await page.waitForSelector('#bootEnter:not([disabled])',{timeout:30000}).catch(()=>{});
  await page.click('#bootEnter'); await wait(page,400);
  await page.evaluate(()=>openVoicePanel());
  await wait(page,300);

  // speak-back toggle persists
  const t0 = await page.locator('#speakToggle').innerText();
  await page.click('#speakToggle'); await wait(page,150);
  const t1 = await page.locator('#speakToggle').innerText();
  const stored = await page.evaluate(()=>localStorage.getItem('tosseos.speak'));
  console.log('speak toggle:', JSON.stringify(t0),'->',JSON.stringify(t1),'| stored:',stored,
    t0!==t1 && stored!==null ? 'PASS':'FAIL');

  // diagnostics panel opens and populates
  console.log('panel hidden before:', !(await page.locator('#vdPanel').isVisible()));
  await page.click('#vdToggle'); await wait(page,1600);
  const vis = await page.locator('#vdPanel').isVisible();
  const rows = await page.evaluate(()=>({
    engine:document.querySelector('#vdEngine').textContent,
    mic:document.querySelector('#vdMic').textContent,
    lvl:document.querySelector('#vdLevelN').textContent,
    barW:document.querySelector('#vdLevel').style.width,
    frames:document.querySelector('#vdFrames').textContent,
    gate:document.querySelector('#vdGate').textContent,
    label:document.querySelector('#vdToggle').textContent
  }));
  console.log('panel:',vis,JSON.stringify(rows), vis&&rows.mic==='live'?'PASS':'FAIL');

  // level meter actually moves with the fake tone once whisper is capturing
  await page.waitForFunction(()=>engine==='whisper'&&captureOn, null, {timeout:60000}).catch(()=>{});
  const samples=[];
  for(let i=0;i<8;i++){ samples.push(await page.evaluate(()=>micRms)); await wait(page,300); }
  const moved = new Set(samples.map(n=>n.toFixed(4))).size>1 && Math.max(...samples)>0.001;
  console.log('input level samples:',samples.map(n=>n.toFixed(4)).join(' '), moved?'PASS':'FAIL');
  const fr = await page.evaluate(()=>({level:micFrames,speech:vadFrames}));
  console.log('audio frames counted:',JSON.stringify(fr), fr.level>20&&fr.speech>5?'PASS':'FAIL');
  const shown = await page.evaluate(()=>({n:document.querySelector('#vdLevelN').textContent,
    w:document.querySelector('#vdLevel').style.width,f:document.querySelector('#vdFrames').textContent}));
  console.log('panel shows level:',JSON.stringify(shown),
    parseFloat(shown.n)>0&&parseFloat(shown.w)>0?'PASS':'FAIL');

  // copy diagnostics text
  const txt = await page.evaluate(()=>diagText());
  const need=['engine:','microphone:','input level:','audio frames:','speech gate:','last heard:','last error:','browser:'];
  console.log('diagText keys:',need.filter(k=>txt.includes(k)).length+'/'+need.length,
    need.every(k=>txt.includes(k))?'PASS':'FAIL');
  console.log('--- sample readout ---\n'+txt.split('\n').slice(0,7).join('\n'));

  // speaking latch cannot deafen the mic: force it on, then confirm it clears
  const latch = await page.evaluate(async()=>{
    setSpeaking(true,600); const on=speaking;
    await new Promise(r=>setTimeout(r,1100));
    return {on, off:!speaking};
  });
  console.log('speaking timeout releases gate:',JSON.stringify(latch), latch.on&&latch.off?'PASS':'FAIL');

  const latch2 = await page.evaluate(()=>{ setSpeaking(true,9000); stopMic(); return !speaking; });
  console.log('stopMic clears speaking latch:',latch2, latch2?'PASS':'FAIL');

  await page.evaluate(()=>{ localStorage.clear(); });
  console.log('console errors:', errs.length?errs.slice(0,4):'none');
  await page.close(); await b.close(); process.exit(0);
})();
