# Deployment Guide: Render

This guide covers deploying QuickClinic to Render with both the Next.js app and Socket.IO server.

---

## 📋 Prerequisites

- GitHub account with this repo pushed
- Render account (https://render.com)
- Environment variables ready (see `.env.example`)

---

## 🚀 Deployment Steps

### **Step 1: Connect to Render**

1. Go to [render.com](https://render.com)
2. Sign in with GitHub
3. Click **"New +"** → **"Blueprint"**
4. Select your repository
5. Render will auto-detect `render.yaml`

### **Step 2: Configure Environment Variables**

Before deploying, set up your environment in Render dashboard:

**For `quick-clinic-app` service:**
- `DATABASE_URL` - Your Neon PostgreSQL URL
- `REDIS_URL` - Your Upstash Redis URL
- `UPSTASH_REDIS_REST_URL` - Upstash REST endpoint
- `UPSTASH_REDIS_REST_TOKEN` - Upstash token
- `NEXTAUTH_SECRET` - Generate with: `openssl rand -base64 32`
- `NEXTAUTH_URL` - Will be provided by Render (e.g., `https://quick-clinic-app.onrender.com`)

**For `quick-clinic-socket` service:**
- `DATABASE_URL` - Same as above
- `PORT` - Keep as `5000` (Render will expose it)

### **Step 3: Deploy**

1. In Render dashboard, click **"Deploy"**
2. Render will build and deploy both services
3. This takes 5-10 minutes

---

## ✅ Verification

After deployment:

1. **Check Main App**
   - Visit `https://quick-clinic-app.onrender.com`
   - Verify login/signup pages load

2. **Check Socket Server**
   - Visit `https://quick-clinic-socket.onrender.com/health`
   - Should return `{"status":"ok","timestamp":"..."}`

3. **Verify Database Connection**
   - Run migrations: Go to Render dashboard → Web service → Shell
   ```bash
   npx prisma migrate deploy
   ```

4. **Test Real-time Features**
   - Login and test chat functionality
   - Should establish WebSocket connection to socket server

---

## 🔧 Managing Services

### **Restart Services**
- Go to Render dashboard → Service → **"Restart service"**

### **View Logs**
- Render dashboard → Service → **"Logs"**

### **Update Code**
- Push to GitHub → Render auto-deploys (if auto-deploy enabled)

### **Update Environment Variables**
- Render dashboard → Service → **"Environment"** → Edit → Save and redeploy

---

## 🐛 Troubleshooting

### **WebSocket Connection Fails**
- Check that `SOCKET_SERVER_URL` and `NEXT_PUBLIC_SOCKET_SERVER_URL` match socket service URL
- Render assigns names like `quick-clinic-socket.onrender.com`
- Verify in client-side code you're using `process.env.NEXT_PUBLIC_SOCKET_SERVER_URL`

### **Database Migrations Fail**
- Shell into main app service
- Run: `npx prisma migrate deploy`
- Check Prisma schema is correct: `npx prisma validate`

### **Prisma Client Missing**
- Render might not generate Prisma client during build
- Add to `Dockerfile.prod`:
  ```dockerfile
  RUN npx prisma generate
  ```

### **Services Can't Communicate**
- Both services are on same network in Render
- Use service names for internal communication
- From socket-server: `DATABASE_URL` connects to Neon (external)
- From main app: `SOCKET_SERVER_URL` uses Render hostname

---

## 📊 Performance Tips

1. **Use Render's PostgreSQL** instead of Neon for lower latency
2. **Redis** - Keep Upstash for caching/sessions
3. **Static assets** - Serve from Render's CDN (automatic)
4. **Monitor** - Use Render's metrics dashboard

---

## 🔄 Auto-Deploy from GitHub

`render.yaml` enables auto-deploy. To disable:
- Render dashboard → Service → **"Settings"** → Toggle auto-deploy

---

## 💰 Estimated Costs (Monthly)

- Main App (Web service): $7-12
- Socket Server (Web service): $7-12
- Database (PostgreSQL): $15+ (or use Render's DB)
- **Total**: ~$30-40/month

---

## 🆘 Support

- Render Docs: https://render.com/docs
- Prisma Docs: https://www.prisma.io/docs
- Socket.IO Docs: https://socket.io/docs
