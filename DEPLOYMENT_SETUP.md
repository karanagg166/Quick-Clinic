# 🔗 Vercel + Render Deployment Setup Guide

## Overview

Your architecture:
```
┌─────────────────────┐         ┌──────────────────────────┐
│   Next.js App       │ ◄─────► │  Socket.IO Server        │
│   (Vercel)          │         │  (Render)                │
│   Port 3000         │         │  Port 4000               │
└─────────────────────┘         └──────────────────────────┘
```

**Socket Server URL:** `https://quickclinic-socket-server.onrender.com`

---

## 📋 Step-by-Step Setup

### Step 1: Identify Your Vercel Deployment URLs

In Vercel, you typically have **3 deployment environments**:

1. **Production** - Your main live site (e.g., `https://quick-clinic.vercel.app`)
2. **Preview** - Branch deployments (e.g., `https://quick-clinic-git-main.vercel.app`)
3. **Development** - Development branch (if configured)

**Which one to use?**
- **For Production:** Use your **Production URL** (the main one)
- **For Preview/Development:** Use the respective preview URLs

---

### Step 2: Configure Render Socket Server

1. Go to **Render Dashboard** → Your Socket Server Service
2. Click **"Environment"** tab
3. Add/Update these environment variables:

```env
# Required
DATABASE_URL=your_postgresql_connection_string
FRONTEND_URL=https://your-production-app.vercel.app
PORT=4000
NODE_ENV=production

# Optional
HOST=0.0.0.0
SOCKET_PORT=4000
```

**Important:**
- `FRONTEND_URL` should be your **Production Vercel URL** (the main one)
- This allows CORS from your Vercel frontend
- If you have multiple Vercel deployments, use the **production URL** here

**Example:**
```
FRONTEND_URL=https://quick-clinic.vercel.app
```

4. Click **"Save Changes"**
5. **Redeploy** the service (Render will auto-redeploy when env vars change)

---

### Step 3: Configure Vercel Next.js App

1. Go to **Vercel Dashboard** → Your Project
2. Click **"Settings"** → **"Environment Variables"**
3. Add/Update these variables:

#### For Production Environment:
```env
NEXT_PUBLIC_SOCKET_URL=https://quickclinic-socket-server.onrender.com
DATABASE_URL=your_postgresql_connection_string
RESEND_API_KEY=your_resend_api_key
# ... other env vars
```

#### For Preview Environment (if needed):
```env
NEXT_PUBLIC_SOCKET_URL=https://quickclinic-socket-server.onrender.com
# ... same as production
```

#### For Development Environment (if needed):
```env
NEXT_PUBLIC_SOCKET_URL=https://quickclinic-socket-server.onrender.com
# ... same as production
```

**Important:**
- `NEXT_PUBLIC_SOCKET_URL` should be the same for all environments (your Render URL)
- Make sure to select the correct **Environment** when adding each variable:
  - ✅ Production
  - ✅ Preview (optional)
  - ✅ Development (optional)

4. Click **"Save"** for each variable
5. **Redeploy** your Vercel app:
   - Go to **"Deployments"** tab
   - Click **"..."** on the latest deployment
   - Click **"Redeploy"**

---

## 🎯 Quick Reference

### Which Vercel URL to Use?

**In Render's `FRONTEND_URL`:**
- Use your **Production Vercel URL** (the main one)
- Example: `https://quick-clinic.vercel.app`
- This is the URL users will access

**In Vercel's `NEXT_PUBLIC_SOCKET_URL`:**
- Use your **Render Socket Server URL**
- Example: `https://quickclinic-socket-server.onrender.com`
- This is the same for all Vercel environments

---

## ✅ Verification Steps

### 1. Test Socket Server Health
```bash
curl https://quickclinic-socket-server.onrender.com/health
```

Should return:
```json
{"status":"ok","timestamp":"2025-12-23T..."}
```

### 2. Test from Vercel App
1. Open your **Production Vercel URL** in browser
2. Login to your app
3. Navigate to a chat page
4. Open browser **Developer Console** (F12)
5. Look for:
   ```
   Connecting to Socket.IO server: https://quickclinic-socket-server.onrender.com
   Socket connected successfully
   ```
6. Send a test message
7. ✅ Should work in real-time!

### 3. Check CORS (if connection fails)
- Verify `FRONTEND_URL` in Render matches your Vercel production URL exactly
- Check browser console for CORS errors
- Ensure both URLs use `https://` (not `http://`)

---

## 🔄 Multiple Vercel Environments

If you have multiple Vercel deployments:

### Option 1: Use Production URL Only (Recommended)
- Set `FRONTEND_URL` in Render to your **production URL only**
- Preview deployments will also work (CORS allows subdomains)

### Option 2: Allow Multiple Origins (Advanced)
If you need to support multiple Vercel URLs, you'll need to modify the socket server CORS config:

```typescript
// In socket-server/main.ts
const allowedOrigins = [
  'https://quick-clinic.vercel.app',
  'https://quick-clinic-git-main.vercel.app',
  // ... other preview URLs
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));
```

**For now, Option 1 is simpler and should work for all environments.**

---

## 🐛 Troubleshooting

### Connection Refused
- ✅ Check `NEXT_PUBLIC_SOCKET_URL` is set correctly in Vercel
- ✅ Verify Render service is running (check Render logs)
- ✅ Test health endpoint: `curl https://quickclinic-socket-server.onrender.com/health`

### CORS Errors
- ✅ Verify `FRONTEND_URL` in Render matches your Vercel production URL exactly
- ✅ Ensure both use `https://` protocol
- ✅ Check browser console for specific CORS error messages

### Socket Not Connecting
- ✅ Check browser console for connection errors
- ✅ Verify `NEXT_PUBLIC_SOCKET_URL` is accessible (try opening in browser)
- ✅ Check Render logs for any errors
- ✅ Ensure WebSocket is enabled (should be automatic on Render)

### Service Spins Down (Free Tier)
- ⚠️ Render free tier spins down after 15 min inactivity
- ⚠️ First connection after spin-down takes ~30-50 seconds
- 💡 Consider upgrading to Starter Plan ($7/month) for always-on service

---

## 📝 Environment Variables Summary

### Render Socket Server:
```env
DATABASE_URL=postgresql://...
FRONTEND_URL=https://your-production-app.vercel.app  ← Your main Vercel URL
PORT=4000
NODE_ENV=production
```

### Vercel Next.js App:
```env
NEXT_PUBLIC_SOCKET_URL=https://quickclinic-socket-server.onrender.com  ← Your Render URL
DATABASE_URL=postgresql://...
RESEND_API_KEY=re_...
# ... other vars
```

---

## 🎉 You're Done!

Once configured:
1. ✅ Socket server accepts connections from your Vercel app
2. ✅ Vercel app connects to your Render socket server
3. ✅ Real-time chat should work!

**Next Steps:**
- Test the connection
- Monitor Render logs for any issues
- Consider upgrading Render plan for production use

