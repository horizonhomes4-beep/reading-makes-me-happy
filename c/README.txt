READING MAKES ME HAPPY — CLASSROOM CLOUD SYNC PROJECT
====================================================

WHAT IS INCLUDED
----------------
1. Persistent Firebase student and administrator sign-in (browser local
   persistence). A user stays signed in until Logout, subject to account/session
   revocation by the school.
2. Gmail OAuth connection using an offline refresh token stored encrypted on the
   server, not in browser storage.
3. Scheduled cloud Gmail inbox synchronisation every five minutes. It runs in
   Firebase Cloud Functions, so the student's browser may be closed and the
   device screen may be off. The device must not be relied upon to perform sync.
4. Only new incoming inbox messages received AFTER the student authorises Gmail
   are imported. Existing historical mail is not backfilled. Attachments are
   not copied. Message body is limited to 30,000 characters.
5. Messages are written to the permanent Firestore classMessages archive by
   Cloud Functions. Browser clients cannot create, edit or delete archive rows.
6. The administrator dashboard receives live Firestore updates automatically;
   no refresh button is needed.
7. Student Logout calls a server function to stop Gmail sync and delete the
   server-held refresh token before Firebase sign-out. A six-hour server-side
   maximum session expiry is a safety fallback if the device loses power or
   cannot send the logout request. A four-hour
   lesson fits inside this six-hour window.
8. Service connection readiness cards for SMS, call history, WhatsApp, Facebook
   and TikTok. These are integration slots, not falsely advertised working
   collectors. See SERVICE CONNECTORS below.

IMPORTANT PRIVACY / PLATFORM LIMITS
-----------------------------------
This is a transparent, student-authorised classroom connection. Students must
be told that the instructor can read new incoming Gmail inbox messages after
Gmail authorisation. Use school-approved accounts, obtain any required parent /
guardian and institutional approvals, and follow applicable privacy law.

- Gmail: Gmail API readonly scope is implemented. It is a restricted Google
  scope and can require OAuth app verification and a security assessment before
  public production use. Google OAuth apps left in Testing may issue refresh
  tokens that expire after seven days. Publish/configure the OAuth consent app
  appropriately for production.
- SMS and call history: a web page cannot read a phone's SMS or call log. These
  require a separately installed Android native application, explicit OS
  permissions, Play policy review, and an appropriate school/guardian consent
  process. iOS does not expose general SMS/call-history access to third-party
  apps.
- WhatsApp: the official WhatsApp Business Platform supports business account
  messages delivered to configured webhooks. It does not provide a supported
  API for extracting a student's personal WhatsApp chat history.
- Facebook: Meta Graph APIs expose only supported Page/business assets and
  permissions after app review. They are not a general personal Facebook inbox
  export API.
- TikTok: TikTok developer APIs expose only the data and actions allowed by the
  approved product/scopes. They are not a general personal direct-message
  collection API.

No connector bypasses encryption, device permissions, provider restrictions,
or account consent. The API slots can be activated when valid approved APIs
are available; some requested personal data is not exposed by those platforms.

PROJECT DETAILS
---------------
Firebase project already present in the uploaded source: quiz-4d75d
Firebase Functions region: us-central1 (default)
Scheduler timezone: Africa/Lagos
Vercel website base URL currently used in this project:
https://reading-makes-me-happy.vercel.app

DEPLOYMENT — DO THESE STEPS IN ORDER
------------------------------------
A. GOOGLE CLOUD / GMAIL API
1. Open https://console.cloud.google.com/ and select project quiz-4d75d.
2. Enable Gmail API.
3. Open Google Auth Platform / OAuth consent screen. Configure app name,
   support email, audience and production publishing as required.
4. Create an OAuth Client ID of type Web application.
5. Add this exact authorised redirect URI (confirm the deployed function URL
   shown by Firebase after first deploy):
   https://us-central1-quiz-4d75d.cloudfunctions.net/gmailOAuthCallback
6. The app requests this scope:
   https://www.googleapis.com/auth/gmail.readonly
7. Google may require verification because Gmail readonly is a restricted
   scope. Complete Google's process; do not try to bypass its consent screen.

B. SET FIREBASE FUNCTION SECRETS
1. Install Node.js 20 LTS and Firebase CLI:
   npm install -g firebase-tools
2. Open PowerShell in the extracted project root:
   firebase login
   firebase use quiz-4d75d
3. Create a random 32-byte encryption key (64 hex characters) in PowerShell:
   $bytes = New-Object byte[] 32
   [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
   $key = -join ($bytes | ForEach-Object { $_.ToString('x2') })
   $key
   Keep the key private. Do not put it in public/ or commit it to GitHub.
4. Set the secrets (replace values with the OAuth credentials you created):
   firebase functions:secrets:set OAUTH_CLIENT_ID
   firebase functions:secrets:set OAUTH_CLIENT_SECRET
   firebase functions:secrets:set OAUTH_REDIRECT_URI
   Enter:
   https://us-central1-quiz-4d75d.cloudfunctions.net/gmailOAuthCallback
   firebase functions:secrets:set TOKEN_ENCRYPTION_KEY
   Enter the 64-character hex key created above.
   firebase functions:secrets:set APP_BASE_URL
   Enter:
   https://reading-makes-me-happy.vercel.app

C. DEPLOY BACKEND AND FIRESTORE RULES
1. From the project root run:
   firebase deploy --only functions,firestore:rules
2. Firebase may require the Blaze (pay-as-you-go) billing plan for Cloud
   Functions and Cloud Scheduler. Enable billing only after reviewing expected
   charges and setting budget alerts. The five-minute schedule incurs usage.
3. Confirm these deployed functions exist:
   createGmailAuthorization
   gmailOAuthCallback
   stopStudentSession
   syncAuthorisedGmail
   reviewInstructorRequest
4. Confirm the scheduled function is enabled in Google Cloud Scheduler.

D. DEPLOY THE WEBSITE TO VERCEL
1. The static website files are in public/ and vercel.json sets public/ as the
   Vercel output directory.
2. Upload/commit the complete project to the Git repository connected to your
   existing Vercel project, keeping the root directory at the project root.
3. Redeploy the Vercel project. Do not deploy only student.html/admin.html;
   deploy the entire public/ folder and its JS/CSS files.
4. Keep public/firebase-config.js pointing to the Firebase project actually used
   by the Functions. The supplied config currently points to quiz-4d75d.

E. ADMINISTRATOR SETUP
The admin page requires Firebase custom claim labAdmin=true.
1. Sign in once with the intended admin Google account so Firebase creates the
   user in Authentication.
2. In Firebase Console > Authentication > Users, copy that user's UID.
3. On a trusted administrator computer, use the included grant-admin.cjs with
   a private service-account key stored OUTSIDE the website folder:
   npm install -g firebase-tools
   npm install firebase-admin
   Set GOOGLE_APPLICATION_CREDENTIALS to the private service-account JSON path.
   Run:
   node grant-admin.cjs THE_ADMIN_UID
4. Sign out and back in to refresh the custom claim.
5. Never place a service-account JSON file in public/ or the Vercel repository.

CLASSROOM USE
-------------
1. Student opens https://reading-makes-me-happy.vercel.app/student.html.
2. Student signs in with their school Google account.
3. Student selects “Authorise Gmail and start class sync”.
4. Student reviews Google's permission screen and approves Gmail readonly.
5. Cloud synchronisation starts. The student may lock the screen or close the
   browser; Firebase Cloud Functions performs scheduled sync independently.
6. Admin opens https://reading-makes-me-happy.vercel.app/admin.html and signs in.
   New authorised incoming Gmail messages appear automatically in the archive.
7. Student selects Logout at the end of class. The website first requests the
   server to stop the Gmail session, then signs out of Firebase.
8. If the device powers off before Logout, cloud sync can continue until the
   six-hour session expiry. This is intentional so a four-hour class can run
   with the screen/device unattended. The safety expiry then disables sync.

TEST BEFORE USING WITH STUDENTS
-------------------------------
1. Use one dedicated test student Google account and one admin account.
2. Deploy backend and rules before deploying the front-end update.
3. Connect Gmail, send a NEW test email to the connected Gmail account, and wait
   for the next five-minute scheduler run.
4. Verify it appears on admin.html without refreshing.
5. Close the student browser or lock the device; send another test email and
   verify cloud sync still runs.
6. Click student Logout and send another email. It should NOT be imported.
7. Check Firebase Functions logs and Cloud Scheduler execution history.

SECURITY / OPERATIONS
---------------------
- OAuth refresh tokens are encrypted with AES-256-GCM and stored in a
  server-only Firestore path. Firestore rules deny all browser access to them.
- The Admin SDK writes the message archive; browser clients have read-only
  access to the archive only when they carry the labAdmin custom claim.
- Archived messages have no client delete path and remain stored until an
  authorised project owner implements a retention/deletion policy.
- If an OAuth token is revoked, the sync function records an error in the
  student's connection status. Reconnect Gmail to restore access.
- The scheduled function checks up to 10 pages of 100 new inbox messages per
  student on each run. For unusually high-volume inboxes, extend paging and
  monitor Gmail API quota before production.
- This package has not been deployed to your Firebase/Vercel accounts. You must
  supply the Google OAuth credentials and deploy it before live sync works.
