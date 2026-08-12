# 0013. Application-level encryption, with a staged path to per-user keys

**Status:** Proposed
**Date:** 2026-08-12

## Context

Finansify holds a complete private financial history for two people: every
position, every transaction, every amount. Neon encrypts its storage and every
connection is TLS, which covers the provider's own layers and is the same
protection a bank applies there. It does not cover the case where the database
itself is read — a leaked dump, a copied backup, a support session, or the
provider.

There is a second requirement that the provider layer cannot address at all.
The two users are also the two administrators. With one key in the deployment
environment, either can read the other's portfolio, and per-user data isolation
(ADR 0009) stops at the application boundary rather than the person.

**One limit has to be stated before anything else, because every design below
is bounded by it.** In a web application, whoever controls deployment can
capture the other user's key the next time they sign in. No key scheme changes
this; it is a property of shipping the code that runs on your data. Signal and
Bitwarden carry the same caveat for their web clients.

The realistic goal is therefore **protection against passive access** — reading
the database, dumps, backups, or ordinary curiosity — and not protection
against a co-administrator who deliberately backdoors a deployment.

A third constraint: this must be free. Managed key services (AWS KMS, GCP Cloud
KMS) are inexpensive but neither is free, and both require an active billing
account.

## Decision

Encrypt private amounts in the application, before the database sees them,
using **envelope encryption with a per-user data key**.

- **One encrypted payload per row**, not one per amount. `quantity`, `price`,
  `gross_amount`, `fee`, `tax`, `fx_rate` and `note` move into a single JSON
  object encrypted into one `encrypted` column on `transactions`. Every read
  path already loads the whole row and folds it in memory, so there is no case
  where one amount is wanted without the others — seven ciphertexts would mean
  seven IVs, seven tags and seven operations to serve a read that always wants
  all of them.
- Identifiers, `trade_date`, `settle_date`, `type`, `currency`, `source`,
  `external_id` and the soft-delete flag stay plaintext, typed columns. They
  carry no amount, and the database needs them to filter, order and enforce the
  re-import unique index.
- **AES-256-GCM**, a fresh random IV per row, stored as `iv || ciphertext ||
  tag`. The AAD binds the payload to `(user_id, 'transactions', row id)`, so a
  payload cannot be replayed onto another row or another user's row.
- Each user has their own **data key (DEK)**, generated on first use and stored
  in `users` only in wrapped form.

### Why the amounts stop being `NUMERIC(28, 10)`

Not a preference — a consequence. AES-GCM turns bytes into bytes, and a
`NUMERIC` column accepts only what parses as a decimal number, so ciphertext
cannot live there at all. The payload column is `text` holding base64; `bytea`
would be about a third smaller but needs a Drizzle `customType`, and at this
scale the simpler column wins.

Techniques that would preserve the column type were considered and are all
worse here. **Format-preserving encryption** (NIST FF1) returns a number of the
same shape, but it is deterministic, so two transactions of the same amount
produce the same ciphertext and repetition leaks; it also carries no
authentication tag. **Order-preserving encryption** lets the database sort, but
revealing the ordering of a portfolio's amounts gives away most of what the
encryption was meant to hide. **Homomorphic encryption** would let the database
sum, at ciphertext sizes and speeds far beyond anything this project needs —
and the results still would not be `NUMERIC`.

This is viable here for a reason specific to this codebase: ADR 0003 already
derives everything on read, folding the whole transaction list in memory.
Postgres never sums, sorts or filters an amount, so encrypting them costs no
query capability. In an application that aggregated in SQL this decision would
be untenable.

The domain is untouched. `packages/core` continues to receive `Money` and
`Decimal`; encryption lives entirely in `packages/db`, which is what the
adapter boundary is for.

### Staged, deliberately

**Stage 1 — now.** The DEK is wrapped with a single master key held in the
deployment environment.

This protects the data against everything outside the deployment: the database,
its dumps, its backups, and the provider. **It does not separate the two users
from each other**, because either can read the master key and unwrap both DEKs.
That is a known, accepted, temporary state — recorded here rather than
discovered later.

**Stage 2 — deferred to its own phase, tracked in `docs/roadmap.md`.**

> **Separating the two users from each other is Stage 2 work and is not
> delivered by Stage 1.** Until it ships, either administrator can read the
> other's ledger. This is a deliberate, recorded deferral, not an oversight —
> anyone reading Stage 1's code and assuming otherwise would be wrong.

The master key is replaced by a key derived from each user's own **ledger
passphrase**, separate from their Clerk sign-in (Clerk never exposes a
password, which is why a second secret is needed at all).

- The passphrase is stretched in the **browser** via WebCrypto, so it never
  reaches the server; only the derived key does.
- That key unwraps the user's DEK, which lives in an encrypted `httpOnly`
  session cookie for the length of the session.
- Server-side rendering survives: during a user's own request the server holds
  that user's DEK and nothing else. During the other user's request it holds
  no means of decrypting the first user's rows.

**Stage 2 re-wraps two data keys. It re-encrypts no data**, because the data
layer is already final in Stage 1. This is the whole reason for using an
envelope rather than encrypting with the master key directly.

### Key custody

Both the master key (Stage 1) and, later, each ledger passphrase and its
recovery code (Stage 2) are stored in both teammates' password managers.
A recovery code that independently unwraps the DEK is mandatory: without it a
forgotten passphrase destroys that user's ledger.

The restore procedure is written in `docs/deployment.md` and **executed once
against a copy**. A recovery path that has never been exercised is not a
recovery path.

## Consequences

**`NUMERIC(28, 10)` stops guaranteeing that an amount is a number.** ADR 0005
chose that column type so the database would refuse a malformed or lossy value;
a ciphertext column cannot. This is the second backstop given up below the
application, after ADR 0009 declined row-level security, and the two compound:
nothing beneath the application layer checks either isolation or numeric
validity.

Worth weighing honestly, though: the database was the *second* line, never the
first. The only write path is the adapter, which already parses every amount
through `core`'s `decimalString` schema and constructs a `Decimal` from the
string. What is lost is the backstop, not the validation — and the same is true
of ADR 0009's missing RLS. The cost is that a bug in the adapter now has
nothing underneath it, which is why both this surface and that one get
`/security-review` rather than trust.

**Calculations are unaffected.** This is the question the column-type change
invites, and the answer is that Postgres was never doing the arithmetic. The
`numeric` columns are already read in Drizzle's `string` mode and handed to
`Decimal` unparsed; after this change the adapter decrypts a JSON payload and
hands `Decimal` the *same strings*. Every figure downstream is bit-for-bit
identical. What is given up is SQL-side aggregation, ordering and indexing of
amounts — none of which any phase in `docs/roadmap.md` uses, because ADR 0003
folds the whole transaction list in memory.

One inversion worth noting: `NUMERIC(28, 10)` silently rounds an eleventh
decimal place away on write. A serialized payload keeps whatever string it is
given, so the encrypted form can preserve *more* precision than the column did.
The adapter therefore has to decide explicitly what it serializes rather than
inheriting the column's rounding by accident.

**Revisit this if the ledger stops fitting in memory.** The decision rests
entirely on ADR 0003's derive-on-read model. If a single user's transaction
list ever grows past what is comfortable to load per request, or if SQL-side
reporting becomes wanted, encrypted amounts become an obstacle rather than a
free win — and that is the point to reopen this, not before.

**Amounts can no longer be read in a database console**, including while
debugging a wrong figure. Diagnosis goes through the application, or through a
decrypt script run with the key.

**Losing a key loses the data it protects.** There is no recovery that was not
arranged in advance, which is why escrow and the drill are part of this decision
rather than an operational afterthought.

**Row ids are generated by the application, not `defaultRandom()`**, because
the AAD binds a ciphertext to its row id and the id must therefore exist before
the row is encrypted.

**A database dump becomes safe to store anywhere.** This is the reason the
off-provider backup named in `docs/roadmap.md` gets much cheaper: the copy is
useless without keys the copy does not contain.

**Amounts can no longer be inspected in a database console**, including while
debugging. Diagnosing a wrong figure goes through the application.

## Alternatives considered

**A managed KMS (AWS or GCP).** Stronger custody: the master key never leaves
the service, rotation and audit come free. Rejected on cost — neither is free
and both need a billing account — and because it would not have addressed the
requirement that actually motivated this, since anyone with deploy access can
still call the KMS.

**A single key for everything, no envelope.** Simpler by a few dozen lines.
Rejected because rotating the key, or moving to per-user passphrases, would
then mean re-encrypting every row rather than re-wrapping two keys. The
envelope is what makes Stage 2 cheap.

**Client-side decryption only, server never sees plaintext.** Feasible here —
`packages/core` is pure TypeScript and folds positions in a browser perfectly
well. Rejected because it removes server-side rendering of every figure, and
against the one threat it would additionally cover — a co-administrator
shipping malicious code — it gives nothing, since that code would run in the
browser too.

**Two separate deployments, one per person.** Physical separation, no
cryptography, no unlock step, and free on both platforms. Rejected because it
discards the shared market-data cache (ADR 0010) — the same price and FX
requests would run twice — and doubles the deployment and secret surface for
two people who want one product.

**No application-level encryption.** Rely on Neon's at-rest encryption and
spend the effort on scoping and backups instead. A defensible position, and the
right one for many products. Rejected here because the data is a complete
personal financial history, and because the second requirement — separating the
two users — has no answer at that layer.
