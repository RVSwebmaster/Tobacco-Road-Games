
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const os=require('node:os');
const path=require('node:path');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const host=process.env.TRG_REHEARSAL_ORIGIN; if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(host)) throw Error('Loopback required');
const user='rehearsal-customer@example.invalid';
const pass=process.env.TRG_REHEARSAL_PASSWORD;
async function main(){
 const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>fs.existsSync(p));
 assert.ok(chrome,'Chromium unavailable');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'trg-customer-nav-'));
 const browser=spawn(chrome,['--headless=new','--disable-background-networking','--disable-extensions','--no-first-run','--remote-debugging-port=0','--user-data-dir='+temp,'about:blank'],{stdio:'ignore'});
 let socket;
 try{
  let port;
  for(let i=0;i<90&&!port;i++){try{port=fs.readFileSync(path.join(temp,'DevToolsActivePort'),'utf8').split(/\r?\n/)[0]}catch{await wait(100)}}
  assert.ok(port,'DevTools unavailable');
  const pages=await fetch('http://127.0.0.1:'+port+'/json/list').then(r=>r.json());
  socket=new WebSocket(pages.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
  let id=0, eventError, logoutRequests=0, logoutDestination, logoutStatus, loginStatus;
  const pending=new Map();
  const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))});
  socket.onmessage=({data})=>{
   const m=JSON.parse(data), p=m.params||{};
   if(m.id){const task=pending.get(m.id);pending.delete(m.id);if(task)m.error?task.reject(new Error(m.error.message)):task.resolve(m.result);return}
   if(m.method==='Fetch.requestPaused'){
    const {requestId,request}=p; const u=new URL(request.url);
    if(u.href==='https://tobaccoroadgames.com/' && p.resourceType==='Document') logoutDestination=u.href;
    const action=u.origin!==host ? send('Fetch.failRequest',{requestId,errorReason:'BlockedByClient'})
      : send('Fetch.continueRequest',{requestId});
    if(u.origin===host && u.pathname==='/api/auth/logout' && request.method==='POST') logoutRequests++;
    action.catch(()=>{eventError='Request interception failed'});
   }
   if(m.method==='Network.responseReceived'){
    if(p.response.url===host+'/api/auth/login') loginStatus=p.response.status;
    if(p.response.url===host+'/api/auth/logout') logoutStatus=p.response.status;
   }
   if(m.method==='Page.javascriptDialogOpening'){eventError='Browser reported a logout error';send('Page.handleJavaScriptDialog',{accept:true}).catch(()=>{});}
  };
  await send('Page.enable');await send('Network.enable');
  await send('Fetch.enable',{patterns:[{urlPattern:'http*',requestStage:'Request'}]});
  const evalJS=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw new Error('Browser evaluation failed');return r.result?.value};
  const until=async (expr,label)=>{for(let i=0;i<100;i++){if(eventError)throw new Error(eventError);try{if(await evalJS(expr))return}catch{}await wait(125)}throw new Error(label+' (login HTTP '+(loginStatus??'none')+', logout HTTP '+(logoutStatus??'none')+')')};

  await send('Page.navigate',{url:host+'/guest/'});
  const trigger='document.querySelector(".site-nav a[aria-controls=guest-login]")';
  await until('location.origin==='+JSON.stringify(host)+' && !!'+trigger,'Guest popup unavailable');
  assert.equal(await evalJS('Array.from(document.querySelectorAll(".site-nav a")).some(a=>a.textContent==="Profile")'),false);
  await evalJS(trigger+'.click()');
  await evalJS(`(()=>{if(location.origin!==${JSON.stringify(host)})throw Error("Origin guard");const f=document.querySelector("#guest-login form");f.elements.email.value=${JSON.stringify(user)};f.elements.password.value=${JSON.stringify(pass)};f.requestSubmit();})()`);
  const profile='Array.from(document.querySelectorAll("[data-progressive-navigation] a")).find(a=>a.textContent==="Profile")';
  await until('location.origin==='+JSON.stringify(host)+' && location.pathname==="/customer" && !!('+profile+')','Authenticated Profile link did not appear');
  assert.equal(loginStatus,200);
  assert.equal(await evalJS('('+profile+').pathname'),'/customer-profile/');
  assert.equal(await evalJS('document.querySelector("[data-progressive-navigation]").textContent.includes("Login/Signup")'),false);
  assert.equal(await evalJS('fetch("/api/account/me").then(r=>r.json()).then(p=>p.authenticated && p.user.accountClass==="customer")'),true);
  await evalJS('('+profile+').click()').catch(()=>{});
  await until('location.origin==='+JSON.stringify(host)+' && location.pathname==="/customer-profile/" && document.querySelector("[data-member-identity-name]")?.textContent==="Release customer"','Profile did not show the signed-in identity');
  await send('Page.navigate',{url:host+'/customer'});
  await until('location.origin==='+JSON.stringify(host)+' && !!('+profile+')','Authenticated storefront did not reopen');
  await evalJS('document.querySelector("[data-customer-logout]").click()').catch(()=>{});
  for(let i=0;i<50&&!logoutDestination;i++) await wait(100);
  assert.equal(logoutRequests,1);
  assert.equal(logoutStatus,200);
  assert.equal(logoutDestination,'https://tobaccoroadgames.com/');
  await send('Page.navigate',{url:host+'/guest/'});
  await until('location.origin==='+JSON.stringify(host)+' && location.pathname==="/guest/" && !!document.querySelector("[data-guest-landing]")','Could not return to isolated Guest');
  assert.equal(await evalJS('fetch("/api/account/me",{cache:"no-store"}).then(r=>r.json()).then(p=>p.authenticated)'),false);
  console.log(JSON.stringify({loginHttp:loginStatus,profileLinkAuthenticated:true,profileRoute:'/customer-profile/',recognizedMember:true,logoutHttp:logoutStatus,logoutDestination,liveHomepageRequestBlocked:true,sessionEnded:true}));
 }finally{
  socket?.close();
  if(browser.pid)spawn('taskkill',['/pid',String(browser.pid),'/T','/F'],{stdio:'ignore'});
  await wait(600);
  const target=path.resolve(temp);
  if(path.dirname(target)===path.resolve(os.tmpdir()) && path.basename(target).startsWith('trg-customer-nav-')) fs.rmSync(target,{recursive:true,force:true,maxRetries:3});
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
