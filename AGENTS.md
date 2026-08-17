# Quick-Clinic Agent Rules

## 0. Read This First

Quick-Clinic contains two independent packages in one repository.

It is **not** a pnpm workspace/monorepo.

There is no:

```text
pnpm-workspace.yaml
```

Packages:

```text
/
```

* Next.js 16
* App Router
* TypeScript
* Prisma 7
* NextAuth
* Zod 4
* Vitest
* Neon PostgreSQL
* Upstash Redis
* Deployed to Vercel

And:

```text
socket-server/
```

* Standalone Socket.IO server
* Own `package.json`
* Own `pnpm-lock.yaml`
* Deployed to Render

Never assume project structure, commands, dependencies, environment variables, or deployment configuration from memory.

Always inspect the repository source of truth first.

---

# 1. Source-of-Truth Files

Before performing work, inspect the appropriate source file.

## Commands

For available development/build/test commands, inspect:

```text
commands.md
```

Do not invent commands if `commands.md` already defines them.

---

## Dependencies / Tech Stack

For root application dependencies, inspect:

```text
package.json
pnpm-lock.yaml
```

For the Socket.IO server, inspect:

```text
socket-server/package.json
socket-server/pnpm-lock.yaml
```

Use installed package versions when deciding APIs or syntax.

Do not rely only on model knowledge.

---

## Environment Variables

For environment variables, inspect:

```text
.env.example
```

Use `.env` / `.env.local` only as runtime configuration.

Never hardcode secrets.

Never commit real environment values.

Do not duplicate the complete environment variable list inside this file when `.env.example` is the authoritative source.

---

## Prisma

For the database schema, inspect:

```text
prisma/schema.prisma
```

Prisma generated client output is:

```text
src/generated/prisma
```

Never manually edit generated Prisma files.

---

## Tests

For testing setup inspect:

```text
vitest.config.ts
src/__tests__/
```

---

# 2. Package Manager

Always use:

```text
pnpm
```

Never switch to:

```text
npm
yarn
bun
```

unless the project is intentionally migrated.

The repository pins its pnpm version in `package.json`.

`pnpm-lock.yaml` is the dependency source of truth.

Remove accidental:

```text
package-lock.json
yarn.lock
bun.lockb
```

if they are created unintentionally.

---

# 3. Docker Development

Normal local development commands should run inside Docker.

For the root app:

```bash
docker compose exec app <command>
```

For the socket server:

```bash
docker compose exec socket-server <command>
```

This applies to:

* installs
* tests
* linting
* TypeScript checks
* Prisma commands
* development scripts

Before running a command, check:

```text
commands.md
```

Do not assume the command name.

---

# 4. AI Model Routing

Use models according to task complexity.

## Default

Use:

```text
Gemini 3.7
```

as the default implementation model.

---

## Low-Complexity Work

Use:

```text
Gemini 3.7 Low
```

for simple mechanical repository work such as:

* git status
* git diff inspection
* pull operations
* push operations after explicit authorization
* simple file movement
* renaming files
* straightforward text/config changes
* command execution
* simple repository inspection

A low model must never independently decide to commit or push.

---

## Mechanical Verification

Prefer:

```text
Gemini 3.7 Flash Low
```

or another capable low-cost model for:

* running lint
* checking lint errors
* TypeScript checks
* formatting checks
* running tests
* reading straightforward test failures
* basic build verification

Equivalent lightweight GPT models may also be used.

Complex failures should be escalated to the main coding model.

---

# 5. Planning Workflow

For non-trivial tasks, make a plan before coding.

Examples:

* new features
* multi-file changes
* schema changes
* authentication
* payments
* Socket.IO architecture
* large refactors
* API changes
* significant bug fixes

## Planning Model

Create the initial plan using:

```text
Gemini 3.7 High
```

The plan should inspect existing code before deciding architecture.

It should consider:

* current structure
* affected files
* dependencies
* APIs
* database impact
* backward compatibility
* tests
* regression risks

---

## Plan Review

If available, review the plan using:

```text
Claude Opus 4.6
```

Check for:

* missing edge cases
* architecture problems
* unnecessary complexity
* SOLID violations
* regression risks
* security issues
* missing tests
* incorrect assumptions

If Claude Opus 4.6 is unavailable:

```text
skip the review
```

Do not block implementation.

Proceed with the Gemini 3.7 High plan.

---

# 6. Understand Before Editing

Before modifying code:

1. inspect the target file
2. inspect related files
3. inspect relevant dependencies
4. inspect related tests
5. understand existing conventions
6. search for reusable implementations

Do not create new abstractions before checking whether the same capability already exists.

---

# 7. Follow the Existing Tech Stack

Before writing framework-specific code, inspect:

```text
package.json
pnpm-lock.yaml
```

Examples:

Do not write:

* Pages Router patterns when the project uses App Router
* old Prisma APIs incompatible with Prisma 7
* Zod 3 patterns when the project uses Zod 4
* Jest-specific tests when Vitest is used
* unsupported NextAuth APIs

Match the installed versions.

---

# 8. SOLID Principles

Use SOLID principles where they improve maintainability.

## Single Responsibility

Components, hooks, services, and modules should have one primary responsibility.

Avoid files that simultaneously contain:

* UI
* API calls
* database logic
* validation
* business rules
* Socket.IO logic
* formatting

Split responsibilities when complexity increases.

---

## Open/Closed

Prefer extending stable code rather than rewriting existing working behavior.

New features should avoid breaking existing flows.

---

## Dependency Inversion

Business logic should not unnecessarily depend directly on low-level implementation details.

Use sensible boundaries for:

* database logic
* Redis
* Socket.IO
* Razorpay
* authentication
* external APIs

Do not create abstractions only for theoretical purity.

---

# 9. Regression Safety

Adding a feature must not unnecessarily break existing behavior.

Before changing existing logic:

* inspect callers
* inspect tests
* inspect shared types
* inspect API contracts
* inspect schema relationships

Prefer:

```text
extend existing behavior
```

over:

```text
replace working behavior
```

unless replacement is necessary.

Bug fixes should preferably include regression tests.

---

# 10. Folder Structure

Keep files organized by responsibility.

Do not dump unrelated files directly into `src`.

Use existing repository conventions first.

A reasonable structure may include:

```text
src/
  app/
  components/
  hooks/
  lib/
  services/
  types/
  features/
  __tests__/
```

Only create directories that are useful for the project.

---

# 11. Components

Reusable React UI belongs in:

```text
src/components/
```

or within a feature-specific component folder.

Example:

```text
src/features/appointments/components/
```

Page files should primarily compose components rather than contain entire feature implementations.

---

# 12. Hooks

Reusable React hooks should be kept separately.

Examples:

```text
src/hooks/
```

or:

```text
src/features/<feature>/hooks/
```

Do not bury large reusable hook logic inside UI components.

---

# 13. Types

Reusable types should be organized separately.

Examples:

```text
src/types/
```

or:

```text
src/features/<feature>/types/
```

Do not fill components with large unrelated interface/type definitions.

Do not duplicate Prisma-generated types unless an application-specific type is actually needed.

---

# 14. Services / Classes

Business or integration services should live in clearly named locations such as:

```text
src/services/
```

or:

```text
src/lib/
```

or feature-scoped:

```text
src/features/<feature>/services/
```

Follow existing repository patterns when they already exist.

---

# 15. API Structure

Next.js API routes belong under:

```text
src/app/api/
```

Organize them by domain.

Example:

```text
src/app/api/appointments/
src/app/api/users/
```

Keep route handlers reasonably thin.

Prefer conceptual flow:

```text
request
→ authentication / authorization
→ validation
→ business logic
→ database / external service
→ response
```

Do not force service layers on trivial endpoints.

---

# 16. Feature Structure

For larger features, prefer feature-oriented organization.

Example:

```text
src/features/appointments/
  components/
  hooks/
  services/
  types/
  schemas/
  utils/
```

Do not create a full feature architecture for tiny functionality.

---

# 17. File Size

Normal handwritten source files should generally remain below:

```text
300–350 lines
```

When a file approaches this size, check whether it should be split by:

* component
* responsibility
* hook
* service
* type
* schema
* utility
* feature

The limit does not apply to:

* generated files
* lockfiles
* machine-generated output

Do not split a file artificially just to satisfy a line count.

The objective is maintainability.

---

# 18. Reuse Before Creating

Before adding a new:

* hook
* utility
* service
* type
* component
* schema
* helper

search for an existing equivalent.

Reuse or extend where practical.

Avoid duplicate implementations of the same behavior.

---

# 19. Prisma Changes

When changing:

```text
prisma/schema.prisma
```

always inspect impacted:

* services
* queries
* API handlers
* Zod schemas
* types
* tests

After schema changes, regenerate Prisma using the appropriate command from:

```text
commands.md
```

Never manually modify:

```text
src/generated/prisma
```

---

# 20. Schema Changes Require Test Changes

If a Prisma schema change modifies behavior or data shape:

* update affected tests
* update fixtures
* update mocks
* add tests for new behavior
* remove assumptions about deleted fields

Do not change the schema while leaving tests based on the old structure.

---

# 21. Zod Validation

The repository uses Zod 4.

When modifying:

```text
src/app/api/**
```

or relevant data structures, inspect corresponding validation schemas.

Ensure schemas stay aligned with:

* request payloads
* Prisma models
* nullable fields
* optional fields
* enums
* API responses where validation exists

---

# 22. New Code Requires Tests

Meaningful new behavior should include tests.

Tests should cover important:

* success cases
* failure cases
* edge cases
* regression scenarios

Do not write meaningless tests purely for coverage.

---

# 23. Bug Fixes

For bugs, prefer:

```text
reproduce bug with test
→ fix implementation
→ verify test passes
```

Do not weaken correct assertions just to make the suite green.

---

# 24. Mandatory Verification

After meaningful code changes run the appropriate checks inside Docker.

Before running commands, inspect:

```text
commands.md
```

At minimum verify:

```text
TypeScript
Lint
Tests
```

For API/schema changes also verify:

```text
Zod validation
Prisma generation/schema correctness
```

Target:

```text
0 newly introduced failures
```

---

# 25. Verification Model

Use:

```text
Gemini 3.7 Flash Low
```

or another capable lightweight model to run:

* lint
* TypeScript checks
* tests
* formatting checks
* simple builds

The primary coding model remains responsible for complex fixes.

---

# 26. Git Safety

Never perform an unprompted:

```bash
git commit
git push
```

Only stage, commit, or push when the user explicitly asks.

Do not interpret:

```text
implement this
finish this
fix this
```

as permission to push.

---

# 27. Protect Existing Work

Before potentially destructive Git operations, inspect:

```bash
git status
```

Never overwrite, discard, or reset unrelated user changes.

Avoid:

```bash
git reset --hard
git clean -fd
```

unless explicitly required and authorized.

---

# 28. Generated Code

Do not manually edit generated output.

Especially:

```text
src/generated/
```

Modify the source configuration/schema and regenerate instead.

---

# 29. Environment & Secrets

For environment configuration, inspect:

```text
.env.example
```

Do not maintain a duplicate list here.

Never:

* commit real secrets
* expose private server secrets through `NEXT_PUBLIC_*`
* hardcode credentials
* place secrets in test fixtures
* print sensitive values in logs

`.env.local` should remain gitignored.

---

# 30. External Services

Before modifying integrations, inspect existing code/configuration.

Current architecture includes services such as:

* Neon PostgreSQL
* Upstash Redis
* Socket.IO
* Razorpay
* NextAuth
* Vercel
* Render

Do not create duplicate clients or integrations without first inspecting the existing implementation.

---

# 31. Deployment Rules

Frontend deployment:

```text
Vercel
```

Socket server deployment:

```text
Render
```

Do not assume Railway or another backend exists unless repository configuration shows otherwise.

---

# 32. Post-Push Verification

Only after an explicitly authorized push:

For frontend changes, inspect Vercel deployment/build status.

Look for:

* failed builds
* SSR errors
* hydration errors
* missing environment variables
* runtime failures

For socket-server changes, inspect Render service logs/runtime status.

Do not assume a health endpoint exists.

---

# 33. Health Endpoints

The socket server currently has no guaranteed:

```text
/health
/api/health
```

endpoint.

Do not attempt to verify it through a nonexistent route.

Either:

* use Render logs/status
* or deliberately add a health endpoint as part of an approved task

---

# 34. TypeScript

Maintain strong typing.

Avoid:

```ts
any
```

when practical.

Prefer:

```text
unknown + runtime narrowing
```

for untrusted data.

Use existing shared/domain types when available.

---

# 35. Security

When modifying relevant code, check for:

* authentication
* authorization
* IDOR
* request validation
* secret exposure
* payment verification
* unsafe client-controlled IDs
* webhook verification
* Redis misuse
* unsafe database operations

TypeScript types do not replace runtime validation at trust boundaries.

---

# 36. Error Handling

Do not silently swallow important errors.

Avoid empty catches unless intentionally justified.

Error handling should:

* preserve useful server-side diagnostics
* avoid leaking secrets
* return appropriate responses
* distinguish expected domain errors from unexpected failures

---

# 37. Scope Control

Do not turn a small feature into a repository-wide rewrite.

Avoid unrelated refactors.

If existing architecture blocks a safe implementation, perform only the smallest necessary refactor.

---

# 38. Documentation

When a change introduces a new project-wide convention, update relevant documentation.

Possible files:

```text
AGENTS.md
commands.md
README.md
.env.example
```

Do not document nonexistent commands, files, or directories.

---

# 39. Skills

Do not assume directories such as:

```text
.agents/skills/
~/.gemini/config/skills/
```

exist.

If project-specific skills are added:

1. create the actual files
2. document them
3. update this file

---

# 40. Completion Checklist

Before marking implementation complete, verify:

* [ ] Relevant `package.json` / lockfile inspected.
* [ ] Relevant existing architecture inspected.
* [ ] Commands checked in `commands.md`.
* [ ] Environment configuration checked in `.env.example` when relevant.
* [ ] Existing implementation searched before adding duplicates.
* [ ] SOLID principles followed where useful.
* [ ] Existing behavior protected from regression.
* [ ] Files are appropriately structured.
* [ ] Large handwritten files remain around or below 300–350 lines where practical.
* [ ] Hooks/types/services/components are separated appropriately.
* [ ] New meaningful behavior includes tests.
* [ ] Bug fixes include regression tests where practical.
* [ ] Schema changes update affected tests.
* [ ] Prisma generated after schema changes.
* [ ] Zod schemas reviewed for API/schema changes.
* [ ] TypeScript passes.
* [ ] Lint passes.
* [ ] Tests pass.
* [ ] Generated files were not manually edited.
* [ ] Secrets were not introduced.
* [ ] Unrelated code was not changed.
* [ ] No commit occurred without explicit permission.
* [ ] No push occurred without explicit permission.

---

# 41. Core Workflow

Use this general process:

```text
inspect repository
→ inspect source-of-truth files
→ understand existing architecture
→ plan if non-trivial
→ review plan with Claude Opus 4.6 if available
→ implement using the actual installed stack
→ add/update tests
→ run verification with a low-cost model
→ fix root causes
→ report results
```

Source-of-truth reminder:

```text
Dependencies        → package.json + pnpm-lock.yaml
Commands            → commands.md
Environment         → .env.example
Database schema     → prisma/schema.prisma
Tests               → vitest.config.ts + src/__tests__/
Deployment          → repository/Vercel/Render configuration
```

When source-of-truth files disagree with assumptions, the repository files win.
