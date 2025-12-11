# QuickClinic Socket.IO Server Setup

## Architecture

```
┌─────────────────┐         ┌──────────────────┐         ┌──────────────┐
│   Next.js App   │ ◄─────► │ Socket.IO Server │ ◄─────► │  PostgreSQL  │
│  (Frontend)     │         │   (Backend)      │         │  (Database)  │
│  Port 3000      │         │   Port 4000      │         │              │
└─────────────────┘         └──────────────────┘         └──────────────┘
```

## Setup Instructions

### 1. Install Socket.IO Client in Next.js App

```bash
cd d:\WebApplications\QuickClinic
npm install socket.io-client
```

### 2. Setup Socket.IO Server

```bash
cd socket-server
npm install
```

### 3. Configure Environment Variables

**Socket Server** (`socket-server/.env`):
```env
FRONTEND_URL=http://localhost:3000
SOCKET_PORT=4000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/quickclinic
```

**Next.js App** (`.env.local`):
```env
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
```

### 4. Generate Prisma Client for Socket Server

```bash
cd d:\WebApplications\QuickClinic
npx prisma generate
```

The generated client will be in `src/generated/prisma` and can be used by the socket server.

### 5. Start Both Servers

**Terminal 1 - Next.js Frontend:**
```bash
npm run dev
```

**Terminal 2 - Socket.IO Backend:**
```bash
cd socket-server
npm run dev
```

## API Endpoints

### REST API (Next.js)
- `POST /api/doctorpatientrelations` - Create/get relation
- `GET /api/doctorpatientrelations/[relationId]/chats` - Get paginated messages
- `POST /api/doctorpatientrelations/[relationId]/chats` - Send message (fallback)

### Socket.IO Events (Node.js Server)

#### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `get_initial_messages` | `{ page: 1, limit: 20 }` | Load chat history |
| `send_message` | `{ text: "message" }` | Send new message |
| `user_typing` | - | Notify typing indicator |
| `mark_as_read` | `{ messageId: "id" }` | Mark message as read |

#### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `connected` | `{ userId, userName, userRole }` | Connection confirmed |
| `initial_messages` | `{ messages: [], pagination: {} }` | Initial messages loaded |
| `new_message` | `{ message: {} }` | New message received |
| `user_typing` | `{ userId, userName }` | User is typing |
| `message_read` | `{ messageId, readBy }` | Message read receipt |
| `error` | `{ message: "error" }` | Error occurred |

## Features

✅ **Real-time Messaging** - Instant message delivery
✅ **Authentication** - Verify user belongs to relation
✅ **Room Management** - Separate chat rooms per relation
✅ **Typing Indicators** - See when other user is typing
✅ **Message Persistence** - Save to PostgreSQL database
✅ **Pagination** - Load messages in chunks
✅ **Auto Reconnection** - Exponential backoff strategy
✅ **Connection Status** - Visual indicator in UI
✅ **Error Handling** - Graceful error management
✅ **CORS Support** - Secure cross-origin requests

## Testing

1. Start both servers (Next.js + Socket.IO)
2. Open two browser windows
3. Login as doctor in one, patient in another
4. Navigate to chat page for same doctor-patient relation
5. Send messages and see real-time updates

## Production Deployment

### Option 1: Same Server (Docker)

Create `docker-compose.yml`:
```yaml
version: '3.8'
services:
  nextjs:
    build: .
    ports:
      - "3000:3000"
  
  socket-server:
    build: ./socket-server
    ports:
      - "4000:4000"
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - FRONTEND_URL=http://localhost:3000
```

### Option 2: Separate Deployments

**Next.js** → Vercel/Netlify
**Socket.IO** → Railway/Render/AWS

Update environment variables accordingly.

### Scaling with Redis

For multiple Socket.IO server instances:

```bash
cd socket-server
npm install @socket.io/redis-adapter redis
```

Update `server.js`:
```javascript
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');

const pubClient = createClient({ url: process.env.REDIS_URL });
const subClient = pubClient.duplicate();

Promise.all([pubClient.connect(), subClient.connect()]).then(() => {
  io.adapter(createAdapter(pubClient, subClient));
});
```

## File Structure

```
QuickClinic/
├── socket-server/           # Standalone Socket.IO server
│   ├── server.js           # Main server file
│   ├── package.json        # Dependencies
│   ├── .env.example        # Environment template
│   └── .gitignore          # Git ignore rules
├── src/
│   └── components/
│       └── general/
│           └── ChatBar.tsx  # React component with Socket.IO client
└── .env.local              # Frontend environment variables
```

## Troubleshooting

### Connection Refused
- Ensure Socket.IO server is running on port 4000
- Check `NEXT_PUBLIC_SOCKET_URL` in `.env.local`
- Verify CORS settings in `server.js`

### Prisma Client Error
- Run `npx prisma generate` in main project
- Ensure `DATABASE_URL` is correct in socket-server `.env`
- Check that `@prisma/client` version matches main project

### Messages Not Persisting
- Verify database is running
- Check Prisma schema has `ChatMessages` model
- Run migrations: `npx prisma migrate dev`

### CORS Issues
- Update `FRONTEND_URL` in socket-server `.env`
- Check CORS configuration in `server.js`
- Ensure credentials are enabled

## Health Check

Visit `http://localhost:4000/health` to verify Socket.IO server is running.

Response:
```json
{
  "status": "ok",
  "timestamp": "2025-12-10T..."
}
```
