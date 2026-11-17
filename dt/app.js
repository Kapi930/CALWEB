const $=id=>document.getElementById(id), enc=new TextEncoder(), dec=new TextDecoder();
const b64=bytes=>{const view=new Uint8Array(bytes);let text='';for(let i=0;i<view.length;i+=32768)text+=String.fromCharCode(...view.subarray(i,i+32768));return btoa(text);}, un64=text=>Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const dayText=day=>new Date(day+'T12:00:00').toLocaleDateString('es-ES');
let store, pairing, key, snapshot, session, profile, pending=[], device, busy=false, cloudToken, verifier, desktopUI, localQueueUser, localQueueKey;
const local=location.hostname==='127.0.0.1'||location.hostname==='localhost'||document.documentElement.dataset.conexion==='pc';
const connection=()=>{ $('connection').hidden=false;$('login').hidden=true;$('workspace').hidden=true; };
function status(text){$('status').textContent=text;}
function showError(error){status(error.message||'No se pudo completar la operación. Los cambios se conservan.');}
function node(tag,text,className){const value=document.createElement(tag);if(text!==undefined)value.textContent=text;if(className)value.className=className;return value;}
function storage(mode,action){return new Promise((resolve,reject)=>{const transaction=store.transaction('datos',mode);let result;try{result=action(transaction.objectStore('datos'));}catch(e){reject(e);return;}transaction.oncomplete=()=>resolve(result?.result);transaction.onerror=()=>reject(new Error('No se pudo guardar en este dispositivo. Comprueba el espacio disponible.'));});}
const read=name=>storage('readonly',s=>s.get(name)), write=(name,value)=>storage('readwrite',s=>s.put(value,name));
async function seal(body,kind){const nonce=crypto.getRandomValues(new Uint8Array(12)),aad=enc.encode(JSON.stringify(['DT',1,pairing.dataset,pairing.user,kind]));const data=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:aad},key,enc.encode(JSON.stringify(body)));return{v:1,dataset:pairing.dataset,user:pairing.user,kind,nonce:b64(nonce),data:b64(data)};}
async function open(envelope,kind){if(envelope?.v!==1||envelope.dataset!==pairing.dataset||envelope.user!==pairing.user||envelope.kind!==kind)throw new Error('El archivo no pertenece a este operario.');try{return JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(envelope.nonce),additionalData:enc.encode(JSON.stringify(['DT',1,pairing.dataset,pairing.user,kind]))},key,un64(envelope.data))));}catch{throw new Error('No se pudo comprobar el archivo cifrado. Se conserva la copia anterior.');}}
async function saveCache(){
 if(pairing)await write('cache',await seal({snapshot,pending},'cache'));
 else if(profile){
  const localKey=await getLocalQueueKey(),nonce=crypto.getRandomValues(new Uint8Array(12));
  const raw=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:enc.encode('DT-local-'+profile.operario)},localKey,enc.encode(JSON.stringify(pending)));
  await write('localQueue-'+profile.operario,{nonce:b64(nonce),data:b64(raw)});
 }
}
async function api(path,method='GET',body,headers={}){const response=await fetch('/api/v1/'+path,{method,headers:{...(session?{Authorization:'Bearer '+session}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined,cache:'no-store'});const data=await response.json();if(!response.ok){const error=new Error(data.error||'No se pudo completar la operación.');error.status=response.status;throw error;}return data;}
function timeoutFetch(url,options={}){return fetch(url,{...options,signal:AbortSignal.timeout(25000),referrerPolicy:'no-referrer'});}
async function token(){if(cloudToken&&cloudToken.expires>Date.now()+60000)return cloudToken.access_token;if(!cloudToken?.refresh_token)throw new Error('Conecta Dropbox para sincronizar.');const response=await timeoutFetch('https://api.dropboxapi.com/oauth2/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',refresh_token:cloudToken.refresh_token,client_id:pairing.app_key})});if(!response.ok)throw new Error('Dropbox requiere volver a conectar la cuenta.');const data=await response.json();cloudToken={...cloudToken,...data,expires:Date.now()+data.expires_in*1000};await write('token',await seal(cloudToken,'token'));return cloudToken.access_token;}
async function download(relative,missing=false){const response=await timeoutFetch('https://content.dropboxapi.com/2/files/download',{method:'POST',headers:{Authorization:'Bearer '+await token(),'Dropbox-API-Arg':JSON.stringify({path:pairing.prefix+'/'+relative})}});if(!response.ok){if(response.status===409&&missing){const error=await response.json();if(error.error_summary?.startsWith('path/not_found/'))return null;}throw new Error('Dropbox no ha podido entregar los datos. Reintenta la sincronización.');}const text=await response.text();if(text.length>16*1024*1024)throw new Error('El archivo supera el tamaño admitido.');return JSON.parse(text);}
async function upload(relative,envelope){const response=await timeoutFetch('https://content.dropboxapi.com/2/files/upload',{method:'POST',headers:{Authorization:'Bearer '+await token(),'Content-Type':'application/octet-stream','Dropbox-API-Arg':JSON.stringify({path:pairing.prefix+'/'+relative,mode:'add',autorename:false,strict_conflict:true,mute:true})},body:JSON.stringify(envelope)});if(response.ok)return;if(response.status===409){const existing=await download(relative);const previous=await open(existing,'operacion'),current=await open(envelope,'operacion');if(JSON.stringify(previous)===JSON.stringify(current))return;}throw new Error('No se ha confirmado el envío. El parte sigue guardado en el dispositivo.');}
async function passwordOK(password){if(typeof password!=='string'||password.length>256)return false;const [kind,rounds,salt,expected]=snapshot.account.encoded.split('$');if(!['PBKDF2','PBKDF2-ACCESS'].includes(kind)||Number(rounds)<10000||Number(rounds)>1000000)return false;if(kind==='PBKDF2-ACCESS'){const spaces='\\u0009-\\u000d \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';password=password.replace(new RegExp('^['+spaces+']+|['+spaces+']+$','g'),'');password=[...password].map(c=>snapshot.normalizacion[String(c.codePointAt(0))]??c).join('');}const material=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);const actual=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:un64(salt),iterations:Number(rounds),hash:'SHA-256'},material,256));const wanted=un64(expected);return wanted.length===actual.length&&actual.reduce((acc,value,i)=>acc|(value^wanted[i]),0)===0;}
async function localData(){
 const month=$('month').value,[year,m]=month.split('-').map(Number);
 if(localQueueUser!==profile.operario){await loadLocalQueue();localQueueUser=profile.operario;}
 const [parts,calendar,balances,catalog,full,commands,dailySync]=await Promise.all([api('partes?desde='+month+'-01&hasta='+month+'-'+new Date(year,m,0).getDate()),api('calendario?anio='+year+'&mes='+m),api('vacaciones?anio='+year),api('catalogos'),api('completo').catch(error=>({error:error.message})),api('comandos').catch(()=>({ordenes:[]})),api('sincronizacion-diarios').catch(()=>({pendientes:0,conflictos:0,incidencias:[]}))]);
 for(const command of commands.ordenes){if(!pending.some(p=>p.id===command.id))pending.push({id:command.id,kind:'Comando',title:command.accion,state:command.estado==='aplicado'?'enviado':command.estado,fecha:new Date(command.fecha*1000).toISOString().slice(0,10)});}
 snapshot={sincronizacion_diarios:dailySync,account:{uid:profile.operario,name:profile.nombre},user:profile.operario,partes:parts.partes,dias:calendar.dias.map(d=>({Fecha:d.fecha,Tipo:d.tipo,Descripcion:d.descripcion})),ausencias:calendar.ausencias_manuales.map(a=>({Fecha:a.fecha,Tipo:a.tipo,Dias:a.dias})),vacaciones:[balances],...catalog,fecha:Date.now()/1000,...(full.error?{completo_error:full.error}:{completo:full})};
}
async function synchronize(){
 if(busy)return;busy=true;$('sync').disabled=true;status('Sincronizando…');
 try{
  if(!pairing){
   await api('sincronizar','POST',{});
   for(const item of pending){if(item.kind!=='Comando'||['rechazado','conflicto'].includes(item.state)||(item.state==='aplicado'&&item.resultado))continue;let ack;try{ack=await api('comandos/'+item.id);}catch(error){
    if(error.status===404&&item.comando){await api('comandos','POST',item.comando,{'Idempotency-Key':item.id});api('sincronizar','POST',{}).catch(()=>{});ack={estado:'pendiente'};}else throw error;
   }acceptAck(item,ack);}
   await localData();
  }else{
   for(const item of pending){
    if(['aplicado','rechazado','conflicto'].includes(item.state))continue;
    let operation={id:item.id,device,user:pairing.user,accion:item.kind==='Comando'?'Comando':item.accion||'Crear'};
    if(item.kind==='Comando')operation.comando=item.comando;
    else{operation.parte=item.parte;if(operation.accion!=='Crear'){operation.id_parte=item.id_parte;operation.revision=item.revision;}}
    await upload(`usuarios/${pairing.user}/cola/${device}/${item.id}.json`,await seal(operation,'operacion'));
    item.state='enviado';await saveCache();
    const envelope=await download(`usuarios/${pairing.user}/confirmaciones/${device}/${item.id}.json`,true);
    if(envelope){const ack=await open(envelope,'confirmacion');if(ack.id!==item.id||ack.device!==device||ack.user!==pairing.user)throw new Error('La confirmación no corresponde al envío.');acceptAck(item,ack);await saveCache();}
   }
   const envelope=await download(`usuarios/${pairing.user}/base.json`,true);
   if(!envelope)throw new Error('El escritorio aún no ha preparado tus datos. Sincroniza desde DT y vuelve a intentarlo.');
   const incoming=await open(envelope,'base');if(incoming.user!==pairing.user||incoming.account.uid!==pairing.user)throw new Error('Los datos no corresponden a este operario.');snapshot=incoming;
  }
  const ids=new Set(snapshot.partes.map(p=>p.id));
  pending=pending.filter(p=>{
   if(p.state!=='aplicado')return true;
   if(p.kind==='Comando')return !!(p.resultado?.base64||p.resultado?.HuellaInicial||p.resultado?.Dias||p.resultado?.calendario)||!snapshot.completo||snapshot.completo.fecha<(p.appliedAt||0);
   return p.accion==='Eliminar'?ids.has(p.id_parte):!ids.has(p.result?.id);
  });
  await saveCache();if(profile){$('connection').hidden=true;$('workspace').hidden=false;render();const daily=snapshot.sincronizacion_diarios;status(daily?.conflictos?'Hay partes que necesitan revisión. Abre Sincronización para consultar el motivo.':daily?.pendientes?'Datos recibidos. Quedan '+daily.pendientes+' cambios diarios pendientes de confirmar en el PC.':'Datos actualizados.');}else showLogin();
 }catch(error){showError(error);if(profile)render();}
 finally{busy=false;$('sync').disabled=false;}
}
function acceptAck(item,ack){
 if(['aplicado','rechazado','conflicto'].includes(ack.estado))item.state=ack.estado;
 item.reason=ack.motivo;item.result=ack.parte;item.resultado=ack.resultado;item.appliedAt=ack.aplicado_utc||0;
}
function showLogin(){$('connection').hidden=true;$('login').hidden=false;$('workspace').hidden=true;if(pairing){$('login-form').elements.user.value=pairing.user;$('login-form').elements.user.readOnly=true;$('login-help').textContent='Operario '+pairing.user+' · Datos guardados de forma cifrada en este dispositivo.';}else status('Conexión con el PC · Inicia sesión con tus datos de DT.');}
function loggedIn(){$('reconnect').hidden=!pairing;$('login').hidden=$('connection').hidden=true;$('workspace').hidden=false;$('logout').hidden=false;$('identity').textContent=profile.operario+' · '+profile.nombre;render();status(pairing?'Sesión abierta. Puedes trabajar sin conexión.':'Conectado al PC · Los cambios se sincronizan con DT.');}
function render(){if(!snapshot)return;if(desktopUI){document.documentElement.dataset.tema=/dark|black|oscuro/i.test(snapshot.apariencia||'DevExpress Dark Style')?'oscuro':'claro';desktopUI.render();return;}document.documentElement.dataset.tema=/dark|black|oscuro/i.test(snapshot.apariencia||'DevExpress Dark Style')?'oscuro':'claro';const month=$('month').value,parts=snapshot.partes.filter(p=>p.fecha.startsWith(month)),ownPending=pending.filter(p=>p.parte.fecha.startsWith(month));$('sync-info').textContent=(pairing?'Dropbox · ':'PC local · ')+'Datos del '+new Date(snapshot.fecha*1000).toLocaleString('es-ES')+(pending.length?' · '+pending.length+' envío(s) conservado(s) en el dispositivo':'');const list=$('parts-list');list.replaceChildren();for(const item of ownPending){const card=node('div',undefined,'pending-card');card.append(node('span',({pendiente:'Pendiente de enviar',enviado:'Enviado · esperando al escritorio',aplicado:'Recibido por el escritorio',rechazado:'Rechazado',conflicto:'Conflicto'})[item.state]||'Pendiente','tag warning'),node('p',dayText(item.parte.fecha)+' · '+item.parte.horas+' h · '+(item.parte.obra||item.parte.titulo)));if(item.reason)card.append(node('p',item.reason,'error'));list.append(card);}if(parts.length){const wrap=node('div',undefined,'table-wrap'),table=node('table'),thead=node('thead'),tr=node('tr');['Fecha','Obra / título','Horas','Tipo','Notas'].forEach(t=>tr.append(node('th',t)));thead.append(tr);table.append(thead);const tbody=node('tbody');for(const p of parts){const row=node('tr');row.append(node('td',dayText(p.fecha)),node('td',[p.obra,p.titulo].filter(Boolean).join(' · ')),node('td',p.horas??'—','number'),node('td',p.tipo_hora),node('td',p.notas,'notes'));tbody.append(row);}table.append(tbody);wrap.append(table);list.append(wrap);}else if(!ownPending.length)list.append(node('p','No hay partes en este mes. Utiliza Nuevo parte para registrar el primero.','empty'));renderCalendar(parts,ownPending);renderBalances();}
function renderCalendar(parts,queued,user=profile?.operario){const [year,month]=$('month').value.split('-').map(Number),calendar=$('calendar');calendar.replaceChildren();['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].forEach(d=>calendar.append(node('div',d,'weekday')));const offset=(new Date(year,month-1,1).getDay()+6)%7;for(let i=0;i<offset;i++)calendar.append(node('div'));for(let d=1;d<=new Date(year,month,0).getDate();d++){const date=`${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`,weekday=new Date(year,month-1,d).getDay(),holidays=snapshot.dias.filter(x=>x.Fecha.startsWith(date)),cell=node('div',String(d),holidays.length?'holiday':weekday===0||weekday===6?'weekend':'');if(date===today())cell.classList.add('today');for(const p of parts.filter(p=>p.fecha===date))cell.append(node('small',p.horas+' h · '+(p.tipo_hora==='26'?'Vacaciones':p.obra||p.titulo),'pc-appointment '+(p.tipo_hora==='26'?'pc-label-vacaciones':p.tipo_hora==='95'?'pc-label-asuntos':!p.obra?'pc-label-obra':p.entregado?'pc-label-enviado':'pc-label-pendiente')));for(const p of queued.filter(p=>p.parte.fecha===date))cell.append(node('small',p.parte.horas+' h · pendiente','pc-appointment pc-label-pendiente'));for(const h of holidays)cell.append(node('small',h.Descripcion||h.Tipo,'pc-appointment pc-label-festivo'));for(const a of (snapshot.completo?.laboral.Ausencias?.filter(a=>a.Operario===user)||snapshot.ausencias).filter(a=>a.Fecha.startsWith(date)))cell.append(node('small',a.Tipo+' · '+a.Dias+' días','pc-appointment '+(a.Tipo==='Vacaciones'?'pc-label-vacaciones':'pc-label-asuntos')));calendar.append(cell);}$('calendar-notes').replaceChildren(node('p','El calendario combina tus partes, los días configurados en DT y las ausencias registradas.','muted'));}
function renderBalances(){const year=Number($('month').value.slice(0,4)),balance=snapshot.vacaciones.find(v=>v.anio===year),area=$('balances');area.replaceChildren();if(!balance){area.append(node('p','No hay saldos actualizados para este año. Sincroniza con el escritorio.','empty'));return;}const grid=node('div',undefined,'balance-grid');for(const [title,field] of [['Vacaciones disponibles','VacacionesSaldo'],['Vacaciones registradas','VacacionesRegistradas'],['Asuntos propios disponibles','AsuntosSaldo']]){const box=node('div',title,'balance');box.append(node('strong',(balance[field]??'Sin configurar')+(balance[field]===null?'':' días')));grid.append(box);}area.append(grid);if(pending.length)area.append(node('p','Hay partes pendientes. El saldo se actualizará cuando los reciba el escritorio.','notice'));}
function today(){const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function openEditor(part){
 if(part?.id&&pending.some(p=>p.id_parte===part.id&&!['rechazado','conflicto','aplicado'].includes(p.state)))throw new Error('Este parte tiene un cambio pendiente. Espera su confirmación antes de editarlo.');
 const form=$('part-form');form.reset();delete form.dataset.requestId;delete form.dataset.partId;delete form.dataset.revision;
 form.elements.fecha.value=part?.fecha||today();form.elements.tipo_hora.replaceChildren();
 for(const type of snapshot.tipos_hora){const option=node('option',type.TipoHora+' · '+type.DescripcionHoras);option.value=type.TipoHora;form.elements.tipo_hora.append(option);}
 form.elements.obra.replaceChildren(new Option('Pendiente de número',''));
 for(const work of snapshot.obras)form.elements.obra.append(new Option(work.NumObra+' · '+(work.DescripcionObra||''),work.NumObra));
 if(part){
  if(part.obra&&!snapshot.obras.some(w=>w.NumObra===part.obra))form.elements.obra.append(new Option(part.obra+' · registro histórico',part.obra));
  if(part.tipo_hora&&!snapshot.tipos_hora.some(t=>t.TipoHora===part.tipo_hora))form.elements.tipo_hora.append(new Option(part.tipo_hora+' · tipo histórico',part.tipo_hora));
  for(const name of ['horas','tipo_hora','obra','titulo','notas','km','notas_departamento'])if(form.elements[name])form.elements[name].value=part[name]??'';
  if(form.elements.otro_departamento)form.elements.otro_departamento.checked=!!part.otro_departamento;
  for(let n=1;n<=8;n++)if(form.elements['nivel_'+n])form.elements['nivel_'+n].value=part.niveles?.[n-1]??'';
  if(part.id){form.dataset.partId=part.id;form.dataset.revision=part.revision;}
 }
 form.querySelector('h2').textContent=part?.id?'Editar parte de trabajo':'Nuevo parte de trabajo';$('form-error').textContent='';$('editor').showModal();form.elements.fecha.focus();
}
$('login-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,password=form.elements.password.value,user=Number(form.elements.user.value),button=form.querySelector('button');button.disabled=true;try{if(pairing){if(user!==pairing.user||!await passwordOK(password))throw new Error('Usuario o contraseña incorrectos.');profile={operario:user,nombre:snapshot.account.name};}else{const result=await api('sesion','POST',{usuario:user,contrasena:password});session=result.token;profile=result;await localData();}form.elements.password.value='';loggedIn();}catch(error){showError(error);}finally{button.disabled=false;}});
$('reconnect').addEventListener('click',()=>{connection();$('back').hidden=!profile;status('Vuelve a conectar Dropbox para reanudar la sincronización.');});
$('back').addEventListener('click',()=>{if(profile)loggedIn();});
$('logout').addEventListener('click',async()=>{if(session)await api('sesion','DELETE').catch(()=>{});session=undefined;if(!pairing){pending=[];snapshot=undefined;localQueueKey=undefined;localQueueUser=undefined;}profile=undefined;$('logout').hidden=true;$('identity').textContent='Edición móvil';showLogin();status('Sesión cerrada.');});
$('new').addEventListener('click',()=>openEditor());$('cancel').addEventListener('click',()=>$('editor').close());
$('part-form').addEventListener('submit',async event=>{
 event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type=submit]'),values=Object.fromEntries(new FormData(form));
 const body={fecha:values.fecha,horas:values.horas.trim().replace(',','.'),tipo_hora:values.tipo_hora,obra:values.obra||'',titulo:values.titulo||'',notas:values.notas||''};
 if('km' in values)body.km=values.km.trim().replace(',','.')||'0';
 if('notas_departamento' in values)body.notas_departamento=values.notas_departamento;
 if(form.elements?.otro_departamento)body.otro_departamento=form.elements.otro_departamento.checked;
 if('nivel_1' in values)body.niveles=Array.from({length:8},(_,i)=>values['nivel_'+(i+1)]||null);
 if(!/^\d{1,2}(\.\d{1,10})?$/.test(body.horas)||Number(body.horas)<=0||Number(body.horas)>24){$('form-error').textContent='Indica horas mayores que cero, hasta 24, con un máximo de diez decimales.';return;}
 if(!body.obra&&!body.titulo.trim()){$('form-error').textContent='Indica una obra o un título pendiente de número.';return;}
 button.disabled=true;
 try{
  const id=form.dataset?.partId,revision=Number(form.dataset?.revision),request=crypto.randomUUID();
  if(pairing){const item={id:request,parte:body,accion:id?'Modificar':'Crear',state:'pendiente',...(id?{id_parte:id,revision}:{})};pending.push(item);try{await saveCache();}catch(error){pending.pop();throw error;}$('editor').close();render();status('Cambio guardado en este dispositivo. Pendiente de confirmar con el escritorio.');if(navigator.onLine)synchronize();}
  else{await api(id?'partes/'+id:'partes',id?'PUT':'POST',body,{'Idempotency-Key':form.dataset.requestId||(form.dataset.requestId=request),...(id?{'If-Match':'"'+revision+'"'}:{})});delete form.dataset.requestId;api('sincronizar','POST',{}).catch(()=>{});await localData();$('editor').close();render();status('Parte guardado. Se ha solicitado su sincronización con el PC.');}
 }catch(error){$('form-error').textContent=error.message;}finally{button.disabled=false;}
});
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-view]').forEach(b=>b.removeAttribute('aria-current'));button.setAttribute('aria-current','page');document.querySelectorAll('.view').forEach(section=>section.hidden=section.id!==button.dataset.view);}));
$('month').addEventListener('change',()=>{if(!$('month').value)return;if(pairing)render();else synchronize();});$('sync').addEventListener('click',synchronize);
$('authorize').addEventListener('click',async()=>{try{if(!pairing)throw new Error('Abre el enlace de conexión preparado desde DT en el escritorio.');verifier=b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');await write('verifier',await seal({value:verifier},'verifier'));const challenge=b64(await crypto.subtle.digest('SHA-256',enc.encode(verifier))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');const url=new URL('https://www.dropbox.com/oauth2/authorize');url.search=new URLSearchParams({client_id:pairing.app_key,response_type:'code',token_access_type:'offline',code_challenge_method:'S256',code_challenge:challenge}).toString();window.open(url,'_blank','noopener,noreferrer');status('Autoriza DT en Dropbox y pega el código de autorización.');}catch(error){showError(error);}});
$('code-form').addEventListener('submit',async event=>{event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;try{if(!verifier){const saved=await read('verifier');if(saved)verifier=(await open(saved,'verifier')).value;}if(!verifier)throw new Error('Pulsa Abrir Dropbox para obtener un código nuevo.');const response=await timeoutFetch('https://api.dropboxapi.com/oauth2/token',{method:'POST',body:new URLSearchParams({grant_type:'authorization_code',client_id:pairing.app_key,code_verifier:verifier,code:event.currentTarget.elements.code.value.trim()})});if(!response.ok)throw new Error('Dropbox no ha aceptado el código. Solicita uno nuevo y vuelve a intentarlo.');const data=await response.json();cloudToken={...data,expires:Date.now()+data.expires_in*1000};await write('token',await seal(cloudToken,'token'));await write('verifier',null);verifier=undefined;event.currentTarget.elements.code.value='';await synchronize();}catch(error){showError(error);}finally{button.disabled=false;}});
window.addEventListener('online',()=>{if(profile)synchronize();});window.addEventListener('offline',()=>status('Sin conexión. Los partes nuevos se conservarán en este dispositivo.'));
async function initialize(){if(!window.crypto?.subtle||!window.indexedDB)throw new Error('DT necesita un navegador actualizado y una dirección HTTPS.');store=await new Promise((resolve,reject)=>{const request=indexedDB.open('DT-movil',1);request.onupgradeneeded=()=>request.result.createObjectStore('datos');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(new Error('No se puede abrir el almacenamiento del dispositivo.'));});if(location.hash.length>1){let incoming;try{incoming=JSON.parse(dec.decode(un64(location.hash.slice(1))));}finally{history.replaceState(null,'',location.pathname+location.search);}if(incoming?.v!==1||!Number.isInteger(incoming.user)||incoming.user<=0||!/^[0-9a-f-]{36}$/.test(incoming.dataset)||un64(incoming.key).length!==32||incoming.prefix!=='/dt_partes_v1/'+incoming.dataset||!incoming.app_key)throw new Error('El enlace de conexión no es válido.');const existing=await read('pairing');if(existing&&(existing.dataset!==incoming.dataset||existing.user!==incoming.user))throw new Error('Este navegador está conectado a otro operario. Utiliza otro perfil de navegador para mantener separados sus datos.');const cached=await read('key');const {key:raw,...safe}=incoming;key=cached||await crypto.subtle.importKey('raw',un64(raw),'AES-GCM',false,['encrypt','decrypt']);if(cached){pairing=safe;const probe=await seal({ok:true},'prueba');const imported=await crypto.subtle.importKey('raw',un64(raw),'AES-GCM',false,['decrypt']);await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(probe.nonce),additionalData:enc.encode(JSON.stringify(['DT',1,safe.dataset,safe.user,'prueba']))},imported,un64(probe.data));}await write('key',key);await write('pairing',safe);}pairing=await read('pairing');key=await read('key');device=await read('device');if(!device){device=crypto.randomUUID();await write('device',device);}$('month').value=today().slice(0,7);await installDesktopUI();if(pairing){const cache=await read('cache');if(cache){const saved=await open(cache,'cache');snapshot=saved.snapshot;pending=saved.pending||[];}const savedToken=await read('token');if(savedToken)cloudToken=await open(savedToken,'token');if(snapshot){showLogin();status('Datos guardados disponibles. Inicia sesión para consultarlos.');}else if(cloudToken){await synchronize();}else{connection();status('Conexión de operario preparada. Autoriza Dropbox para descargar tus datos.');}}else if(local){showLogin();}else{status('Abre el enlace de conexión desde DT → Sincronizar con Dropbox → Conectar móvil.');$('login').hidden=false;$('login-form').hidden=true;$('login-help').textContent='Esta instalación necesita el enlace personal preparado desde el escritorio.';}}
async function enqueueCommand(accion,datos,requestId){
 const request=requestId||crypto.randomUUID();let item={id:request,kind:'Comando',comando:{accion,datos},title:accion,fecha:today(),state:'pendiente'};
 const previous=pending.find(p=>p.id===request);if(previous){if(JSON.stringify(previous.comando)!==JSON.stringify(item.comando))throw new Error('El envío anterior puede haberse recibido. Revisa Sincronización antes de cambiar su contenido.');item=previous;}
 else{pending.push(item);try{await saveCache();}catch(error){pending.pop();throw error;}}
 if(!pairing){try{await api('comandos','POST',item.comando,{'Idempotency-Key':request});}catch(error){
  if(error.status&&error.status>=400&&error.status<500){item.state=error.status===409?'conflicto':'rechazado';item.reason=error.message;await saveCache();throw error;}
  status('No se ha recibido confirmación. La operación se conserva para reintentar sin duplicarla.');return item;
 }}
 if(!pairing)api('sincronizar','POST',{}).catch(()=>{});
 status('Operación guardada. Pendiente de confirmación del escritorio.');if(navigator.onLine)synchronize();return item;
}
async function removePart(part){
 if(!part.id)throw new Error('Abre el día desde Partes de operarios para modificar esa línea.');
 if(pending.some(p=>p.id_parte===part.id&&!['rechazado','conflicto','aplicado'].includes(p.state)))throw new Error('Ya hay un cambio pendiente para ese parte.');
 if(!confirm('¿Eliminar el apunte del '+part.fecha+' · '+(part.obra||part.titulo)+'?'))return;
 const request=crypto.randomUUID();
 if(pairing){const item={id:request,accion:'Eliminar',id_parte:part.id,revision:part.revision,parte:null,fecha:part.fecha,state:'pendiente'};pending.push(item);try{await saveCache();}catch(error){pending.pop();throw error;}if(navigator.onLine)synchronize();}
 else{await api('partes/'+part.id,'DELETE',undefined,{'Idempotency-Key':request,'If-Match':'"'+part.revision+'"'});api('sincronizar','POST',{}).catch(()=>{});await localData();render();}
}
async function discard(item){if(!['aplicado','rechazado','conflicto'].includes(item.state))throw new Error('Espera una confirmación antes de retirar un envío.');if(!pairing&&item.kind==='Comando'){try{await api('comandos/'+item.id+'/retirar','POST',{});}catch(error){if(error.status!==404)throw error;}}pending=pending.filter(p=>p.id!==item.id);await saveCache();render();}
async function getLocalQueueKey(){
 if(localQueueKey)return localQueueKey;
 const name='local-key-'+profile.operario;localQueueKey=await read(name);
 if(!localQueueKey){localQueueKey=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);await write(name,localQueueKey);}
 return localQueueKey;
}
async function loadLocalQueue(){
 pending=[];const cache=await read('localQueue-'+profile.operario);if(!cache)return;
 const localKey=await getLocalQueueKey();const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:un64(cache.nonce),additionalData:enc.encode('DT-local-'+profile.operario)},localKey,un64(cache.data));pending=JSON.parse(dec.decode(raw));
}
async function installDesktopUI(){
 const {DesktopUI}=await import('./desktop-ui.js');
 desktopUI=new DesktopUI({state:()=>snapshot,profile:()=>profile,pending:()=>pending,cloud:()=>!!pairing,today,error:showError,sync:synchronize,command:enqueueCommand,discard,edit:openEditor,remove:removePart,calendar:renderCalendar,balances:renderBalances});
 setInterval(()=>{if(profile&&!busy&&(snapshot?.sincronizacion_diarios?.pendientes>0||pending.some(p=>!['aplicado','rechazado','conflicto'].includes(p.state)||(p.state==='aplicado'&&p.kind==='Comando'&&!p.resultado?.base64&&!p.resultado?.HuellaInicial&&!p.resultado?.Dias&&!p.resultado?.calendario&&(snapshot?.completo?.fecha||0)<(p.appliedAt||0)))))synchronize();},5000);
}
// DT registra solo su propio servicio, incluso si falla el primer acceso.
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).then(reg=>reg.update()).catch(()=>{});
initialize().catch(showError);
