# Quick-Clinic Command Reference (`commands.md`)

This guide contains all standard local development and Docker commands for the Quick-Clinic project.

---

## 🏗️ 0. Architecture & Package Manager Rules
- **Root Web App (`/`):** Next.js 16 App Router, Prisma 7, NextAuth. **ALWAYS use `pnpm`**.
- **Socket Server (`/socket-server`):** Standalone Socket.IO server. **Uses `npm`**.
- **Database:** PostgreSQL (Neon) with Prisma custom output at `src/generated/prisma`.
- **Cache / Messaging:** Upstash Redis / Redis.

---

## 💻 1. Local Development Commands (Without Docker)

### Package Installation
```bash
# Install root dependencies
pnpm install

# Install socket-server dependencies
cd socket-server && npm install && cd ..
```

### Running Dev Servers
```bash
# Run Next.js frontend dev server (default port 3000)
pnpm dev

# Run Socket server in parallel (port 4000)
cd socket-server && npm run dev
```

### Prisma & Database
```bash
# Generate Prisma Client (outputs to src/generated/prisma)
pnpm prisma generate

# Push database schema changes to Neon DB without migration files
pnpm prisma db push

# Create and apply migrations
pnpm prisma migrate dev --name <migration_name>

# Open Prisma Studio web interface
pnpm prisma studio

# Seed database with sample doctors, patients, admin, slots (passwords: karan166)
pnpm tsx prisma/seed.ts
```

### Verification & Testing
```bash
# Run TypeScript type check
pnpm type-check
# or:
pnpm exec tsc --noEmit

# Run ESLint (Next.js 16 flat config)
pnpm lint

# Run all Unit & API Tests (Vitest)
pnpm test

# Run tests in watch mode
pnpm test:watch

# Production Build
pnpm build

# Start Production Server
pnpm start
```

---

## 🐳 2. Docker & Container Commands

The repository includes `docker-compose.yml` for local containerized development.

### Starting and Stopping Services
```bash
# Start all services in the background (detached mode)
docker compose up -d

# Start all services with build output visible in terminal
docker compose up

# Build or rebuild images before starting
docker compose up -d --build

# Stop all running containers
docker compose down

# Stop and remove containers, networks, and volumes
docker compose down -v
```

### Viewing Logs
```bash
# View logs from all services in real time
docker compose logs -f

# View Next.js app logs only
docker compose logs -f app

# View Socket server logs only
docker compose logs -f socket-server
```

### Executing Commands Inside Containers
Per project guidelines, execute tools and scripts inside the isolated containers:

```bash
# Run interactive bash/sh inside app container
docker compose exec app sh

# Generate Prisma client inside container
docker compose exec app pnpm prisma generate

# Run database migrations inside container
docker compose exec app pnpm prisma db push

# Seed database inside container
docker compose exec app pnpm tsx prisma/seed.ts

# Run type check inside container
docker compose exec app pnpm type-check

# Run ESLint inside container
docker compose exec app pnpm lint

# Run Vitest test suite inside container
docker compose exec app pnpm test

# Run socket-server npm commands inside socket container
docker compose exec socket-server npm test
```

---

## 🔑 3. Environment Variables Setup
Copy `.env.example` to `.env` before running the app:

```bash
cp .env.example .env
```

Key variables required:
- `DATABASE_URL`: Neon PostgreSQL connection string with `sslmode=require` or pooled URL.
- `UPSTASH_REDIS_REST_URL` & `UPSTASH_REDIS_REST_TOKEN`: Upstash Redis credentials.
- `REDIS_URL`: Socket server Redis connection string (`rediss://...`).
- `NEXT_PUBLIC_SOCKET_URL`: URL of the socket server (e.g. `http://localhost:4000`).
- `NEXTAUTH_SECRET` & `NEXTAUTH_URL`: NextAuth session encryption and base URL.
- `RAZORPAY_KEY_ID` & `RAZORPAY_KEY_SECRET`: Razorpay payment keys.
- `RESEND_API_KEY`: Resend email API key for OTP delivery.

---

## 🔒 4. Git & Repository Safety
- Do not commit `.env` or `.env.local`.
- Only stage and commit changes when explicitly instructed.
- Always run the verification loop (`pnpm type-check && pnpm lint && pnpm test`) before pushing.
