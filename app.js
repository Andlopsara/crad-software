'use strict';
const STORAGE_KEY='uteq.control.aulas.neondata.v1';
const CLOUD_PENDING_KEY='uteq.neondata.pending.v1';
const CLOUD_REVISION_KEY='uteq.neondata.revision.v1';
// La configuración de correo se conserva aparte del respaldo de los datos del alumnado.
const MAIL_SETTINGS_KEY='uteq.control.aulas.mail.v1';
const ADMIN_MAIL='aulasdigitalesiemens@uteq.edu.mx';
function loadMailSettings(){
  try { const x=JSON.parse(localStorage.getItem(MAIL_SETTINGS_KEY)||'null');
    if(x&&typeof x.url==='string'&&typeof x.token==='string')return x;
  } catch(e){}
  return {url:'',token:''};
}
let mailSettings=loadMailSettings();
function saveMailSettings(){localStorage.setItem(MAIL_SETTINGS_KEY,JSON.stringify(mailSettings));}
const mailConfigured=()=>/^https:\/\/script\.google\.com\/(?:macros\/s|a\/macros\/[a-zA-Z0-9.-]+\/s)\/[a-zA-Z0-9_-]+\/exec$/.test(mailSettings.url)&&mailSettings.token.length>=24;
// Envío por formulario HTML normal hacia Apps Script (no fetch/no-cors).
// La respuesta NO se puede leer en segundo plano debido al origen cruzado.
// El botón «Diagnóstico» abre la respuesta JSON en otra pestaña para verificarla.
function mailStatusText(u){
  switch(u.emailNotification){
    case 'attempted': return 'Aviso solicitado (sin confirmación)';
    case 'sending': return 'Solicitando aviso…';
    case 'error': return 'Sin conexión; reintentar';
    default: return 'Correo sin configurar';
  }
}
/**
 * Un formulario HTML hace POST entre orígenes sin depender de la API Fetch/CORS.
 * Apps Script lee e.parameter.payload y valida CLAVE_KIOSCO.
 * Cuando visible es true, la respuesta JSON aparece en una pestaña aparte.
 * El modo silencioso NO ofrece acuse de entrega: revisar Gmail / Ejecuciones.
 */
function sendMailForm(data,visible=false){
  const form=document.createElement('form');
  form.method='POST';
  form.action=mailSettings.url;
  form.enctype='application/x-www-form-urlencoded';
  form.acceptCharset='UTF-8';
  form.style.display='none';
  let frame=null;
  if(visible){
    form.target='_blank';
    form.rel='noopener';
  }else{
    frame=document.createElement('iframe');
    frame.name='uteq_mail_sink_'+Date.now()+'_'+Math.random().toString(36).slice(2);
    frame.title='Envío de aviso de Aulas Digitales';
    frame.style.display='none';
    document.body.appendChild(frame);
    form.target=frame.name;
  }
  const field=document.createElement('input');
  field.type='hidden';
  field.name='payload';
  field.value=JSON.stringify({...data,token:mailSettings.token});
  form.appendChild(field);
  document.body.appendChild(form);
  try{
    // No usa fetch ni lectura de datos entre dominios.
    form.submit();
    return true;
  }finally{
    form.remove();
    // No retirar el iframe antes de que el navegador termine el POST.
    if(frame)setTimeout(()=>frame.remove(),60000);
  }
}
async function submitMailNotice(data,booking){
  if(!mailConfigured()){
    if(booking){booking.emailNotification='not_configured';save();}
    return false;
  }
  if(booking){booking.emailNotification='sending';booking.emailAttemptAt=nowISO();save();}
  try{
    const launched=sendMailForm(data,false);
    if(booking){booking.emailNotification='attempted';save();}
    // Haber enviado el formulario NO confirma que el script procesó el aviso.
    return launched;
  }catch(e){
    console.error('No se pudo solicitar el aviso a Apps Script:',e);
    if(booking){booking.emailNotification='error';save();}
    return false;
  }
}

function notifyNewFreeUse(u){
  return submitMailNotice({event:'nueva_solicitud',reservation:{
    id:u.id,termName:db.terms.find(t=>t.id===u.termId)?.name||'',
    date:u.date,room:u.room,fullName:u.fullName,email:u.email,reason:u.reason,
    plannedStart:u.plannedStart,plannedEnd:u.plannedEnd,createdAt:u.createdAt,
    immediateEntry:!!u.entryAt
  }},u).then(ok=>{
    if(view==='admin'&&activeTab==='freeUses')renderAdmin();
    if(ok)flash('Solicitud guardada. Se solicitó el aviso a Gmail; verifica su recepción.');
    else flash('Solicitud guardada. Aviso por correo pendiente: revisa la configuración o conexión.');
  });
}

const DAYS=['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
const pad=n=>String(n).padStart(2,'0');
const dKey=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const mins=s=>{let p=String(s).split(':').map(Number);return (p[0]||0)*60+(p[1]||0)};
const fmtTime=s=>String(s||'').slice(0,5);
const byId=id=>document.getElementById(id);
const safe=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const hourName=s=>`${fmtTime(s)} h`;
const fmtDate=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString('es-MX',{day:'2-digit',month:'short',year:'numeric'})};
const dayNo=d=>(d.getDay()+6)%7;
const nowISO=()=>new Date().toISOString();
const termSeed=()=>({id:'2026-SD',name:'Septiembre – Diciembre 2026',start:'2026-09-01',end:'2026-12-31',trackingStart:dKey(new Date()),holidays:[],schedule:SEED_SCHEDULE.map((x,i)=>({id:`seed-${i+1}`,weekday:x.weekday,room:x.room,start:x.start,end:x.end,teacher:x.teacher,group_name:x.group_name,subject:x.subject,shift:x.shift||''}))});
const load=()=>{try{const value=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');if(value&&Array.isArray(value.terms)&&Array.isArray(value.logs))return value;}catch(e){}return {version:1,active:'2026-SD',terms:[termSeed()],logs:[],adminPin:''}};
let db=load();if(!Array.isArray(db.freeUses))db.freeUses=[];let kioskTab='classes',freeViewDate=dKey(new Date()),freeTermId=db.active;let view='kiosk', activeTab='report', ticker=null,reportTermId=db.active,scheduleTermId=db.active,annualYear=new Date().getFullYear(),lastMinuteKey='';
function save(){
  try{
    localStorage.setItem(STORAGE_KEY,JSON.stringify(db));
    // El PIN administrativo solo permanece en este navegador.
    localStorage.setItem(CLOUD_PENDING_KEY,'1');
    cloudDirty=true;
    showCloudStatus('pending','☁ Cambios pendientes de Neon');
    if(cloudReady) scheduleCloudSave();
  }catch(e){alert('No se pudo guardar localmente; revisa el navegador.');throw e}
}
function term(){return db.terms.find(t=>t.id===db.active)||db.terms[0]}
function operationalTerm(now=new Date()){const date=dKey(now);return db.terms.find(t=>date>=t.start&&date<=t.end)||term()}
function todayClasses(){let now=new Date(),t=operationalTerm(now),date=dKey(now);if(date<t.start||date>t.end||(t.holidays||[]).includes(date))return [];return t.schedule.filter(s=>s.weekday===dayNo(now)).sort((a,b)=>mins(a.start)-mins(b.start)||a.room-b.room)}
function idFor(s,date=dKey(new Date()),t=operationalTerm()){return `${t.id}::${date}::${s.id}`}
function logFor(s,date=dKey(new Date()),t=operationalTerm()){const id=idFor(s,date,t);return db.logs.find(x=>x.id===id)}
function status(s){const cur=new Date(),date=dKey(cur),m=cur.getHours()*60+cur.getMinutes(),l=logFor(s,date);if(l&&l.exitAt)return {code:'done',name:'Finalizada',action:'Ver registro'};if(l){return {code:'success',name:m>mins(s.end)?'Salida pendiente':'En uso',action:'Registrar salida'}};if(m<mins(s.start))return {code:'wait',name:'Aún no inicia',action:'Entrada no disponible'};if(m>=mins(s.end))return {code:'missed',name:'Sin entrada',action:'Horario terminado'};if(db.freeUses.some(u=>u.date===date&&u.room===s.room&&!u.canceledAt&&u.entryAt&&!u.exitAt))return {code:'wait',name:'Aula ocupada por uso adicional',action:'Esperar salida'};return {code:'success',name:m>mins(s.start)?'Entrada disponible':'Inicia ahora',action:'Registrar entrada'}}
function dayClock(){let now=new Date();byId('clock').textContent=now.toLocaleTimeString('es-MX',{hour12:false});byId('todayLabel').textContent=now.toLocaleDateString('es-MX',{weekday:'long',day:'numeric',month:'long',year:'numeric'});const modalClock=byId('modalNow');if(modalClock)modalClock.textContent=now.toLocaleTimeString('es-MX',{hour12:false});updateEarlyExitReasonVisibility();}
function flash(message){let el=byId('toast');el.textContent=message;el.classList.remove('hidden');clearTimeout(flash.timer);flash.timer=setTimeout(()=>el.classList.add('hidden'),4000)}
function currentClasses(now=new Date()){
  const minute=now.getHours()*60+now.getMinutes();
  return todayClasses().filter(s=>{
    const log=logFor(s,dKey(now));
    return (minute>=mins(s.start)&&minute<mins(s.end)) || (log?.entryAt&&!log.exitAt);
  }).sort((a,b)=>mins(a.start)-mins(b.start)||a.room-b.room||a.teacher.localeCompare(b.teacher,'es'));
}
function nextBlock(now=new Date()){
  const minute=now.getHours()*60+now.getMinutes();
  const future=todayClasses().filter(s=>mins(s.start)>minute);
  if(!future.length)return null;
  const begin=Math.min(...future.map(s=>mins(s.start)));
  return {hour:`${pad(Math.floor(begin/60))}:${pad(begin%60)}`,count:future.filter(s=>mins(s.start)===begin).length};
}
function renderKiosk(){
  byId('kioskSubtitle').textContent=kioskTab==='free'?'Encuentra espacios sin clases, registra una solicitud y confirma la entrada y salida desde esta estación.':'Las clases aparecen cuando inicia su horario. Las solicitudes de espacios libres de hoy también aparecen aquí para registrar su entrada o salida.';
  byId('scheduledSection').classList.toggle('hidden',kioskTab!=='classes');
  byId('freeSection').classList.toggle('hidden',kioskTab!=='free');
  byId('kioskNav').querySelectorAll('[data-kiosk-tab]').forEach(b=>b.classList.toggle('chosen',b.dataset.kioskTab===kioskTab));
  if(kioskTab==='free'){renderFreeSpaces();return;}
  const now=new Date(), date=dKey(now), all=todayClasses(), shown=currentClasses(now), upcoming=nextBlock(now);
  const freeUses=db.freeUses.filter(u=>u.date===date&&!u.canceledAt)
    .sort((a,b)=>mins(a.plannedStart)-mins(b.plannedStart)||a.room-b.room);
  byId('termChip').textContent=operationalTerm(now).name;
  byId('listTitle').textContent='Programa del día';
  byId('listSubtitle').textContent=`${DAYS[dayNo(now)]} ${fmtDate(date)} · ${shown.length} clase${shown.length===1?'':'s'} en curso · ${freeUses.length} solicitud${freeUses.length===1?'':'es'} de uso libre`;
  const next=byId('nextBlock');
  next.innerHTML=upcoming?`<span class="next-dot"></span> Próximas clases a las <strong>${upcoming.hour} h</strong> · ${upcoming.count} clase${upcoming.count===1?'':'s'}`:'<span class="next-dot muted-dot"></span> No quedan nuevos bloques programados para hoy';
  const entries=[
    ...shown.map(item=>({kind:'class',item,start:item.start,room:item.room})),
    ...freeUses.map(item=>({kind:'free',item,start:item.plannedStart,room:item.room}))
  ].sort((a,b)=>mins(a.start)-mins(b.start)||a.room-b.room);
  byId('classList').innerHTML=!entries.length?
    `<div class="empty"><div class="empty-illustration">◷</div><strong>${!all.length?'No hay clases programadas ni usos libres solicitados para hoy':'No hay clases en este momento ni usos libres solicitados'}</strong>${upcoming?`El siguiente bloque comenzará a las <b>${upcoming.hour} h</b>. Las clases aparecerán automáticamente.`:'Puedes consultar el horario completo desde Administración.'}</div>`:
    entries.map(({kind,item})=>{
      if(kind==='free'){
        const st=useState(item,now),can=!!st.action;
        const actual=item.entryAt?`<div class="small muted" style="margin-top:7px">Entrada: ${new Date(item.entryAt).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit',hour12:false})}${item.exitAt?' · Salida: '+new Date(item.exitAt).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit',hour12:false}):''}</div>`:'';
        return `<article class="classcard ${st.code==='success'?'active':''}"><div><div class="time">${safe(item.plannedStart)} – ${safe(item.plannedEnd)}</div><span class="tag" style="display:inline-block;margin-top:7px">Aula Digital ${item.room}</span></div><div><div class="subject">${safe(item.fullName)}</div><div class="teacher">Uso de espacio libre</div><div class="small muted">Solicitud para hoy</div>${actual}</div><div class="right"><span class="status ${st.code}">${st.name}</span><button class="btn ${st.code==='success'?'main':''} smallbtn" data-free-use="${safe(item.id)}" ${can?'':'disabled'}>${st.action||st.name}</button></div></article>`;
      }
      const s=item,st=status(s),l=logFor(s),can=st.code==='success'||st.code==='done';
      const info=l?`<div class="small muted" style="margin-top:7px">Entrada: ${new Date(l.entryAt).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit',hour12:false})}${l.exitAt?' · Salida: '+new Date(l.exitAt).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit',hour12:false}):''}</div>`:'';
      const pending=l&&!l.exitAt&&mins(s.end)<=now.getHours()*60+now.getMinutes();
      return `<article class="classcard ${st.code==='success'?'active':''}"><div><div class="time">${safe(s.start)} – ${safe(s.end)}</div><span class="tag" style="display:inline-block;margin-top:7px">Aula Digital ${s.room}</span></div><div><div class="subject">${safe(s.subject||'Materia sin nombre')}</div><div class="teacher">${safe(s.teacher)}</div><div class="small muted">Grupo ${safe(s.group_name||'—')} ${s.shift?'· '+safe(s.shift):''}</div>${info}</div><div class="right"><span class="status ${pending?'wait':st.code}">${pending?'Salida pendiente':st.name}</span><button class="btn ${st.code==='success'?'main':''} smallbtn" data-class="${safe(s.id)}" ${can?'':'disabled'}>${st.action}</button></div></article>`;
    }).join('');
  document.querySelectorAll('[data-class]').forEach(b=>b.onclick=()=>showClass(b.dataset.class));
  document.querySelectorAll('[data-free-use]').forEach(b=>b.onclick=()=>showFreeUse(b.dataset.freeUse));
}

function modal(html){byId('overlay').className='modal-back';byId('overlay').innerHTML=`<div class="modal" role="dialog" aria-modal="true">${html}</div>`;byId('overlay').onclick=e=>{if(e.target===byId('overlay'))closeModal()};byId('overlay').querySelectorAll('[data-close]').forEach(x=>x.onclick=closeModal);updateEarlyExitReasonVisibility()}
function closeModal(){byId('overlay').className='hidden';byId('overlay').innerHTML=''}
// El préstamo se confirma al entregar la identificación y recibir la llave físicamente.
// No se guardan números, fotografías ni tipos de identificación.
function handoverNotice(kind,prefix){
  const exit=kind==='exit';
  return `<section class="handover ${exit?'exit':''}" aria-label="Control de préstamo de llave e identificación">
    <h4 class="handover-title">${exit?'🔑 Antes de registrar tu salida':'🪪 Antes de registrar tu entrada'}</h4>
    <p>${exit
      ?'Para finalizar el uso del aula, <strong>entrega la llave que se te prestó</strong> al personal responsable y <strong>recupera tu identificación</strong>. Después registra tu salida en esta pantalla.'
      :'Para ingresar al aula, <strong>entrega una identificación</strong> al personal responsable. A cambio, se te proporcionará <strong>la llave del aula</strong> durante el tiempo autorizado. No olvides registrar tu salida al terminar.'}</p>
    <label class="handover-check"><input type="checkbox" id="${prefix}Key" /> <span>${exit?'Confirmo que ya devolví la llave del aula.':'Confirmo que ya recibí la llave del aula.'}</span></label>
    <label class="handover-check"><input type="checkbox" id="${prefix}Id" /> <span>${exit?'Confirmo que ya recuperé mi identificación.':'Confirmo que ya entregué mi identificación para resguardo.'}</span></label>
    <div class="handover-help">Marca las dos casillas únicamente cuando el intercambio se haya realizado. La confirmación quedará guardada en el historial.</div>
  </section>`;
}
function handoverReady(prefix,kind){
  const key=byId(prefix+'Key'),ident=byId(prefix+'Id');
  if(!key?.checked||!ident?.checked){
    alert(kind==='exit'?'Antes de cerrar la salida, confirma la devolución de la llave y la recuperación de tu identificación.':'Para registrar la entrada, confirma que entregaste tu identificación y recibiste la llave del aula.');
    (key&&!key.checked?key:ident)?.focus();
    return false;
  }
  return true;
}
// El motivo solo se solicita cuando la salida real ocurre antes del fin programado.
// Se compara fecha y hora completas para respetar también reservas de fechas anteriores.
function isEarlyExit(date,end,instant=new Date()){
  if(!date||!end)return false;
  const [year,month,day]=String(date).split('-').map(Number);
  const [hour,minute]=fmtTime(end).split(':').map(Number);
  return instant.getTime()<new Date(year,month-1,day,hour,minute,0,0).getTime();
}
function earlyExitField(date,end,inputId){
  return `<div class="field early-exit-note hidden" id="earlyExitReasonWrap" data-exit-date="${safe(date)}" data-exit-end="${safe(end)}" data-input-id="${inputId}">
    <label for="${inputId}">Motivo de salida anticipada <span aria-hidden="true">*</span></label>
    <p>Estás registrando la salida antes de las <strong>${safe(end)} h</strong>, hora de finalización programada. Explica el motivo para poder continuar.</p>
    <textarea id="${inputId}" class="input" rows="3" maxlength="300" placeholder="Ej. La actividad terminó antes de lo previsto"></textarea>
    <div class="form-note">Este motivo se conservará en el historial y en los reportes cuatrimestrales y anuales.</div>
  </div>`;
}
function updateEarlyExitReasonVisibility(){
  const wrap=byId('earlyExitReasonWrap');
  if(!wrap)return;
  const early=isEarlyExit(wrap.dataset.exitDate,wrap.dataset.exitEnd);
  wrap.classList.toggle('hidden',!early);
  const input=byId(wrap.dataset.inputId);
  if(input){input.required=early;if(!early)input.value='';}
}
function getEarlyExitReason(early,inputId){
  if(!early)return '';
  const input=byId(inputId),reason=(input?.value||'').trim();
  if(reason.length<5){
    alert('La salida es anticipada. Escribe el motivo (mínimo 5 caracteres) antes de registrar la salida.');
    updateEarlyExitReasonVisibility();
    input?.focus();
    return null;
  }
  return reason;
}
function stampHandover(record,kind,when){
  if(kind==='exit'){
    record.keyReturnedAt=when;
    record.identificationReturnedAt=when;
  }else{
    record.keyDeliveredAt=when;
    record.identificationDepositedAt=when;
  }
}

function showClass(id){
  const s=currentClasses().find(x=>x.id===id);
  if(!s)return flash('Esta clase ya no está disponible en el horario actual.');
  const st=status(s),l=logFor(s),cur=new Date();
  if(st.code==='wait'||st.code==='missed')return flash('No puedes registrar entrada fuera del horario permitido.');
  if(st.code==='done')return modal(`<h3>Registro completado</h3><p>${safe(s.teacher)} · Aula ${s.room}</p><div class="prominent">Entrada: <strong>${new Date(l.entryAt).toLocaleString('es-MX')}</strong><br>Salida: <strong>${new Date(l.exitAt).toLocaleString('es-MX')}</strong></div><p class="muted small">${l.keyReturnedAt&&l.identificationReturnedAt?'Llave e identificación: devolución confirmada.':'Control físico: no consta en este registro anterior.'}</p>${l.earlyExitReason?`<p class="early-exit-summary"><b>Motivo de salida anticipada:</b> ${safe(l.earlyExitReason)}</p>`:''}<button class="btn" data-close>Cerrar</button>`);
  const exiting=!!l,kind=exiting?'exit':'entry';
  modal(`<p class="tag" style="display:inline-block;margin:0 0 10px">Aula Digital ${s.room}</p><h3>${exiting?'Confirmar salida':'Confirmar entrada'}</h3><p class="muted small">Verifica que esta sea tu clase antes de continuar.</p><div class="prominent"><strong>${safe(s.teacher)}</strong><div>${safe(s.subject)} · ${safe(s.group_name)}</div><div class="small muted">Horario: ${safe(s.start)} a ${safe(s.end)}</div><div class="small" style="margin-top:10px">Hora actual: <b id="modalNow">${cur.toLocaleTimeString('es-MX',{hour12:false})}</b></div></div>${handoverNotice(kind,'classHandover')}${exiting?earlyExitField(dKey(cur),s.end,'exitEarlyReason'):''}<div class="modal-actions"><button class="btn" data-close>Cancelar</button><button class="btn main" id="confirmAction">${exiting?'Registrar salida':'Confirmar entrada'}</button></div>`);
  byId('confirmAction').onclick=()=>{
    const rightNow=new Date(),m=rightNow.getHours()*60+rightNow.getMinutes(),date=dKey(rightNow);
    if(date!==dKey(cur))return flash('Cambió la fecha. Vuelve a seleccionar la clase.');
    const fresh=logFor(s);
    if(exiting){
      if(!fresh||fresh.exitAt)return flash('El registro ya fue cerrado.');
      const early=isEarlyExit(fresh.date||date,fresh.end||s.end,rightNow);
      const reason=getEarlyExitReason(early,'exitEarlyReason');
      if(reason===null)return;
      if(!handoverReady('classHandover','exit'))return;
      fresh.exitAt=rightNow.toISOString();fresh.earlyExitReason=reason;
      stampHandover(fresh,'exit',fresh.exitAt);
    }else{
      if(fresh)return flash('Ya existe una entrada para esta clase.');
      if(m<mins(s.start)||m>=mins(s.end))return flash('Entrada no disponible: fuera del horario programado.');
      let other=db.logs.find(x=>x.termId===operationalTerm(rightNow).id&&x.date===date&&x.room===s.room&&x.entryAt&&!x.exitAt);
      if(other)return flash('Primero debe registrarse la salida de la clase anterior en esa aula.');
      if(db.freeUses.some(u=>u.date===date&&u.room===s.room&&!u.canceledAt&&u.entryAt&&!u.exitAt))return flash('Primero debe registrarse la salida del uso adicional de esa aula.');
      if(!handoverReady('classHandover','entry'))return;
      const log={id:idFor(s,date),termId:operationalTerm(rightNow).id,scheduleId:s.id,date,room:s.room,teacher:s.teacher,subject:s.subject,group_name:s.group_name,start:s.start,end:s.end,entryAt:rightNow.toISOString(),exitAt:null,note:'',earlyExitReason:''};
      stampHandover(log,'entry',log.entryAt);db.logs.push(log);
    }
    save();closeModal();renderKiosk();flash(exiting?'Salida guardada · llave devuelta e identificación recuperada':'Entrada guardada · llave entregada e identificación resguardada');
  };
}
// Espacios libres: se calcula disponibilidad por aula para la fecha consultada.
const FREE_OPEN='07:00',FREE_CLOSE='22:00';
const hhmm=n=>`${pad(Math.floor(n/60))}:${pad(n%60)}`;
const termForDate=date=>db.terms.find(t=>date>=t.start&&date<=t.end)||null;
const freeUsesFor=(date,termId=null)=>db.freeUses.filter(u=>u.date===date&&(!termId||u.termId===termId));
function busyIntervals(date,room,ignoreId=''){
  const t=termForDate(date);if(!t)return [];
  const day=dayNo(new Date(date+'T12:00:00'));
  const periods=[];
  if(!(t.holidays||[]).includes(date)){
    for(const s of t.schedule){if(s.weekday===day&&Number(s.room)===Number(room))periods.push([mins(s.start),mins(s.end)]);}
  }
  for(const u of db.freeUses){
    if(u.date!==date||Number(u.room)!==Number(room)||u.canceledAt||u.id===ignoreId)continue;
    let finish=mins(u.plannedEnd);
    if(u.exitAt){const time=new Date(u.exitAt);finish=Math.min(finish,time.getHours()*60+time.getMinutes());}
    else if(u.entryAt){finish=mins(FREE_CLOSE);}
    periods.push([mins(u.plannedStart),Math.max(mins(u.plannedStart),finish)]);
  }
  // Si el docente aún no ha registrado su salida, el aula sigue ocupada.
  for(const l of db.logs){if(l.date===date&&Number(l.room)===Number(room)&&l.entryAt&&!l.exitAt)periods.push([mins(l.start||FREE_OPEN),mins(FREE_CLOSE)]);}
  return periods.map(([a,b])=>[Math.max(mins(FREE_OPEN),a),Math.min(mins(FREE_CLOSE),b)])
    .filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);
}
function freeIntervals(date,room){
  if(!termForDate(date))return [];
  const busy=busyIntervals(date,room),slots=[];let cursor=mins(FREE_OPEN);
  for(const [a,b] of busy){if(a>cursor)slots.push([cursor,a]);cursor=Math.max(cursor,b);}
  if(cursor<mins(FREE_CLOSE))slots.push([cursor,mins(FREE_CLOSE)]);
  return slots.filter(([a,b])=>b-a>=15);
}
function validFreeRequest(date,room,start,end){
  const t=termForDate(date);
  if(!t)return 'Esta fecha no pertenece a un cuatrimestre configurado.';
  if(date<dKey(new Date()))return 'No se puede reservar una fecha pasada.';
  if(![1,2,3,4].includes(Number(room))||!/^\d\d:\d\d$/.test(start)||!/^\d\d:\d\d$/.test(end))return 'Verifica aula y horario.';
  if(mins(start)<mins(FREE_OPEN)||mins(end)>mins(FREE_CLOSE)||mins(end)-mins(start)<15)return 'El horario debe durar al menos 15 minutos y estar entre las 07:00 y las 22:00.';
  if(date===dKey(new Date())){const now=new Date(),current=now.getHours()*60+now.getMinutes();if(mins(start)<current)return 'La hora de inicio no puede ser anterior a la hora actual.';if(mins(end)<=current)return 'Ese horario ya pasó.';}
  if(!freeIntervals(date,room).some(([a,b])=>mins(start)>=a&&mins(end)<=b))return 'El espacio dejó de estar disponible; revisa nuevamente los horarios.';
  return '';
}
function useState(u,now=new Date()){
  if(u.canceledAt)return {name:'Cancelada',code:'missed',action:null};
  if(u.exitAt)return {name:'Finalizada',code:'done',action:'Ver registro'};
  const minute=now.getHours()*60+now.getMinutes(),today=dKey(now);
  if(u.entryAt)return {name:u.date<today||minute>=mins(u.plannedEnd)?'Salida pendiente':'En uso',code:'success',action:'Registrar salida'};
  if(u.date<today||(u.date===today&&minute>=mins(u.plannedEnd)))return {name:'Sin entrada (vencida)',code:'missed',action:null};
  if(u.date===today&&minute>=mins(u.plannedStart))return {name:'Entrada disponible',code:'success',action:'Registrar entrada'};
  return {name:'Reservada',code:'wait',action:null};
}
function renderFreeSpaces(){
  const today=dKey(new Date()),date=freeViewDate<today?today:freeViewDate;
  freeViewDate=date;
  const input=byId('freeDate');input.value=date;input.min=today;
  const t=termForDate(date),m=new Date().getHours()*60+new Date().getMinutes(),isToday=date===today;
  byId('termChip').textContent=t?t.name:'Periodo no configurado';
  let available=0;
  const html=[1,2,3,4].map(room=>{
    const slots=freeIntervals(date,room).filter(([a,b])=>!isToday||b>m+14);
    available+=slots.length;
    return `<div class="space-room"><div class="space-title"><span>Aula Digital ${room}</span><span class="status ${slots.length?'success':'wait'}">${slots.length?'Disponible':'Sin espacios'}</span></div>`+
    (slots.length?slots.map(([a,b])=>{
      const begin=isToday?Math.max(a,m):a;
      const len=b-begin;
      return `<div class="slot-line"><div><div class="slot-time">${hhmm(begin)} – ${hhmm(b)} h</div><div class="slot-help">${len} minutos disponibles${isToday&&a<m?' · espacio libre ahora':''}</div></div><button class="btn smallbtn main" data-free-book="1" data-date="${date}" data-room="${room}" data-start="${hhmm(a)}" data-end="${hhmm(b)}">Solicitar uso</button></div>`;
    }).join(''):'<p class="muted small">Sin intervalos disponibles para reservar en esta fecha.</p>')+'</div>';
  }).join('');
  byId('freeSummary').textContent=t?`${DAYS[dayNo(new Date(date+'T12:00:00'))]} ${fmtDate(date)} · ${t.name} · ${available} intervalos disponibles para solicitar`:`${fmtDate(date)} · No hay cuatrimestre configurado para esta fecha. Crea el periodo en Administración.`;
  byId('freeSlots').innerHTML=t?html:'<div class="empty-tight">No existe un cuatrimestre para esa fecha. Pide a Administración que cargue el siguiente horario.</div>';
  byId('freeSlots').querySelectorAll('[data-free-book]').forEach(b=>b.onclick=()=>openFreeForm(b.dataset.date,Number(b.dataset.room),b.dataset.start,b.dataset.end));
  const uses=freeUsesFor(date).filter(u=>!u.canceledAt).sort((a,b)=>mins(a.plannedStart)-mins(b.plannedStart)||a.room-b.room);
  byId('freeCount').textContent=`${uses.length} solicitud${uses.length===1?'':'es'}`;
  byId('freeUses').innerHTML=uses.length?uses.map(u=>{
    const st=useState(u),arr=u.entryAt?new Date(u.entryAt).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit',hour12:false}):'—',out=u.exitAt?new Date(u.exitAt).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit',hour12:false}):'—';
    return `<div class="usecard"><div><div class="use-name">${safe(u.fullName)}</div><div class="use-details">Aula Digital ${u.room} · ${safe(u.plannedStart)} – ${safe(u.plannedEnd)} h</div><div class="use-details">Entrada real: ${arr} · Salida real: ${out}</div></div><div class="use-side"><span class="status ${st.code}">${st.name}</span>${st.action?`<button class="btn smallbtn ${st.code==='success'?'main':''}" data-use-action="${safe(u.id)}">${st.action}</button>`:''}</div></div>`;
  }).join(''):'<div class="empty-tight">Todavía no hay solicitudes de uso libre para esta fecha.</div>';
  byId('freeUses').querySelectorAll('[data-use-action]').forEach(b=>b.onclick=()=>showFreeUse(b.dataset.useAction));
}
function openFreeForm(date,room,blockStart,blockEnd){
  const today=dKey(new Date());if(date<today)return flash('Consulta nuevamente la disponibilidad.');
  const now=new Date(),cur=now.getHours()*60+now.getMinutes();
  const start=hhmm(date===today?Math.max(mins(blockStart),cur):mins(blockStart));
  const end=hhmm(Math.min(mins(blockEnd),mins(start)+60));
  if(mins(blockEnd)-mins(start)<15)return flash('No queda tiempo suficiente para un nuevo uso.');
  modal(`<span class="tag">Aula Digital ${room}</span><h3 style="margin-top:12px">Solicitud de uso de espacio libre</h3><p class="muted small">${fmtDate(date)} · Espacio disponible: ${safe(blockStart)} a ${safe(blockEnd)} h</p>
    <form id="freeForm" class="formgrid"><div class="field wide"><label for="freeName">Nombre completo *</label><input class="input" id="freeName" name="fullName" required minlength="5" maxlength="120" autocomplete="name" placeholder="Nombre y apellidos" /></div>
    <div class="field wide"><label for="freeEmail">Correo electrónico *</label><input type="email" class="input" id="freeEmail" name="email" required maxlength="160" autocomplete="email" placeholder="nombre@institucion.edu.mx" /></div>
    <div class="field"><label for="freeStart">Inicio solicitado *</label><input type="time" class="input" id="freeStart" name="start" value="${start}" min="${safe(blockStart)}" max="${safe(blockEnd)}" step="60" required /></div>
    <div class="field"><label for="freeEnd">Fin solicitado *</label><input type="time" class="input" id="freeEnd" name="end" value="${end}" min="${safe(blockStart)}" max="${safe(blockEnd)}" step="60" required /></div>
    <div class="field wide"><label for="freeReason">Motivo del uso *</label><textarea class="input" style="width:100%;min-height:91px;resize:vertical" id="freeReason" name="reason" maxlength="500" minlength="5" required placeholder="Describe para qué utilizarás el aula"></textarea></div>
    <div class="field wide"><p class="form-note">Al guardar la solicitud, sus datos (nombre, correo, aula, fecha, horario y motivo) se notificarán a ${ADMIN_MAIL} cuando el correo institucional esté configurado. Esta solicitud no garantiza autorización adicional.</p></div>
    <div class="field wide"><label style="display:flex;gap:8px;align-items:flex-start;font-weight:500"><input type="checkbox" id="freeInstant" ${date===today&&mins(start)<=cur&&cur<mins(end)?'checked':date===today?'':'disabled'} /> Registrar también mi entrada ahora, si ya inició el horario seleccionado</label><div class="form-note">La reserva no equivale a una entrada. Puedes registrar la entrada al llegar, nunca antes del inicio; al terminar, deberás registrar la salida.</div></div>
    <div class="field wide ${date===today&&mins(start)<=cur&&cur<mins(end)?'':'hidden'}" id="freeInstantNotice">${handoverNotice('entry','instantHandover')}</div>
    <div class="field wide"><div class="modal-actions"><button class="btn" type="button" data-close>Cancelar</button><button class="btn main" type="submit">Guardar solicitud</button></div></div></form>`);
  byId('freeInstant').onchange=()=>byId('freeInstantNotice').classList.toggle('hidden',!byId('freeInstant').checked);
  const form=byId('freeForm');form.onsubmit=e=>{
    e.preventDefault();if(!form.reportValidity())return;
    const f=new FormData(form),fullName=String(f.get('fullName')||'').trim(),email=String(f.get('email')||'').trim(),reason=String(f.get('reason')||'').trim(),start=String(f.get('start')),end=String(f.get('end'));
    if(fullName.length<5||reason.length<5)return alert('Completa el nombre completo y el motivo del uso.');
    const issue=validFreeRequest(date,room,start,end);if(issue)return alert(issue);
    const instant=byId('freeInstant').checked,real=new Date(),minute=real.getHours()*60+real.getMinutes();
    if(instant){
      if(date!==dKey(real)||minute<mins(start)||minute>=mins(end))return alert('La entrada solo puede registrarse durante el horario solicitado. Desmarca la entrada ahora para guardar únicamente la reserva.');
      if(db.logs.some(l=>l.date===date&&l.room===room&&l.entryAt&&!l.exitAt))return alert('Esta aula tiene una clase cuya salida sigue pendiente. Primero debe registrarse.');
      if(!handoverReady('instantHandover','entry'))return;
    }
    const t=termForDate(date);
    const item={id:'free-'+Date.now()+'-'+Math.random().toString(36).slice(2,8),termId:t.id,date,room,fullName,email,reason,plannedStart:start,plannedEnd:end,entryAt:instant?real.toISOString():null,exitAt:null,note:'',createdAt:real.toISOString(),canceledAt:null};
    if(instant)stampHandover(item,'entry',item.entryAt);
    item.emailNotification=mailConfigured()?'sending':'not_configured';
    db.freeUses.push(item);
    save();closeModal();renderKiosk();
    flash(instant?'Solicitud y entrada guardadas':'Solicitud guardada. Registra tu entrada cuando llegues.');
    // El aviso es adicional: el registro local queda guardado incluso sin Internet.
    if(mailConfigured())void notifyNewFreeUse(item);
    else flash('Solicitud guardada. Configura avisos en Administración > Correo institucional.');
  };
}
function showFreeUse(id){
  const u=db.freeUses.find(x=>x.id===id);
  if(!u||u.canceledAt)return flash('No se encontró la solicitud.');
  const st=useState(u);
  if(!st.action)return flash('La entrada todavía no está disponible o esta solicitud ya venció.');
  if(u.exitAt)return modal(`<h3>Uso finalizado</h3><p>${safe(u.fullName)} · Aula Digital ${u.room}</p><div class="prominent">Entrada: <strong>${new Date(u.entryAt).toLocaleString('es-MX')}</strong><br>Salida: <strong>${new Date(u.exitAt).toLocaleString('es-MX')}</strong></div><p class="muted small">${u.keyReturnedAt&&u.identificationReturnedAt?'Llave e identificación: devolución confirmada.':'Control físico: no consta en este registro anterior.'}</p>${u.earlyExitReason?`<p class="early-exit-summary"><b>Motivo de salida anticipada:</b> ${safe(u.earlyExitReason)}</p>`:''}<div class="modal-actions"><button class="btn" data-close>Cerrar</button></div>`);
  const exiting=!!u.entryAt,kind=exiting?'exit':'entry';
  modal(`<span class="tag">Aula Digital ${u.room}</span><h3 style="margin-top:12px">${exiting?'Registrar salida de uso libre':'Registrar entrada de uso libre'}</h3><p class="muted small">${safe(u.fullName)} · ${fmtDate(u.date)} · ${safe(u.plannedStart)} a ${safe(u.plannedEnd)} h</p><div class="prominent">Hora actual: <strong id="modalNow">${new Date().toLocaleTimeString('es-MX',{hour12:false})}</strong></div>${handoverNotice(kind,'freeHandover')}${exiting?earlyExitField(u.date,u.plannedEnd,'useEarlyReason'):''}<div class="modal-actions"><button class="btn" data-close>Cancelar</button><button class="btn main" id="confirmFreeUse">${exiting?'Registrar salida':'Confirmar entrada'}</button></div>`);
  byId('confirmFreeUse').onclick=()=>{
    const now=new Date(),minute=now.getHours()*60+now.getMinutes(),date=dKey(now),fresh=db.freeUses.find(x=>x.id===id);
    if(!fresh||fresh.canceledAt)return flash('La solicitud ya no está disponible.');
    if(exiting){
      if(!fresh.entryAt||fresh.exitAt)return flash('La salida ya se registró.');
      const early=isEarlyExit(fresh.date,fresh.plannedEnd,now);
      const reason=getEarlyExitReason(early,'useEarlyReason');
      if(reason===null)return;
      if(!handoverReady('freeHandover','exit'))return;
      fresh.exitAt=now.toISOString();fresh.earlyExitReason=reason;
      stampHandover(fresh,'exit',fresh.exitAt);
    }else{
      if(fresh.entryAt)return flash('La entrada ya se registró.');
      if(date!==fresh.date||minute<mins(fresh.plannedStart)||minute>=mins(fresh.plannedEnd))return alert('La entrada solo está permitida durante el horario reservado, nunca antes.');
      if(db.logs.some(l=>l.date===date&&l.room===fresh.room&&l.entryAt&&!l.exitAt))return alert('Hay una clase con salida pendiente en esta aula.');
      if(db.freeUses.some(x=>x.id!==fresh.id&&x.date===date&&x.room===fresh.room&&!x.canceledAt&&x.entryAt&&!x.exitAt))return alert('Hay otro uso del aula con salida pendiente.');
      if(!handoverReady('freeHandover','entry'))return;
      fresh.entryAt=now.toISOString();
      stampHandover(fresh,'entry',fresh.entryAt);
    }
    save();closeModal();renderKiosk();flash(exiting?'Salida guardada · llave devuelta e identificación recuperada':'Entrada guardada · llave entregada e identificación resguardada');
  };
}
function freeUseRows(termId=null,year=null){
  return db.freeUses.filter(u=>(!termId||u.termId===termId)&&(!year||u.date.startsWith(String(year)+'-')))
    .sort((a,b)=>b.date.localeCompare(a.date)||mins(a.plannedStart)-mins(b.plannedStart)||a.room-b.room);
}
function freeUsageStats(rows){
  const real=rows.filter(u=>!u.canceledAt);
  return {total:real.length,completed:real.filter(u=>u.exitAt).length,inUse:real.filter(u=>u.entryAt&&!u.exitAt).length,booked:real.filter(u=>!u.entryAt).length,minutes:real.reduce((n,u)=>n+(u.entryAt&&u.exitAt?Math.max(0,Math.round((new Date(u.exitAt)-new Date(u.entryAt))/60000)):0),0)};
}
const FREE_COLUMNS=['Fecha','Cuatrimestre','Aula','Nombre completo','Correo electrónico','Motivo del uso','Inicio solicitado','Fin solicitado','Entrada real','Salida real','Estado','Tiempo real (min)','Observaciones','Motivo de salida anticipada','Fecha de solicitud','Identificación entregada al ingresar','Llave recibida al ingresar','Llave devuelta al salir','Identificación recuperada al salir','Estado del aviso por correo'];
function freeRow(u){
  const t=db.terms.find(x=>x.id===u.termId),fmt=val=>val?new Date(val).toLocaleString('es-MX',{hour12:false}):'',state=useState(u).name;
  return [u.date,t?.name||u.termId,u.room,u.fullName,u.email,u.reason,u.plannedStart,u.plannedEnd,fmt(u.entryAt),fmt(u.exitAt),state,u.entryAt&&u.exitAt?Math.max(0,Math.round((new Date(u.exitAt)-new Date(u.entryAt))/60000)):'',u.note||'',u.earlyExitReason||'',fmt(u.createdAt),u.identificationDepositedAt?'Sí':'Sin constancia',u.keyDeliveredAt?'Sí':'Sin constancia',u.keyReturnedAt?'Sí':'Sin constancia',u.identificationReturnedAt?'Sí':'Sin constancia',mailStatusText(u)];
}
function exportFreeQuarter(t=selectedReportTerm()){const rows=freeUseRows(t.id);csvExport(`Usos_Libres_UTEQ_${t.id}.csv`,[FREE_COLUMNS,...rows.map(freeRow)]);flash('Usos de espacios libres descargados');}
function exportFreeAnnual(year=annualYear){const rows=freeUseRows(null,year);csvExport(`Usos_Libres_Anual_UTEQ_${year}.csv`,[FREE_COLUMNS,...rows.map(freeRow)]);flash('Usos libres del año descargados');}
function freeReportHtml(t){
  const rows=freeUseRows(t.id),st=freeUsageStats(rows);
  return `<section class="panel"><div class="filterrow"><div><h3>Uso de espacios libres · ${safe(t.name)}</h3><p class="muted small">Solicitudes adicionales, entradas y salidas reales. El CSV incluye correo y motivo.</p></div><button class="btn main no-print" id="exportFreeQuarter">↓ Reporte de usos libres CSV</button></div>
    <div class="stats"><div class="stat"><strong>${st.total}</strong><span>Solicitudes no canceladas</span></div><div class="stat"><strong>${st.completed}</strong><span>Usos finalizados</span></div><div class="stat"><strong>${st.inUse}</strong><span>Salidas pendientes</span></div><div class="stat"><strong>${st.minutes}</strong><span>Minutos registrados</span></div></div>
    <div class="tablewrap"><table><thead><tr><th>Fecha</th><th>Aula</th><th>Persona</th><th>Horario solicitado</th><th>Entrada</th><th>Salida</th><th>Estado</th><th>Motivo de salida anticipada</th></tr></thead><tbody>${rows.slice(0,150).map(u=>`<tr><td>${safe(u.date)}</td><td>${u.room}</td><td>${safe(u.fullName)}</td><td>${safe(u.plannedStart)}–${safe(u.plannedEnd)}</td><td>${u.entryAt?new Date(u.entryAt).toLocaleTimeString('es-MX',{hour12:false}):'—'}</td><td>${u.exitAt?new Date(u.exitAt).toLocaleTimeString('es-MX',{hour12:false}):'—'}</td><td>${safe(useState(u).name)}</td><td style="max-width:280px;white-space:normal">${safe(u.earlyExitReason||'—')}</td></tr>`).join('')||'<tr><td colspan="8">Todavía no hay usos libres registrados en este periodo.</td></tr>'}</tbody></table></div></section>`;
}
function annualFreeHtml(year){
  const rows=freeUseRows(null,year),st=freeUsageStats(rows);
  return `<section class="panel"><div class="filterrow"><div><h3>Uso adicional de aulas · Reporte anual ${year}</h3><p class="muted small">Historial acumulado de solicitudes de espacios libres de todos los cuatrimestres.</p></div><button class="btn main no-print" id="annualFreeExport">↓ Usos libres del año CSV</button></div>
    <div class="stats"><div class="stat"><strong>${st.total}</strong><span>Solicitudes adicionales</span></div><div class="stat"><strong>${st.completed}</strong><span>Usos concluidos</span></div><div class="stat"><strong>${st.inUse}</strong><span>Salidas pendientes</span></div><div class="stat"><strong>${st.minutes}</strong><span>Minutos de uso real</span></div></div>
    <div class="tablewrap"><table><thead><tr><th>Cuatrimestre</th><th>Solicitudes</th><th>Finalizadas</th><th>Salidas pendientes</th><th>Minutos registrados</th></tr></thead><tbody>${annualPeriods(year).map(t=>{const st=freeUsageStats(freeUseRows(t.id,year));return `<tr><td>${safe(t.name)}</td><td>${st.total}</td><td>${st.completed}</td><td>${st.inUse}</td><td>${st.minutes}</td></tr>`}).join('')||'<tr><td colspan="5">No existen periodos para el año seleccionado.</td></tr>'}</tbody></table></div></section>`;
}
function csvEscape(x){let s=String(x==null?'':x);if(/^[\s]*[=+@]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'}
function download(name,content,type='text/csv;charset=utf-8'){let blob=new Blob([content],{type}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1000)}
function csvExport(name,rows){let data='\ufeff'+rows.map(r=>r.map(csvEscape).join(',')).join('\r\n');download(name,data)}
function parseCSV(source){let x=source.replace(/^\ufeff/,'').trim(),delimiter=(x.split(/\r?\n/,1)[0].match(/;/g)||[]).length>(x.split(/\r?\n/,1)[0].match(/,/g)||[]).length?';':',';let rows=[],line=[],field='',quoted=false;for(let i=0;i<x.length;i++){const c=x[i];if(c==='"'){if(quoted&&x[i+1]==='"'){field+='"';i++}else quoted=!quoted;}else if(c===delimiter&&!quoted){line.push(field);field=''}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&x[i+1]==='\n')i++;line.push(field);if(line.some(y=>y.trim()))rows.push(line);line=[];field=''}else field+=c}line.push(field);if(line.some(y=>y.trim()))rows.push(line);return rows}
function parseScheduleCsv(content){const rows=parseCSV(content);if(rows.length<2)throw Error('No se encontraron clases.');const names=rows[0].map(h=>h.trim().toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,'_'));const idx=(...terms)=>names.findIndex(n=>terms.includes(n));const cols=[idx('dia','day','weekday'),idx('aula','room'),idx('inicio','start'),idx('fin','end'),idx('docente','teacher'),idx('materia','subject'),idx('grupo','group_name')];if(cols.some(x=>x<0))throw Error('El CSV debe incluir: dia, aula, inicio, fin, docente, materia y grupo.');let shift=idx('turno','shift');let weekday=v=>{const q=String(v).trim().toLocaleLowerCase('es').normalize('NFD').replace(/[\u0300-\u036f]/g,'');const day=['lunes','martes','miercoles','jueves','viernes','sabado','domingo'].indexOf(q);return day>=0?day:Number.isInteger(Number(q))&&Number(q)>=0&&Number(q)<=6?Number(q):-1};const checkTime=x=>/^\d{1,2}:\d{2}$/.test(x)&&mins(x)<1440;const out=[];for(let i=1;i<rows.length;i++){let r=rows[i],day=weekday(r[cols[0]]),room=Number(r[cols[1]]),start=String(r[cols[2]]||'').trim(),end=String(r[cols[3]]||'').trim(),teacher=String(r[cols[4]]||'').trim(),subject=String(r[cols[5]]||'').trim(),group_name=String(r[cols[6]]||'').trim();if(day<0||![1,2,3,4].includes(room)||!checkTime(start)||!checkTime(end)||mins(start)>=mins(end)||!teacher)throw Error(`Error en fila ${i+1}: revisa día, aula, horas y docente.`);out.push({id:`csv-${Date.now()}-${i}`,weekday:day,room,start:start.padStart(5,'0'),end:end.padStart(5,'0'),teacher,subject,group_name,shift:shift>=0?String(r[shift]||'').trim():''})}return out}
function downloadSchedule(t=term()){let rows=[['dia','aula','inicio','fin','docente','materia','grupo','turno'],...t.schedule.map(s=>[DAYS[s.weekday],s.room,s.start,s.end,s.teacher,s.subject,s.group_name,s.shift||''])];csvExport('Horario_Aulas_'+t.id+'.csv',rows)}
function reportData(t=term(),year=null){
  const today=dKey(new Date()),start=[t.start,t.trackingStart||t.start,year?`${year}-01-01`:'0000-01-01'].sort().at(-1),end=[t.end,today,year?`${year}-12-31`:'9999-12-31'].sort()[0];
  const rows=[];if(start>end)return rows;
  const now=new Date(),minute=now.getHours()*60+now.getMinutes();
  for(let date=new Date(start+'T12:00:00');dKey(date)<=end;date.setDate(date.getDate()+1)){
    const dt=dKey(date),weekday=dayNo(date);
    if((t.holidays||[]).includes(dt))continue;
    for(const s of t.schedule){
      if(s.weekday!==weekday)continue;
      const log=logFor(s,dt,t),elapsed=dt<today||mins(s.end)<=minute;
      if(!elapsed&&!log)continue;
      const inDt=log?.entryAt?new Date(log.entryAt):null,outDt=log?.exitAt?new Date(log.exitAt):null;
      const inTime=inDt?`${pad(inDt.getHours())}:${pad(inDt.getMinutes())}`:'',outTime=outDt?`${pad(outDt.getHours())}:${pad(outDt.getMinutes())}`:'';
      const late=inDt?Math.max(0,inDt.getHours()*60+inDt.getMinutes()-mins(s.start)):null;
      const early=outDt?Math.max(0,mins(s.end)-(outDt.getHours()*60+outDt.getMinutes())):null;
      const duration=inDt&&outDt?Math.max(0,Math.round((outDt-inDt)/60000)):null;
      const status=outDt?'Completada':inDt?(elapsed?'Salida pendiente':'En curso'):'Sin entrada';
      rows.push({termId:t.id,termName:t.name,date:dt,weekday:DAYS[weekday],room:s.room,teacher:s.teacher,subject:s.subject,group:s.group_name,start:s.start,end:s.end,arrival:inTime,departure:outTime,late,early,duration,status,note:log?.note||'',earlyExitReason:log?.earlyExitReason||'',identificationDepositedAt:log?.identificationDepositedAt,keyDeliveredAt:log?.keyDeliveredAt,keyReturnedAt:log?.keyReturnedAt,identificationReturnedAt:log?.identificationReturnedAt});
    }
  }
  return rows.sort((a,b)=>b.date.localeCompare(a.date)||a.start.localeCompare(b.start)||a.room-b.room);
}
function annualPeriods(year){
  return db.terms.filter(t=>t.start<=`${year}-12-31`&&t.end>=`${year}-01-01`).sort((a,b)=>a.start.localeCompare(b.start));
}
function annualRows(year){
  return annualPeriods(year).flatMap(t=>reportData(t,year)).sort((a,b)=>b.date.localeCompare(a.date)||a.start.localeCompare(b.start)||a.room-b.room);
}
function rowStats(rows){
  return {total:rows.length,complete:rows.filter(r=>r.status==='Completada').length,missing:rows.filter(r=>r.status==='Sin entrada').length,pending:rows.filter(r=>r.status==='En curso'||r.status==='Salida pendiente').length,early:rows.filter(r=>r.early>0).length,late:rows.filter(r=>r.late>0).length,minutes:rows.reduce((n,r)=>n+(r.duration||0),0)};
}
function reportSummary(rows){
  const map=new Map();
  for(const r of rows){
    const key=r.teacher||'Sin nombre';
    if(!map.has(key))map.set(key,{teacher:key,total:0,completed:0,missing:0,pending:0,late:0,early:0,minutes:0});
    const x=map.get(key);x.total++;
    if(r.status==='Completada')x.completed++;
    if(r.status==='Sin entrada')x.missing++;
    if(r.status==='Salida pendiente'||r.status==='En curso')x.pending++;
    if(r.late>0)x.late++;if(r.early>0)x.early++;
    x.minutes+=r.duration||0;
  }
  return [...map.values()].sort((a,b)=>a.teacher.localeCompare(b.teacher,'es'));
}
const REPORT_COLUMNS=['Fecha','Día','Cuatrimestre','Aula','Docente','Materia','Grupo','Hora programada inicio','Hora programada fin','Entrada real','Salida real','Retraso (min)','Salida anticipada (min)','Tiempo en aula (min)','Estado','Observaciones','Motivo de salida anticipada','Identificación entregada al ingresar','Llave recibida al ingresar','Llave devuelta al salir','Identificación recuperada al salir'];
const reportRow=r=>[r.date,r.weekday,r.termName,r.room,r.teacher,r.subject,r.group,r.start,r.end,r.arrival,r.departure,r.late??'',r.early??'',r.duration??'',r.status,r.note,r.earlyExitReason||'',r.identificationDepositedAt?'Sí':'Sin constancia',r.keyDeliveredAt?'Sí':'Sin constancia',r.keyReturnedAt?'Sí':'Sin constancia',r.identificationReturnedAt?'Sí':'Sin constancia'];
const SUMMARY_COLUMNS=['Docente','Clases transcurridas','Completadas','Sin entrada','Pendientes','Entradas con retraso','Salidas anticipadas','Minutos registrados'];
const summaryRow=x=>[x.teacher,x.total,x.completed,x.missing,x.pending,x.late,x.early,x.minutes];
function downloadReport(){const t=selectedReportTerm(),rows=reportData(t);csvExport('Registro_Aulas_'+t.id+'.csv',[REPORT_COLUMNS,...rows.map(reportRow)]);flash('Reporte del cuatrimestre descargado')}
function downloadSummary(){const t=selectedReportTerm(),rows=reportSummary(reportData(t));csvExport('Resumen_Docentes_'+t.id+'.csv',[SUMMARY_COLUMNS,...rows.map(summaryRow)])}
function annualDetailExport(){const rows=annualRows(annualYear);csvExport(`Reporte_Anual_Detallado_UTEQ_${annualYear}.csv`,[REPORT_COLUMNS,...rows.map(reportRow)]);flash('Reporte anual descargado')}
function annualSummaryExport(){const rows=reportSummary(annualRows(annualYear));csvExport(`Resumen_Docentes_Anual_UTEQ_${annualYear}.csv`,[SUMMARY_COLUMNS,...rows.map(summaryRow)])}
function annualPeriodsExport(){const periods=annualPeriods(annualYear),rows=periods.map(t=>({t,...rowStats(reportData(t,annualYear))}));csvExport(`Resumen_Cuatrimestres_UTEQ_${annualYear}.csv`,[['Año','Periodo','Fecha de inicio','Fecha de fin','Bloques por semana','Clases transcurridas','Completadas','Sin entrada','Pendientes','Entradas tardías','Salidas anticipadas','Minutos registrados','Usos libres solicitados','Usos libres finalizados','Minutos de uso libre'],...rows.map(x=>[annualYear,x.t.name,x.t.start,x.t.end,x.t.schedule.length,x.total,x.complete,x.missing,x.pending,x.late,x.early,x.minutes,freeUsageStats(freeUseRows(x.t.id,annualYear)).total,freeUsageStats(freeUseRows(x.t.id,annualYear)).completed,freeUsageStats(freeUseRows(x.t.id,annualYear)).minutes])])}
function annualSchedulesExport(){const rows=annualPeriods(annualYear).flatMap(t=>t.schedule.map(s=>[annualYear,t.name,t.start,t.end,DAYS[s.weekday],s.room,s.start,s.end,s.teacher,s.subject,s.group_name,s.shift||'']));csvExport(`Historial_Horarios_UTEQ_${annualYear}.csv`,[['Año','Cuatrimestre','Inicio del cuatrimestre','Fin del cuatrimestre','Día','Aula','Inicio','Fin','Docente','Materia','Grupo','Turno'],...rows]);flash('Historial de horarios descargado')}
function selectedReportTerm(){return db.terms.find(t=>t.id===reportTermId)||term()}
function selectedScheduleTerm(){return db.terms.find(t=>t.id===scheduleTermId)||term()}
function yearsAvailable(){let years=new Set([new Date().getFullYear()]);for(const t of db.terms){const from=Number(t.start.slice(0,4)),to=Number(t.end.slice(0,4));for(let y=from;y<=Math.min(to,from+10);y++)years.add(y)}return [...years].sort((a,b)=>b-a)}
function statsTiles(st){return `<div class="stats"><div class="stat"><strong>${st.total}</strong><span>Clases transcurridas</span></div><div class="stat"><strong>${st.complete}</strong><span>Entradas y salidas completas</span></div><div class="stat"><strong>${st.missing}</strong><span>Sin entrada registrada</span></div><div class="stat"><strong>${st.pending}</strong><span>Salidas pendientes / en curso</span></div></div>`}

function renderAdmin(){
  byId('adminTabs').querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('chosen',b.dataset.tab===activeTab));
  const panel=byId('adminContent');
  if(activeTab==='report'){
    const t=selectedReportTerm(),rows=reportData(t),st=rowStats(rows);
    panel.innerHTML=`<section class="panel">
      <div class="filterrow"><div><h3>Reporte por cuatrimestre</h3><p class="muted small">Consulta cualquier periodo almacenado sin cambiar la pantalla de registro.</p></div>
      <div class="field" style="min-width:min(100%,290px)"><label for="reportTerm">Cuatrimestre a consultar</label><select class="input" id="reportTerm" style="width:100%">${db.terms.map(x=>`<option value="${safe(x.id)}" ${x.id===t.id?'selected':''}>${safe(x.name)}</option>`).join('')}</select></div></div>
      <div class="muted small">${fmtDate(t.start)} al ${fmtDate(t.end)} · registros contabilizados desde ${fmtDate(t.trackingStart||t.start)}</div>
      ${statsTiles(st)}
      <div class="actions no-print" style="margin:17px 0"><button id="exportDetail" class="btn main">↓ Detallado CSV</button><button id="exportSummary" class="btn">↓ Resumen por docente</button><button id="printReport" class="btn">Imprimir</button></div>
      <p class="muted small">Solo se incluyen clases cuyo horario ya transcurrió o que tienen un registro. Una clase sin entrada no demuestra ausencia del docente.</p>
      <div class="tablewrap"><table><thead><tr><th>Fecha</th><th>Aula</th><th>Docente</th><th>Programado</th><th>Entrada</th><th>Salida</th><th>Estado</th><th>Motivo salida anticipada</th></tr></thead>
      <tbody>${rows.slice(0,250).map(x=>`<tr><td>${safe(x.date)}</td><td>${x.room}</td><td>${safe(x.teacher)}</td><td>${x.start}–${x.end}</td><td>${x.arrival||'—'}</td><td>${x.departure||'—'}</td><td>${safe(x.status)}</td><td style="max-width:280px;white-space:normal">${safe(x.earlyExitReason||'—')}</td></tr>`).join('')||'<tr><td colspan="8">Aún no hay registros para este periodo.</td></tr>'}</tbody></table></div>
      <p class="muted small">Se muestran hasta 250 filas; el archivo CSV incluye todas las filas.</p></section>`;
    panel.insertAdjacentHTML('beforeend',freeReportHtml(t));
    byId('exportFreeQuarter').onclick=()=>exportFreeQuarter(t);
    byId('reportTerm').onchange=e=>{reportTermId=e.target.value;renderAdmin()};
    byId('exportDetail').onclick=downloadReport;
    byId('exportSummary').onclick=downloadSummary;
    byId('printReport').onclick=()=>print();
    return;
  }
  if(activeTab==='annual'){
    const periods=annualPeriods(annualYear),rows=annualRows(annualYear),st=rowStats(rows);
    panel.innerHTML=`<section class="panel">
      <div class="filterrow"><div><h3>Reporte anual de Aulas Digitales</h3><p class="muted small">Consolida todos los cuatrimestres del año calendario, sus clases y registros.</p></div>
      <div class="field" style="min-width:160px"><label for="annualYear">Año a consultar</label><select class="input" id="annualYear" style="width:100%">${yearsAvailable().map(y=>`<option value="${y}" ${y===annualYear?'selected':''}>${y}</option>`).join('')}</select></div></div>
      <div class="history-banner"><div><span>Cuatrimestres almacenados en ${annualYear}</span><strong>${periods.length}</strong></div><div><span>Bloques semanales en los horarios archivados</span><strong>${periods.reduce((n,t)=>n+t.schedule.length,0)}</strong></div></div>
      ${statsTiles(st)}
      <div class="actions no-print" style="margin:17px 0"><button id="annualDetail" class="btn main">↓ Registro anual CSV</button><button id="annualTeacher" class="btn">↓ Resumen por docente</button><button id="annualPeriod" class="btn">↓ Resumen por cuatrimestre</button><button id="annualSchedules" class="btn ink">↓ Historial de horarios</button></div>
      <p class="muted small">Los reportes anuales se calculan con los periodos guardados y sus fechas de seguimiento. Las clases futuras no cuentan como faltantes.</p>
      <h3 style="margin-top:22px">Resultados por cuatrimestre</h3>
      <div class="tablewrap"><table><thead><tr><th>Periodo</th><th>Fechas</th><th>Bloques semanales</th><th>Transcurridas</th><th>Completadas</th><th>Sin entrada</th><th>Pendientes</th><th>Salidas anticipadas</th></tr></thead><tbody>${periods.map(t=>{const s=rowStats(reportData(t,annualYear));return `<tr><td><b>${safe(t.name)}</b></td><td>${safe(t.start)} – ${safe(t.end)}</td><td>${t.schedule.length}</td><td>${s.total}</td><td>${s.complete}</td><td>${s.missing}</td><td>${s.pending}</td><td>${s.early}</td></tr>`}).join('')||'<tr><td colspan="8">Todavía no hay cuatrimestres registrados para este año.</td></tr>'}</tbody></table></div>
      <h3 style="margin-top:22px">Actividad por docente</h3>
      <div class="tablewrap"><table><thead><tr><th>Docente</th><th>Clases</th><th>Completadas</th><th>Sin entrada</th><th>Salidas anticipadas</th><th>Minutos registrados</th></tr></thead><tbody>${reportSummary(rows).slice(0,150).map(x=>`<tr><td>${safe(x.teacher)}</td><td>${x.total}</td><td>${x.completed}</td><td>${x.missing}</td><td>${x.early}</td><td>${x.minutes}</td></tr>`).join('')||'<tr><td colspan="6">Sin clases transcurridas en el año seleccionado.</td></tr>'}</tbody></table></div>
      <p class="muted small">La tabla muestra hasta 150 docentes; los CSV contienen el resumen completo. El historial de horarios contiene las asignaciones semanales de cada periodo.</p></section>`;
    panel.insertAdjacentHTML('beforeend',annualFreeHtml(annualYear));
    byId('annualFreeExport').onclick=()=>exportFreeAnnual(annualYear);
    byId('annualYear').onchange=e=>{annualYear=Number(e.target.value);renderAdmin()};
    byId('annualDetail').onclick=annualDetailExport;
    byId('annualTeacher').onclick=annualSummaryExport;
    byId('annualPeriod').onclick=annualPeriodsExport;
    byId('annualSchedules').onclick=annualSchedulesExport;
    return;
  }
  if(activeTab==='freeUses'){
    const t=db.terms.find(x=>x.id===freeTermId)||term(),rows=freeUseRows(t.id),st=freeUsageStats(rows);
    panel.innerHTML=`<section class="panel"><div class="filterrow"><div><h3>Control de uso de espacios libres</h3><p class="muted small">Consulta los datos completos y cancela solicitudes que aún no tengan entrada.</p></div><div class="field"><label>Cuatrimestre</label><select id="freeTermSelect" class="input">${db.terms.map(x=>`<option value="${safe(x.id)}" ${x.id===t.id?'selected':''}>${safe(x.name)}</option>`).join('')}</select></div></div>
      <div class="stats"><div class="stat"><strong>${st.total}</strong><span>Solicitudes</span></div><div class="stat"><strong>${st.completed}</strong><span>Finalizadas</span></div><div class="stat"><strong>${st.inUse}</strong><span>Salida pendiente</span></div><div class="stat"><strong>${st.booked}</strong><span>Sin entrada</span></div></div>
      <div class="actions no-print" style="margin:15px 0"><button id="adminFreeExport" class="btn main">↓ Exportar todas las solicitudes CSV</button></div>
      <div class="tablewrap"><table><thead><tr><th>Fecha</th><th>Aula</th><th>Nombre completo</th><th>Correo</th><th>Motivo del uso</th><th>Horario</th><th>Estado</th><th>Motivo salida anticipada</th><th>Aviso por correo</th><th>Acciones</th></tr></thead><tbody>${rows.map(u=>`<tr><td>${safe(u.date)}</td><td>${u.room}</td><td>${safe(u.fullName)}</td><td>${safe(u.email)}</td><td style="max-width:260px;white-space:normal">${safe(u.reason)}</td><td>${safe(u.plannedStart)}–${safe(u.plannedEnd)}</td><td>${safe(useState(u).name)}</td><td style="max-width:280px;white-space:normal">${safe(u.earlyExitReason||'—')}</td><td>${safe(mailStatusText(u))}</td><td><button class="btn smallbtn no-print" data-mail-retry="${safe(u.id)}" ${mailConfigured()?'':'disabled'}>Solicitar aviso</button>${!u.entryAt&&!u.canceledAt?`<button class="btn smallbtn danger no-print" data-free-cancel="${safe(u.id)}">Cancelar</button>`:'—'}</td></tr>`).join('')||'<tr><td colspan="10">Todavía no hay solicitudes para este cuatrimestre.</td></tr>'}</tbody></table></div>
      <p class="muted small">Una cancelación conserva su registro para auditoría y libera el horario. Los datos personales no se muestran en la pantalla pública.</p></section>`;
    byId('freeTermSelect').onchange=e=>{freeTermId=e.target.value;renderAdmin()};
    byId('adminFreeExport').onclick=()=>exportFreeQuarter(t);
    panel.querySelectorAll('[data-mail-retry]').forEach(b=>b.onclick=()=>{
      const u=db.freeUses.find(x=>x.id===b.dataset.mailRetry);
      if(!u)return flash('No se encontró la solicitud.');
      if(!mailConfigured())return alert('Primero configura el correo institucional.');
      if(!confirm('¿Solicitar nuevamente el aviso? El servicio evita duplicados recientes, pero podrían llegar dos correos si pasó mucho tiempo.'))return;
      b.disabled=true;void notifyNewFreeUse(u);
    });
    panel.querySelectorAll('[data-free-cancel]').forEach(b=>b.onclick=()=>{
      const u=db.freeUses.find(x=>x.id===b.dataset.freeCancel);
      if(!u||u.entryAt||u.canceledAt)return alert('Esta solicitud ya no puede cancelarse aquí.');
      if(!confirm(`¿Cancelar el uso de Aula ${u.room} de ${u.fullName} para ${u.date} a las ${u.plannedStart}?`))return;
      u.canceledAt=nowISO();save();renderAdmin();flash('Solicitud cancelada; espacio liberado');
    });
    return;
  }
  if(activeTab==='schedule'){
    const t=selectedScheduleTerm(),scheduled=[...t.schedule].sort((a,b)=>a.weekday-b.weekday||mins(a.start)-mins(b.start)||a.room-b.room);
    const locked=db.logs.some(x=>x.termId===t.id)||db.freeUses.some(x=>x.termId===t.id);
    panel.innerHTML=`<section class="panel">
      <div class="filterrow"><div><h3>Horarios archivados por cuatrimestre</h3><p class="muted small">Cada periodo conserva su propio horario para consultas y reportes posteriores.</p></div>
      <div class="field" style="min-width:min(100%,290px)"><label for="scheduleTerm">Consultar horario de</label><select id="scheduleTerm" class="input" style="width:100%">${db.terms.map(x=>`<option value="${safe(x.id)}" ${x.id===t.id?'selected':''}>${safe(x.name)}</option>`).join('')}</select></div></div>
      <div class="actions" style="margin:16px 0"><span class="tag">${t.schedule.length} clases semanales</span><button id="exportSchedule" class="btn">↓ Descargar horario CSV</button></div>
      <div class="notice">Importa un CSV con las columnas <b>dia, aula, inicio, fin, docente, materia, grupo, turno</b>. Descarga el horario actual como plantilla, edítalo en Excel y guárdalo como CSV UTF-8.</div>
      ${locked?'<p class="notice" style="margin-top:12px">Este horario está protegido porque ya tiene registros de entrada o salida. Puedes consultarlo y descargarlo, pero no reemplazarlo.</p>':`<div class="field" style="margin-top:16px"><label>Reemplazar horario de este cuatrimestre desde CSV</label><input type="file" id="scheduleFile" class="input" accept=".csv,text/csv" /></div>`}
      <div class="tablewrap"><table><thead><tr><th>Día</th><th>Aula</th><th>Horario</th><th>Docente</th><th>Materia</th><th>Grupo</th></tr></thead><tbody>${scheduled.map(s=>`<tr><td>${DAYS[s.weekday]}</td><td>${s.room}</td><td>${s.start}–${s.end}</td><td>${safe(s.teacher)}</td><td>${safe(s.subject)}</td><td>${safe(s.group_name)}</td></tr>`).join('')||'<tr><td colspan="6">No hay horario cargado para este periodo.</td></tr>'}</tbody></table></div></section>`;
    byId('scheduleTerm').onchange=e=>{scheduleTermId=e.target.value;renderAdmin()};
    byId('exportSchedule').onclick=()=>downloadSchedule(t);
    if(!locked)byId('scheduleFile').onchange=async e=>{
      const file=e.target.files[0];if(!file)return;
      try{
        const next=parseScheduleCsv(await file.text());
        if(db.logs.some(x=>x.termId===t.id)||db.freeUses.some(x=>x.termId===t.id))return alert('Este cuatrimestre ya tiene registros o solicitudes de uso libre. No es posible reemplazar el horario.');
        if(!confirm(`¿Reemplazar las ${t.schedule.length} clases por ${next.length} clases en ${t.name}?`))return;
        t.schedule=next;save();renderAdmin();flash('Horario guardado para este cuatrimestre');
      }catch(err){alert('No se pudo importar el horario: '+err.message)}
    };
    return;
  }
  if(activeTab==='terms'){
    panel.innerHTML=`<section class="panel"><h3>Historial de cuatrimestres</h3>
      <p class="muted small">Los periodos no se borran. La pantalla de entrada cambia automáticamente al cuatrimestre que corresponda a la fecha actual; aquí eliges cuál administrar.</p>
      ${[...db.terms].sort((a,b)=>b.start.localeCompare(a.start)).map(t=>`<div class="termrow"><div><b>${safe(t.name)}</b>${t.id===operationalTerm().id?' <span class="tag">En pantalla hoy</span>':''}${t.id===db.active?' <span class="status done">Seleccionado para administrar</span>':''}<div class="small muted">${safe(t.start)} a ${safe(t.end)} · ${t.schedule.length} bloques semanales · ${db.logs.filter(x=>x.termId===t.id).length} clases registradas · ${freeUseRows(t.id).length} solicitudes libres</div></div><div class="actions"><button class="btn smallbtn" data-term-schedule="${safe(t.id)}">Ver horario</button><button class="btn smallbtn" data-term-report="${safe(t.id)}">Ver reporte</button>${t.id!==db.active?`<button class="btn smallbtn ink" data-activate="${safe(t.id)}">Administrar periodo</button>`:''}</div></div>`).join('')}
      <h3 style="margin:26px 0 13px">Crear el siguiente cuatrimestre</h3>
      <form id="newTermForm" class="formgrid"><div class="field wide"><label>Nombre del periodo</label><input class="input" name="name" required placeholder="Ej. Enero – Abril 2027" /></div><div class="field"><label>Fecha de inicio</label><input type="date" class="input" name="start" required /></div><div class="field"><label>Fecha de término</label><input type="date" class="input" name="end" required /></div><div class="field wide"><label><input name="copy" type="checkbox" checked /> Copiar inicialmente el horario activo (podrás sustituirlo por uno nuevo en Horarios)</label></div><div class="field wide"><button class="btn main" type="submit">Guardar nuevo cuatrimestre</button></div></form>
      <div class="footnote">El historial queda guardado en este navegador y en esta computadora. Descarga regularmente un respaldo completo JSON para no perder años anteriores.</div></section>
      <section class="panel"><h3>Configuración del periodo seleccionado · ${safe(term().name)}</h3><p class="muted small">La fecha inicial evita contar como clases sin entrada los días anteriores a la instalación. Marca las fechas sin clases para excluirlas del reporte.</p>
      <form id="trackingForm" class="actions"><input type="date" class="input" id="trackingStart" min="${term().start}" max="${term().end}" value="${term().trackingStart||term().start}" required /><button class="btn" type="submit">Guardar fecha de inicio del seguimiento</button></form>
      <h3 style="margin-top:24px">Días sin clases</h3><form id="addHoliday" class="actions"><input type="date" class="input" id="holidayDate" min="${term().start}" max="${term().end}" required /><button class="btn" type="submit">Excluir fecha</button></form>
      ${(term().holidays||[]).sort().map(d=>`<div class="adminrow"><b>${fmtDate(d)}</b><button class="btn smallbtn danger" data-holiday-remove="${d}">Quitar</button></div>`).join('')||'<p class="muted small">Sin fechas excluidas.</p>'}</section>`;
    byId('newTermForm').onsubmit=e=>{
      e.preventDefault();const f=new FormData(e.target),name=String(f.get('name')||'').trim(),start=String(f.get('start')||''),end=String(f.get('end')||'');
      if(!name||!start||!end||start>end)return alert('Revisa las fechas y el nombre.');
      if(db.terms.some(t=>start<=t.end&&end>=t.start))return alert('Las fechas se superponen con un cuatrimestre guardado. Revisa el periodo.');
      const id='term-'+Date.now(),copy=!!f.get('copy'),schedule=copy?term().schedule.map((s,i)=>({...s,id:`copy-${id}-${i}`})):[];
      db.terms.push({id,name,start,end,trackingStart:start,schedule,holidays:[]});db.active=id;reportTermId=id;scheduleTermId=id;
      save();renderAdmin();flash('Nuevo horario archivado; se mostrará en sus fechas');
    };
    byId('trackingForm').onsubmit=e=>{e.preventDefault();const value=byId('trackingStart').value;if(value<term().start||value>term().end)return alert('La fecha debe estar dentro del cuatrimestre.');term().trackingStart=value;save();renderAdmin();flash('Seguimiento actualizado')};
    byId('addHoliday').onsubmit=e=>{e.preventDefault();const d=byId('holidayDate').value;if(d<term().start||d>term().end)return alert('Fuera del periodo.');term().holidays=term().holidays||[];if(!term().holidays.includes(d))term().holidays.push(d);save();renderAdmin()};
    document.querySelectorAll('[data-activate]').forEach(b=>b.onclick=()=>{db.active=b.dataset.activate;save();renderAdmin();flash('Cuatrimestre seleccionado para administración')});
    document.querySelectorAll('[data-term-schedule]').forEach(b=>b.onclick=()=>{scheduleTermId=b.dataset.termSchedule;activeTab='schedule';renderAdmin()});
    document.querySelectorAll('[data-term-report]').forEach(b=>b.onclick=()=>{reportTermId=b.dataset.termReport;activeTab='report';renderAdmin()});
    document.querySelectorAll('[data-holiday-remove]').forEach(b=>b.onclick=()=>{term().holidays=term().holidays.filter(v=>v!==b.dataset.holidayRemove);save();renderAdmin()});
    return;
  }
  if(activeTab==='mail'){
    panel.innerHTML=`<section class="panel"><h3>Notificaciones de solicitudes por Gmail</h3>
      <p>Cuando una persona <strong>solicite un espacio libre</strong>, la estación enviará los datos del registro a <strong>${ADMIN_MAIL}</strong>, sin necesidad de que la persona abra Gmail.</p>
      <div class="notice">Para activarlo es necesario publicar una pequeña automatización con Google Apps Script. Nunca escribas tu contraseña de Gmail en la aplicación. El aviso puede necesitar conexión a Internet y permisos institucionales. La estación puede solicitar el envío, pero no confirmar su entrega; revisa la bandeja de entrada para verificarlo.</div>
      <form id="mailSettingsForm" class="formgrid" style="margin-top:16px">
        <div class="field wide"><label for="mailUrl">URL de implementación de Apps Script (/exec)</label><input id="mailUrl" type="url" class="input" placeholder="https://script.google.com/macros/s/.../exec" value="${safe(mailSettings.url)}" required /></div>
        <div class="field wide"><label for="mailToken">Clave de autorización (generada en Apps Script)</label><input id="mailToken" type="password" class="input" value="${safe(mailSettings.token)}" minlength="24" autocomplete="off" required /><p class="form-note">La clave se guarda en este navegador, no en el código ni en el respaldo JSON. Quien tenga acceso técnico al equipo podría extraerla; restringe el acceso a la estación.</p></div>
        <div class="field wide"><div class="actions"><button class="btn main" type="submit">Guardar configuración</button><button class="btn" type="button" id="mailTest">Enviar aviso de prueba</button><button class="btn ink" type="button" id="mailDiagnose">Diagnóstico: ver respuesta de Google ↗</button></div>
        <p class="form-note">El diagnóstico abre una pestaña con una respuesta JSON. Si aparece <strong>{"ok":true}</strong>, el script aceptó la solicitud de prueba; si aparece <strong>{"ok":false}</strong>, mostrará el motivo. Se envía un correo real de prueba.</p></div>
      </form>
      <p class="muted small">Estado: <strong>${mailConfigured()?'Configuración guardada (envío no verificado)':'Pendiente de configurar'}</strong>. Si necesitas que el correo se confirme automáticamente y se reintente hasta entregarse, será necesario migrar a un servidor propio con acuses.</p>
      </section>`;
    byId('mailSettingsForm').onsubmit=e=>{
      e.preventDefault();const url=byId('mailUrl').value.trim(),token=byId('mailToken').value.trim();
      if(!/^https:\/\/script\.google\.com\/(?:macros\/s|a\/macros\/[a-zA-Z0-9.-]+\/s)\/[a-zA-Z0-9_-]+\/exec$/.test(url))return alert('Introduce la URL /exec de una aplicación web de Apps Script.');
      if(token.length<24)return alert('La clave debe tener al menos 24 caracteres.');
      mailSettings={url,token};saveMailSettings();renderAdmin();flash('Configuración guardada. Envia un aviso de prueba para verificar Gmail.');
    };
    byId('mailTest').onclick=async()=>{
      if(!mailConfigured())return alert('Guarda primero la URL y la clave.');
      byId('mailTest').disabled=true;
      const ok=await submitMailNotice({event:'prueba',testId:'prueba-'+Date.now()});
      flash(ok?'Petición de prueba enviada. Revisa Gmail; no se puede verificar la entrega desde esta página.':'No se pudo conectar. Verifica Internet y la URL.');
      if(byId('mailTest'))byId('mailTest').disabled=false;
    };
    byId('mailDiagnose').onclick=()=>{
      if(!mailConfigured())return alert('Primero guarda la URL de Apps Script y la clave.');
      try{
        // El POST ocurre dentro del gesto de clic para permitir abrir la pestaña.
        sendMailForm({event:'prueba',testId:'diagnostico-'+Date.now()},true);
        flash('Se abrió el diagnóstico. Revisa la respuesta JSON y Gmail.');
      }catch(err){
        console.error('Diagnóstico de correo:',err);
        alert('No se pudo abrir el diagnóstico. Revisa los permisos de ventanas emergentes del navegador.');
      }
    };
    return;
  }
  if(activeTab==='settings'){
    panel.innerHTML=`<section class="panel"><h3>Respaldo histórico de todos los cuatrimestres</h3>
      <p class="muted small">El respaldo JSON incluye horarios, registros de clases, solicitudes de espacios libres, datos de contacto, entradas, salidas, confirmaciones de préstamo de llaves e identificaciones y configuración de todos los cuatrimestres. Descárgalo y guárdalo fuera de la computadora (por ejemplo, en una unidad institucional).</p>
      <div class="actions"><button id="backup" class="btn main">↓ Descargar respaldo completo JSON</button><label class="btn" for="restore">↑ Restaurar respaldo</label><input id="restore" type="file" accept=".json,application/json" class="hidden" /></div>
      <div class="notice" style="margin-top:16px">Los datos se sincronizan con Neon Data API cuando se muestra «Guardado en Neon». Si dice «Pendiente» o «Sin sincronizar», permanece solo una copia local. El PIN es una barrera visual, NO un mecanismo seguro de autorización de bases de datos. Antes de utilizarlo institucionalmente en una estación compartida, TI debe separar los permisos del kiosco y de administración.</div></section>
      <section class="panel"><h3>PIN del administrador</h3><p class="muted small">Cambiar el PIN de 4 a 8 dígitos.</p><form id="pinForm" class="actions"><input id="pinNew" class="input" placeholder="Nuevo PIN de 4 a 8 dígitos" type="password" pattern="[0-9]{4,8}" minlength="4" maxlength="8" required /><button class="btn" type="submit">Guardar PIN</button></form></section>`;
    byId('backup').onclick=()=>download('Respaldo_Aulas_UTEQ_'+dKey(new Date())+'.json',JSON.stringify(db,null,2),'application/json;charset=utf-8');
    byId('restore').onchange=async e=>{
      const f=e.target.files[0];if(!f)return;
      try{
        const data=JSON.parse(await f.text());
        if(!data||!Array.isArray(data.terms)||!data.terms.length||!Array.isArray(data.logs)||typeof data.active!=='string'||!data.terms.every(t=>t.id&&Array.isArray(t.schedule)&&t.start&&t.end)||!data.terms.some(t=>t.id===data.active))throw Error('Formato inválido');
        if(!confirm('¿Restaurar este respaldo? Sustituirá TODOS los cuatrimestres y registros de este equipo.'))return;
        db=data;if(!Array.isArray(db.freeUses))db.freeUses=[];save();reportTermId=db.active;scheduleTermId=db.active;freeTermId=db.active;annualYear=new Date().getFullYear();renderAdmin();flash('Respaldo histórico restaurado');
      }catch(err){alert('Archivo de respaldo inválido: '+err.message)}
    };
    byId('pinForm').onsubmit=e=>{e.preventDefault();const pin=byId('pinNew').value;if(!/^\d{4,8}$/.test(pin))return alert('Usa solo 4 a 8 dígitos.');db.adminPin=pin;save();flash('PIN actualizado');byId('pinNew').value=''};
  }
}

function setView(to){view=to;byId('kioskView').classList.toggle('hidden',to!=='kiosk');byId('adminView').classList.toggle('hidden',to!=='admin');if(to==='admin')renderAdmin();else{renderKiosk()}}
function openAdmin(){if(!db.adminPin){modal(`<h3>Configurar administración</h3><p class="muted">Primera configuración: crea un PIN de 4 a 8 dígitos para acceder al panel administrativo en esta computadora.</p><div class="field"><label>Crear PIN</label><input id="firstPin" class="input" type="password" inputmode="numeric" pattern="[0-9]{4,8}" style="width:100%" /></div><div class="modal-actions"><button data-close class="btn">Cancelar</button><button id="createPin" class="btn main">Configurar</button></div>`);byId('createPin').onclick=()=>{let p=byId('firstPin').value;if(!/^\d{4,8}$/.test(p))return alert('Escribe un PIN de 4 a 8 números.');db.adminPin=p;save();closeModal();setView('admin')};return}modal(`<h3>Acceso administrativo</h3><p class="muted">Ingresa el PIN del equipo para consultar horarios, cuatrimestres y reportes.</p><div class="field"><label>PIN</label><input id="adminPinInput" class="input" type="password" inputmode="numeric" style="width:100%" /></div><div class="modal-actions"><button data-close class="btn">Cancelar</button><button id="pinEnter" class="btn main">Ingresar</button></div>`);let submit=()=>{if(byId('adminPinInput').value!==db.adminPin)return alert('PIN incorrecto');closeModal();setView('admin')};byId('pinEnter').onclick=submit;byId('adminPinInput').onkeydown=e=>{if(e.key==='Enter')submit()};byId('adminPinInput').focus()}
byId('adminOpen').onclick=openAdmin;
byId('kioskNav').querySelectorAll('[data-kiosk-tab]').forEach(b=>b.onclick=()=>{kioskTab=b.dataset.kioskTab;renderKiosk()});
byId('freeDate').onchange=e=>{freeViewDate=e.target.value||dKey(new Date());renderKiosk()};
byId('freeToday').onclick=()=>{freeViewDate=dKey(new Date());renderKiosk()};
byId('adminClose').onclick=()=>setView('kiosk');
byId('adminTabs').querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{activeTab=b.dataset.tab;renderAdmin()});
function refresh(force=false){
  dayClock();
  const now=new Date(),minuteKey=dKey(now)+'T'+pad(now.getHours())+':'+pad(now.getMinutes());
  if(force||minuteKey!==lastMinuteKey){
    lastMinuteKey=minuteKey;
    if(view==='kiosk'&&byId('overlay').classList.contains('hidden'))renderKiosk();
  }
}

// Sincronización con Neon Data API autenticada, sin servidor Node.js.
// La nube es la fuente principal de datos. localStorage es una copia de contingencia.
let cloudReady=false;
let cloudBusy=false;
let cloudDirty=localStorage.getItem(CLOUD_PENDING_KEY)==='1';
let cloudRevision=Number(localStorage.getItem(CLOUD_REVISION_KEY)||0);
let cloudTimer=null;
let cloudConflict=false;
let cloudLoading=false;
function showCloudStatus(state,text){
  const el=byId('cloudStatus');
  if(el){el.dataset.cloud=state;el.textContent=text;el.title=text;}
}
async function databaseCall(name,...args){
  // Neon Auth proporciona el JWT automáticamente a Neon Data API.
  const client=await window.UTEQ_NEON.ready;
  if(name==='leerEstadoUTEQ'){
    const {data,error}=await client.from('uteq_kiosk_state')
      .select('revision,estado').eq('id',1).limit(1);
    if(error)throw Error('Lectura de Neon: '+error.message);
    const row=Array.isArray(data)?data[0]:null;
    return {ok:true,revision:Number(row?.revision||0),estado:row?.estado||null};
  }
  if(name==='guardarEstadoUTEQ'){
    const [payload, revision]=args;
    if(!payload||!Array.isArray(payload.terms)||!Array.isArray(payload.logs)||!Array.isArray(payload.freeUses))
      throw Error('Los datos que intentas guardar son inválidos');
    let result;
    if(revision===0){
      result=await client.from('uteq_kiosk_state')
        .insert({id:1,revision:1,estado:payload}).select('revision');
    }else{
      result=await client.from('uteq_kiosk_state')
        .update({estado:payload,revision:revision+1,actualizado_en:new Date().toISOString()})
        .eq('id',1).eq('revision',revision).select('revision');
    }
    if(result.error){
      if(result.error.code==='23505')throw Error('CONFLICTO_VERSION: el registro ya existe.');
      throw Error('Guardado de Neon: '+result.error.message);
    }
    const row=Array.isArray(result.data)?result.data[0]:null;
    if(!row)throw Error('CONFLICTO_VERSION: otra sesión modificó el estado.');
    return {ok:true,revision:Number(row.revision)};
  }
  throw Error('Operación no permitida');
}
function cloudPayload(){
  const data=JSON.parse(JSON.stringify(db));
  // El PIN local no se sube a Neon. Los datos personales sí quedan en la BD institucional.
  delete data.adminPin;
  return data;
}
function scheduleCloudSave(){
  clearTimeout(cloudTimer);
  if(cloudReady&&!cloudConflict)cloudTimer=setTimeout(pushCloud,400);
}
async function pushCloud(){
  if(!cloudReady||cloudBusy||!cloudDirty||cloudConflict)return;
  cloudBusy=true;
  const payload=cloudPayload();
  const payloadJson=JSON.stringify(payload);
  showCloudStatus('pending','☁ Guardando en base de datos...');
  try{
    const result=await databaseCall('guardarEstadoUTEQ',payload,cloudRevision);
    if(!result?.ok)throw Error('Neon no confirmó el guardado.');
    cloudRevision=result.revision;
    localStorage.setItem(CLOUD_REVISION_KEY,String(cloudRevision));
    // Si hubo movimientos nuevos mientras se enviaba, debe hacerse otro guardado.
    cloudDirty=JSON.stringify(cloudPayload())!==payloadJson;
    localStorage.setItem(CLOUD_PENDING_KEY,cloudDirty?'1':'0');
    showCloudStatus(cloudDirty?'pending':'saved',cloudDirty?'☁ Nuevos cambios pendientes':'✓ Guardado en Neon');
  }catch(e){
    const msg=String(e?.message||e);
    console.error('Error de sincronización con Neon:',msg);
    if(msg.includes('CONFLICTO_VERSION')){
      cloudConflict=true;
      showCloudStatus('error','⚠ Conflicto: respaldar JSON');
      alert('Otra sesión cambió los registros en Neon. No se sobrescribieron. Descarga el respaldo JSON local y consulta con Administración antes de continuar.');
    }else{
      showCloudStatus('error','⚠ Sin sincronizar: revisar Internet');
    }
    cloudDirty=true;
    localStorage.setItem(CLOUD_PENDING_KEY,'1');
  }finally{
    cloudBusy=false;
    if(cloudDirty&&!cloudConflict){
      // Reintento no agresivo; el reloj y el resto de la aplicación continúan funcionando.
      clearTimeout(cloudTimer);
      cloudTimer=setTimeout(pushCloud,20000);
    }
  }
}
async function startCloud(){
  if(cloudLoading)return;
  cloudLoading=true;
  showCloudStatus('pending','☁ Consultando Neon Data API...');
  try{
    const res=await databaseCall('leerEstadoUTEQ');
    if(!res||typeof res.revision!=='number')throw Error('Respuesta incorrecta de la base de datos');
    const previouslyAcked=Number(localStorage.getItem(CLOUD_REVISION_KEY)||0);
    if(cloudDirty&&res.estado&&previouslyAcked!==res.revision){
      cloudConflict=true;
      showCloudStatus('error','⚠ Cambios locales y remotos');
      alert('Existen cambios locales pendientes y la base de datos cambió. Para evitar pérdidas, exporta un respaldo JSON antes de reconciliar manualmente.');
      cloudReady=true;
      return;
    }
    cloudRevision=res.revision;
    localStorage.setItem(CLOUD_REVISION_KEY,String(cloudRevision));
    if(res.estado&&!cloudDirty){
      const localPin=db.adminPin||'';
      db={...res.estado,adminPin:localPin};
      if(!Array.isArray(db.freeUses))db.freeUses=[];
      localStorage.setItem(STORAGE_KEY,JSON.stringify(db));
      reportTermId=db.active;scheduleTermId=db.active;freeTermId=db.active;
      refresh(true);
      if(view==='admin')renderAdmin();
    }
    cloudReady=true;
    const startButton=byId('initializeSheet');
    if(!res.estado){
      // La base está vacía: se exige iniciar explícitamente para NO trasladar
      // por accidente los datos guardados en una página anterior.
      if(startButton)startButton.classList.remove('hidden');
      showCloudStatus('pending','☁ Base vacía · iniciar sistema');
      return;
    }
    if(startButton)startButton.classList.add('hidden');
    if(cloudDirty){showCloudStatus('pending','☁ Pendiente de guardar');scheduleCloudSave();}
    else showCloudStatus('saved','✓ Datos cargados de Neon');
  }catch(e){
    console.error('No se pudo cargar la base de datos:',e);
    cloudReady=false;
    showCloudStatus('error','⚠ Sin conexión con base de datos');
  }finally{
    cloudLoading=false;
  }
}
// Los cambios se realizan en el kiosco y se sincronizan por lotes.
// Si se cierra el navegador antes de sincronizar, el indicador avisa.
window.addEventListener('beforeunload',e=>{
  if(cloudDirty){e.preventDefault();e.returnValue='';}
});
setInterval(()=>{
  if(!cloudReady&&!cloudConflict)startCloud();
  else if(cloudDirty&&!cloudBusy&&!cloudConflict)pushCloud();
},30000);

refresh(true);
ticker=setInterval(refresh,1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh(true)});

// Inicio intencional sin respaldo: conserva el horario incluido en el proyecto,
// pero comienza con cero entradas, salidas y solicitudes históricas.
byId('initializeSheet').onclick=()=>{
  if(!cloudReady||cloudBusy||cloudConflict){
    alert('Primero verifica que Neon esté conectado y sin conflictos.');
    return;
  }
  const ok=confirm('¿Comenzar desde cero? Se guardarán los 115 bloques del horario Septiembre-Diciembre 2026 y se iniciarán vacíos los registros de clases y espacios libres. No se importará información anterior.');
  if(!ok)return;
  const pin=db.adminPin||'';
  db={version:1,active:'2026-SD',terms:[termSeed()],logs:[],freeUses:[],adminPin:pin};
  reportTermId=db.active;
  scheduleTermId=db.active;
  freeTermId=db.active;
  byId('initializeSheet').classList.add('hidden');
  save();
  refresh(true);
  if(view==='admin')renderAdmin();
  flash('Base inicializada sin respaldo. Verifica la confirmación «Guardado en base de datos».');
};

startCloud();
