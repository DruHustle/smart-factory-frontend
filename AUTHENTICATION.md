# Authentication and access

The Node API verifies bcrypt passwords and issues an eight-hour HS256 HttpOnly cookie. Every protected request checks persisted current role, disabled state, session generation, recovery restriction and revocation. Browser code never stores the JWT. Sockets retain identity and expiry and enforce revocation; .NET delegated routes independently verify the persisted session and current role. Unsafe cookie requests enforce the exact allowed origin.

Private installations support viewer, operator, engineer and administrator roles. Shared reserved demo identities and public-demo deployments are always read-only and limited to approved demonstration records. A displayed engineer/admin role never grants a shared identity operational writes. Fixture records remain read-only even for individual users. Disabling demo sign-in rejects already-issued reserved sessions too.

New passwords require at least 12 characters within bcrypt's 72-byte UTF-8 limit. PostgreSQL login counters apply across replicas. Configure trusted proxy attribution for Vercel/Caddy and retain ingress rate limits. Production requires verified TLS, distinct secrets and exact allowed origins.

Use [access, recovery and publication](docs/access-and-publication.md) for private first-admin bootstrap, verified administrator recovery, temporary single-use 30-minute credentials, forced initial password change, disablement, revocation and last-usable-admin protection. Public self-registration cannot grant factory access. Password assistance directs users to this supported administrator workflow; no email reset link is invented.

Demonstration identity creation is separate from fixture seeding. The persisted visibility setting never seeds. See [operations](docs/operations.md) and [Oracle deployment](deploy/oracle/README.md). AAS service credentials are server-only OAuth identities; they do not provide user SSO. See [AAS authorization](docs/authorization-and-aas.md).
