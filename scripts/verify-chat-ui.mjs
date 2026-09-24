import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
let mode='normal', calls=0, lastBody, enabled=true, expired=false, autoAvailable=true;
const chatRuns=new Map();
let loseSubmission=true, interruptStream=true;
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/admin/jobs') { res.setHeader('Content-Type','application/json');
    if(url.searchParams.has('id')) {res.writeHead(404).end('{"error":"Source no longer available"}');return;}
    res.end(JSON.stringify({jobs:[],stages:['new'],models:[],features:{jevEnabled:true}})); return; }
  if(url.pathname==='/api/admin/chat') {
    if(expired){res.writeHead(401,{'Content-Type':'application/json'}).end('{"error":"Unauthorized"}');return;}
    if(req.method==='GET' && !url.searchParams.has('run')) { res.setHeader('Content-Type','application/json');res.end(JSON.stringify({enabled,contextConfigured:true,workerConfigured:true,autoAvailable,insightsEnabled:true,models:[{id:'gpt-5.6-sol',label:'Sol',provider:'openai',available:true},{id:'claude-sonnet-5',label:'Sonnet',provider:'anthropic',available:true}]}));return; }
    if(req.method==='POST') {
      let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);
      if(input.action==='stop') {
        const run=chatRuns.get(input.runId);clearTimeout(run.timer);
        run.send('snapshot',{status:'stopped'});run.send('done',{status:'stopped'});
        res.writeHead(202,{'Content-Type':'application/json'}).end('{}');return;
      }
      lastBody=input;
      let run=chatRuns.get(input.requestId);
      if(!run) {
        calls++;run={events:[],listeners:new Set()};chatRuns.set(input.requestId,run);
        run.send=(event,data)=>{
          const part={event,data:{...data,seq:run.events.length}};run.events.push(part);
          for(const listener of run.listeners)listener(part);
        };
        run.send('activity',{state:'queued'});
        run.send('text',{text:'## Role comparison\n\n**Strong'});
        const runMode=mode;
        run.timer=setTimeout(()=>{
          if(runMode==='error'){run.send('snapshot',{status:'failed',error:'Synthetic upstream failure'});run.send('done',{status:'failed'});return;}
          const ending=' evidence** for a €100 project. <script>window.chatUnsafe=true</script>\n\n- Design leadership\n- Product strategy\n\n1. Review the role\n2. Use `specific evidence`\n\n> Focus on impact.\n\n| Role | Strength | Evidence | Next step |\n| --- | --- | --- | --- |\n| Atlas | Leadership | Research and strategy | Review portfolio |\n\n```js\nconst evidence = "A long example that stays inside its own horizontally scrolling code block on mobile screens";\n```\n\n[Reference](https://example.com/evidence) · [Unsafe](javascript:alert%281%29)\n\n![Hidden image](https://example.com/tracking.png)\n\n**Sources**\n\n- Sanity ID `fit-import-private`\n';
          run.send('text',{text:ending});
          run.send('sources',{sources:runMode==='no-sources'?[]:[{id:'synthetic.job',type:'job',title:'Fictional Atlas · Principal Designer',jobId:'job & example'},{id:'synthetic.job.copy',type:'job',title:'Fictional Atlas · Principal Designer',jobId:'job & example'},{id:'synthetic.report',type:'fitReport',title:'Role analysis',jobId:'job & example'},{id:'synthetic.evidence',type:'candidateEvidence',title:'Design leadership'}]});
          run.send('activity',{state:'saving'});run.send('snapshot',{status:'complete',storage:'saved'});run.send('done',{status:'complete'});
        },runMode==='hold'?30000:200);
      }
      if(loseSubmission){loseSubmission=false;res.destroy();return;}
      res.writeHead(202,{'Content-Type':'application/json'}).end(JSON.stringify({runId:input.requestId}));return;
    }
    const run=chatRuns.get(url.searchParams.get('run'));
    if(!run){res.writeHead(404,{'Content-Type':'application/json'}).end('{"error":"Missing run"}');return;}
    res.writeHead(200,{'Content-Type':'text/event-stream'});
    const send=({event,data})=>{res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);if(event==='done')res.end();};
    for(const part of run.events.slice(Number(url.searchParams.get('cursor')||0))) {
      send(part);
      if(interruptStream && part.event==='text'){interruptStream=false;res.end();return;}
    }
    if(!res.writableEnded)run.listeners.add(send);
    res.on('close',()=>run.listeners.delete(send));return;
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
  assert.equal(await page.locator('.masthead #admin-chat-root .admin-chat-launcher').count(),1);
  await page.getByRole('button',{name:'Chat',exact:true}).click();
  await page.getByRole('heading',{name:'Chat with your content'}).waitFor();
  await page.evaluate(()=>{const viewport=document.createElement('ol');viewport.className='task-toast-viewport';viewport.id='chat-toast-fixture';viewport.innerHTML='<li>Background task fixture</li>';document.body.append(viewport);});
  assert.equal(await page.locator('#chat-toast-fixture').isVisible(),false,'notifications do not cover the modal');
  await page.getByLabel('Message',{exact:true}).fill('Compare my roles');
  assert.equal(await page.getByRole('dialog').getByRole('combobox').count(),0);
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.getByText('Response complete.').waitFor();
  await page.getByText('Sources consulted').waitFor();
  assert.equal(lastBody.provider,'auto');assert.equal(lastBody.model,'auto');assert.equal(calls,1);
  assert.equal(loseSubmission,false);assert.equal(interruptStream,false);
  assert.equal(await page.evaluate(()=>window.chatUnsafe),undefined);
  const markdown=page.locator('.chat-markdown');
  assert.equal(await markdown.locator('h2').textContent(),'Role comparison');
  assert.equal(await markdown.locator('strong').textContent(),'Strong evidence');
  assert.equal(await markdown.locator('ul > li').count(),2);
  assert.equal(await markdown.locator('ol > li').count(),2);
  assert.equal(await markdown.locator('pre code').count(),1);
  assert.equal(await markdown.locator('table th').count(),4);
  assert.equal(await markdown.locator('blockquote').count(),1);
  assert.equal(await markdown.getByRole('link',{name:'Reference',exact:true}).getAttribute('href'),'https://example.com/evidence');
  assert.equal(await markdown.getByRole('link',{name:'Unsafe',exact:true}).count(),0);
  assert.equal(await markdown.locator('script, img').count(),0);
  assert.equal(await markdown.getByText('Sources', {exact:true}).count(),0);
  assert.equal(await markdown.getByText('fit-import-private').count(),0);
  assert.equal(await page.locator('.chat-model-label').count(),0);
  await page.getByText('Sources consulted').click();
  assert.equal(await page.locator('.chat-sources li').count(),3);
  assert.match(await page.getByRole('link',{name:'Role analysis'}).getAttribute('href'), /section=materials/);
  assert.equal(await page.getByText('Design leadership',{exact:true}).count(),2);
  assert.match(await page.getByRole('link',{name:'Fictional Atlas'}).getAttribute('href'), /job%20%26%20example/);
  await page.getByRole('link',{name:'Fictional Atlas'}).click();
  assert.equal(new URL(page.url()).searchParams.get('job'),'job & example');
  await page.getByRole('button',{name:'Chat',exact:true}).click();
  await page.getByText('Sources consulted').waitFor();
  await mkdir('.chat-screenshots',{recursive:true});
  for(const width of [1280,768,390,360]) {
    await page.setViewportSize({width,height:900});
    const headerPosition=await page.evaluate(()=>{const header=document.querySelector('.masthead').getBoundingClientRect(),button=document.querySelector('.admin-chat-launcher').getBoundingClientRect();return {header:{top:header.top,bottom:header.bottom},button:{top:button.top,bottom:button.bottom,right:button.right}};});
    assert.ok(headerPosition.button.top>=headerPosition.header.top&&headerPosition.button.bottom<=headerPosition.header.bottom&&headerPosition.button.right<=width,`chat launcher stays in header at ${width}`);
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
  assert.equal(await page.locator('#chat-toast-fixture').evaluate(el=>getComputedStyle(el).bottom),'16px');
  await page.getByRole('button',{name:'Chat',exact:true}).click();
  assert.equal(await page.getByLabel('Message',{exact:true}).inputValue(),'Draft survives closing');
  assert.equal(await page.getByText('Conversations are saved privately for Insights.').count(),0);
  assert.equal(await page.locator('.chat-composer-footer [role=status]').textContent(),'Response complete.');
  mode='hold';await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.waitForFunction(()=>JSON.parse(sessionStorage.getItem('bfit_admin_chat')).turns.at(-1).runId);
  const streamingRun=chatRuns.get(lastBody.requestId);
  const viewport=page.locator('[data-slot=message-scroller-viewport]');
  const atBottom=()=>page.waitForFunction(()=>{const el=document.querySelector('[data-slot=message-scroller-viewport]');return el.scrollHeight-el.clientHeight-el.scrollTop<8;});
  let scrollChunk=0;
  const appendChunk=async(text)=>{
    const marker=`Streaming check ${++scrollChunk}`;
    streamingRun.send('text',{text:`\n\n${marker}\n\n${text}`});
    await page.getByText(marker,{exact:true}).waitFor({state:'attached'});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  };
  for(const width of [1280,390]) {
    await page.setViewportSize({width,height:900});
    await appendChunk('Streaming evidence paragraph.\n\n'.repeat(24));
    await atBottom();
    await viewport.hover();await page.mouse.wheel(0,-450);
    await page.waitForFunction(()=>{const el=document.querySelector('[data-slot=message-scroller-viewport]');return el.scrollHeight-el.clientHeight-el.scrollTop>200;});
    // Wait for the wheel's scroll position to settle before comparing subsequent chunks.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const readingPosition=await viewport.evaluate(el=>el.scrollTop);
    await appendChunk('New evidence while reading older messages.\n\n'.repeat(8));
    assert.ok(Math.abs(await viewport.evaluate(el=>el.scrollTop)-readingPosition)<8,`preserves reading position at ${width}`);
    await page.getByRole('button',{name:'Scroll to end',exact:true}).click();await atBottom();
    await appendChunk('Following the newest text again.\n\n'.repeat(8));
    await atBottom();
  }
  const beforeReload=calls;
  await page.reload();await page.getByRole('button',{name:'Chat',exact:true}).click();
  await page.getByRole('button',{name:'Stop',exact:true}).waitFor();
  assert.equal(calls,beforeReload,'reload reconnects without regenerating');
  await page.getByRole('button',{name:'Stop',exact:true}).click();await page.getByText('Stopped · partial response').waitFor();
  mode='error';await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByText('Synthetic upstream failure',{exact:true}).waitFor();
  mode='normal';await page.getByRole('button',{name:'Retry',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.chat-retry'));
  assert.equal(lastBody.messages.length,3,'retry replaces failed attempt');
  assert.equal(lastBody.provider,'auto');assert.equal(lastBody.model,'auto');
  await page.getByRole('button',{name:'Start a new chat'}).click();
  await page.getByText('What would you like to explore?').waitFor();
  mode='no-sources';
  await page.getByLabel('Message',{exact:true}).fill('Question with no source records');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await page.getByText('Response complete.').waitFor();
  await page.getByText('Sources consulted').click();
  await page.getByText('No source records were returned for this answer.').waitFor();
  await page.getByRole('button',{name:'Start a new chat'}).click();
  mode='normal';
  autoAvailable=false;await page.keyboard.press('Escape');await page.getByRole('button',{name:'Chat',exact:true}).click();
  await page.getByText('Chat is temporarily unavailable. Please try again later.').waitFor();
  await page.getByLabel('Message',{exact:true}).fill('Question while routing is unavailable');
  assert.equal(await page.getByRole('button',{name:'Send',exact:true}).isDisabled(),true);
  autoAvailable=true;
  enabled=false;await page.keyboard.press('Escape');await page.getByRole('button',{name:'Chat',exact:true}).click();
  await page.getByText('Chat is not enabled in this environment yet.').waitFor();
  assert.equal(await page.getByRole('button',{name:'Send',exact:true}).isDisabled(),true);
  expired=true;await page.keyboard.press('Escape');await page.getByRole('button',{name:'Chat',exact:true}).click();
  await page.getByRole('heading',{name:'Locked',exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog').count(),0);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('bfit_admin_secret')),null);
  assert.deepEqual(errors,[]);
  console.log('Chat UI passed: idempotent dispatch recovery, stream reconnection, reload recovery, status footer, automatic routing, Markdown, sources, accessibility, stop and retry.');
} finally {for(const run of chatRuns.values())clearTimeout(run.timer);await browser.close();await new Promise(resolve=>server.close(resolve));}
