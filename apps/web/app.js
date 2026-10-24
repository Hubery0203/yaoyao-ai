const $=s=>document.querySelector(s);
const state={token:null,userId:null,email:'',generation:0,messages:[],pending:null,sending:false,register:false,tab:'saved',memories:[],audits:[],memoryTotal:0,memoryRequest:0,memoryDetail:null,memoryEdit:null,detailRequest:0,renewing:null};
let prefs={nickname:'',enter:true};try{const stored=JSON.parse(localStorage.getItem('yaoyao.preferences')||'null');if(stored&&typeof stored.nickname==='string'&&typeof stored.enter==='boolean')prefs=stored;}catch{localStorage.removeItem('yaoyao.preferences');}
const titles={chat:'和遥遥聊聊',history:'一起聊过的',memories:'记在心里的',settings:'连接与偏好'};
function node(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
let noticeTimer;function notice(text){$('#notice').textContent=text;$('#notice').classList.remove('hidden');clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('#notice').classList.add('hidden'),6000);}
function errorText(error){return error.message||'连接暂时不顺畅，请稍后再试。';}
async function raw(path,options={}){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),120000);try{const r=await fetch(path,{...options,signal:controller.signal,headers:{'Content-Type':'application/json',...options.headers},cache:'no-store'});let body;try{body=await r.json();}catch{throw new Error('服务返回了无法识别的响应，请检查后端连接。');}return {r,body};}catch(e){if(e.name==='AbortError')throw new Error('等待回复超时，可以用原消息重试。');throw e;}finally{clearTimeout(timer);}}
function acceptAuth(data){state.token=data.accessToken;state.userId=data.userId;sessionStorage.setItem('yaoyao.refresh',data.refreshToken);sessionStorage.setItem('yaoyao.user',data.userId);}
async function renew(){if(!state.renewing)state.renewing=(async()=>{const generation=state.generation;const refreshToken=sessionStorage.getItem('yaoyao.refresh');if(!refreshToken)throw new Error('请先登录。');const {r,body}=await raw('/api/v1/auth/refresh',{method:'POST',body:JSON.stringify({refreshToken})});if(!r.ok)throw new Error('登录已过期，请重新登录。');if(generation!==state.generation)throw new Error('账户已切换。');acceptAuth(body.data);})().finally(()=>{state.renewing=null;});return state.renewing;}
async function api(path,options={},retry=true){const generation=state.generation;const {r,body}=await raw('/api/v1'+path,{...options,headers:{Authorization:'Bearer '+state.token,...options.headers}});if(generation!==state.generation)throw new Error('账户已切换。');if(r.status===401&&retry){try{await renew();}catch{if(generation!==state.generation)throw new Error('账户已切换。');clearAccount();if(!$('#auth').open)$('#auth').showModal();throw new Error('请重新登录后继续。');}return api(path,options,false);}if(!r.ok){const code=body.error?.code||body.code;throw new Error(code==='STALE_WRITE'?'这条记忆已变化，请刷新后重新查看。':code==='IDEMPOTENCY_KEY_REUSED'?'本次重试的内容不一致，请刷新记忆后再操作。':code==='DOMAIN_INVARIANT'?'请填写一条明确的同类事实，例如更正住址，或把喜欢改成不喜欢；复杂变化可在聊天中说明。':r.status===429?'操作有些频繁，稍等一会再试。':r.status===401?'邮箱或密码不正确。':r.status===503?'后端暂时无法连接。':code==='DUPLICATE_ENTITY'?'这个邮箱已经注册，请直接登录。':code==='VALIDATION_FAILED'?'请检查填写的内容。':body.error?.message||'操作未完成，请稍后再试。');}return body;}
function clearAccount(){state.generation++;state.token=null;state.userId=null;state.email='';$('#message').value='';$('#password').value='';state.messages=[];state.memories=[];state.audits=[];state.memoryTotal=0;state.memoryRequest++;state.detailRequest++;state.memoryDetail=null;state.memoryEdit=null;$('#memory-detail').close();$('#memory-detail-body').replaceChildren();$('#pending-count').textContent='0';state.pending=null;state.sending=false;sessionStorage.removeItem('yaoyao.refresh');sessionStorage.removeItem('yaoyao.user');sessionStorage.removeItem('yaoyao.pending');$('#account-name').replaceChildren(node('span','登录我们的空间'),node('small','你的对话，只属于你'));$('#user-id').textContent='尚未登录';$('#model-state').textContent='登录后查看';$('#weixin-state').textContent='登录后查看';$('#weixin-code').textContent='';$('#weixin-deliveries').replaceChildren();$('#weixin-bind').hidden=true;$('#weixin-toggle').hidden=true;renderMessages();renderHistory();renderMemories();}
function requireLogin(){if(state.token)return true;$('#auth').showModal();return false;}
function view(){const v=titles[location.hash.slice(1)]?location.hash.slice(1):'chat';document.querySelectorAll('.view').forEach(n=>n.classList.toggle('hidden',n.id!==v));document.querySelectorAll('nav a').forEach(n=>n.classList.toggle('active',n.dataset.view===v));$('#page-title').textContent=titles[v];if(state.token&&v==='memories')loadMemories().catch(e=>notice(errorText(e)));if(state.token&&v==='settings')loadConnection().catch(e=>notice(errorText(e)));}
function updateAccount(){const label=prefs.nickname||state.email||'我的空间';$('#account-name').replaceChildren(node('span',label),node('small','已登录 · 私人空间'));$('#user-id').textContent=state.userId;}
function renderMessages(){const list=$('#messages');list.replaceChildren();if(!state.messages.length&&!state.pending){const box=node('div',undefined,'welcome');box.append(node('span','A LITTLE SPACE, JUST FOR US','eyebrow'),node('h2',state.token?'今天过得怎么样？':'给彼此，留一点时间'),node('p',state.token?'想说的话、遇到的小事，或只是打个招呼。':'登录后，我们就从今天开始聊。'));const btn=node('button',state.token?'今天想和你聊聊 ↗':'登录我们的空间 ↗','secondary');btn.onclick=()=>{if(requireLogin()){$('#message').value='今天想和你聊聊';$('#message').focus();}};box.append(btn);list.append(box);}
for(const m of state.messages){if(state.pending&&m.requestId===state.pending.id&&m.role==='user')continue;const row=node('div',undefined,'bubble-row '+m.role);const bubble=node('div',m.text,'bubble');bubble.append(node('small',new Date(m.occurredAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})));row.append(node('span',m.role==='user'?'你':'遥','avatar'),bubble);list.append(row);}
if(state.pending){const row=node('div',undefined,'bubble-row user');const bubble=node('div',state.pending.text,'bubble');bubble.append(node('small',state.sending?'正在等遥遥的回复…':'尚未确认发送结果'));if(!state.sending){const b=node('button','用原消息重试 ↻','secondary');b.onclick=()=>sendPending();bubble.append(b);}row.append(node('span','你','avatar'),bubble);list.append(row);}list.scrollTop=list.scrollHeight;$('#compose button').disabled=state.sending;}
async function loadMessages(older=false){const offset=older?state.messages.length:0;const res=await api('/conversations/messages?limit=100&offset='+offset);const incoming=res.data.messages;state.messages=older?[...incoming,...state.messages]:incoming;if(state.pending&&state.messages.some(m=>m.role==='assistant'&&m.requestId===state.pending.id)){state.pending=null;sessionStorage.removeItem('yaoyao.pending');}$('#older').disabled=state.messages.length>=res.data.total;renderMessages();renderHistory();}
function renderHistory(){const q=$('#history-search').value.toLowerCase();const list=$('#history-list');list.replaceChildren();const filtered=state.messages.filter(m=>m.text.toLowerCase().includes(q));if(!filtered.length){list.append(node('div',state.token?'还没有符合条件的对话。':'登录后可以查看之前的对话。','empty'));return;}for(const m of [...filtered].reverse()){const card=node('article',undefined,'history-card');card.append(node('h3',(m.role==='user'?'你':'遥遥')+' · '+new Date(m.occurredAt).toLocaleString('zh-CN')),node('p',m.text,m.role==='user'?'user-text':''));list.append(card);}}
async function sendPending(){if(!requireLogin()||state.sending||!state.pending)return;const pending=state.pending;const generation=state.generation;state.sending=true;renderMessages();try{await api('/conversations/messages',{method:'POST',headers:{'Idempotency-Key':pending.id},body:JSON.stringify({text:pending.text})});if(generation!==state.generation)return;state.pending=null;sessionStorage.removeItem('yaoyao.pending');await loadMessages();}catch(e){if(generation===state.generation)notice(errorText(e));}finally{if(generation===state.generation){state.sending=false;renderMessages();}}}
$('#compose').onsubmit=e=>{e.preventDefault();if(!requireLogin())return;if(state.pending){notice('请先确认上一条消息的发送结果。');return;}const text=$('#message').value.trim();if(!text)return;state.pending={id:crypto.randomUUID(),text,userId:state.userId};sessionStorage.setItem('yaoyao.pending',JSON.stringify(state.pending));$('#message').value='';sendPending();};
$('#message').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&prefs.enter){e.preventDefault();$('#compose').requestSubmit();}};
const memoryLabels={CORE:'重要记忆',SEMANTIC:'关于你',EPISODIC:'经历',SHARED_LIFE:'共同计划'};
const heldReasons={uncertain_interpretation:'这句话带有不确定含义，需要你确认后才会记为事实。',conflict_needs_confirmation:'与现有记忆不同，先由你决定。',awaiting_core_confirmation:'重要记忆需要你亲自确认。',older_than_current_memory:'这条消息早于当前记忆，确认前请先核对。'};
function displayTime(value){const d=new Date(value);return Number.isNaN(d.getTime())?'时间未知':d.toLocaleString('zh-CN');}
function renderMemories(){
 const list=$('#memory-list');list.replaceChildren();
 const rows=['saved','history'].includes(state.tab)?state.memories:state.audits;
 $('#memory-summary').textContent=state.token?({saved:'当前生效的记忆。可以查看原话、纠正历史或提交明确纠正。',history:'被纠正的旧版本只用于回看，不作为当前偏好。',pending:'这些内容还不是已确认事实；请核对原话后决定。',resolved:'你已经处理过的候选记录。'})[state.tab]:'登录后查看属于你的记忆。';
 $('#more-memories').classList.toggle('hidden',!state.token||rows.length>=state.memoryTotal);
 if(!rows.length){list.append(node('div',state.token?({saved:'值得记住的小事，会慢慢出现在这里。',history:'目前没有被纠正的旧版本。',pending:'目前没有需要你确认的记忆。',resolved:'目前没有已处理的候选。'})[state.tab]:'登录后查看属于你的记忆。','empty'));return;}
 for(const row of rows){
  const card=node('article',undefined,'memory-card');
  if(['saved','history'].includes(state.tab)){
   card.append(node('span',state.tab==='history'?'已被纠正':memoryLabels[row.type]||'记忆','tag'),node('p',row.content),node('small',(row.version>1?'最近更新：':'记于：')+displayTime(row.updatedAt)));
   const b=node('button','查看原话与纠正历史','secondary');b.onclick=()=>openMemory(row.memoryId);card.append(b);
  }else{
   const resolved=!!row.resolution;
   card.append(node('span',resolved?(row.resolution.decision==='confirm'?'已确认':'已放弃'):'待确认 · 尚非事实','tag'),node('p',row.audit.candidate.content),node('blockquote','原话：'+row.audit.candidate.evidence),node('small',displayTime(row.created_at)),node('p',resolved?(row.resolution.decision==='confirm'?'你已确认这条候选，来源与处理记录已保留。':'这条候选未被记为事实，原话与放弃记录已保留。'):(heldReasons[row.audit.reason]||'需要你确认后再处理。'),'memory-help'));
   const actions=node('div',undefined,'actions');
   if(resolved&&row.resolution.memoryId){const b=node('button','查看确认后的记忆','secondary');b.onclick=()=>openMemory(row.resolution.memoryId);actions.append(b);}
   if(!resolved)for(const [decision,label]of [['confirm','确认记住'],['discard','放弃这条']]){
    const b=node('button',label,decision==='confirm'?'primary':'secondary');
    b.onclick=async()=>{actions.querySelectorAll('button').forEach(n=>n.disabled=true);const generation=state.generation;try{
     await api(`/memories/candidates/${row.job_id}/${row.ordinal}/resolve`,{method:'POST',body:JSON.stringify({decision})});
     if(generation!==state.generation)return;await loadMemories();notice(decision==='confirm'?'已经确认这条记忆。':'已放弃这条候选，原话和处理记录仍保留。');
    }catch(e){if(generation===state.generation){notice(errorText(e));actions.querySelectorAll('button').forEach(n=>n.disabled=false);}}};actions.append(b);
   }
   card.append(actions);
  }
  list.append(card);
 }
}
async function loadMemories(more=false){
 const tab=state.tab,generation=state.generation,id=++state.memoryRequest;
 const isMemory=['saved','history'].includes(tab),rows=isMemory?state.memories:state.audits;
 const offset=more?rows.length:0;
 const path=isMemory?'/memories?status='+(tab==='saved'?'CONSOLIDATED':'CORRECTED')+'&limit=50&offset='+offset:'/memories/review?status='+(tab==='pending'?'pending':'resolved')+'&limit=50&offset='+offset;
 $('#more-memories').disabled=true;
 try{
  const [page,pending]=await Promise.all([api(path),api('/memories/review?status=pending&limit=1')]);
  if(generation!==state.generation||id!==state.memoryRequest||tab!==state.tab)return;
  if(isMemory)state.memories=more?[...state.memories,...page.data.memories]:page.data.memories;
  else state.audits=more?[...state.audits,...page.data.rows]:page.data.rows;
  state.memoryTotal=page.data.total;$('#pending-count').textContent=pending.data.pendingTotal;renderMemories();
 }finally{if(id===state.memoryRequest)$('#more-memories').disabled=false;}
}
async function openMemory(memoryId){
 if(!requireLogin())return;const request=++state.detailRequest;
 state.memoryDetail=null;state.memoryEdit=null;$('#memory-correction').classList.add('hidden');$('#memory-detail-body').replaceChildren(node('p','正在读取记忆…'));$('#correction-error').textContent='';
 if(!$('#memory-detail').open)$('#memory-detail').showModal();
 try{
  const {data}=await api('/memories/'+encodeURIComponent(memoryId)+'/detail');if(request!==state.detailRequest)return;
  state.memoryDetail=data;const box=$('#memory-detail-body');box.replaceChildren();
  box.append(node('span',data.memory.status==='CONSOLIDATED'?'当前记忆':'历史版本','tag'),node('p',data.memory.content,'detail-content'),node('small','最近更新：'+displayTime(data.memory.updatedAt)),node('h3','这条记忆的来源'));
  if(!data.sources.length)box.append(node('p','这条旧记忆没有可展示的原话来源。'));
  for(const source of data.sources){box.append(node('blockquote',source.text),node('small',(source.kind==='owner_correction'?'你在记忆页面提交 · ':'你在聊天中说 · ')+displayTime(source.occurredAt)));}
  if(data.sourcesTruncated)box.append(node('p','这里只展示前 10 条来源。'));
  box.append(node('h3','纠正历史'));
  if(!data.history.length)box.append(node('p','这是可追溯的首个版本。'));
  for(const h of data.history){const b=node('button','旧版本 · '+h.content,'history-version');b.onclick=()=>openMemory(h.memoryId);box.append(b);}
  if(data.historyTruncated)box.append(node('p','这里只展示最近 20 个旧版本，可点开最早的一条继续查看。'));
  $('#memory-correction').classList.toggle('hidden',!data.canCorrect);
  $('#correction-text').value='';$('#correction-text').disabled=false;$('#correction-submit').disabled=false;
  $('#close-memory-detail').focus({preventScroll:true});$('#memory-detail').scrollTop=0;
  if(!data.canCorrect)box.append(node('p',data.memory.status==='CONSOLIDATED'?'这条记忆暂不支持直接纠正；可以在聊天中说明变化。':'旧版本只供回看，请从当前记忆提交纠正。','memory-help'));
 }catch(e){if(request===state.detailRequest)$('#memory-detail-body').replaceChildren(node('p',errorText(e),'error'));}
}
$('#close-memory-detail').onclick=()=>{$('#memory-detail').close();state.detailRequest++;};
$('#memory-detail').addEventListener('close',()=>{state.detailRequest++;});
$('#memory-correction').onsubmit=async e=>{
 e.preventDefault();if(!requireLogin()||!state.memoryDetail?.canCorrect)return;
 const text=$('#correction-text').value.trim(),memory=state.memoryDetail.memory;if(!text)return;
 const generation=state.generation;
 if(!state.memoryEdit||state.memoryEdit.text!==text||state.memoryEdit.memoryId!==memory.memoryId)state.memoryEdit={id:crypto.randomUUID(),memoryId:memory.memoryId,text,expectedVersion:memory.version};
 const edit=state.memoryEdit;$('#correction-submit').disabled=true;$('#correction-text').disabled=true;$('#correction-error').textContent='';
 try{
  const {data}=await api('/memories/'+encodeURIComponent(edit.memoryId)+'/correct',{method:'POST',headers:{'Idempotency-Key':edit.id},body:JSON.stringify({text:edit.text,expectedVersion:edit.expectedVersion})});
  if(generation!==state.generation)return;state.memoryEdit=null;
  await loadMemories();await openMemory(data.memoryId);notice('已更新当前记忆，旧版本和你的纠正原话都已保留。');
 }catch(error){if(generation===state.generation){$('#correction-error').textContent=errorText(error);$('#correction-submit').disabled=false;$('#correction-text').disabled=false;}}
};
async function health(){try{const {r,body}=await raw('/health/ready');if(!r.ok||body.status!=='ok'||body.checks?.some(c=>c.name==='database'&&c.status!=='ok'))throw new Error();$('#connection').classList.add('online');$('#connection').lastChild.textContent='后端已连接';$('#api-state').textContent='已连接 · 遥遥后端';return body;}catch{$('#connection').classList.remove('online');$('#connection').lastChild.textContent='后端未连接';$('#api-state').textContent='未连接 · 请启动 API 和数据库';}}
async function loadConnection(){await health();if(state.token){const res=await api('/conversations/connection');$('#model-state').textContent=res.data.provider==='mock'?'演示模型（Mock）':res.data.provider+' · '+res.data.model;await loadWeixin();}}
async function hydrate(){updateAccount();try{const pending=JSON.parse(sessionStorage.getItem('yaoyao.pending')||'null');state.pending=pending?.userId===state.userId?pending:null;}catch{sessionStorage.removeItem('yaoyao.pending');}const results=await Promise.allSettled([loadMessages(),loadMemories(),loadConnection()]);for(const r of results)if(r.status==='rejected')notice(errorText(r.reason));view();}
$('#auth-form').onsubmit=async e=>{e.preventDefault();const button=$('#auth-submit');button.disabled=true;$('#auth-error').textContent='';try{const email=$('#email').value.trim(),password=$('#password').value;const payload=JSON.stringify({email,password});if(state.register){const reg=await raw('/api/v1/users',{method:'POST',body:payload});if(!reg.r.ok)throw new Error(reg.r.status===409?'邮箱已注册，请切换到登录。':'注册未完成，请检查连接和填写的内容。');}const {r,body}=await raw('/api/v1/auth/login',{method:'POST',body:payload});if(!r.ok)throw new Error(r.status===429?'操作频繁，请稍后再登录。':r.status===503?'后端暂时无法连接，请启动 API 和数据库。':'邮箱或密码不正确。');state.generation++;state.email=email;acceptAuth(body.data);$('#password').value='';$('#auth').close();await hydrate();}catch(error){$('#auth-error').textContent=errorText(error);}finally{button.disabled=false;}};
$('#switch-auth').onclick=()=>{state.register=!state.register;$('#auth-title').textContent=state.register?'从今天，开始认识你':'很高兴，又见到你';$('#auth-submit').textContent=state.register?'创建账户并登录':'登录';$('#switch-auth').textContent=state.register?'已经有账户？登录':'第一次来？创建账户';$('#password').autocomplete=state.register?'new-password':'current-password';$('#auth-error').textContent='';};
$('#account').onclick=()=>state.token?location.hash='settings':$('#auth').showModal();$('#close-auth').onclick=()=>$('#auth').close();$('#logout').onclick=async()=>{if(!state.token)return;try{await api('/auth/logout',{method:'POST',body:JSON.stringify({refreshToken:sessionStorage.getItem('yaoyao.refresh')})});}catch{notice('本页已退出，服务端会话撤销未确认。');}finally{clearAccount();}};
$('#preferences').onsubmit=e=>{e.preventDefault();prefs.nickname=$('#nickname').value.trim();prefs.enter=$('#enter-send').checked;localStorage.setItem('yaoyao.preferences',JSON.stringify(prefs));if(state.token)updateAccount();$('#compose-hint').textContent=prefs.enter?'Enter 发送 · Shift + Enter 换行':'点击发送按钮发送消息';notice('偏好已保存。');};
$('#compose-hint').textContent=prefs.enter?'Enter 发送 · Shift + Enter 换行':'点击发送按钮发送消息';$('#nickname').value=prefs.nickname;$('#enter-send').checked=prefs.enter;$('#older').onclick=()=>{if(requireLogin())loadMessages(true).catch(e=>notice(errorText(e)));};$('#history-search').oninput=renderHistory;$('#more-memories').onclick=()=>loadMemories(true).catch(e=>notice(errorText(e)));$('#check').onclick=()=>loadConnection().catch(e=>notice(errorText(e)));document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{state.tab=b.dataset.tab;state.memories=[];state.audits=[];state.memoryTotal=0;document.querySelectorAll('[data-tab]').forEach(n=>n.classList.toggle('active',n===b));renderMemories();if(requireLogin())loadMemories().catch(e=>notice(errorText(e)));});document.querySelectorAll('[data-prompt]').forEach(b=>b.onclick=()=>{if(requireLogin()){$('#message').value=b.dataset.prompt;$('#message').focus();}});window.addEventListener('hashchange',view);view();health();renderMessages();renderHistory();renderMemories();if(sessionStorage.getItem('yaoyao.refresh')){const generation=state.generation;renew().then(()=>{if(generation===state.generation)return hydrate();}).catch(()=>{if(generation===state.generation){clearAccount();notice('请重新登录。');}});}

async function loadWeixin(){
 if(!requireLogin())return;
 const {data}=await api('/weixin');
 $('#weixin-state').textContent=!data.enabled?'微信通道尚未启用。':!data.bound?(data.available?'尚未绑定：生成绑定码后，在微信 ClawBot 发送下方指令。':'此微信通道已绑定其他账号。'):data.authExpired?'微信授权已失效，需要重新扫码。':data.paused?'已暂停。恢复后继续处理排队消息。':data.error?'通道等待恢复：'+data.error:'已绑定，正在接收新消息。';
 $('#weixin-bind').hidden=!data.enabled||!data.available||data.bound;
 $('#weixin-toggle').hidden=!data.bound;$('#weixin-toggle').textContent=data.paused?'恢复':'暂停';
 $('#weixin-toggle').onclick=()=>weixinAction('/control',{action:data.paused?'resume':'pause'});
 if(data.bound)$('#weixin-code').textContent='';
 const list=$('#weixin-deliveries');list.replaceChildren();
 for(const d of data.deliveries||[]){
  if(!['uncertain','failed'].includes(d.stage))continue;
  const card=node('div',undefined,'history-card');card.append(node('p',new Date(d.created_at).toLocaleString('zh-CN')+' · '+(d.stage==='uncertain'?'发送结果待确认，请先检查微信。':'处理失败，可重试或跳过。')));
  const choices=d.stage==='uncertain'?[['confirm','微信已收到'],['retry','重新发送'],['skip','跳过']]:[['retry','重试'],['skip','跳过']];
  for(const [action,label] of choices){const b=node('button',label,'secondary');b.onclick=()=>{if(action==='retry'&&d.stage==='uncertain'&&!confirm('原回复可能已送达。重新发送可能在微信中产生重复消息，是否继续？'))return;weixinAction('/deliveries/'+d.key+'/resolve',{action});};card.append(b);}
  list.append(card);
 }
}
async function weixinAction(path,body){if(!requireLogin())return;try{await api('/weixin'+path,{method:'POST',body:JSON.stringify(body)});await loadWeixin();}catch(e){notice(errorText(e));}}
$('#weixin-refresh').onclick=()=>loadWeixin().catch(e=>notice(errorText(e)));
$('#weixin-bind').onclick=async()=>{if(!requireLogin())return;try{const {data}=await api('/weixin/binding-code',{method:'POST'});$('#weixin-code').textContent='请在微信 ClawBot 发送：绑定 '+data.code+'（10 分钟内有效）';}catch(e){notice(errorText(e));}};
