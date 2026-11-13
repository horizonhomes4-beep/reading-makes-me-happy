import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, collection, getDocs, orderBy, query } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);
const reviewInstructorRequest = httpsCallable(functions, "reviewInstructorRequest");
const $ = id => document.getElementById(id);
let isAdmin = false;

function log(message) {
  $("log").textContent = `[${new Date().toLocaleTimeString()}] ${message}\n` + $("log").textContent;
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
async function checkAdmin(user) {
  const token = await user.getIdTokenResult(true);
  return token.claims.labAdmin === true;
}
async function loadInstructorRequests() {
  if (!isAdmin) return;
  const target = $("requests");
  target.textContent = "Loading instructor requests…";
  try {
    const snap = await getDocs(collection(db, "instructorRequests"));
    const pending = snap.docs.filter(d => d.data().status === "pending");
    if (!pending.length) { target.innerHTML = '<p class="muted">No pending instructor requests.</p>'; return; }
    target.innerHTML = "";
    pending.forEach(d => {
      const x = d.data();
      const card = document.createElement("article"); card.className = "item";
      const heading = document.createElement("h3"); heading.textContent = x.displayName || x.email || d.id;
      const meta = document.createElement("p"); meta.className = "meta"; meta.textContent = `${x.email || "No email"} · UID: ${d.id}`;
      const reason = document.createElement("p"); reason.className = "muted"; reason.textContent = x.reason || "No role details supplied.";
      const controls = document.createElement("div"); controls.className = "row";
      const approve = document.createElement("button"); approve.textContent = "Approve instructor";
      const reject = document.createElement("button"); reject.textContent = "Reject request"; reject.className = "danger";
      approve.onclick = () => decideRequest(d.id, true, approve, reject);
      reject.onclick = () => decideRequest(d.id, false, approve, reject);
      controls.append(approve, reject); card.append(heading, meta, reason, controls); target.appendChild(card);
    });
  } catch (e) { target.textContent = "Could not load requests: " + e.message; log("Instructor request read error: " + e.message); }
}
async function decideRequest(uid, approve, approveButton, rejectButton) {
  const verb = approve ? "approve" : "reject";
  if (!confirm(`${verb[0].toUpperCase()+verb.slice(1)} this instructor request?`)) return;
  approveButton.disabled = true; rejectButton.disabled = true;
  try {
    await reviewInstructorRequest({ uid, approve });
    log(`Instructor request ${verb}ed for UID ${uid}.`);
    await loadInstructorRequests();
  } catch (e) { alert(`Could not ${verb} request: ${e.message}`); approveButton.disabled = false; rejectButton.disabled = false; }
}
async function loadMessages() {
  if (!isAdmin) return;
  $("list").textContent = "Loading shared messages…";
  try {
    const q = query(collection(db, "sharedEmails"), orderBy("sharedAt", "desc"));
    const snap = await getDocs(q);
    if (snap.empty) {
      $("list").innerHTML = '<p class="muted">No students have shared a message yet.</p>';
      return;
    }
    $("list").innerHTML = "";
    snap.forEach(d => {
      const x = d.data();
      const date = x.sharedAt?.toDate ? x.sharedAt.toDate().toLocaleString() : "Timestamp pending";
      const card = document.createElement("article");
      card.className = "item";
      card.innerHTML = `<h3>${escapeHtml(x.subject || "(No subject)")}</h3>
        <div class="meta">Student: ${escapeHtml(x.studentEmail)} · Gmail account: ${escapeHtml(x.gmailAccount)}<br>
        From: ${escapeHtml(x.sender)}<br>Shared: ${escapeHtml(date)}</div>
        <div class="body">${escapeHtml(x.body || "(No body)")}</div>`;
      $("list").appendChild(card);
    });
    log(`Loaded ${snap.size} student-shared message record(s).`);
  } catch (e) {
    $("list").textContent = "Could not load messages: " + e.message;
    log("Firestore read error: " + e.message);
  }
}
$("signin").onclick = async () => {
  try {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    isAdmin = await checkAdmin(result.user);
    if (!isAdmin) {
      $("status").textContent = "Access denied: this account is not an authorised instructor.";
      $("refresh").disabled = true;
      $("list").textContent = "Instructor permission is required.";
      log("Sign-in succeeded, but labAdmin custom claim was not found.");
      return;
    }
    $("status").textContent = `Authorised instructor: ${result.user.email}`;
    $("refresh").disabled = false;
    $("signout").disabled = false;
    log("Instructor authentication and admin claim verified.");
    await loadInstructorRequests();
    await loadMessages();
  } catch (e) {
    $("status").textContent = "Sign-in failed: " + e.message;
    log("Sign-in error: " + e.message);
  }
};
$("refresh").onclick = loadMessages;
$("signout").onclick = async () => {
  isAdmin = false;
  await signOut(auth);
  $("status").textContent = "Signed out.";
  $("refresh").disabled = true; $("signout").disabled = true;
  $("list").textContent = "Sign in as an authorised instructor to load records.";
  log("Instructor signed out.");
};
onAuthStateChanged(auth, async user => {
  if (!user) return;
  try {
    isAdmin = await checkAdmin(user);
    if (isAdmin) {
      $("status").textContent = `Authorised instructor: ${user.email}`;
      $("refresh").disabled = false; $("signout").disabled = false;
      await loadInstructorRequests();
      await loadMessages();
    } else {
      $("status").textContent = "Signed in, but instructor access is not enabled.";
    }
  } catch (e) { log("Could not verify instructor claim: " + e.message); }
});
