# 🚀 Step-by-Step: Deploy Socket Server to Render

## Prerequisites
- ✅ GitHub repository with your code pushed
- ✅ Render account (free tier works)
- ✅ Database URL (Neon PostgreSQL)
- ✅ Vercel app URL (for FRONTEND_URL)

---

## Step 1: Create Render Account

1. Go to **[render.com](https://render.com)**
2. Click **"Get Started for Free"** or **"Sign Up"**
3. Sign up with **GitHub** (recommended - easier to connect repo)
4. Authorize Render to access your GitHub account

---

## Step 2: Create New Web Service

1. In Render dashboard, click **"New +"** button (top right)
2. Select **"Web Service"** from the dropdown

---

## Step 3: Connect Your Repository

1. Render will show a list of your GitHub repositories
2. Find and click on **"Quick-Clinic"** (or your repo name)
3. Click **"Connect"**

---

## Step 4: Configure Service Settings

### Basic Settings

Fill in these fields:

- **Name**: `quickclinic-socket-server` (or any name you prefer)
- **Environment**: Select **"Docker"** ⚠️ **IMPORTANT - Select Docker, not Node!**
- **Region**: Choose closest to your users (e.g., `Oregon (US West)` or `Frankfurt (EU)`)
- **Branch**: `main` (or your main branch name)
- **Root Directory**: Leave **empty** (uses root directory)

### Docker Settings

- **Dockerfile Path**: `socket-server/Dockerfile.prod`
- **Docker Context**: `.` (root directory - this is usually auto-filled)

**That's it for build settings!** No build commands or start commands needed with Docker! ✅

---

## Step 5: Set Environment Variables

Click on **"Environment"** tab or scroll down to **"Environment Variables"** section.

Click **"Add Environment Variable"** for each:

### Required Variables:

1. **DATABASE_URL**
   - Key: `DATABASE_URL`
   - Value: Your Neon PostgreSQL connection string
   - Example: `postgresql://user:password@host.neon.tech/dbname?sslmode=require`

2. **FRONTEND_URL**
   - Key: `FRONTEND_URL`
   - Value: Your Vercel app URL
   - Example: `https://your-app.vercel.app`

3. **PORT**
   - Key: `PORT`
   - Value: `4000`

4. **SOCKET_PORT**
   - Key: `SOCKET_PORT`
   - Value: `4000`

5. **NODE_ENV**
   - Key: `NODE_ENV`
   - Value: `production`

### Environment Variables Summary:
```
DATABASE_URL=postgresql://...
FRONTEND_URL=https://your-app.vercel.app
PORT=4000
SOCKET_PORT=4000
NODE_ENV=production
```

---

## Step 6: Choose Plan

- **Free Plan**: ✅ Free, but spins down after 15 min inactivity (good for testing)
- **Starter Plan**: $7/month - Always on (recommended for production)

For now, select **Free** to test.

---

## Step 7: Deploy!

1. Scroll down and click **"Create Web Service"**
2. Render will start building your Docker image
3. You'll see build logs in real-time
4. Wait for deployment (usually 3-5 minutes)

**What happens during build:**
- ✅ Clones your repository
- ✅ Builds Docker image from `socket-server/Dockerfile.prod`
- ✅ Installs all dependencies
- ✅ Generates Prisma client
- ✅ Builds TypeScript
- ✅ Starts the server

---

## Step 8: Get Your Socket Server URL

After deployment completes:

1. You'll see a **"Your service is live"** message
2. Your URL will be displayed, like:
   ```
   https://quickclinic-socket-server.onrender.com
   ```
3. **Copy this URL** - you'll need it for Vercel!

---

## Step 9: Test Your Deployment

### Test Health Endpoint

Open in browser or use curl:
```bash
curl https://quickclinic-socket-server.onrender.com/health
```

Should return:
```json
{"status":"ok","timestamp":"2025-12-23T..."}
```

✅ If you see this, your server is working!

---

## Step 10: Update Vercel Environment Variables

1. Go to your **Vercel** dashboard
2. Select your **Next.js app** project
3. Go to **Settings** → **Environment Variables**
4. Click **"Add New"**
5. Add:
   - **Key**: `NEXT_PUBLIC_SOCKET_URL`
   - **Value**: `https://quickclinic-socket-server.onrender.com` (your Render URL)
   - **Environment**: Select all (Production, Preview, Development)
6. Click **"Save"**
7. **Redeploy** your Next.js app:
   - Go to **Deployments** tab
   - Click **"..."** on latest deployment
   - Click **"Redeploy"**

---

## Step 11: Test End-to-End

1. Open your Vercel app
2. Login as a user
3. Navigate to a chat page
4. Check browser console - should see Socket.IO connection
5. Send a test message
6. ✅ Should work in real-time!

---

## 🎉 You're Done!

Your socket server is now deployed and connected to your Next.js app!

---

## 📊 Monitoring

### View Logs
1. Go to Render dashboard
2. Click on your service
3. Click **"Logs"** tab
4. See real-time logs

### View Metrics
- Render shows basic metrics (CPU, Memory, Requests)
- Upgrade to paid plan for advanced metrics

---

## 🔄 Auto-Deploy

Render automatically deploys when you push to `main` branch!

**To deploy updates:**
1. Make changes to your code
2. Push to GitHub: `git push origin main`
3. Render automatically detects and redeploys
4. Wait 3-5 minutes for new deployment

---

## 🐛 Troubleshooting

### Build Fails

**Check:**
- Dockerfile path is correct: `socket-server/Dockerfile.prod`
- Docker context is `.` (root)
- View build logs for specific errors

**Common fixes:**
- Ensure `DATABASE_URL` is set (even if placeholder)
- Check that all files are committed to GitHub
- Verify Dockerfile syntax

### Service Won't Start

**Check:**
- Environment variables are all set
- `DATABASE_URL` is correct and accessible
- `FRONTEND_URL` matches your Vercel domain
- View logs for error messages

### Connection Refused from Frontend

**Check:**
- `NEXT_PUBLIC_SOCKET_URL` in Vercel matches Render URL
- CORS is configured (should be automatic)
- Both services are running
- Check browser console for errors

### Service Spins Down (Free Tier)

**Free tier limitation:**
- Service spins down after 15 min of inactivity
- First request takes 30-50 seconds (cold start)

**Solution:**
- Upgrade to Starter Plan ($7/month) for always-on
- Or use a service like UptimeRobot to ping your service every 10 minutes

---

## 💰 Pricing

| Plan | Cost | Features |
|------|------|----------|
| **Free** | $0/month | Spins down after inactivity, 750 hours/month |
| **Starter** | $7/month | Always on, better performance |
| **Standard** | $25/month | More resources, better scaling |

**Recommendation:** Start with Free, upgrade to Starter for production.

---

## ✅ Deployment Checklist

- [ ] Render account created
- [ ] GitHub repository connected
- [ ] Web service created
- [ ] Environment set to **Docker**
- [ ] Dockerfile path: `socket-server/Dockerfile.prod`
- [ ] Environment variables added
- [ ] Service deployed successfully
- [ ] Health endpoint tested
- [ ] Vercel environment variable updated
- [ ] Next.js app redeployed
- [ ] End-to-end test successful

---

## 🎯 Quick Reference

**Render Service URL:**
```
https://quickclinic-socket-server.onrender.com
```

**Health Check:**
```
https://quickclinic-socket-server.onrender.com/health
```

**Vercel Environment Variable:**
```
NEXT_PUBLIC_SOCKET_URL=https://quickclinic-socket-server.onrender.com
```

---

## 📚 Need Help?

- **Render Docs**: [docs.render.com](https://docs.render.com)
- **Render Support**: [community.render.com](https://community.render.com)
- **Your Deployment Guide**: See `DOCKER_DEPLOYMENT.md` for more details

---

**That's it! You're ready to deploy! 🚀**

