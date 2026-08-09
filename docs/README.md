# Docs

Five files and a folder of decisions. Each one is a page or less on purpose — if a doc
stops fitting on a page, that is a signal to split it or move the reasoning into an ADR.

| File                               | Answers                                                  | Changes         |
| ---------------------------------- | -------------------------------------------------------- | --------------- |
| [product.md](product.md)           | What are we building, and what is deliberately excluded? | Rarely          |
| [architecture.md](architecture.md) | How do the pieces fit, and where does new code go?       | Rarely          |
| [domain.md](domain.md)             | What are the accounting rules that must never be broken? | Rarely          |
| [roadmap.md](roadmap.md)           | What is done, what is next, what is still undecided?     | **Every phase** |
| [decisions/](decisions/)           | Why is it built this way?                                | Append-only     |

## How to use this as a human

Read `product.md` and `domain.md` once. Check `roadmap.md` when you sit down to work.
Reach for `decisions/` only when you are about to disagree with something.

## How to use this with Claude

`CLAUDE.md` at the repo root loads automatically in every session and routes to the
right file here. That is the whole mechanism — you should not need to paste docs into chat.

Practically:

- Starting work: `/context` gives Claude the current state without it reading everything.
- Disagreeing with a decision: point it at the ADR. If the ADR is genuinely wrong, write a new one that supersedes it rather than editing history.
- Finishing a phase item: `/sync-docs` updates the roadmap.

## Rules for writing docs here

1. **One concept per file.** An agent should read exactly one file to do its task.
2. **State rules, not narrative.** "Money is Decimal, never number" beats three paragraphs about floating point.
3. **Decisions live in ADRs.** Keeping rationale out of the reference docs is what keeps them short.
4. **Say what is _not_ being done, and why.** Half of MVP discipline is written-down exclusions.
5. **No status updates outside `roadmap.md`.** Everything else should stay true for months.
