# finansify

A [Turborepo](https://turborepo.com) monorepo with a [Next.js](https://nextjs.org) app,
bootstrapped from [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Layout

```
apps/web       Next.js app (App Router, TypeScript, Tailwind v4)
packages/core  Empty workspace package -- add shared code here
```

## Setup

Requires Node 24+ and pnpm 10.

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Commands

|                   |                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `pnpm dev`        | Run the app                                                                                 |
| `pnpm check`      | build + lint + typecheck + test + format:check, cached via turbo -- run before every commit |
| `pnpm test`       | Run tests                                                                                   |
| `pnpm test:watch` | Tests in watch mode                                                                         |
