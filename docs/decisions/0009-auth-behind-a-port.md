# 0009. Auth behind a port, with our own user identity

**Status:** Accepted
**Date:** 2026-08-11

## Context

Finansify needs authentication from day one — it is on the public internet even
with two users. Clerk is the pragmatic choice: a generous free tier, a
first-class Next.js integration, and one-click provisioning through the Vercel
Marketplace.

The concern is not whether Clerk is good. It is that auth providers are among the
stickiest dependencies a product acquires, and the usual mechanism is not the SDK
— it is the **identity**. Once `user_2abc...` is a foreign key on every table,
migrating means rewriting the entire database, and no amount of wrapping the SDK
helps.

There is a second question: how per-user data isolation is guaranteed. Postgres
row-level security is the standard answer, but it ties authorization to the
database engine, which ADR 0008 has deliberately left open.

## Decision

Use Clerk, isolated by four structural rules:

1. `core` defines `SessionProvider` and
   `AuthenticatedUser { id: UserId; email: string }`. It has no idea Clerk
   exists.
2. `apps/web/src/lib/auth/` is the **only** directory permitted to import
   `@clerk/nextjs`. Everything else calls `getCurrentUser()`.
3. **`users.id` is our own UUID.** `auth_provider` and `auth_subject` hold the
   Clerk identity. No other table references a provider id.
4. Clerk's React components appear only on `/sign-in` and `/sign-up`. The app
   header, avatar, and settings use our own user object.

**No RLS.** Every user-scoped query filters `user_id` in application code. To
make that structurally unforgettable rather than a matter of discipline,
repositories are **user-bound at construction**:

```ts
const ledger = ledgerRepository.forUser(user.id);
```

There is no API that returns a queryable repository without a user id.

## Consequences

Rule 3 is the one that matters. It turns an auth migration from "rewrite every
foreign key" into "backfill one column" — the cheapest anti-lock-in move
available, paid once, at schema-design time.

The `forUser` shape means an unscoped user query is not something a developer
must remember to avoid; it is something they cannot express. This is the cheap
version of the guarantee RLS gives, it survives an engine swap, and unlike RLS it
costs nothing at read time and works identically on Postgres and SQLite.

The costs: one extra indirection on every user lookup, and the fact that rules 2
and 4 are conventions rather than enforced constraints, per ADR 0002.

**The `users` row is provisioned lazily, inside `getCurrentUser()`, not via a
Clerk webhook.** `getCurrentUser()` looks up `users` by `(auth_provider,
auth_subject)`; on a miss, it inserts (`ON CONFLICT DO NOTHING RETURNING *`,
so two concurrent first requests from the same new user — e.g. two tabs — don't
race) and returns the result. Every request pays the same lookup either way, so
this is not an added cost over the webhook path — only the creation step moves.
A webhook route needs the same lazy check anyway as a fallback for the gap
between signup and the event arriving, which would leave two creation paths
instead of one. Lazy also introduces no new endpoint, no signature
verification, and no webhook secret — consistent with ADR 0003's bias against
async, out-of-request machinery. The trade-off: nothing currently reacts to a
user being deleted or changed on Clerk's side (an orphaned `users` row);
acceptable at two known users, revisit if it starts to matter.

Declining RLS also means there is no database-level backstop. If a repository
implementation is written wrongly, nothing below it will catch the mistake. The
`forUser` construction is what makes that acceptable, and it is why the private
cache boundary gets an explicit end-to-end test in `docs/roadmap.md`.

## Alternatives considered

**Clerk ids as foreign keys directly.** One less join and less code. Rejected —
this is precisely the lock-in the design exists to avoid, and it is unrecoverable
without a full migration.

**Postgres RLS.** A real defence in depth, and the right answer for genuinely
multi-tenant systems. Rejected because it binds authorization to Postgres while
ADR 0008 is open, adds per-query session-variable plumbing, and interacts badly
with connection pooling.

**Auth.js / NextAuth, self-hosted.** No vendor at all. Rejected for the
operational burden of owning credential storage, email verification, and session
security for a two-user app. The port makes this a viable future move rather than
a decision that must be right now.

**Supabase Auth.** Would come bundled with the database. Rejected in ADR 0008 for
coupling two concerns the architecture wants separable.
