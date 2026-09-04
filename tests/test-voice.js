const { chromium } = require('playwright');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async () => {
  const b = await chromium.launch({ executablePath:'/usr/local/bin/chromium', args:[
    '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required','--no-sandbox'
  ]});
  const ctx = await b.newContext({ viewport:{width:1440,height:900}, permissions:['camera','microphone'] });
  const page = await ctx.newPage();
  const errs=[];
  page.on('console', m=>{ if(m.type()==='error') errs.push(m.text()) });
  page.on('pageerror', e=>errs.push('PAGEERROR '+e.message));
  await page.goto('http://127.0.0.1:8899/tosseos-preview.html');
  await sleep(900);

  // the launch flow asks for both by itself; drop the camera so the camera
  // commands below still start from cold
  await page.waitForFunction(()=>!!micStream,null,{timeout:20000}).catch(()=>{});
  await page.evaluate(()=>{try{stopCamera()}catch(_){}}); await sleep(600);
  console.log('boot mic:', await page.locator('#bootMic .st').innerText());
  await page.click('#bootEnter'); await sleep(400);
  console.log('MIC badge:', !(await page.locator('#micLive').getAttribute('hidden')));
  console.log('mic state:', (await page.locator('#micState').innerText()).trim());
  console.log('engine    :', await page.locator('#engineBtn').innerText());
  console.log('wake btn  :', await page.locator('#wakeToggle').innerText());

  await page.evaluate(()=>{ closeAll('voice'); document.querySelector('#voice').classList.add('open') });

  const say = async (t) => { await page.evaluate(s=>runCommand(s), t); await sleep(340); };
  const st = () => page.evaluate(()=>({
    title:document.querySelector('#voiceTitle').textContent,
    text:document.querySelector('#voiceText').textContent.slice(0,72),
    heard:document.querySelector('#heard').textContent,
    heardOn:document.querySelector('#heard').classList.contains('on'),
    ws:document.querySelector('#wsName').textContent, wsi:document.body.dataset.ws,
    launcher:document.querySelector('#launcher').classList.contains('open'),
    gesture:document.querySelector('#gesture').classList.contains('open'),
    vol:typeof volume!=='undefined'?volume:null, cam:tracking, mic:!!micStream,
    ghost:ghostOn, wake:wakeMode, osd:document.querySelector('#osd').classList.contains('show')
  }));

  const tests = [
    ['help',                    s=>/Voice commands/i.test(s.title)],
    ['open launcher',           s=>s.launcher],
    ['close',                   s=>!s.launcher],
    ['show me the apps',        s=>s.launcher],
    ['open terminal',           s=>/Opening Terminal/i.test(s.title)],
    ['calculator',              s=>/Opening Calculator/i.test(s.title)],
    ['launch calculater',       s=>/Opening Calculator/i.test(s.title)],   // misspelt on purpose
    ['hey eva open weather',  s=>/Opening Weather/i.test(s.title)],
    ['next workspace',          s=>s.ws==='Workspace 2'],
    ['workspace three',         s=>s.ws==='Workspace 3'],
    ['previous workspace',      s=>s.ws==='Workspace 2'],
    ['volume up',               s=>s.vol===70 && s.osd],
    ['turn it down',            s=>s.vol===62],
    ['mute',                    s=>s.vol===0],
    ['open gestures',           s=>s.gesture],
    ['center pointer',          s=>/centered/i.test(s.text)],
    ['ghost overlay off',       s=>s.ghost===false],
    ['ghost on',                s=>s.ghost===true],
    ['enable camera',           s=>/Camera starting/i.test(s.title)],
    ['turn off the camera',     s=>s.cam===false],
    ['wake word on',            s=>s.wake===true],
    ['always listening',        s=>s.wake===false],
    ['flibbertigibbet',         s=>/Not sure/i.test(s.title)],
  ];
  let pass=0;
  for (const [cmd,check] of tests){
    await say(cmd);
    const s = await st();
    const ok = check(s); if(ok)pass++;
    console.log((ok?'PASS':'FAIL')+`  "${cmd}"`.padEnd(28)+` -> ${s.title} | ${s.text.slice(0,44)}`);
  }
  console.log(`VOICE COMMANDS: ${pass}/${tests.length}`);

  // chained command
  await page.evaluate(()=>{ closeAll(); switchWorkspace(-wsIndex) });
  await say('open terminal and then next workspace');
  // chained parts fire 950ms apart, so wait for the effect instead of a guess
  await page.waitForFunction(()=>/Workspace 2/.test(document.querySelector('#wsName').textContent),
    null,{timeout:8000}).catch(()=>{});
  const ch = await st();
  console.log('chained cmd:', ch.title, '|', ch.ws, /Workspace 2/.test(ch.ws)?'PASS':'FAIL');

  // typed box drives the same parser and shows in the HUD
  const typed = await page.evaluate(async()=>{
    const i=document.querySelector('#voiceCmd'); i.value='open photos';
    i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    await new Promise(r=>setTimeout(r,300));
    return {title:document.querySelector('#voiceTitle').textContent,
            hud:document.querySelector('#heard').textContent,
            hudOn:document.querySelector('#heard').classList.contains('on'),
            cleared:i.value===''};
  });
  console.log('typed command:', JSON.stringify(typed), /Opening Photos/.test(typed.title)&&typed.hudOn?'PASS':'FAIL');

  // echo guard: Eva's own last sentence must be ignored
  const echo = await page.evaluate(async()=>{
    lastSay='Switched to Workspace 2'; lastSayAt=Date.now();
    const before=document.querySelector('#voiceTitle').textContent;
    runCommand('switched to workspace 2');
    await new Promise(r=>setTimeout(r,200));
    return {before, after:document.querySelector('#voiceTitle').textContent};
  });
  console.log('echo guard ignored self:', echo.before===echo.after?'PASS':'FAIL');

  // wake-word gating is advisory (commands still parse); confirm the toggle persists
  await page.evaluate(()=>setWake(true));
  await page.reload(); await sleep(1500);
  console.log('wake persisted after reload:', await page.evaluate(()=>wakeMode)===true?'PASS':'FAIL');
  console.log('mic auto-restored     :', await page.evaluate(()=>!!micStream)?'PASS':'FAIL');
  console.log('engine after reload   :', await page.locator('#engineBtn').innerText());

  // engine switch -> on-device Whisper
  await page.evaluate(()=>{ closeAll('voice'); document.querySelector('#voice').classList.add('open') });
  await page.click('#engineBtn');
  for(let i=0;i<50;i++){ const e=await page.locator('#engineBtn').innerText();
    if(/Whisper|unavailable/.test(e)) break; await sleep(1500); }
  console.log('engine switched to    :', await page.locator('#engineBtn').innerText());
  console.log('voice text            :', (await page.locator('#voiceText').innerText()).slice(0,90));
  await page.screenshot({path:'v1-voice.png'});

  console.log('console errors:', errs.length ? errs.slice(0,8) : 'none');
  await page.close(); await b.close(); process.exit(0);
})();
