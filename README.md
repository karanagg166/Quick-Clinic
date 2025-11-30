# 🚑 Quick Clinic — Next.js + Prisma + Neon + Upstash + Docker

This project runs fully in Docker using Neon PostgreSQL and Upstash Redis. You do not need Node.js, PostgreSQL, or Redis installed locally. Only Docker Desktop and Git are required.

Clone the project:
git clone <your-repo-url>
cd quick-clinic

Create your environment file:
cp .env.example .env

Fill your actual values inside `.env`:
DATABASE_URL="your-neon-postgres-url"
UPSTASH_REDIS_REST_URL="your-upstash-rest-url"
UPSTASH_REDIS_REST_TOKEN="your-upstash-rest-token"
REDIS_URL="your-upstash-redis-url"
NODE_ENV="production"

Build and start Docker for the first time:
docker compose up --build -d

Generate the Prisma client inside the container:
docker compose exec app npx prisma generate

Apply migrations if they exist:
docker compose exec app npx prisma migrate deploy

Run the project normally:
docker compose up

Stop the project:
Ctrl + C
or
docker compose down

Run the project anytime in the future:
docker compose up

Rebuild after installing new npm packages:
docker compose up --build

If you edit the Prisma schema and need to sync:
docker compose exec app npx prisma generate
(optional for development)
docker compose exec app npx prisma migrate dev
or for production
docker compose exec app npx prisma migrate deploy

If you want to push schema changes directly to the database (dev only):
docker compose exec app npx prisma db push

If you want to pull schema changes from the database:
docker compose exec app npx prisma db pull

Your entire workflow uses Docker only. No need for npm run dev on your machine.
