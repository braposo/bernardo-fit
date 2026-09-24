import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
let mode='normal', calls=0, lastBody, enabled=true, expired=false;
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/admin/jobs') { res.setHeader('Content-Type','application/json');
    if(url.searchParams.has('id')) {res.writeHead(404).end('{"error":"Source no longer available"}');return;}
    res.end(JSON.stringify({jobs:[],stages:['new'],models:[],features:{jevEnabled:true}})); return; }
  if(url.pathname==='/api/admin/chat') {
    if(expired){res.writeHead(401,{'Content-Type':'application/json'}).end('{"error":"Unauthorized"}');return;}
    if(req.method==='GET') { res.setHeader('Content-Type','application/json');res.end(JSON.stringify({enabled,contextConfigured:true,autoAvailable:true,insightsEnabled:true,models:[{id:'gpt-5.6-sol',label:'Sol',provider:'openai',available:true},{id:'claude-sonnet-5',label:'Sonnet',provider:'anthropic',available:true}]}));return; }
    let body='';for await(const chunk of req)body+=chunk; lastBody=JSON.parse(body); calls++;
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const send=(event,data)=>res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('route',{model:lastBody.model==='auto'?'gpt-5.6-sol':lastBody.model});
    send('text',{text:'Synthetic answer: <script>window.chatUnsafe=true</script> €100. '});
    const timer=setTimeout(()=>{
      if(mode==='error'){send('error',{error:'Synthetic upstream failure'});res.end();return;}
      send('text',{text:'Evidence suggests a strong match.\n'.repeat(18)});
      send('sources',{sources:[{id:'synthetic.job',type:'job',title:'Fictional Atlas · Principal Designer',jobId:'job & example'}]});
      send('persistence',{state:'saved'});send('done',{finishReason:'stop'});res.end();
    },mode==='hold'?30000:200);
    res.on('close',()=>clearTimeout(timer));return;
  }
  const allowed=['/admin.html','/admin-run.js','/admin-usage.js','/assets/admin-ui.js','/assets/admin-ui.css','/assets/task-ui.js','/task-ui.css'];
  if(!allowed.includes(url.pathname)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html');
  res.end(await readFile(new URL('../public'+url.pathname,import.meta.url)));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined});
try {
  const context=await browser.newContext({viewport:{width:1280,height:900}});
  const page=await context.newPage(), errors=[];
  await page.emulateMedia({reducedMotion:'reduce'});
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>sessionStorage.setItem('bfit_admin_secret','synthetic'));
  await page.goto(`http://127.0.0.1:${server.address().port}/admin.html`);
  await page.getByRole('button',{name:'Chat',exact:true}).click();
  await page.getByRole('heading',{name:'Chat with your content'}).waitFor();
  await page.evaluate(()=>{const viewport=document.createElement('ol');viewport.className='task-toast-viewport';viewport.id='chat-toast-fixture';viewport.innerHTML='<li>Background task fixture</li>';document.body.append(viewport);});
  assert.equal(await page.locator('#chat-toast-fixture').isVisible(),false,'notifications do not cover the modal');
  await page.getByLabel('Message',{exact:true}).fill('Compare my roles');
  await page.getByLabel('Chat provider').selectOption('anthropic');
  await page.getByLabel('Chat model').selectOption('claude-sonnet-5');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.getByText('Sources consulted (1)').waitFor();
  assert.equal(lastBody.provider,'anthropic');assert.equal(lastBody.model,'claude-sonnet-5');assert.equal(calls,1);
  assert.equal(await page.evaluate(()=>window.chatUnsafe),undefined);
  await page.getByText('Sources consulted (1)').click();
  assert.match(await page.getByRole('link',{name:'Fictional Atlas'}).getAttribute('href'), /job%20%26%20example/);
  await page.getByRole('link',{name:'Fictional Atlas'}).click();
  assert.equal(new URL(page.url()).searchParams.get('job'),'job & example');
  await page.getByRole('button',{name:'Chat',exact:true}).click();
  await page.getByText('Sources consulted (1)').waitFor();
  await mkdir('.chat-screenshots',{recursive:true});
  for(const width of [1280,768,390,360]) {
    await page.setViewportSize({width,height:900});
    const panel=page.getByRole('dialog');
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const bounds=await panel.boundingBox();assert.ok(bounds.x>=-1&&bounds.x+bounds.width<=width+1,`dialog fits ${width}: ${JSON.stringify(bounds)}`);
    assert.ok(await page.getByRole('button',{name:'Send',exact:true}).isVisible());
    assert.equal(await panel.evaluate(el=>el.scrollWidth>el.clientWidth),false,`no overflow ${width}`);
    await page.screenshot({path:`.chat-screenshots/chat-${width}.png`});
  }
  const accessibility=await new AxeBuilder({page}).include('[role="dialog"]').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  assert.deepEqual(accessibility.violations.map(v=>({id:v.id,description:v.description})),[]);
  await page.getByLabel('Message',{exact:true}).fill('Draft survives closing');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#chat-toast-fixture').isVisible(),true,'notifications return after closing chat');
  assert.equal(await page.locator('#chat-toast-fixture').evaluate(el=>getComputedStyle(el).bottom),'80px');
  await page.getByRole('button',{name:'Chat',exact:true}).click();
  assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'Draft survives closing');
  mode='hold';await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.getByRole('button',{name:'Stop',exact:true}).click();await page.getByText('Stopped · partial response').waitFor();
  mode='error';await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByText('Synthetic upstream failure',{exact:true}).waitFor();
  mode='normal';await page.getByRole('button',{name:'Retry',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.chat-retry'));
  assert.equal(lastBody.messages.length,3,'retry replaces failed attempt');
  await page.getByRole('button',{name:'Start a new chat'}).click();
  await page.getByText('What would you like to explore?').waitFor();
  enabled=false;await page.keyboard.press('Escape');await page.getByRole('button',{name:'Chat',exact:true}).click();
  await page.getByText('Chat is not enabled in this environment yet.').waitFor();
  assert.equal(await page.getByRole('button',{name:'Send',exact:true}).isDisabled(),true);
  expired=true;await page.keyboard.press('Escape');await page.getByRole('button',{name:'Chat',exact:true}).click();
  await page.getByRole('heading',{name:'Locked',exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog').count(),0);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('bfit_admin_secret')),null);
  assert.deepEqual(errors,[]);
  console.log('Chat UI passed: provider/model, streaming, escaped output, source links, responsive layout, accessibility, draft retention, stop, retry and new chat.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
