# apps/web

The Next.js app and the **composition root**: the only place that imports
adapters and wires them into core use cases. It also owns all UI — there is no
`packages/ui`, see `docs/architecture.md`.

> When `agentRules: true` is enabled in `next.config.ts`, Next.js maintains its
> own `BEGIN/END:nextjs-agent-rules` block in this file. Do not hand-edit inside
> that block; the rules below it are ours.

## Composition

Adapters are instantiated once in `src/server/container.ts`, which exports them
ready to use: `getDb()`, `getInstruments()`, and `scopedLedgerFor(userId)`.
Route handlers, server components, and server actions call those — they never
construct an adapter themselves.

A **use case is composed at the call site**, from those ports:

```ts
const openAccount = makeOpenAccount({ ledger: scopedLedgerFor(user.id) });
```

rather than being exported ready-made from the container. Every user-scoped
port needs the _request's_ user, so a ready-made export would have to take a
`userId` anyway (rule 4, ADR 0009) — and this way the reader sees which ports a
route actually depends on. `scopedLedgerFor` is memoized with React's `cache()`,
so composing per call costs nothing.

Importing `@finansify/db`, `@finansify/providers`, or `@finansify/importers`
outside the server layer is a boundary violation. The one exception:
`src/lib/auth/get-current-user.ts` composes `@clerk/nextjs` with
`@finansify/db`'s `users` functions directly rather than going through
`container.ts` — ADR 0009 places the `SessionProvider` implementation inside
the auth adapter itself, because `core` cannot define a port shaped around a
Clerk identity (`authProvider`/`authSubject`) without knowing Clerk exists.

## Auth

`src/lib/auth/` is the **only** directory permitted to import `@clerk/nextjs`.
Everything else calls `getCurrentUser()` and receives our own `AuthenticatedUser`
with our own UUID — never a Clerk subject id. See ADR 0009.

Clerk's own React components appear only on `/sign-in` and `/sign-up`.

Middleware lives in `src/proxy.ts`. Next 16 renamed `middleware.ts` to
`proxy.ts`, and parses that file statically: the handler must be a function
**declared there** and `config` a literal object — re-exporting either fails the
build. So `src/proxy.ts` is a thin shim that calls `authProxy` from
`src/lib/auth/proxy.ts`. Keep it that way; putting `clerkMiddleware` directly in
`src/proxy.ts` builds fine but breaks the rule above for no gain.

## Caching

**Every `use cache` boundary over user data takes the user id as an argument**,
so it lands in the cache key. Read models are tagged `user:{id}` and
`portfolio:{id}`; mutations call `updateTag(...)`.

Only prices, FX, and macro series are shared between users. Getting this wrong
leaks one user's portfolio to another and looks like a cache hit, not an error.
See ADR 0010.

Background refresh uses `after()` from `next/server`. There is no cron.

## Presentation

This is where formatting happens, and the only place it happens.
`Intl.NumberFormat` and `Intl.DateTimeFormat` at the edge; `core` hands over
`Money` and Temporal values, never strings.

Two things the UI must always express:

- **Stale data is labelled with its timestamp.** Never render an old number as
  though it were live.
- **An unvaluable position is visible as such**, not silently dropped from a
  total.

## Next 16

This version diverges from training data in ways that are easy to get wrong.
Check the docs rather than recalling: `proxy.ts` rather than `middleware.ts`,
Cache Components (`use cache`, `cacheLife`, `cacheTag`, `updateTag`), `after()`,
and `typedRoutes`.

Dev runs Turbopack. Intra-package imports are extensionless.

## UI conventions

Details in `docs/ui.md`. The two that are easiest to violate by accident:

- **Green and red are reserved for profit and loss.** Never for buttons, badges,
  links, or chrome.
- **Tables render through the `<DataList>` primitive**, which is a real `<table>`
  at `md` and above and stacked cards below. Do not hand-roll a responsive table.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
