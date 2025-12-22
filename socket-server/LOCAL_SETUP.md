# 🚀 Running Socket Server Locally

## Prerequisites

1. Node.js installed (v18+)
2. PostgreSQL database running (or Neon database URL)
3. Prisma client generated in the main project

## Step-by-Step Setup

### 1. Install Dependencies

From the **root** of the project:
```bash
npm install
```

Then from the **socket-server** directory:
```bash
cd socket-server
npm install
```

### 2. Generate Prisma Client

The socket server uses the Prisma client from the main project. Generate it from the **root** directory:

```bash
cd ..  # Go to root
npx prisma generate
cd socket-server  # Back to socket-server
```

### 3. Set Environment Variables

The socket server reads environment variables from the root `.env` file. Make sure you have:

```env
# Database
DATABASE_URL=postgresql://user:password@host:port/database

# Socket Server
FRONTEND_URL=http://localhost:3000
PORT=4000
SOCKET_PORT=4000
```

**Note:** The socket server uses `dotenv` which will automatically load variables from the root `.env` file.

### 4. Run the Server

#### Option A: Development Mode (Recommended for Development)

```bash
npm run dev
```

This uses `ts-node` to run TypeScript directly without building.

**Output:**
```
🚀 Socket.IO server running on 0.0.0.0:4000
📡 WebSocket endpoint: ws://localhost:4000
🌐 Frontend allowed from: http://localhost:3000
```

#### Option B: Development Mode with Auto-Reload

```bash
npm run dev:watch
```

This automatically restarts the server when you make changes.

#### Option C: Production Mode

First build, then run:

```bash
npm run build
npm start
```

This compiles TypeScript to JavaScript in the `dist/` folder, then runs the compiled code.

### 5. Verify It's Working

#### Test Health Endpoint

```bash
curl http://localhost:4000/health
```

Expected response:
```json
{"status":"ok","timestamp":"2025-12-22T19:27:55.931Z"}
```

#### Test from Browser

1. Start your Next.js app: `npm run dev` (in root directory)
2. Open your app at `http://localhost:3000`
3. Navigate to a chat page
4. Check browser console - you should see Socket.IO connection messages

## Running Both Servers

You need **two terminal windows**:

### Terminal 1: Next.js Frontend
```bash
# From root directory
npm run dev
```
Runs on: `http://localhost:3000`

### Terminal 2: Socket.IO Backend
```bash
# From socket-server directory
npm run dev
```
Runs on: `http://localhost:4000`

## Common Commands

```bash
# Development (TypeScript, no build needed)
npm run dev

# Development with auto-reload
npm run dev:watch

# Build TypeScript to JavaScript
npm run build

# Run production build
npm start

# Check if server is running
curl http://localhost:4000/health
```

## Troubleshooting

### Error: Cannot find module '@prisma/client-runtime-utils'

**Solution:** Install it in the root directory:
```bash
cd ..
npm install @prisma/client-runtime-utils@7.1.0
cd socket-server
```

### Error: Cannot find module '../src/generated/prisma/client'

**Solution:** Generate Prisma client from root:
```bash
cd ..
npx prisma generate
cd socket-server
```

### Error: DATABASE_URL is not set

**Solution:** Create a `.env` file in the root directory with:
```env
DATABASE_URL=your-database-url
```

### Port Already in Use

**Solution:** Change the port in your `.env`:
```env
PORT=4001
SOCKET_PORT=4001
```

Or kill the process using port 4000:
```bash
# Find process
lsof -ti:4000

# Kill process (replace PID with actual process ID)
kill -9 PID
```

### Connection Refused from Frontend

**Check:**
1. Socket server is running (`curl http://localhost:4000/health`)
2. `NEXT_PUBLIC_SOCKET_URL=http://localhost:4000` is set in root `.env.local`
3. `FRONTEND_URL=http://localhost:3000` is set in root `.env`
4. CORS is properly configured (should be automatic)

## File Structure

```
socket-server/
├── main.ts              # Server entry point
├── server.ts            # Socket.IO event handlers
├── package.json         # Dependencies
├── tsconfig.json        # TypeScript config
├── dist/                # Compiled JavaScript (after build)
│   ├── main.js
│   └── server.js
└── node_modules/        # Dependencies
```

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ Yes | - | PostgreSQL connection string |
| `FRONTEND_URL` | ✅ Yes | `http://localhost:3000` | Next.js app URL (for CORS) |
| `PORT` | ❌ No | `4000` | HTTP server port |
| `SOCKET_PORT` | ❌ No | `4000` | Socket.IO port (same as PORT) |
| `NODE_ENV` | ❌ No | `development` | Environment mode |

## Running with Docker (Easier!)

For an even easier setup, use Docker! See `DOCKER_SETUP.md` for instructions.

**Quick Docker start:**
```bash
# From root directory
docker compose up socket-server
```

This automatically:
- ✅ Installs all dependencies
- ✅ Generates Prisma client
- ✅ Sets up environment
- ✅ Starts the server

## Next Steps

Once the socket server is running locally:

1. ✅ Test the health endpoint
2. ✅ Test chat functionality in your Next.js app
3. ✅ Check browser console for connection status
4. ✅ Send test messages between users
5. 🚀 Ready to deploy to Render (see `RENDER_DEPLOYMENT.md`)

