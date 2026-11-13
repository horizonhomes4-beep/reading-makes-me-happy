SERVICE CONNECTOR IMPLEMENTATION PLAN
=====================================

The project contains the secure shared archive, connection-status collection,
administrator UI and the working Gmail cloud connector. The following services
must be integrated only through their official supported products and with
explicit account-owner authorisation.

1. WHATSAPP BUSINESS PLATFORM
- Create a Meta Business portfolio and WhatsApp Business Account.
- Create a Meta developer app and add the WhatsApp product.
- Configure the webhook URL and verify token in the server environment.
- Subscribe the WABA to the official message webhooks.
- Store the permanent/system-user access token in Firebase Secret Manager.
- Validate X-Hub-Signature-256 for every webhook request before accepting it.
- Map provider message IDs to deterministic Firestore document IDs for
  idempotency; store only the business messages the connected business account
  is permitted to receive.
- This is not a connector for reading a student's personal WhatsApp chats.

2. FACEBOOK / META GRAPH API
- Create a Meta developer app and complete required business verification/app
  review for the exact Page/business permissions needed.
- Use Meta's OAuth flow and least-privilege scopes. Store tokens server-side in
  Secret Manager or encrypted server-only Firestore.
- Subscribe only approved Page/business webhook fields.
- Validate webhook signatures, deduplicate event IDs, and record provider,
  account, timestamp and authorised scope with every event.
- Do not attempt to scrape personal profiles, private inboxes or session cookies.

3. TIKTOK DEVELOPER API
- Register a TikTok developer app and request only the products/scopes actually
  available to the approved use case.
- Implement TikTok OAuth state/PKCE and server-side token storage.
- Use only the approved APIs and webhook events made available to that app.
- TikTok's APIs are not a general personal direct-message archive API.

4. ANDROID SMS / CALL LOG
- This cannot be added to the website with a browser API. It requires a separate
  Android application and Android runtime permissions. Google Play restricts
  SMS and Call Log permissions to approved core use cases; school monitoring is
  not automatically eligible. A sideloaded APK still must respect Android
  permissions and local law. iOS does not provide general access to these logs.
- Any native app must show an obvious disclosure, request permission in context,
  allow revocation, transmit only approved fields over TLS, authenticate each
  device, and send data through a verified Firebase callable/HTTPS endpoint.

COMMON BACKEND CONTRACT FOR FUTURE APPROVED CONNECTORS
-----------------------------------------------------
Use top-level Firestore collection `classMessages` with server-only writes.
Suggested fields:
  studentUid, studentEmail, provider, account, messageId, sender, subject,
  body, receivedAt, syncedAt, visibility

Use a stable ID derived from provider + account ID + provider message ID so
webhook retries cannot create duplicates. Do not expose tokens to browser code.
Do not grant clients write access to `classMessages`, `privateIntegrations`, or
`oauthStates`. Add a service status document to `integrationStatus/{uid}` using
Admin SDK only. Administrator reads are guarded by the `labAdmin` custom claim.
