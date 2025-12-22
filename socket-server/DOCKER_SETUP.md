# 🐳 Running Socket Server with Docker

Docker makes it easy to run the socket server without worrying about dependencies or environment setup!

## Quick Start

### Option 1: Using Docker Compose (Recommended)

Run both Next.js app and Socket server together:

```bash
# From root directory
docker compose up
```

This will:
- ✅ Build both containers
- ✅ Install all dependencies automatically
- ✅ Generate Prisma client
- ✅ Start both servers

**Access:**
- Next.js App: `http://localhost:3000`
- Socket Server: `http://localhost:4000`
- Health Check: `http://localhost:4000/health`

### Option 2: Run Socket Server Only

```bash
# Build and run socket server
docker compose up socket-server

# Or in detached mode (background)
docker compose up -d socket-server
```

### Option 3: Using Dockerfile Directly

```bash
# Build the image
docker build -f socket-server/Dockerfile.dev -t quickclinic-socket-server .

# Run the container
docker run -p 4000:4000 --env-file .env quickclinic-socket-server
```

## Docker Compose Commands

```bash
# Start all services
docker compose up

# Start in background (detached)
docker compose up -d

# Start only socket server
docker compose up socket-server

# Stop all services
docker compose down

# Rebuild containers (after dependency changes)
docker compose up --build

# View logs
docker compose logs socket-server

# Follow logs in real-time
docker compose logs -f socket-server

# Stop and remove containers
docker compose down
```

## Environment Variables

Docker Compose automatically reads from `.env` file in the root directory. Make sure you have:

```env
DATABASE_URL=postgresql://user:password@host:port/database
FRONTEND_URL=http://localhost:3000
PORT=4000
SOCKET_PORT=4000
```

## Development Workflow

### Hot Reload

The Docker setup uses volumes, so your code changes are automatically reflected:

```bash
# Start services
docker compose up

# Make changes to socket-server files
# Changes are automatically picked up (if using dev:watch)
```

### Rebuild After Dependency Changes

If you add new dependencies:

```bash
# Stop containers
docker compose down

# Rebuild and start
docker compose up --build
```

## Production Build

For production, use the production Dockerfile:

```bash
# Build production image
docker build -f socket-server/Dockerfile.prod -t quickclinic-socket-server:prod .

# Run production container
docker run -p 4000:4000 --env-file .env quickclinic-socket-server:prod
```

## Troubleshooting

### Port Already in Use

```bash
# Find what's using port 4000
lsof -ti:4000

# Or change port in docker-compose.yml
ports:
  - "4001:4000"  # Host:Container
```

### Container Won't Start

```bash
# Check logs
docker compose logs socket-server

# Rebuild from scratch
docker compose down
docker compose build --no-cache socket-server
docker compose up socket-server
```

### Dependencies Not Installing

```bash
# Remove node_modules volumes and rebuild
docker compose down -v
docker compose up --build
```

### Prisma Client Not Found

The Dockerfile automatically generates Prisma client, but if you see errors:

```bash
# Rebuild to regenerate Prisma client
docker compose up --build socket-server
```

### Database Connection Issues

Make sure:
1. `DATABASE_URL` is set in `.env`
2. Database is accessible from Docker container
3. If using local PostgreSQL, use `host.docker.internal` instead of `localhost`:
   ```env
   DATABASE_URL=postgresql://user:password@host.docker.internal:5432/database
   ```

## File Structure

```
Quick-Clinic/
├── docker-compose.yml          # Docker Compose config
├── Dockerfile.dev              # Next.js dev Dockerfile
├── socket-server/
│   ├── Dockerfile.dev          # Socket server dev Dockerfile
│   ├── Dockerfile.prod         # Socket server prod Dockerfile
│   └── ...
└── .env                        # Environment variables
```

## Benefits of Using Docker

✅ **No Local Setup** - No need to install Node.js, npm, or manage versions  
✅ **Consistent Environment** - Same setup for all developers  
✅ **Easy Dependencies** - All dependencies installed automatically  
✅ **Isolated** - Doesn't affect your system's Node.js installation  
✅ **Easy Cleanup** - Just `docker compose down` to remove everything  
✅ **Production Ready** - Same Docker setup can be used in production  

## Next Steps

1. ✅ Run `docker compose up` to start everything
2. ✅ Test health endpoint: `curl http://localhost:4000/health`
3. ✅ Test chat functionality in your app
4. 🚀 Ready to deploy! (See `RENDER_DEPLOYMENT.md`)

## Comparison: Docker vs Local

| Feature | Docker | Local |
|---------|--------|-------|
| Setup Time | ⚡ Instant | ⏱️ Manual setup |
| Dependencies | ✅ Auto-installed | ❌ Manual install |
| Environment | ✅ Isolated | ⚠️ System-wide |
| Consistency | ✅ Same for everyone | ⚠️ Varies by system |
| Cleanup | ✅ `docker compose down` | ❌ Manual cleanup |

**Recommendation:** Use Docker for easier setup and consistency! 🐳

