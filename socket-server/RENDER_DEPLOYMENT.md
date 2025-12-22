# 🚀 Deploy Socket Server to Render

## Quick Start Guide

### Step 1: Create Render Account
1. Go to [render.com](https://render.com)
2. Sign up with GitHub
3. Connect your GitHub account

### Step 2: Create New Web Service
1. Click **"New +"** → **"Web Service"**
2. Connect your **Quick-Clinic** repository
3. Configure the service:

### Step 3: Configuration Settings

#### Option A: Using Docker (Recommended - Easier!)

**Basic Settings:**
- **Name**: `quickclinic-socket-server`
- **Environment**: `Docker`
- **Region**: Choose closest to your users
- **Branch**: `main`
- **Root Directory**: Leave empty (uses root)

**Docker Settings:**
- **Dockerfile Path**: `socket-server/Dockerfile.prod`
- **Docker Context**: `.` (root directory)

**No build/start commands needed** - Docker handles everything! ✅

#### Option B: Using Node.js (Alternative)

**Basic Settings:**
- **Name**: `quickclinic-socket-server`
- **Environment**: `Node`
- **Region**: Choose closest to your users
- **Branch**: `main`
- **Root Directory**: `socket-server` ⚠️ **IMPORTANT**

**Build & Deploy:**
- **Build Command**: 
  ```bash
  cd .. && npm install && npx prisma generate && cd socket-server && npm install && npm run build
  ```
- **Start Command**: 
  ```bash
  npm start
  ```

**Environment Variables:**
Add these in Render dashboard:
```
NODE_ENV=production
PORT=4000
SOCKET_PORT=4000
DATABASE_URL=your-neon-postgres-url-here
FRONTEND_URL=https://your-vercel-app.vercel.app
```

### Step 4: Deploy
1. Click **"Create Web Service"**
2. Render will automatically build and deploy
3. Wait for deployment to complete (usually 2-5 minutes)

### Step 5: Get Your Socket Server URL
After deployment, Render will provide a URL like:
```
https://quickclinic-socket-server.onrender.com
```

### Step 6: Update Vercel Environment Variables
1. Go to your Vercel project
2. **Settings** → **Environment Variables**
3. Add/Update:
   ```
   NEXT_PUBLIC_SOCKET_URL=https://quickclinic-socket-server.onrender.com
   ```
4. **Redeploy** your Next.js app

---

## 🐳 Why Use Docker?

**Benefits:**
- ✅ **Simpler Setup** - No need to configure build commands
- ✅ **Consistent** - Same environment as local development
- ✅ **Automatic** - Docker handles all dependencies and builds
- ✅ **Production Ready** - Optimized production image

**Docker vs Node.js:**
| Feature | Docker | Node.js |
|---------|--------|---------|
| Setup Complexity | ⭐ Simple | ⭐⭐ More config |
| Build Commands | ❌ Not needed | ✅ Required |
| Dependency Management | ✅ Automatic | ⚠️ Manual |
| Consistency | ✅ Same as local | ⚠️ May differ |

---

## 🔍 Verify Deployment

### Test Health Endpoint
```bash
curl https://quickclinic-socket-server.onrender.com/health
```

Should return:
```json
{"status":"ok","timestamp":"2025-12-22T..."}
```

### Test from Frontend
1. Open your Vercel app
2. Navigate to a chat page
3. Check browser console - should see Socket.IO connection
4. Send a test message

---

## ⚠️ Important Notes

### Free Tier Limitations
- **Render Free Tier**: Services spin down after 15 minutes of inactivity
- First request after spin-down takes ~30-50 seconds (cold start)
- For production, consider **Starter Plan** ($7/month) for always-on service

### WebSocket Support
- Render **fully supports WebSockets** on all plans
- No additional configuration needed

### Auto-Deploy
- Render automatically deploys on every push to `main` branch
- You can disable this in settings if needed

---

## 🐛 Troubleshooting

### Build Fails
- Check that `rootDir` is set to `socket-server`
- Verify Prisma client is generated (check build logs)
- Ensure all dependencies are in `package.json`

### Connection Refused
- Verify `NEXT_PUBLIC_SOCKET_URL` matches your Render URL
- Check CORS settings - `FRONTEND_URL` must match your Vercel domain
- Ensure service is running (check Render logs)

### Database Connection Error
- Verify `DATABASE_URL` is correct
- Check that Neon database allows connections from Render IPs
- Ensure Prisma client is generated during build

---

## 📊 Monitoring

### View Logs
1. Go to Render dashboard
2. Click on your service
3. Click **"Logs"** tab
4. Real-time logs are available

### Metrics
- Render provides basic metrics (CPU, Memory, Requests)
- Upgrade to paid plan for advanced metrics

---

## 🔄 Manual Deployment

If auto-deploy is disabled:
1. Go to Render dashboard
2. Click **"Manual Deploy"**
3. Select branch and commit
4. Click **"Deploy"**

---

## 💰 Pricing

- **Free Tier**: $0/month (spins down after inactivity)
- **Starter Plan**: $7/month (always-on, better performance)
- **Standard Plan**: $25/month (more resources)

For production, **Starter Plan** is recommended.

---

## ✅ Deployment Checklist

- [ ] Render account created
- [ ] GitHub repository connected
- [ ] Web service created with correct root directory
- [ ] Build command configured
- [ ] Start command configured
- [ ] Environment variables set
- [ ] Service deployed successfully
- [ ] Health endpoint tested
- [ ] Vercel environment variable updated
- [ ] Frontend tested and working

---

## 🎉 You're Done!

Your socket server is now deployed on Render! 🚀

