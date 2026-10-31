# Account access and session lifecycle

Individual accounts retain their database-current roles. Shared walkthrough identities and public-demo deployments use the central read-only policy. A temporary credential grants only the account/password flow, even when the stored account role is administrator.

## Sessions

Interactive JWTs carry a random session identity, account access version and expiry. Authentication verifies the signature/issuer/audience/expiry, current account version, enabled state, shared-login policy and persisted session revocation. The API stores only a SHA-256 hash of a revoked session identity, with its expiry; bearer tokens are not stored or returned as JSON.

Logout persists revocation before reporting success, closes the corresponding local sockets and publishes revocation over the existing Redis connection. Role changes, disable/re-enable, explicit session revocation and credential changes increment the account version and close that account's sockets. If revocation storage fails, local cookies are still cleared and the API reports failure rather than claiming persistent revocation succeeded.

Legacy cookies without the new session identity/version require a fresh sign-in at API cutover. Existing accounts default to enabled/version zero; the additive migration does not change their passwords or delete records. Delegated command credentials retain the parent session identity so revocation applies to them as well. The coordinated runtime qualification also checks the downstream command boundary.

## Administrator recovery and initial credentials

The login page links to **Forgot password?**. A person enters an email address and receives a generic confirmation; unknown and reserved demo addresses receive the same response and create no review item. An eligible request appears in **Users & access → Account requests**. The administrator verifies identity through the approved channel, sets a temporary password with **Verify & reset**, and delivers it privately. A request itself never changes a credential or creates a session. Repeated pending requests for the same address are deduplicated, and shared PostgreSQL rate limits apply to the public request endpoints.

The **Register** form collects name, email, factory/organization, optional job title and a password. It stores a pending request with only a password hash. It does not create a user or session. An individual administrator reviews identity and factory affiliation, explicitly approves the request, and the transaction creates a viewer account using that hash. The request records its reviewer and review time, then discards its copy of the hash. Rejected requests also discard the hash. Existing account addresses receive the same generic submit confirmation. The retired direct registration API rejects in every environment. Approval requires a private individual administrator; shared demo admins cannot review requests.

An individually authenticated administrator verifies the account owner's identity through the installation's approved process, then enters a strong temporary credential. The API accepts that credential only as input, stores its hash, revokes old sessions and returns only account/expiry/status metadata. The application does not return a reset token, password or bearer token and does not claim an email was sent. The administrator uses the approved recovery channel to provide the temporary credential.

The credential expires after 30 minutes and can create exactly one restricted sign-in session. That session cannot read or operate the factory workspace. Its only next action is choosing a different strong password; successful completion clears the restriction, increments the access version again and replaces the HttpOnly session cookie. Expired or already-used credentials require a new administrator recovery action. Administrator-created accounts follow the same initial-password policy. Approved applicants use the password they chose in the request.

Administrators can disable/re-enable an account or revoke its sessions without deleting operational history. Role/enable changes support an expected access version and reject stale edits. A transaction-level lock protects the last enabled individual administrator across concurrent demotion/disable attempts. Reserved walkthrough accounts do not count as recovery administrators. Self-disable, self-demotion and self-reset are unavailable; the account's authenticated Change password action remains supported.

## Socket limits

Only supported read channels are accepted: `aas:all`, `alerts:all`, and numeric `device:<id>:sensor|status|alert`. A socket has at most 32 subscriptions, enforced while each channel is added; a request contains at most 64 names. Incoming messages are limited to 16 KiB, 20 per second and four pending handlers. A process admits at most 128 sockets and 16 simultaneous authorization handshakes. A receiver with more than 1 MiB queued is terminated before another payload is added.

Production sockets retain their authenticated user/session/expiry. Expiry has a dedicated close deadline; later subscriptions and heartbeats reauthorize access with bounded caching. Redis carries immediate session/account revocations between replicas; periodic checks remain active if fan-out fails. Shared walkthrough and temporary-credential sessions cannot attach to the private live fan-out. These rules do not invent site/tenant permissions; current private viewers retain the product's existing fleet read scope.

## Verification

`server/accountAccess.test.ts` and `server/accountRequests.test.ts` create randomly named local test databases and drop only those explicitly owned databases. They exercise persisted logout, role/enable version changes, concurrent last-admin protection, one-time recovery and expiry, pending registration denial, approval, generic recovery requests, and disabled shared logins. `server/websocket.bounds.test.ts` uses real local sockets to test the reported 40-channel case, request bounds, expiry, revocation, reauthorization, flooding and backpressure. The general access tests enumerate every operational mutation for each shared role and assert denial before route side effects.

No test uses production accounts, real email delivery, a physical broker or machine commands.
