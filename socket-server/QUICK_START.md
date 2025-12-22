# ⚡ Socket Server - Quick Start Commands

## 🐳 Using Docker (Recommended - Easiest!)

### First Time Setup
```bash
# From root directory - Start both Next.js app and Socket server
docker compose up
```

### Start Only Socket Server
```bash
# From root directory
docker compose up socket-server

# Or in background
docker compose up -d socket-server
```

### Stop Socket Server
```bash
docker compose down socket-server
# Or stop everything
docker compose down
```

### View Logs
```bash
docker compose logs -f socket-server
```

### Rebuild After Changes
```bash
docker compose up --build socket-server
```

---

## 💻 Local Setup (Without Docker)

### First Time Setup
```bash
# 1. Install root dependencies (if not done)
cd /Users/karanagg/Desktop/Projects/Quick-Clinic
npm install

# 2. Generate Prisma client
npx prisma generate

# 3. Install socket-server dependencies
cd socket-server
npm install
```

### Run Socket Server

**Development Mode:**
```bash
cd socket-server
npm run dev
```

**Development with Auto-Reload:**
```bash
cd socket-server
npm run dev:watch
```

**Production Mode:**
```bash
cd socket-server
npm run build
npm start
```

---

## ✅ Verify It's Running

### Test Health Endpoint
```bash
curl http://localhost:4000/health
```

**Expected Response:**
```json
{"status":"ok","timestamp":"2025-12-22T..."}
```

### Or Open in Browser
```
http://localhost:4000/health
```

---

## 🔧 Environment Variables

Make sure your `.env` file (in root directory) has:

```env
DATABASE_URL=postgresql://user:password@host:port/database
FRONTEND_URL=http://localhost:3000
PORT=4000
SOCKET_PORT=4000
```

---

## 📋 All Available Commands

### Docker Commands
```bash
# Start everything
docker compose up

# Start only socket server
docker compose up socket-server

# Start in background
docker compose up -d socket-server

# Stop
docker compose down

# View logs
docker compose logs socket-server

# Follow logs
docker compose logs -f socket-server

# Rebuild
docker compose up --build socket-server
```

### Local npm Commands
```bash
# Development (TypeScript, no build)
npm run dev

# Development with auto-reload
npm run dev:watch

# Build TypeScript
npm run build

# Run production build
npm start
```

---

## 🚀 Quick Reference

| Task | Docker | Local |
|------|--------|-------|
| **First Setup** | `docker compose up` | `npm install` then `npm run dev` |
| **Start Server** | `docker compose up socket-server` | `npm run dev` |
| **Stop Server** | `docker compose down` | `Ctrl+C` |
| **View Logs** | `docker compose logs -f socket-server` | Terminal output |
| **Rebuild** | `docker compose up --build` | `npm run build` |

---

## 🎯 Recommended Workflow

### For Development:
```bash
# Option 1: Docker (Easiest)
docker compose up

# Option 2: Local
cd socket-server && npm run dev
```

### For Testing:
```bash
# Test health
curl http://localhost:4000/health

# Test from browser
open http://localhost:4000/health
```

---

## 📚 More Information

- **Docker Setup**: See `DOCKER_SETUP.md`
- **Local Setup**: See `LOCAL_SETUP.md`
- **Deployment**: See `RENDER_DEPLOYMENT.md`
- **Full Documentation**: See `README.md`

---

## ⚠️ Troubleshooting

### Port Already in Use
```bash
# Find process
lsof -ti:4000

# Kill process
kill -9 $(lsof -ti:4000)
```

### Dependencies Not Found
```bash
# Docker: Rebuild
docker compose up --build socket-server

# Local: Reinstall
cd socket-server && rm -rf node_modules && npm install
```

### Prisma Client Error
```bash
# From root directory
npx prisma generate
```

---

## ✅ Success Checklist

- [ ] Socket server starts without errors
- [ ] Health endpoint returns `{"status":"ok"}`
- [ ] Can connect from Next.js app
- [ ] Chat messages work in real-time

---

**That's it! You're ready to go! 🚀**

