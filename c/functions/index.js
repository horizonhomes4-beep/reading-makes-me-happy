const crypto = require('crypto');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue, Timestamp } = require('firebase-admin/firestore');
const { google } = require('googleapis');

initializeApp();
const db = getFirestore();
const OAUTH_CLIENT_ID = defineSecret('OAUTH_CLIENT_ID');
const OAUTH_CLIENT_SECRET = defineSecret('OAUTH_CLIENT_SECRET');
const OAUTH_REDIRECT_URI = defineSecret('OAUTH_REDIRECT_URI');
const TOKEN_ENCRYPTION_KEY = defineSecret('TOKEN_ENCRYPTION_KEY');
const APP_BASE_URL = defineSecret('APP_BASE_URL');
const SESSION_HOURS = 6; // Safety ceiling; normal stop is the student's explicit logout.

function oauthClient() {
  return new google.auth.OAuth2(OAUTH_CLIENT_ID.value(), OAUTH_CLIENT_SECRET.value(), OAUTH_REDIRECT_URI.value());
}
function encrypt(text) {
  const key = Buffer.from(TOKEN_ENCRYPTION_KEY.value(), 'hex');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes).');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function decrypt(box) {
  const key = Buffer.from(TOKEN_ENCRYPTION_KEY.value(), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(box.data, 'base64')), decipher.final()]).toString('utf8');
}
function cleanHeader(headers, name) {
  return (headers || []).find(h => String(h.name).toLowerCase() === name.toLowerCase())?.value || '';
}
function decodePart(data) {
  if (!data) return '';
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}
function extractText(payload) {
  const plain = [], html = [];
  const walk = part => {
    if (!part) return;
    if (part.body?.data) {
      const mime = String(part.mimeType || '').toLowerCase();
      if (mime === 'text/plain') plain.push(decodePart(part.body.data));
      if (mime === 'text/html') html.push(decodePart(part.body.data));
    }
    (part.parts || []).forEach(walk);
  };
  walk(payload);
  if (plain.length) return plain.join('\n').slice(0, 30000);
  if (html.length) return html.join('\n').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 30000);
  return '[No readable text body. Attachments are not copied.]';
}

exports.createGmailAuthorization = onCall({ secrets: [OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, OAUTH_REDIRECT_URI] }, async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in before connecting Gmail.');
  const uid = request.auth.uid;
  const state = crypto.randomBytes(32).toString('hex');
  await db.collection('oauthStates').doc(crypto.createHash('sha256').update(state).digest('hex')).set({ uid, expectedEmail: request.auth.token.email || '', createdAt: FieldValue.serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 10 * 60 * 1000) });
  const client = oauthClient();
  const url = client.generateAuthUrl({
    access_type: 'offline', prompt: 'consent', include_granted_scopes: true,
    scope: ['https://www.googleapis.com/auth/gmail.readonly'], state,
  });
  return { url };
});

exports.gmailOAuthCallback = onRequest({ secrets: [OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, OAUTH_REDIRECT_URI, TOKEN_ENCRYPTION_KEY, APP_BASE_URL] }, async (req, res) => {
  const base = APP_BASE_URL.value().replace(/\/$/, '');
  try {
    if (req.query.error) throw new Error(`Google authorization was not completed: ${String(req.query.error)}`);
    const code = String(req.query.code || '');
    const state = String(req.query.state || '');
    if (!code || !state) throw new Error('Missing OAuth code or state. Start the connection again from the student dashboard.');
    const stateId = crypto.createHash('sha256').update(state).digest('hex');
    const stateRef = db.collection('oauthStates').doc(stateId);
    const stateSnap = await stateRef.get();
    if (!stateSnap.exists || stateSnap.data().expiresAt.toMillis() < Date.now()) throw new Error('Authorization link expired. Return to the student dashboard and try again.');
    const uid = stateSnap.data().uid;
    const expectedEmail = String(stateSnap.data().expectedEmail || '').toLowerCase();
    await stateRef.delete();
    const client = oauthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Revoke this app in your Google Account permissions and reconnect, choosing the full consent prompt.');
    const gmail = google.gmail({ version: 'v1', auth: client });
    client.setCredentials(tokens);
    const profile = await gmail.users.getProfile({ userId: 'me' });
    if (expectedEmail && String(profile.data.emailAddress || '').toLowerCase() !== expectedEmail) throw new Error('Please authorise the same Google account you used to sign in to the student dashboard.');
    const now = Date.now();
    const expiresAt = Timestamp.fromMillis(now + SESSION_HOURS * 60 * 60 * 1000);
    await db.collection('privateIntegrations').doc(uid).collection('providers').doc('gmail').set({
      provider: 'gmail', email: profile.data.emailAddress || '', refreshToken: encrypt(tokens.refresh_token),
      connectedAt: Timestamp.fromMillis(now), syncAfter: Timestamp.fromMillis(now),
      active: true, expiresAt, lastSyncAt: null, lastError: '',
    }, { merge: true });
    await db.collection('integrationStatus').doc(uid).set({ gmailConnected: true, gmailActive: true, gmailAccount: profile.data.emailAddress || '', connectedAt: Timestamp.fromMillis(now), expiresAt, lastSyncAt: null, lastError: '' }, { merge: true });
    res.redirect(`${base}/student.html?gmail=connected`);
  } catch (e) {
    console.error('Gmail OAuth callback:', e);
    res.status(400).send(`<main style="font:16px Arial;max-width:640px;margin:48px auto;padding:20px"><h2>Gmail connection was not completed</h2><p>${String(e.message || e).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</p><a href="${base}/student.html">Return to student dashboard</a></main>`);
  }
});

exports.stopStudentSession = onCall(async request => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const ref = db.collection('privateIntegrations').doc(request.auth.uid).collection('providers').doc('gmail');
  await ref.delete(); // Remove the server-held refresh token when the student stops/logs out.
  await db.collection('integrationStatus').doc(request.auth.uid).set({ gmailActive: false, stoppedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { stopped: true };
});

exports.syncAuthorisedGmail = onSchedule({ schedule: 'every 5 minutes', timeZone: 'Africa/Lagos', timeoutSeconds: 300, memory: '512MiB', secrets: [OAUTH_CLIENT_ID, OAUTH_CLIENT_SECRET, OAUTH_REDIRECT_URI, TOKEN_ENCRYPTION_KEY] }, async () => {
  const now = Date.now();
  const students = await db.collection('privateIntegrations').get();
  for (const student of students.docs) {
    const uid = student.id;
    const ref = student.ref.collection('providers').doc('gmail');
    const snap = await ref.get();
    if (!snap.exists) continue;
    const cfg = snap.data();
    if (cfg.active !== true || !cfg.expiresAt || cfg.expiresAt.toMillis() <= now) {
      if (cfg.active === true) {
        await ref.delete(); // Expired sessions no longer retain the refresh token.
        await db.collection('integrationStatus').doc(uid).set({ gmailActive: false, lastError: 'Class session expired. Reconnect to start another session.' }, { merge: true });
      }
      continue;
    }
    try {
      const client = oauthClient();
      client.setCredentials({ refresh_token: decrypt(cfg.refreshToken) });
      const gmail = google.gmail({ version: 'v1', auth: client });
      const after = Math.floor((cfg.syncAfter?.toMillis?.() || cfg.connectedAt.toMillis()) / 1000);
      const studentUser = await getAuth().getUser(uid);
      let pageToken = undefined;
      let pages = 0;
      do {
        const list = await gmail.users.messages.list({ userId: 'me', q: `in:inbox after:${after}`, maxResults: 100, pageToken });
        for (const item of (list.data.messages || [])) {
        const msgRef = db.collection('classMessages').doc(`${uid}_${item.id}`);
        const exists = await msgRef.get();
        if (exists.exists) continue;
        const full = await gmail.users.messages.get({ userId: 'me', id: item.id, format: 'full' });
        const payload = full.data.payload || {};
        const headers = payload.headers || [];
        const internalDate = Number(full.data.internalDate || Date.now());
        await msgRef.create({
          studentUid: uid, studentEmail: studentUser.email || '',
          provider: 'gmail', account: cfg.email || '', messageId: item.id,
          sender: cleanHeader(headers, 'From'), subject: cleanHeader(headers, 'Subject'),
          body: extractText(payload), receivedAt: Timestamp.fromMillis(internalDate),
          syncedAt: FieldValue.serverTimestamp(), visibility: 'student-authorised-inbox-sync',
        });
        }
        pageToken = list.data.nextPageToken;
        pages += 1;
      } while (pageToken && pages < 10);
      await ref.set({ lastSyncAt: FieldValue.serverTimestamp(), lastError: '' }, { merge: true });
      await db.collection('integrationStatus').doc(uid).set({ gmailActive: true, lastSyncAt: FieldValue.serverTimestamp(), lastError: '' }, { merge: true });
    } catch (e) {
      console.error(`Gmail sync failed for ${uid}:`, e);
      const message = String(e.message || e).slice(0, 500);
      await ref.set({ lastError: message, lastSyncAt: FieldValue.serverTimestamp() }, { merge: true });
      await db.collection('integrationStatus').doc(uid).set({ lastError: message, lastSyncAt: FieldValue.serverTimestamp() }, { merge: true });
    }
  }
});

exports.reviewInstructorRequest = require('firebase-functions/v2/https').onCall(async request => {
  if (!request.auth || request.auth.token.labAdmin !== true) throw new HttpsError('permission-denied', 'Only a verified project administrator can review instructor requests.');
  const uid = typeof request.data?.uid === 'string' ? request.data.uid : '';
  const approve = request.data?.approve;
  if (!uid || uid === request.auth.uid || typeof approve !== 'boolean') throw new HttpsError('invalid-argument', 'Provide a valid instructor UID and approve boolean.');
  const requestRef = db.collection('instructorRequests').doc(uid);
  const snap = await requestRef.get();
  if (!snap.exists || snap.data().status !== 'pending') throw new HttpsError('not-found', 'No pending request was found.');
  const target = await getAuth().getUser(uid);
  if (approve) {
    await getAuth().setCustomUserClaims(uid, { ...(target.customClaims || {}), labAdmin: true });
    await requestRef.update({ status: 'approved', reviewedAt: FieldValue.serverTimestamp(), reviewedBy: request.auth.uid });
    return { status: 'approved', email: target.email || '' };
  }
  await requestRef.update({ status: 'rejected', reviewedAt: FieldValue.serverTimestamp(), reviewedBy: request.auth.uid });
  return { status: 'rejected', email: target.email || '' };
});
