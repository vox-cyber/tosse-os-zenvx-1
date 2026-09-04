const { chromium } = require('playwright');
const URL='http://127.0.0.1:8899/tosseos-preview.html';
const sleep=(p,ms)=>p.waitForTimeout(ms);

async function run(){
  /* ---------- 1. launch asks by itself, no clicks at all ---------- */
  let b = await chromium.launch({ executablePath:'/usr/local/bin/chromium', args:[
    '--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--no-sandbox']});
  let ctx = await b.newContext({ viewport:{width:1280,height:860}, permissions:['camera','microphone'] });
  let page = await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
  await page.goto(URL); await sleep(page,700);

  console.log('card visible on load     :', await page.locator('#boot').isVisible(), '(no click made)');
  const asking = await page.locator('#bootEnter').innerText();
  console.log('button while asking      :', JSON.stringify(asking),
              /waiting|starting/i.test(asking)?'PASS':'FAIL');

  const t0=Date.now();
  await page.waitForFunction(()=>!!micStream, null, {timeout:20000}).catch(()=>{});
  console.log('mic live with zero clicks:', await page.evaluate(()=>!!micStream),
              '('+(Date.now()-t0)+'ms)', await page.evaluate(()=>!!micStream)?'PASS':'FAIL');
  await page.waitForFunction(()=>tracking===true, null, {timeout:30000}).catch(()=>{});
  console.log('camera live with 0 clicks:', await page.evaluate(()=>tracking===true),
              await page.evaluate(()=>tracking===true)?'PASS':'FAIL');
  await page.waitForFunction(()=>!document.querySelector('#bootEnter').disabled,null,{timeout:20000}).catch(()=>{});
  console.log('rows                     :', await page.locator('#bootMic .st').innerText(),
              '/', await page.locator('#bootCam .st').innerText());
  console.log('button when ready        :', JSON.stringify(await page.locator('#bootEnter').innerText()),
              JSON.stringify((await page.locator('#bootHint').innerText()).slice(0,44)));
  const ready = (await page.locator('#bootEnter').innerText()).includes('Enter the desktop');
  console.log('enter offered            :', ready, ready?'PASS':'FAIL');
  await page.click('#bootEnter'); await sleep(page,300);
  console.log('card gone after enter    :', await page.evaluate(()=>!document.querySelector('#boot')),
              await page.evaluate(()=>!document.querySelector('#boot'))?'PASS':'FAIL');

  /* ---------- 2. return visit: sensors resume, no card ---------- */
  await page.reload(); await sleep(page,1200);
  const back = await page.evaluate(()=>({card:!!document.querySelector('#boot'),mic:!!micStream}));
  console.log('return visit             :', JSON.stringify(back), !back.card&&back.mic?'PASS':'FAIL');
  await page.close(); await ctx.close(); await b.close();

  /* ---------- 3. denied: clear blocked state + working retry ----------
     headless Chromium cannot show a real prompt, so a genuine refusal is
     simulated exactly as a browser reports one */
  b = await chromium.launch({ executablePath:'/usr/local/bin/chromium', args:['--no-sandbox',
    '--use-fake-device-for-media-stream']});
  ctx = await b.newContext({ viewport:{width:1280,height:860} });
  await ctx.clearPermissions();
  await ctx.addInitScript(()=>{
    navigator.mediaDevices.getUserMedia = () => Promise.reject(
      Object.assign(new Error('Permission denied'),{name:'NotAllowedError'}));
    navigator.permissions.query = (d) => Promise.resolve({state:'denied',name:d&&d.name,onchange:null});
  });
  page = await ctx.newPage();
  page.on('pageerror',e=>errs.push('denied: '+e.message));
  await page.goto(URL); await sleep(page,2500);
  const den = await page.evaluate(()=>({
    mic:document.querySelector('#bootMic .st').textContent,
    cam:document.querySelector('#bootCam .st').textContent,
    micCls:document.querySelector('#bootMic').className,
    btn:document.querySelector('#bootEnter').textContent,
    disabled:document.querySelector('#bootEnter').disabled,
    hint:document.querySelector('#bootHint').textContent,
    warn:document.querySelector('#bootHint').classList.contains('warn')}));
  console.log('blocked rows             :', den.mic,'/',den.cam,
              den.mic==='Blocked'&&den.cam==='Blocked'?'PASS':'FAIL');
  console.log('blocked styling          :', den.micCls.includes('blocked')?'PASS':'FAIL');
  console.log('retry button offered     :', JSON.stringify(den.btn), !den.disabled&&/Try again|Allow/.test(den.btn)?'PASS':'FAIL');
  console.log('hint explains the fix    :', den.warn&&/address bar/.test(den.hint)?'PASS':'FAIL');
  console.log('  ->', den.hint);
  const retry = await page.evaluate(async()=>{
    const seen=[]; const t=setInterval(()=>seen.push(document.querySelector('#bootEnter').textContent),40);
    document.querySelector('#bootEnter').click(); await new Promise(r=>setTimeout(r,500)); clearInterval(t);
    return {sawWaiting:seen.some(x=>/Waiting/.test(x)), back:document.querySelector('#bootEnter').textContent,
            hint:document.querySelector('#bootHint').textContent};});
  console.log('retry shows it tried     :', retry.sawWaiting, retry.sawWaiting?'PASS':'FAIL');
  console.log('retry escalates the hint :', /still refusing/.test(retry.hint)?'PASS':'FAIL');
  console.log('  ->', retry.hint);

  // skipping is remembered, so the card does not nag
  await page.click('#bootSkip'); await sleep(page,200);
  await page.reload(); await sleep(page,1200);
  console.log('skip is remembered       :', await page.evaluate(()=>!document.querySelector('#boot'))?'PASS':'FAIL');

  /* ---------- 4. an abandoned setup gets asked again ---------- */
  await page.evaluate(()=>{localStorage.clear();localStorage.setItem('tosseos.setup','1')});
  await page.reload(); await sleep(page,1500);
  console.log('abandoned setup re-asks  :', await page.locator('#boot').isVisible()?'PASS':'FAIL');

  console.log('page errors:', errs.length?errs.slice(0,4):'none');
  await page.close(); await b.close();
}
run().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
