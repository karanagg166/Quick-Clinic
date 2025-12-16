# Profile Pictures Setup Guide

## ✅ What's Been Implemented

### 1. Database Changes
- Added `profileImageUrl` field to the `User` model in Prisma schema
- Field is optional and stores the URL of the user's profile picture

### 2. API Endpoints

#### GET `/api/user/[userId]/avatar`
- Fetches the profile picture URL for a user
- Returns: `{ avatarUrl: string }`

#### POST `/api/user/[userId]/avatar`
- Updates profile picture via URL
- Requires Bearer token authentication (user must be updating their own profile)
- Body: `{ avatarUrl: string }` or `{ url: string }`
- Returns: `{ avatarUrl: string }`

#### POST `/api/user/[userId]/avatar/upload`
- **NEW**: Uploads image file directly to Cloudinary
- Accepts multipart/form-data with `file` field
- Automatically resizes to 400x400 with face detection
- Stores in Cloudinary folder: `quickclinic/avatars`
- Requires authentication
- Max file size: 5MB
- Allowed types: image/jpeg, image/png, image/webp, etc.

### 3. UI Components

#### `<AvatarUploader />`
- Location: `src/components/general/AvatarUploader.tsx`
- Integrated in user profile page
- Features:
  - File upload with preview
  - Drag/drop support via file input
  - URL paste option as fallback
  - 5MB file size validation
  - Image type validation
  - Real-time preview before upload

#### `<Avatar />`
- Location: `src/components/general/Avatar.tsx`
- Reusable avatar display component
- Features:
  - Shows profile picture if available
  - Fallback to initials (gradient background)
  - Multiple sizes: sm, md, lg, xl
  - Used in navbars for doctor and patient

### 4. Store Updates
- `userStore.ts` now includes `profileImageUrl` field
- Avatar updates sync to Zustand store automatically

### 5. Navbar Integration
- Doctor navbar shows profile picture
- Patient navbar shows profile picture
- Both fallback to initials if no picture exists

---

## 🚀 Setup Instructions

### Step 1: Environment Variables
Add these to your `.env` file:

```env
# Cloudinary Configuration
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

# JWT (if not already set)
JWT_SECRET=your_jwt_secret_here
```

### Step 2: Get Cloudinary Credentials
1. Sign up at [cloudinary.com](https://cloudinary.com)
2. Go to Dashboard
3. Copy your Cloud Name, API Key, and API Secret
4. Paste into `.env`

### Step 3: Run Prisma Migration
```powershell
# Generate Prisma client
npx prisma generate

# Create and apply migration
npx prisma migrate dev --name add-user-profile-image
```

### Step 4: Update Existing Users (Optional)
If you have existing users and want to seed some test avatars:

```sql
-- Run this in your database client or via Prisma Studio
UPDATE "User" SET "profileImageUrl" = 'https://via.placeholder.com/150' WHERE "profileImageUrl" IS NULL;
```

### Step 5: Restart Dev Server
```powershell
npm run dev
```

---

## 📝 Usage

### For Users
1. Go to profile page: `/user/profile`
2. Click "Choose File" button
3. Select an image (JPG, PNG, WebP, etc. - max 5MB)
4. Click "Upload" button
5. Avatar appears immediately in navbar

**Alternative**: Paste a direct image URL and click "Save URL"

### For Developers

#### Display an avatar anywhere:
```tsx
import Avatar from '@/components/general/Avatar';

<Avatar 
  src={user.profileImageUrl} 
  name={user.name}
  size="md"
/>
```

#### Get avatar URL for current user:
```tsx
const { user } = useUserStore();
const avatarUrl = user?.profileImageUrl;
```

---

## 🔒 Security Features

- ✅ Bearer token authentication on upload
- ✅ User can only update their own avatar
- ✅ File type validation (images only)
- ✅ File size limits (5MB max)
- ✅ Cloudinary auto-optimization (quality, format)
- ✅ Face-detection cropping for better avatars

---

## 🎨 Cloudinary Transformations Applied

All uploaded avatars are automatically:
- Resized to 400x400 pixels
- Cropped to fill with face gravity (centers on faces)
- Optimized for web delivery
- Converted to best format (WebP where supported)

---

## 📦 Dependencies Used

Already installed in your project:
- `cloudinary` - Image hosting and transformation
- `formidable` - Multipart form parsing
- `zustand` - State management for user data

---

## 🐛 Troubleshooting

### "Cloudinary credentials not found"
- Check that `.env` has all three Cloudinary variables
- Restart dev server after adding env vars

### "Upload failed"
- Check file size (must be < 5MB)
- Check file type (must be image/*)
- Check Cloudinary dashboard for quota limits

### "Unauthorized" error
- Ensure user is logged in
- Check that JWT token is being sent
- Verify token in browser DevTools > Application > Cookies

### Avatar not showing in navbar
- Check browser console for image load errors
- Verify `profileImageUrl` is set in database
- Check Cloudinary URL is publicly accessible

---

## 🔄 Future Enhancements (Optional)

- [ ] Add avatar to doctor/patient cards
- [ ] Show avatars in chat messages
- [ ] Add avatar to appointment cards
- [ ] Implement avatar crop/rotate UI
- [ ] Add "Remove avatar" button
- [ ] Support multiple image formats better
- [ ] Add loading skeleton for avatars

---

## ✨ That's It!

Users can now:
1. Upload profile pictures from their device
2. See their avatar in the navbar
3. Update or change their picture anytime

The system handles upload, storage, optimization, and display automatically.
