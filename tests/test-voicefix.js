const { chromium } = require('playwright');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const b=await chromium.launch({executablePath:'/usr/local/bin/chromium',args:[
    '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:1440,height:900},permissions:['microphone']});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto('http://127.0.0.1:8899/tosseos-preview.html'); await sleep(900);

  console.log('native SR object exists:', await page.evaluate(()=>!!(window.SpeechRecognition||window.webkitSpeechRecognition)));
  console.log('-- voice comes up on its own at launch (native will silently die here) --');
  const t0=Date.now();
  await page.waitForFunction(()=>!!micStream,null,{timeout:20000}).catch(()=>{});
  await page.evaluate(()=>{try{stopCamera()}catch(_){}});
  // watch the engine label transition without any user action
  const seen=[];
  for(let i=0;i<80;i++){
    const e=await page.evaluate(()=>({eng:document.querySelector('#engineBtn').textContent,
      diag:document.querySelector('#voiceDiag').textContent,
      diagOn:document.querySelector('#voiceDiag').classList.contains('on')}));
    const key=e.eng+'|'+e.diag;
    if(!seen.length||seen[seen.length-1].key!==key){
      seen.push({key,t:Date.now()-t0,...e});
      console.log(`  +${String(Date.now()-t0).padStart(6)}ms  ${e.eng}`);
      if(e.diagOn) console.log(`            diag: ${e.diag}`);
    }
    if(/Whisper|unavailable/.test(e.eng)) break;
    await sleep(700);
  }
  const finalEng=await page.locator('#engineBtn').innerText();
  console.log('AUTO-FALLBACK without any user click:', /WHISPER/i.test(finalEng)?'PASS':'FAIL','->',finalEng);
  const fellBackIn = seen.find(s=>/Whisper|loading/i.test(s.eng));
  console.log('handover began at:', fellBackIn? fellBackIn.t+'ms':'never');

  // the on-device engine must actually be capturing
  const cap=await page.evaluate(()=>({engine, whisperReady, captureOn, mic:!!micStream}));
  console.log('engine state:', JSON.stringify(cap),
    cap.engine==='whisper'&&cap.whisperReady&&cap.captureOn&&cap.mic?'PASS':'FAIL');

  // and commands must work through it
  const cmd=await page.evaluate(async()=>{
    document.querySelectorAll('.win').forEach(w=>w.remove()); openWins.clear();
    runCommand('open calculator'); await new Promise(r=>setTimeout(r,150));
    return openWins.has('Calculator');
  });
  console.log('command path live on on-device engine:', cmd?'PASS':'FAIL');

  await page.waitForSelector('#bootEnter:not([disabled])',{timeout:30000}).catch(()=>{});
  await page.click('#bootEnter'); await sleep(300);
  await page.screenshot({path:'a2-voice-fallback.png'});

  // a return visit must skip the dead native engine entirely
  console.log('-- reload (should go straight to the on-device engine) --');
  const t1=Date.now();
  await page.reload(); await sleep(1200);
  let straight='';
  for(let i=0;i<50;i++){
    straight=await page.locator('#engineBtn').innerText();
    if(/Whisper|unavailable/.test(straight))break;
    await sleep(600);
  }
  console.log('after reload:', straight, '('+(Date.now()-t1)+'ms)', /WHISPER/i.test(straight)?'PASS':'FAIL');
  console.log('never touched native again:', await page.evaluate(()=>localStorage.getItem('tosseos.nativeDead'))==='1'?'PASS':'FAIL');

  console.log('page errors:', errs.length?errs.slice(0,5):'none');
  await page.close(); await b.close(); process.exit(0);
})();
