# Socket Server Deployment Guide

## ⚠️ Important: Vercel Limitation

**Vercel does NOT support long-running WebSocket servers.** Vercel's serverless functions are stateless and have execution time limits, making them unsuitable for Socket.IO connections.

## ✅ Recommended Deployment Options

### Option 1: Deploy Socket Server Separately (Recommended)

Deploy your Next.js app on Vercel and the Socket.IO server on a platform that supports WebSockets.

#### Platform Options:

1. **Railway** (Easiest - Recommended)
   - Free tier available
   - Automatic deployments from GitHub
   - Built-in PostgreSQL support
   - WebSocket support

2. **Render** (Recommended for Free Tier)
   - Free tier available
   - WebSocket support
   - Easy GitHub integration
   - See detailed Render setup below

3. **Fly.io**
   - Global edge deployment
   - WebSocket support
   - Good for scaling

4. **DigitalOcean App Platform**
   - Simple deployment
   - WebSocket support
   - Paid service

5. **AWS EC2 / Lightsail**
   - Full control
   - Requires more setup
   - WebSocket support

---

## 🚀 Deployment Steps (Railway - Recommended)

### Step 1: Prepare Socket Server

1. Update `socket-server/Dockerfile.prod` to use TypeScript:

```dockerfile
FROM node:24.11.1-alpine

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache openssl

# Copy package files
COPY socket-server/package*.json ./
COPY package*.json ../

# Install dependencies
RUN npm ci --only=production

# Copy Prisma generated client
COPY src/generated ../src/generated

# Copy socket server files
COPY socket-server/*.ts ./
COPY socket-server/tsconfig.json ./

# Build TypeScript
RUN npm run build --prefix socket-server || npx tsc

# Expose port
EXPOSE 4000

ENV NODE_ENV=production
ENV PORT=4000

CMD ["node", "dist/main.js"]
```

### Step 2: Deploy to Railway

1. **Create Railway Account**
   - Go to [railway.app](https://railway.app)
   - Sign up with GitHub

2. **Create New Project**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your Quick-Clinic repository

3. **Configure Service**
   - Railway will auto-detect the project
   - Set **Root Directory** to: `socket-server`
   - Set **Start Command** to: `npm start` (or `node dist/main.js` if using TypeScript)

4. **Set Environment Variables**
   ```
   DATABASE_URL=your-neon-postgres-url
   FRONTEND_URL=https://your-vercel-app.vercel.app
   PORT=4000
   NODE_ENV=production
   ```

5. **Deploy**
   - Railway will automatically build and deploy
   - Get the deployment URL (e.g., `https://socket-server-production.up.railway.app`)

### Step 3: Update Vercel Environment Variables

In your Vercel project settings:

1. Go to **Settings → Environment Variables**
2. Add:
   ```
   NEXT_PUBLIC_SOCKET_URL=https://socket-server-production.up.railway.app
   ```
3. Redeploy your Next.js app

---

## 🐳 Option 2: Deploy Both with Docker (Not on Vercel)

If you want to deploy both together, you **cannot use Vercel**. Use platforms that support Docker:

### Platforms Supporting Docker:
- **Railway** (supports Docker Compose)
- **Render** (supports Docker)
- **Fly.io** (supports Docker)
- **DigitalOcean App Platform** (supports Docker)
- **AWS ECS / EKS**
- **Google Cloud Run**

### Docker Compose Setup

Create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  nextjs:
    build:
      context: .
      dockerfile: Dockerfile.prod
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - NEXT_PUBLIC_SOCKET_URL=http://socket-server:4000
    depends_on:
      - socket-server

  socket-server:
    build:
      context: .
      dockerfile: socket-server/Dockerfile.prod
    ports:
      - "4000:4000"
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - FRONTEND_URL=http://nextjs:3000
      - PORT=4000
    depends_on:
      - nextjs
```

---

## 🔧 Option 3: Use Socket.io Cloud Service

Instead of self-hosting, use a managed service:

1. **Socket.io Cloud** (by Socket.io team)
   - Managed service
   - Easy integration
   - Paid service

2. **Pusher**
   - Real-time messaging service
   - Free tier available
   - Requires code changes

3. **Ably**
   - Real-time messaging platform
   - Free tier available
   - Requires code changes

---

## 📝 Environment Variables Checklist

### Socket Server (Railway/Render/etc.)
```
DATABASE_URL=postgresql://...
FRONTEND_URL=https://your-app.vercel.app
PORT=4000
NODE_ENV=production
```

### Next.js App (Vercel)
```
DATABASE_URL=postgresql://...
NEXT_PUBLIC_SOCKET_URL=https://your-socket-server.railway.app
RESEND_API_KEY=re_...
# ... other vars
```

---

## 🧪 Testing Deployment

1. **Test Socket Server Health**
   ```bash
   curl https://your-socket-server.railway.app/health
   ```
   Should return: `{"status":"ok","timestamp":"..."}`

2. **Test from Frontend**
   - Open your Vercel app
   - Navigate to chat page
   - Check browser console for connection status
   - Send a test message

---

## 🔄 CI/CD Setup

### GitHub Actions (Optional)

Create `.github/workflows/deploy-socket-server.yml`:

```yaml
name: Deploy Socket Server

on:
  push:
    branches: [main]
    paths:
      - 'socket-server/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to Railway
        run: |
          # Railway CLI deployment
          # Or trigger Railway webhook
```

---

## 📊 Monitoring

### Recommended Tools:
- **Railway Dashboard** - Built-in logs and metrics
- **Sentry** - Error tracking
- **LogRocket** - Session replay and logs

---

## 🚨 Troubleshooting

### Connection Refused
- Verify `NEXT_PUBLIC_SOCKET_URL` is set correctly in Vercel
- Check CORS settings in socket server
- Ensure socket server is running and accessible

### CORS Errors
- Update `FRONTEND_URL` in socket server to match your Vercel domain
- Check that credentials are enabled in Socket.IO config

### Database Connection Issues
- Verify `DATABASE_URL` is correct
- Ensure database allows connections from deployment platform
- Check Prisma client is generated correctly

---

## 💡 Best Practices

1. **Use Environment Variables** - Never hardcode URLs
2. **Enable HTTPS** - Both services should use HTTPS
3. **Monitor Connections** - Set up logging and monitoring
4. **Handle Reconnections** - Client should handle disconnections gracefully
5. **Scale Horizontally** - Use Redis adapter for multiple socket server instances

---

## 📚 Additional Resources

- [Railway Documentation](https://docs.railway.app)
- [Socket.IO Deployment Guide](https://socket.io/docs/v4/deployment/)
- [Vercel Environment Variables](https://vercel.com/docs/concepts/projects/environment-variables)

