/* Integración en el navegador: Neon Auth + Neon Data API.
   Importamos el SDK con un servicio ESM; no requiere instalar Node.js.
   La URL de Neon es pública, la contraseña se introduce en el login.
   El SDK envía JWT de sesión y Postgres RLS limita las filas. */
import { createClient } from 'https://esm.sh/@neondatabase/neon-js?bundle';

const $ = id => document.getElementById(id);
const gate=$('loginGate'), info=$('gateInfo'), login=$('loginForm');
const setInfo=(text,isError=false)=>{info.textContent=text;info.className='gate-alert'+(isError?' error':'')};
// El cliente oficial necesita las dos URLs (Auth y Data API), no un string PostgreSQL.
const dataApiUrl=(window.UTEQ_CONFIG?.NEON_DATA_API_URL||'').trim().replace(/\/$/,'');
const authUrl=(window.UTEQ_CONFIG?.NEON_AUTH_URL||'').trim().replace(/\/$/,'');
function isPublicNeonUrl(url,suffix){
  try {
    const u=new URL(url);
    return u.protocol==='https:' && u.hostname.endsWith('.neon.tech') &&
      !u.username && !u.password && u.search==='' && u.hash==='' &&
      u.pathname.endsWith(suffix);
  } catch {return false;}
}
const validConfig=isPublicNeonUrl(dataApiUrl,'/rest/v1') && isPublicNeonUrl(authUrl,'/auth');
let client;
if(!validConfig){
  setInfo('Configura NEON_DATA_API_URL y NEON_AUTH_URL en config.js. Deben ser URLs HTTPS completas de Neon; no uses postgresql://.',true);
  login.querySelector('button[type=submit]').disabled=true;
}else {
  try {
    client=createClient({auth:{url:authUrl},dataApi:{url:dataApiUrl}});
    setInfo('Accede con tu cuenta autorizada de Neon Auth.');
  } catch(e) {setInfo('No se pudo iniciar Neon: '+e.message,true)}
}
let createMode=false;
$('signupToggle').onclick=()=>{
  createMode=!createMode;
  $('loginButton').textContent=createMode?'Crear cuenta inicial':'Iniciar sesión';
  $('signupToggle').textContent=createMode?'Volver a iniciar sesión':'Crear cuenta inicial';
  setInfo(createMode?'Solo para el primer administrador. Después restringe el alta de nuevas cuentas en Neon Auth.':'Accede con tu cuenta autorizada de Neon Auth.');
};
async function unlock(user){
  if(!user?.id)throw Error('La sesión no devolvió el identificador de usuario');
  // Evita mostrar a otra cuenta una copia local que corresponde a la anterior.
  const previous=localStorage.getItem('uteq.neondata.owner.v1');
  if(previous && previous!==String(user.id)){
    const pending=localStorage.getItem('uteq.neondata.pending.v1')==='1';
    if(pending) throw Error('Esta computadora tiene cambios pendientes de otra cuenta. Haz respaldo antes de cambiar de usuario.');
    for(const key of ['uteq.control.aulas.neondata.v1','uteq.neondata.pending.v1','uteq.neondata.revision.v1'])localStorage.removeItem(key);
    localStorage.setItem('uteq.neondata.owner.v1',String(user.id));
    location.reload();return;
  }
  localStorage.setItem('uteq.neondata.owner.v1',String(user.id));
  gate.classList.add('hidden'); $('appHeader').classList.remove('hidden'); $('appMain').classList.remove('hidden');
  window.UTEQ_NEON._resolve(client);
  $('logoutNeon').onclick=async()=>{
    if(localStorage.getItem('uteq.neondata.pending.v1')==='1'){
      alert('Tienes registros sin sincronizar. Antes de cerrar sesión, genera un respaldo y comprueba la conexión.');return;
    }
    await client.auth.signOut();location.reload();
  };
}
if(client){
  try {
    const result=await client.auth.getSession();
    if(result?.data?.session&&result?.data?.user)await unlock(result.data.user);
  }catch(e){setInfo('No se pudo verificar la sesión: '+e.message,true)}
}
login.onsubmit=async e=>{
  e.preventDefault();
  if(!client)return;
  const email=$('loginEmail').value.trim(),password=$('loginPassword').value;
  const button=$('loginButton');button.disabled=true;setInfo('Verificando acceso…');
  try{
    const result=createMode
      ?await client.auth.signUp.email({name:'Estación UTEQ',email,password})
      :await client.auth.signIn.email({email,password});
    if(result.error)throw Error(result.error.message||'Acceso rechazado');
    const session=await client.auth.getSession();
    if(!session.data?.session||!session.data?.user)
      throw Error('Cuenta creada, pero sin sesión activa. Verifica el correo o vuelve a iniciar sesión.');
    await unlock(session.data.user);
  }catch(err){setInfo(String(err.message||err),true)}
  finally{button.disabled=false}
};
