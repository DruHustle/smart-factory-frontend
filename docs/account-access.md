# Account access and session lifecycle

Approved individual accounts retain their database-current roles when selecting **Live**, including on a site that offers shared demo accounts. Reserved walkthrough identities and any individual selecting **Demo** use the central read-only policy. A temporary credential grants only the account/password flow, even when the stored account role is administrator.

## Sessions

Interactive JWTs carry a random session identity, account access version and expiry. Authentication verifies the signature/issuer/audience/expiry, current account version, enabled state, shared-login policy and persisted session revocation. The API stores only a SHA-256 hash of a revoked session identity, with its expiry; bearer tokens are not stored or returned as JSON.

Logout persists revocation before reporting success, closes the corresponding local sockets and publishes revocation over the existing Redis connection. Role changes, disable/re-enable, explicit session revocation and credential changes increment the account version and close that account's sockets. If revocation storage fails, local cookies are still cleared and the API reports failure rather than claiming persistent revocation succeeded.

Legacy cookies without the new session identity/version require a fresh sign-in at API cutover. Existing accounts default to enabled/version zero; the additive migration does not change their passwords or delete records. Delegated command credentials retain the parent session identity so revocation applies to them as well. The coordinated runtime qualification also checks the downstream command boundary.

## Forgot password and email recovery

The sign-in page links to **Forgot password?**. A person enters their account email and receives a generic confirmation. When delivery is configured, **Send reset link** queues an email for an enabled individual account. Unknown, disabled and reserved demo identities receive the same public response but no reset credential. Pending applicants do not have an active account to recover.

The link expires after 30 minutes and can be used once. A newer request replaces older outstanding links. Its form accepts a new password and matching confirmation; opening the link alone never changes a password. The browser removes the token from its URL before mounting analytics and keeps the token only in memory. No recovery credential is saved in browser storage. After success the person signs in again with the new password, and previous sessions and active sockets are invalidated.

The API stores a SHA-256 token hash in `password_reset_tokens`, bound to the user's email and current access version. Issuance, consumption and account changes cannot make a used, expired or revoked link valid again. Delivery uses a separate AES-256-GCM envelope, authenticated to the row, user, email and access version. The worker clears that encrypted envelope after delivery or invalidation. Reset links never appear in notification inbox APIs, account responses, audit details or provider-error logs. Shared PostgreSQL limits apply both to recovery requests and to token redemption attempts. Successful reset also closes the matching pending administrator-help request.

### Existing mail-worker configuration

The existing SMTP, Resend or SES sender delivers recovery links using its current recipient policy. Email credentials remain on the worker. Set the same canonical `PASSWORD_RESET_ORIGIN` on the API and worker, for example `https://smart-factory-iot-app.vercel.app`; the API may also use its single `ALLOWED_ORIGIN`. Both processes use their existing matching `DASHBOARD_SERVICE_TOKEN` to authenticate the encrypted delivery payload. API delivery metadata must reflect the actual configured worker (`EMAIL_DELIVERY_CONFIGURED=true` and the supported bundle/compose deployment mode). Neither the request's Host header nor a caller-supplied redirect determines the reset link.

If origin, service-key or delivery configuration is unavailable, the form offers **Request password help**. Every eligible request also remains visible to an individual administrator in **Users & access → Account requests** until completed or rejected, so delivery failures can be handled through the approved recovery channel. The generic email confirmation does not assert that a provider has accepted or delivered the message.

## Administrator signup review and role assignment

The **Register** form collects name, email, factory/organization, optional job title and a password. It stores a pending request with only a password hash and creates no user or session. An individual administrator selects **Approve**, reviews the identity and factory affiliation, chooses **Viewer**, **Operator**, **Engineer** or **Admin**, and explicitly confirms verification. Viewer is selected initially. Changing the role clears the verification checkbox so the final grant is reviewed. The transaction creates the chosen role and records the reviewer, request, user and role in the audit trail; failed audit storage rolls back the approval. Role assignment is never accepted from the applicant.

**Reject** opens a confirmation naming the applicant. Approved or rejected requests discard their stored password hash. Repeated pending requests are deduplicated, and two concurrent reviews cannot approve the same request twice. Existing account addresses receive the same generic submit confirmation. The retired direct registration API rejects in every environment. Review requires an individual administrator in Live mode; shared demo admins and individual Demo sessions cannot inspect or act on the queue. Existing account roles can still be changed through the separate user access controls.

## Administrator recovery and initial credentials

For a password-help request, the administrator verifies identity through the approved channel, sets a temporary password with **Verify & reset**, and delivers it privately. A request itself never changes a credential or creates a session.

An individually authenticated administrator verifies the account owner's identity through the installation's approved process, then enters a strong temporary credential. The API accepts that credential only as input, stores its hash, revokes old sessions and returns only account/expiry/status metadata. The application does not return a reset token, password or bearer token and does not claim an email was sent. The administrator uses the approved recovery channel to provide the temporary credential.

The credential expires after 30 minutes and can create exactly one restricted sign-in session. That session cannot read or operate the factory workspace. Its only next action is choosing a different strong password; successful completion clears the restriction, increments the access version again and replaces the HttpOnly session cookie. Expired or already-used credentials require a new administrator recovery action. Administrator-created accounts follow the same initial-password policy. Approved applicants use the password they chose in the request.

Administrators can disable/re-enable an account or revoke its sessions without deleting operational history. Role/enable changes support an expected access version and reject stale edits. A transaction-level lock protects the last enabled individual administrator across concurrent demotion/disable attempts. Reserved walkthrough accounts do not count as recovery administrators. Self-disable, self-demotion and self-reset are unavailable; the account's authenticated Change password action remains supported.

## Socket limits

Only supported read channels are accepted: `aas:all`, `alerts:all`, and numeric `device:<id>:sensor|status|alert`. A socket has at most 32 subscriptions, enforced while each channel is added; a request contains at most 64 names. Incoming messages are limited to 16 KiB, 20 per second and four pending handlers. A process admits at most 128 sockets and 16 simultaneous authorization handshakes. A receiver with more than 1 MiB queued is terminated before another payload is added.

Production sockets retain their authenticated user/session/expiry. Expiry has a dedicated close deadline; later subscriptions and heartbeats reauthorize access with bounded caching. Redis carries immediate session/account revocations between replicas; periodic checks remain active if fan-out fails. Shared walkthrough and temporary-credential sessions cannot attach to the private live fan-out. These rules do not invent site/tenant permissions; current private viewers retain the product's existing fleet read scope.

## Verification

`server/accountAccess.test.ts`, `server/accountRequests.test.ts` and `server/passwordRecovery.test.ts` use explicitly disposable local databases. They exercise persisted logout, role/enable version changes, concurrent last-admin protection, one-time recovery and expiry, token replacement, concurrent redemption, approval roles, rejection, audit rollback and disabled/shared identities. Worker tests verify the same cryptographic fixture and delivery eligibility without sending real email. The browser recovery contracts exercise the sign-in link, generic confirmation, matching-password form, URL redaction, expiry and mobile layout. `server/websocket.bounds.test.ts` uses real local sockets to test channel bounds, expiry, revocation, reauthorization, flooding and backpressure. The general access tests enumerate every operational mutation for each shared role and assert denial before route side effects.

No test uses production accounts, real email delivery, a physical broker or machine commands.
