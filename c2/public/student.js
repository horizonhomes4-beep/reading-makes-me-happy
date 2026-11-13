import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, setDoc, addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = id => document.getElementById(id);
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
let currentUser = null;
let gmailToken = null;
let selectedEmail = null;

function log(message) {
  $("log").textContent = `[${new Date().toLocaleTimeString()}] ${message}\n` + $("log").textContent;
}
function setMessage(subject, from, body) {
  $("subject").textContent = subject;
  $("from").textContent = "From: " + from;
  $("body").textContent = body;
  $("email").hidden = false;
}
function decodeBase64Url(data) {
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}
function extractBody(payload) {
  const found = [];
  const walk = part => {
    if (!part) return;
    const mime = (part.mimeType || "").toLowerCase();
    if (part.body?.data && (mime === "text/plain" || mime === "text/html")) {
      found.push({mime, text: decodeBase64Url(part.body.data)});
    }
    (part.parts || []).forEach(walk);
  };
  walk(payload);
  const plain = found.find(x => x.mime === "text/plain");
  if (plain) return plain.text;
  const html = found.find(x => x.mime === "text/html");
  if (html) return new DOMParser().parseFromString(html.text, "text/html").body?.textContent || "";
  return "No readable text body was returned. The email may contain only images or unsupported content.";
}

$("signin").onclick = async () => {
  try {
    const provider = new GoogleAuthProvider();
    provider.addScope("https://www.googleapis.com/auth/gmail.readonly");
    provider.setCustomParameters({prompt: "consent", access_type: "online"});
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    gmailToken = credential?.accessToken || null;
    if (!gmailToken) throw new Error("Google sign-in completed, but no Gmail access token was returned. Sign out and try again.");
    currentUser = result.user;
    $("identity").textContent = `Signed in as ${currentUser.email}. Gmail read-only permission granted for this session.`;
    $("read").disabled = false;
    $("signout").disabled = false;
    log("Signed in. Gmail readonly permission was granted by Google.");
  } catch (e) {
    log("Sign-in error: " + e.message);
    alert("Could not connect: " + e.message);
  }
};

$("read").onclick = async () => {
  if (!gmailToken || !currentUser) return;
  $("read").disabled = true;
  try {
    const listResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1", {
      headers: {Authorization: "Bearer " + gmailToken}
    });
    if (!listResponse.ok) throw new Error(`Gmail API error ${listResponse.status}: ${await listResponse.text()}`);
    const list = await listResponse.json();
    if (!list.messages?.length) throw new Error("No email messages were found in this inbox.");
    const messageId = list.messages[0].id;
    const messageResponse = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`, {
      headers: {Authorization: "Bearer " + gmailToken}
    });
    if (!messageResponse.ok) throw new Error(`Could not fetch message (${messageResponse.status}).`);
    const message = await messageResponse.json();
    const headers = message.payload?.headers || [];
    const header = name => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || "(not supplied)";
    const body = extractBody(message.payload);
    selectedEmail = {
      messageId,
      from: header("From"),
      subject: header("Subject"),
      body: body.slice(0, 20000),
      gmailAccount: currentUser.email
    };
    setMessage(selectedEmail.subject, selectedEmail.from, selectedEmail.body);
    $("share").disabled = false;
    $("shareStatus").textContent = "Review the message. It has not been shared yet.";
    log("Fetched one latest email. It is displayed locally and has not been sent to Firebase.");
  } catch (e) {
    log("Gmail read error: " + e.message);
    alert("Could not read Gmail: " + e.message);
  } finally {
    $("read").disabled = false;
  }
};

$("share").onclick = async () => {
  if (!currentUser || !selectedEmail) return;
  const approved = confirm("Share this email's sender, subject and message body with the instructor? This will save the content in the classroom Firebase project.");
  if (!approved) return;
  $("share").disabled = true;
  try {
    await setDoc(doc(db, "sharedEmails", currentUser.uid), {
      studentUid: currentUser.uid,
      studentEmail: currentUser.email || "",
      gmailAccount: selectedEmail.gmailAccount,
      sender: selectedEmail.from,
      subject: selectedEmail.subject,
      body: selectedEmail.body,
      messageId: selectedEmail.messageId,
      sharedAt: serverTimestamp()
    });
    $("shareStatus").textContent = "Shared successfully. The instructor can now view this selected message.";
    log("Student explicitly shared this selected message to Firebase.");
  } catch (e) {
    $("shareStatus").textContent = "Share failed: " + e.message;
    log("Firebase share error: " + e.message);
  } finally {
    $("share").disabled = false;
  }
};

$("signout").onclick = async () => {
  gmailToken = null; selectedEmail = null;
  $("email").hidden = true; $("share").disabled = true; $("read").disabled = true;
  $("identity").textContent = "Signed out.";
  $("shareStatus").textContent = "";
  await signOut(auth);
  log("Signed out. The Gmail access token held by this page was cleared.");
};

onAuthStateChanged(auth, user => {
  currentUser = user;
  if (!user) {
    $("identity").textContent = "Not signed in.";
    $("read").disabled = true;
    $("signout").disabled = true;
  }
});


// Student-authorised SMS and call-history import. This browser app cannot read device logs.
const imported = { sms: [], calls: [] };
function parseCsv(text) {
  const rows=[]; let row=[], cell="", quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i], n=text[i+1];
    if(c==='"' && quoted && n==='"'){cell+='"';i++;}
    else if(c==='"'){quoted=!quoted;}
    else if(c===',' && !quoted){row.push(cell);cell="";}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&n==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell="";}
    else cell+=c;
  }
  row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
  if(rows.length<2) throw new Error("CSV needs a header row and at least one record.");
  const headers=rows.shift().map(x=>x.trim().toLowerCase());
  return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,(r[i]||"").trim()])));
}
function normalizeRecord(x, kind) {
  const get=(...keys)=>{for(const k of keys){if(x[k]!==undefined&&x[k]!==null&&String(x[k]).trim())return String(x[k]).trim();}return "";};
  if(kind==="sms") return {date:get("date","datetime","timestamp","time"), contact:get("contact","name","sender","recipient","address","phone","number"), phone:get("phone","number","address"), body:get("body","message","text","content"), type:get("type","direction")};
  return {date:get("date","datetime","timestamp","time"), contact:get("contact","name","caller","recipient"), phone:get("phone","number","number"), duration:get("duration","durationseconds","seconds"), type:get("type","direction"), body:get("note","notes")};
}
function safeText(x){return String(x||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
async function importRecords(file, kind) {
  if(!currentUser) throw new Error("Sign in first.");
  const raw=await file.text();
  let parsed;
  if(file.name.toLowerCase().endsWith(".json")){parsed=JSON.parse(raw);if(!Array.isArray(parsed)) parsed=parsed.records||parsed.messages||parsed.calls||[];}
  else parsed=parseCsv(raw);
  if(!Array.isArray(parsed)) throw new Error("The file must contain a JSON array or CSV records.");
  const rows=parsed.map(x=>normalizeRecord(x,kind)).filter(x=>Object.values(x).some(Boolean));
  if(!rows.length) throw new Error("No usable records found. Check the file headers and contents.");
  imported[kind]=rows.slice(0,500);
  renderRecords(kind);
}
function renderRecords(kind) {
  const target=$(kind==="sms"?"smsPreview":"callsPreview"), rows=imported[kind];
  target.innerHTML="";
  rows.forEach((r,i)=>{
    const item=document.createElement("label");item.className="record-choice";
    const cb=document.createElement("input");cb.type="checkbox";cb.checked=false;cb.dataset.index=String(i);
    const content=document.createElement("span");content.className="record-content";
    const headline=kind==="sms"?(r.contact||r.phone||"Unknown contact"):(r.contact||r.phone||"Unknown caller");
    const detail=kind==="sms"?r.body:[r.type,r.duration?`${r.duration} seconds`:"",r.body].filter(Boolean).join(" · ");
    content.innerHTML=`<strong>${safeText(headline)}</strong><div class="record-meta">${safeText(r.date||"Date not supplied")} · ${safeText(r.phone||"No phone number")}</div><div>${safeText(detail||"No message content supplied")}</div>`;
    item.append(cb,content);target.append(item);
  });
  $(kind==="sms"?"shareSms":"shareCalls").disabled=false;
}
async function shareSelected(kind) {
  if(!currentUser) return;
  const target=$(kind==="sms"?"smsPreview":"callsPreview");
  const selected=[...target.querySelectorAll('input[type="checkbox"]:checked')].map(cb=>imported[kind][Number(cb.dataset.index)]);
  const status=$(kind==="sms"?"smsStatus":"callsStatus");
  if(!selected.length){status.textContent="Select at least one record.";return;}
  if(!confirm(`Share ${selected.length} selected ${kind==="sms"?"SMS":"call-history"} record(s) with the instructor?`)) return;
  const button=$(kind==="sms"?"shareSms":"shareCalls");button.disabled=true;
  try{
    const col=kind==="sms"?"sharedSms":"sharedCalls";
    for(const record of selected){
      await addDoc(collection(db,col),{
        studentUid:currentUser.uid,studentEmail:currentUser.email||"",
        record,sharedAt:serverTimestamp(),source:"student_import",
        consentedAt:serverTimestamp()
      });
    }
    status.textContent=`${selected.length} selected record(s) shared successfully.`;
    log(`Student explicitly shared ${selected.length} ${kind==="sms"?"SMS":"call-history"} record(s).`);
    target.querySelectorAll('input[type="checkbox"]').forEach(cb=>cb.checked=false);
  }catch(e){status.textContent="Share failed: "+e.message;log("Record share error: "+e.message);}
  finally{button.disabled=false;}
}
for(const [id,kind] of [["smsFile","sms"],["callsFile","calls"]]){
  $(id).addEventListener("change",async e=>{const file=e.target.files?.[0];if(!file)return;try{await importRecords(file,kind);$(kind==="sms"?"smsStatus":"callsStatus").textContent=`Imported ${imported[kind].length} records. Select the records to share.`;}catch(err){alert("Import failed: "+err.message);}});
}
$("shareSms").onclick=()=>shareSelected("sms");
$("shareCalls").onclick=()=>shareSelected("calls");
