import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js';
import { getFirestore, doc, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const $ = id => document.getElementById(id);
const app = initializeApp(firebaseConfig), auth = getAuth(app), functions = getFunctions(app), db = getFirestore(app);
const createGmailAuthorization = httpsCallable(functions, 'createGmailAuthorization');
const stopStudentSession = httpsCallable(functions, 'stopStudentSession');
let currentUser = null, unsubscribeStatus = null;
const services = [
  ['Gmail','Cloud API','Available after Google OAuth setup','Ready for configuration'],
  ['SMS','Android native app/API','Requires an explicitly installed and permission-approved Android app','API / native app required'],
  ['Call history','Android native app/API','Requires an explicitly installed and permission-approved Android app','API / native app required'],
  ['WhatsApp','Official WhatsApp Business Platform','Business account webhooks only; not personal WhatsApp chat-history access','Business API required'],
  ['Facebook','Meta Graph API','Approved Page/business scopes; personal private inbox access is not included','Meta app review required'],
  ['TikTok','TikTok developer APIs','Approved account/content scopes; private DMs are not generally exposed','TikTok app review required']
];
function log(s){ $('log').textContent = `[${new Date().toLocaleTimeString()}] ${s}\n` + $('log').textContent; }
function renderServices(){ $('services').innerHTML = services.map(([name,type,detail,status]) => `<article class="service"><b>${name}</b><span>${type}</span><p>${detail}</p><small>${status}</small></article>`).join(''); }
renderServices();
setPersistence(auth, browserLocalPersistence).catch(e => log('Could not set persistent sign-in: '+e.message));
$('signin').onclick = async () => {
  try { const p = new GoogleAuthProvider(); const result = await signInWithPopup(auth,p); log(`Signed in as ${result.user.email}.`); }
  catch(e){ alert('Sign-in failed: '+e.message); log('Sign-in error: '+e.message); }
};
$('connect').onclick = async () => {
  if(!currentUser) return;
  const ok = confirm('You are authorising the school to synchronise new incoming Gmail inbox messages received after this connection. The instructor can read those messages. Continue?');
  if(!ok) return;
  $('connect').disabled = true;
  try { const result = await createGmailAuthorization(); window.location.assign(result.data.url); }
  catch(e){ $('connect').disabled = false; alert('Could not start Gmail authorisation: '+e.message); log('Gmail authorisation error: '+e.message); }
};
$('stop').onclick = async () => {
  if(!currentUser) return;
  try { await stopStudentSession(); $('gmailStatus').textContent = 'Gmail synchronisation stopped.'; $('stop').disabled = true; $('connect').disabled = false; log('Student stopped the cloud Gmail session.'); }
  catch(e){ alert('Could not stop sync: '+e.message); }
};
$('signout').onclick = async () => {
  try { if(currentUser) await stopStudentSession(); log('Cloud Gmail synchronisation stopped.'); }
  catch(e){ log('Could not reach the server to stop sync immediately; the six-hour server expiry remains as a fallback. '+e.message); }
  finally { if(unsubscribeStatus) unsubscribeStatus(); await signOut(auth); log('Firebase session signed out.'); }
};
onAuthStateChanged(auth, user => {
  currentUser = user;
  $('signin').disabled = !!user;
  $('signout').disabled = !user;
  $('connect').disabled = !user;
  $('identity').textContent = user ? `Signed in as ${user.email}. Sign-in will remain active until Logout.` : 'Not signed in.';
  if(unsubscribeStatus){ unsubscribeStatus(); unsubscribeStatus=null; }
  if(user){
    unsubscribeStatus = onSnapshot(doc(db,'integrationStatus',user.uid), snap => {
      const x = snap.exists()?snap.data():{};
      if(x.gmailConnected){
        $('gmailStatus').textContent = x.gmailActive ? `Connected: ${x.gmailAccount || 'Gmail'} · Cloud sync active` : 'Gmail connected, but synchronisation is stopped.';
        $('stop').disabled = !x.gmailActive; $('connect').disabled = x.gmailActive;
        $('sessionInfo').textContent = `Last cloud check: ${x.lastSyncAt?.toDate?.().toLocaleString() || 'Waiting for first check'}${x.lastError ? ' · Issue: '+x.lastError : ''}`;
      } else { $('gmailStatus').textContent = 'Gmail is not connected.'; $('stop').disabled=true; $('connect').disabled=false; }
    }, e=>log('Connection status error: '+e.message));
  } else {
    $('gmailStatus').textContent='Gmail is not connected.'; $('stop').disabled=true; $('connect').disabled=true; $('sessionInfo').textContent='';
  }
});
if(new URLSearchParams(location.search).get('gmail')==='connected') log('Google authorisation completed. Cloud synchronisation is being activated.');
