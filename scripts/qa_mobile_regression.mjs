/** Real panel in a mobile Chromium viewport, with ALL APIs synthetic and all network blocked.
 * BUSHIN_QA_BROWSER=/usr/bin/google-chrome node scripts/qa_mobile_regression.mjs
 * Optional first argument: screenshot output path. No credentials/Discord/Worker are used.
 */
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {PANEL_HTML,PANEL_JS} from '../cloudflare/discord2-ui.mjs';
const browser=await chromium.launch({headless:true,...(process.env.BUSHIN_QA_BROWSER?{executablePath:process.env.BUSHIN_QA_BROWSER}:{}),args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 page.setDefaultTimeout(8000);
 const errors=[],network=[];
 page.on('pageerror',e=>errors.push(e.message));
 const html=PANEL_HTML.replace('<script defer src="/mobile/discord2/app.js"></script>','');
 await page.route('**/*',route=>{if(route.request().url()==='https://bushin-fixture.test/')return route.fulfill({status:200,contentType:'text/html',body:html});network.push(route.request().url());return route.abort();});
 await page.goto('https://bushin-fixture.test/');
 await page.evaluate(()=>{
  const a='1520114348079583263',b='999999999999999999';
  window.qaRequests=[];window.qaHoldSend=true;window.qaFailSend=false;let initial=true;
  let state={version:1,revision:0,phase:'stopped',reason:'Agente parado.',steps:0,max_steps:25,history:[],goal_level:20};
  const missing=['BUSHIN_GAME: service binding para o adaptador autorizado pelo jogo','BUSHIN_GAME_APPROVAL: referência da autorização do operador'];
  window.fetch=async(input,opt={})=>{
   const path=String(input).replace('/mobile/discord2/api',''),body=opt.body instanceof FormData?JSON.parse(String(opt.body.get('payload_json'))):opt.body?JSON.parse(opt.body):null;
   window.qaRequests.push({path,body,files:opt.body instanceof FormData?opt.body.getAll('files').map(f=>f.name):[]});
   if(path.includes('/messages/receipt'))return Response.json({state:'unknown',sent:null,reason:'Fixture: recibo ainda sem resultado. Nenhum reenvio.'});
   if(path==='/channels')return Response.json({listed:true,channels:[{id:a,name:'Canal A',type:0},{id:b,name:'Canal B',type:0}]});
   if(path.startsWith('/channels/')&&path.includes('/messages')){
    const channel=path.split('/')[2];
    if(body){
     if(window.qaHoldSend)await new Promise(resolve=>{window.qaReleaseSend=resolve;});
     return Response.json(window.qaFailSend?{sent:false,reason:'Entrega não comprovada pelo transporte de teste.'}:{sent:true,channel_id:channel,message_id:'1564380277411680326'});
    }
    const response=()=>Response.json({read:true,messages:[{id:channel===a?'1564380277411680301':'1564380277411680302',channel_id:channel,author_id:'111111111111111111',author_name:'Outro jogador',content:channel===a?'Mensagem do canal A':'Mensagem do canal B',timestamp:new Date().toISOString()}]});
    if(channel===a&&initial){initial=false;return new Promise(resolve=>{window.qaReleaseInitial=()=>resolve(response());});}
    return response();
   }
   if(path==='/autoplay'){
    if(body){state={...state,revision:state.revision+1,phase:body.action==='stop'?'stopped':'blocked',code:'game_integration_missing',reason:'Falta o adaptador autorizado pelo Naruto Project.'};}
    return Response.json(window.qaPersonalMode?{controller:'personal_player',state:{...state,phase:'stopped'},integration:{configured:true,mode:'personal_user_token',credential_configured:true,executor_online:false,brain_ready:false,missing:[]},note:'Fixture de conexão pessoal configurada com executor offline.'}:{controller:'authorized_game',state,integration:{configured:false,missing},note:'Fixture sintética: sem jogo real.'});
   }
   if(path.startsWith('/commands'))return Response.json({catalog_verified:true,commands:[]});
   if(path==='/ai/codex-bridge'&&body)return Response.json({state:'completed',model:'Fixture sintética',included_scan_notes:0});
   return Response.json({state:{phase:'stopped',revision:0},integration:{ready:false},history:[],chat_history:[],missing:[]});
  };
 });
 await page.addScriptTag({content:PANEL_JS});
 await page.waitForFunction(()=>typeof window.qaReleaseInitial==='function');
 // Select B while A has not completed. The new channel must load immediately.
 await page.locator('#menu').click();await page.locator('.chan').nth(1).click();
 await page.waitForFunction(()=>document.querySelector('#feed').textContent.includes('Mensagem do canal B'));
 await page.evaluate(()=>window.qaReleaseInitial());
 await page.waitForTimeout(100);
 assert.match(await page.locator('#feed').innerText(),/Mensagem do canal B/);
 assert.doesNotMatch(await page.locator('#feed').innerText(),/Mensagem do canal A/);
 // Send once; change channel and draft before the receipt arrives.
 await page.locator('#message').fill('Mensagem enviada apenas na fixture');await page.locator('#send').click();
 await page.waitForFunction(()=>typeof window.qaReleaseSend==='function');
 await page.locator('#menu').click();await page.locator('.chan').nth(0).click();
 await page.locator('#message').fill('Meu novo rascunho');
 await page.evaluate(()=>window.qaReleaseSend());
 await page.waitForFunction(()=>!document.querySelector('#send').disabled);
 assert.equal(await page.locator('#message').inputValue(),'Meu novo rascunho');
 assert.match(await page.locator('#status').innerText(),/Entrega confirmada no canal 999999999999999999/);
 let sends=await page.evaluate(()=>window.qaRequests.filter(r=>r.path.includes('/messages')&&r.body));
 assert.equal(sends.length,1);assert.ok(sends[0].path.includes('/999999999999999999/'));
 // A non-confirmed send never clears the draft or displays delivery success.
 await page.evaluate(()=>{window.qaHoldSend=false;window.qaFailSend=true;});
 await page.locator('#send').click();await page.waitForFunction(()=>!document.querySelector('#send').disabled);
 assert.equal(await page.locator('#message').inputValue(),'Meu novo rascunho');
 assert.match(await page.locator('#status').innerText(),/Envio não confirmado/);
 await page.locator('#sendReceipt').click();
 assert.match(await page.locator('#status').innerText(),/Nenhum reenvio/);
 // A real File/FormData goes through the actual panel, but only to the synthetic fetch.
 await page.evaluate(()=>window.qaFailSend=false);await page.locator('#message').fill('');
 await page.locator('#messageFiles').setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0])});
 await page.locator('#send').click();await page.waitForFunction(()=>!document.querySelector('#send').disabled);
 assert.equal(await page.locator('#messageFiles').evaluate(e=>e.files.length),0);
 const upload=await page.evaluate(()=>window.qaRequests.find(r=>r.files?.includes('fixture.png')));assert.ok(upload);assert.ok(upload.body.request_id);
 // A public autoplay click reports its exact missing integration and never starts the personal executor.
 await page.locator('#autoplayStart').click();
 await page.waitForFunction(()=>document.querySelector('#autoplayEvidence').open);
 assert.match(await page.locator('#autoplayStatus').innerText(),/BUSHIN_GAME_APPROVAL/);
 assert.match(await page.locator('#autoplayIntegration').innerText(),/BUSHIN_GAME/);
 assert.equal(await page.evaluate(()=>window.qaRequests.filter(r=>r.body&&/ai\/(?:opencode|command-session)/.test(r.path)).length),0);
 await page.evaluate(()=>window.qaPersonalMode=true);await page.locator('#autoplayRefresh').click();
 await page.waitForFunction(()=>document.querySelector('#autoplayIntegration').textContent.includes('executor: offline'));
 await page.locator('#autoplayMissing summary').click();
 assert.match(await page.locator('#autoplayIntegration').innerText(),/credencial: configurada/);
 assert.match(await page.locator('#autoplayIntegration').innerText(),/Não é uma integração oficial/);
 // Check normal and keyboard-sized viewports. This does not emulate a native Android keyboard.
 await page.locator('#autoplayEvidence').evaluate(e=>e.open=false);
 const layout=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,sendHeight:document.querySelector('#send').getBoundingClientRect().height}));
 assert.equal(layout.width,layout.scrollWidth);assert.ok(layout.sendHeight>=44);
 await page.setViewportSize({width:390,height:480});await page.locator('#message').focus();
 const reduced=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:innerHeight,composerBottom:document.querySelector('#message').getBoundingClientRect().bottom}));
 assert.equal(reduced.width,reduced.scrollWidth);assert.ok(reduced.composerBottom<=reduced.height);
 assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
 if(process.argv[2])await page.screenshot({path:process.argv[2],fullPage:true});
 console.log(JSON.stringify({mode:'all APIs synthetic; zero external network requests',checks:['delayed channel switch','stale read ignored','send stays in original channel','new draft preserved','unconfirmed send retains draft','read-only receipt lookup','image-only FormData upload','exact integration block','no unsolicited executor dispatch','44px touch target','no horizontal overflow','composer at reduced height'],layout,reduced,pageErrors:errors},null,2));
}finally{await browser.close();}
