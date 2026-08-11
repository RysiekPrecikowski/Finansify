# 0001. Hexagonal architecture with four packages

**Status:** Accepted
**Date:** 2026-08-11

## Context

Finansify depends on several third-party services that are chosen under
uncertainty: a database on a free tier, an auth provider, and market-data feeds
that include an unofficial API with no stability guarantee. At least one of them
will need replacing, and we do not know which.

The calculations, by contrast, are stable and are the actual value of the
product: lot matching, valuation, bond accrual, performance. These should not
have to change because a vendor did.

There is also a pull in the other direction. A small project with two users can
be destroyed by premature structure just as easily as by none.

## Decision

Ports and adapters, with four packages and a single composition root.

`packages/core` holds the domain and **defines the interfaces**. It imports
nothing from the workspace and nothing from React, Next, a database driver, or
`fetch`. `packages/db`, `packages/providers`, and `packages/importers` implement
those interfaces and may import only `core` — never each other. `apps/web` is the
only place that imports adapters, and wires them into use cases in
`src/server/container.ts`.

Dependency injection is factory functions closing over their dependencies. No DI
container, no decorators, no `reflect-metadata`.

UI stays inside `apps/web`; there is no `packages/ui`.

## Consequences

Replacing a provider is a bounded, testable task: reimplement the interface, run
the unchanged `core` test suite. That is the actual answer to avoiding vendor
lock-in — the boundary, not the choice of vendor.

`core` becomes trivially testable, with in-memory fakes instead of a database and
a network. This is what makes strict correctness affordable for the bond engine
and lot matching.

The cost is indirection. Some changes touch three files where a monolith would
touch one, and there is a permanent temptation to reach past a port when in a
hurry. Four packages is the ceiling, chosen precisely to keep that cost visible
and bounded.

Declining a `packages/ui` accepts that extracting one later is real work, in
exchange for not fighting shadcn's copy-in model and Tailwind content paths for a
single consumer.

## Alternatives considered

**A single Next.js app with folders.** Simplest, and defensible for two users.
Rejected because the domain logic here is unusually valuable and unusually
long-lived relative to the app around it, and because a provider swap is not
hypothetical — the market-data source is explicitly unofficial.

**More packages** — separate `ui`, `auth`, `bonds`, `market-data`. Rejected as
the mess we are trying to avoid. Each package boundary is a tax, and these would
be paid for structure nobody asked for.

**A DI container.** Rejected as machinery in search of a problem at this size.
Factory functions give the same substitutability with no runtime and no
magic.
