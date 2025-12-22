# 🐳 Deploy Socket Server with Docker

Deploying with Docker is the **easiest** way! It handles all dependencies and builds automatically.

## 🚀 Quick Deploy to Render (Docker)

### Step 1: Create Render Account
1. Go to [render.com](https://render.com)
2. Sign up with GitHub
3. Connect your GitHub account

### Step 2: Create New Web Service
1. Click **"New +"** → **"Web Service"**
2. Connect your **Quick-Clinic** repository

### Step 3: Configure Docker Deployment

**Basic Settings:**
- **Name**: `quickclinic-socket-server`
- **Environment**: `Docker` ⚠️ **Select Docker, not Node!**
- **Region**: Choose closest to your users
- **Branch**: `main`
- **Root Directory**: Leave empty (uses root)

**Docker Settings:**
- **Dockerfile Path**: `socket-server/Dockerfile.prod`
- **Docker Context**: `.` (root directory)

**That's it!** No build commands or start commands needed! 🎉

### Step 4: Set Environment Variables

Add these in Render dashboard:
```
NODE_ENV=production
PORT=4000
SOCKET_PORT=4000
DATABASE_URL=your-neon-postgres-url-here
FRONTEND_URL=https://your-vercel-app.vercel.app
```

### Step 5: Deploy
1. Click **"Create Web Service"**
2. Render will automatically:
   - Build the Docker image
   - Install all dependencies
   - Generate Prisma client
   - Build TypeScript
   - Start the server
3. Wait for deployment (usually 3-5 minutes)

### Step 6: Get Your URL
After deployment, Render provides a URL like:
```
https://quickclinic-socket-server.onrender.com
```

---

## 🎯 Other Platforms with Docker

### Railway (Docker)

1. Go to [railway.app](https://railway.app)
2. **New Project** → **Deploy from GitHub repo**
3. Select your repository
4. **Add Service** → **Dockerfile**
5. Set **Dockerfile Path**: `socket-server/Dockerfile.prod`
6. Add environment variables
7. Deploy!

### Fly.io (Docker)

1. Install Fly CLI: `curl -L https://fly.io/install.sh | sh`
2. Login: `fly auth login`
3. Create app: `fly launch --dockerfile socket-server/Dockerfile.prod`
4. Set environment variables: `fly secrets set DATABASE_URL=... FRONTEND_URL=...`
5. Deploy: `fly deploy`

### DigitalOcean App Platform (Docker)

1. Go to [cloud.digitalocean.com](https://cloud.digitalocean.com)
2. **Apps** → **Create App**
3. Connect GitHub repository
4. **Resource Type**: Docker
5. **Dockerfile Path**: `socket-server/Dockerfile.prod`
6. Add environment variables
7. Deploy!

### AWS ECS / Google Cloud Run

Both support Docker deployments. Use `socket-server/Dockerfile.prod` as your Dockerfile.

---

## 📋 Dockerfile Overview

The `Dockerfile.prod` automatically:
1. ✅ Installs Node.js and dependencies
2. ✅ Copies Prisma schema
3. ✅ Generates Prisma client
4. ✅ Builds TypeScript to JavaScript
5. ✅ Creates optimized production image
6. ✅ Starts the server

**No manual steps needed!**

---

## 🔍 Verify Deployment

### Test Health Endpoint
```bash
curl https://your-socket-server.onrender.com/health
```

Expected:
```json
{"status":"ok","timestamp":"2025-12-22T..."}
```

### Test from Frontend
1. Update Vercel environment variable:
   ```
   NEXT_PUBLIC_SOCKET_URL=https://your-socket-server.onrender.com
   ```
2. Redeploy Next.js app
3. Test chat functionality

---

## 🆚 Docker vs Node.js Deployment

| Feature | Docker | Node.js |
|---------|--------|---------|
| **Setup** | ⭐ One click | ⭐⭐ Manual config |
| **Build Commands** | ❌ Not needed | ✅ Required |
| **Dependencies** | ✅ Auto-installed | ⚠️ Manual install |
| **Consistency** | ✅ Same everywhere | ⚠️ May differ |
| **Prisma Client** | ✅ Auto-generated | ⚠️ Manual step |
| **TypeScript Build** | ✅ Automatic | ⚠️ Manual command |

**Recommendation: Use Docker!** 🐳

---

## 🐛 Troubleshooting

### Build Fails
- Check Dockerfile path is correct: `socket-server/Dockerfile.prod`
- Verify Docker context is root directory (`.`)
- Check Render logs for specific errors

### Container Won't Start
- Verify environment variables are set
- Check `DATABASE_URL` is correct
- Ensure `FRONTEND_URL` matches your Vercel domain

### Connection Issues
- Verify `NEXT_PUBLIC_SOCKET_URL` in Vercel matches Render URL
- Check CORS settings (should be automatic)
- Ensure both services are running

---

## ✅ Deployment Checklist

- [ ] Render account created
- [ ] GitHub repository connected
- [ ] Web service created with **Docker** environment
- [ ] Dockerfile path set: `socket-server/Dockerfile.prod`
- [ ] Environment variables added
- [ ] Service deployed successfully
- [ ] Health endpoint tested
- [ ] Vercel environment variable updated
- [ ] Frontend tested and working

---

## 🎉 That's It!

Docker makes deployment **super simple** - just point Render to your Dockerfile and it handles everything else! 🚀

