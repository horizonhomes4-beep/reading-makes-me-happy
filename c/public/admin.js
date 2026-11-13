import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getFirestore, collection, getDocs, query, orderBy, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getFirestore(app),functions=getFunctions(app);
const reviewInstructorRequest=httpsCallable(functions,'reviewInstructorRequest');
const $=id=>document.getElementById(id); let isAdmin=false, stopMessages=null, stopConnections=null, allMessages=[];
function log(s){console.info(`[${new Date().toLocaleTimeString()}] ${s}`)}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function checkAdmin(user){const t=await user.getIdTokenResult(true);return t.claims.labAdmin===true;}
async function loadRequests(){
  const target=$('requests'); target.textContent='Loading requests…';
  try{const snap=await getDocs(collection(db,'instructorRequests'));const pending=snap.docs.filter(d=>d.data().status==='pending');
    if(!pending.length){target.innerHTML='<p class="muted">No pending instructor requests.</p>';return;} target.innerHTML='';
    pending.forEach(d=>{const x=d.data(),card=document.createElement('article');card.className='item';card.innerHTML=`<h3>${esc(x.displayName||x.email||d.id)}</h3><p class="meta">${esc(x.email)} · ${esc(d.id)}</p><p>${esc(x.reason||'No details supplied')}</p><div class="row"><button data-action="approve">Approve</button><button class="danger" data-action="reject">Reject</button></div>`;
      card.querySelector('[data-action="approve"]').onclick=()=>decide(d.id,true);card.querySelector('[data-action="reject"]').onclick=()=>decide(d.id,false);target.append(card);});
  }catch(e){target.textContent='Could not load requests: '+e.message;}
}
async function decide(uid,approve){if(!confirm(`${approve?'Approve':'Reject'} this instructor request?`))return;try{await reviewInstructorRequest({uid,approve});await loadRequests();}catch(e){alert(e.message);}}
function renderMessages(){const term=$('search').value.trim().toLowerCase();const rows=allMessages.filter(x=>[x.studentEmail,x.sender,x.subject,x.body,x.account].join(' ').toLowerCase().includes(term));$('counts').textContent=`${rows.length} message(s) shown · ${allMessages.length} total archived`;
  if(!rows.length){$('list').innerHTML='<p class="muted">No messages match this search.</p>';return;}
  $('list').innerHTML=rows.map(x=>`<article class="item"><h3>${esc(x.subject||'(No subject)')}</h3><div class="meta">Student: ${esc(x.studentEmail||x.studentUid)} · Gmail: ${esc(x.account||'')}<br>From: ${esc(x.sender||'')}<br>Received: ${esc(x.receivedAt?.toDate?.().toLocaleString()||'Date unavailable')} · Synced: ${esc(x.syncedAt?.toDate?.().toLocaleString()||'')}</div><div class="body">${esc(x.body||'(No text body)')}</div></article>`).join('');
}
function startLive(){
  if(stopMessages)stopMessages(); if(stopConnections)stopConnections();
  const q=query(collection(db,'classMessages'),orderBy('receivedAt','desc'));
  stopMessages=onSnapshot(q,snap=>{allMessages=snap.docs.map(d=>d.data());renderMessages();},e=>{$('list').textContent='Message archive error: '+e.message;});
  stopConnections=onSnapshot(collection(db,'integrationStatus'),snap=>{
    if(snap.empty){$('connections').innerHTML='<p class="muted">No student service connections yet.</p>';return;}
    $('connections').innerHTML=snap.docs.map(d=>{const x=d.data();return `<article class="item"><b>${esc(x.gmailAccount||'Student account')}</b><div class="meta">Student UID: ${esc(d.id)}<br>Gmail: ${x.gmailConnected?'Connected':'Not connected'} · Cloud sync: ${x.gmailActive?'Active':'Stopped'}<br>Last sync: ${esc(x.lastSyncAt?.toDate?.().toLocaleString()||'Not yet synced')}<br>Session expiry: ${esc(x.expiresAt?.toDate?.().toLocaleString()||'—')}</div>${x.lastError?`<p class="notice">${esc(x.lastError)}</p>`:''}</article>`;}).join('');
  },e=>{$('connections').textContent='Connection status error: '+e.message;});
}
$('search').addEventListener('input',renderMessages);
$('signin').onclick=async()=>{try{const result=await signInWithPopup(auth,new GoogleAuthProvider());if(!(await checkAdmin(result.user))){await signOut(auth);$('status').textContent='Access denied. This account is not an authorised administrator.';return;} }catch(e){$('status').textContent='Sign-in failed: '+e.message;}};
$('signout').onclick=async()=>{if(stopMessages)stopMessages();if(stopConnections)stopConnections();stopMessages=stopConnections=null;isAdmin=false;await signOut(auth);$('status').textContent='Signed out.';$('list').textContent='Administrator sign-in required.';$('connections').textContent='Administrator sign-in required.';};
onAuthStateChanged(auth,async user=>{
  isAdmin=false;$('signin').disabled=!!user;$('signout').disabled=!user;
  if(!user){if(stopMessages)stopMessages();if(stopConnections)stopConnections();stopMessages=stopConnections=null;$('status').textContent='Not signed in.';return;}
  try{isAdmin=await checkAdmin(user);if(!isAdmin){$('status').textContent='Access denied: administrator role is missing.';await signOut(auth);return;}$('status').textContent=`Authorised administrator: ${user.email} · persistent sign-in active`;$('signout').disabled=false;await loadRequests();startLive();}
  catch(e){$('status').textContent='Could not verify administrator access: '+e.message;}
});
setPersistence(auth,browserLocalPersistence).catch(e=>console.error('Auth persistence:',e));
