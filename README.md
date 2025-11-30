# 🚑 Quick Clinic — Next.js + Prisma + Neon + Upstash + Docker

This project runs entirely inside Docker. You do NOT need Node.js, PostgreSQL, or Redis installed locally. Only Docker Desktop and Git are required.

--------------------------------------------------------------------------------

📥 1. Clone the Project
git clone <your-repo-url>
cd quick-clinic

--------------------------------------------------------------------------------

📄 2. Create Environment File
cp .env.example .env

Fill your actual values inside `.env`:
DATABASE_URL="your-neon-postgres-url"
UPSTASH_REDIS_REST_URL="your-upstash-rest-url"
UPSTASH_REDIS_REST_TOKEN="your-upstash-rest-token"
REDIS_URL="your-upstash-redis-url"
NODE_ENV="production"

--------------------------------------------------------------------------------

🐳 3. Build & Start Docker (First Time)
docker compose up --build -d

--------------------------------------------------------------------------------

🛠 4. Generate Prisma Client (inside container)
docker compose exec app npx prisma generate

--------------------------------------------------------------------------------

🗄 5. Apply Migrations
Production:
docker compose exec app npx prisma migrate deploy

Development (optional):
docker compose exec app npx prisma migrate dev

--------------------------------------------------------------------------------

▶️ 6. Start the Project
docker compose up

Visit the app:
http://localhost:3000

--------------------------------------------------------------------------------

🛑 7. Stop the Project
Press Ctrl + C
or
docker compose down

--------------------------------------------------------------------------------

🔁 8. Start the Project Anytime Later
docker compose up

--------------------------------------------------------------------------------

📦 9. After Installing New npm Packages
docker compose up --build

--------------------------------------------------------------------------------

🗂 10. Prisma Schema Commands

Regenerate client:
docker compose exec app npx prisma generate

Push schema changes to DB (dev only):
docker compose exec app npx prisma db push

Pull schema changes from DB:
docker compose exec app npx prisma db pull

Apply migrations (prod):
docker compose exec app npx prisma migrate deploy

Apply migrations (dev):
docker compose exec app npx prisma migrate dev

--------------------------------------------------------------------------------

🎉 All development is done through Docker — no need to run npm install or npm run dev locally.
