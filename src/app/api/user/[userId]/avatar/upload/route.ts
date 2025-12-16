import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getUserId } from '@/lib/auth';
import { v2 as cloudinary } from 'cloudinary';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Upload buffer to Cloudinary
async function uploadToCloudinary(buffer: Buffer, userId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: 'quickclinic/avatars',
        public_id: `user_${userId}_${Date.now()}`,
        transformation: [
          { width: 400, height: 400, crop: 'fill', gravity: 'face' },
          { quality: 'auto' },
          { fetch_format: 'auto' },
        ],
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result!.secure_url);
      }
    );
    uploadStream.end(buffer);
  });
}

// Delete image from Cloudinary by URL
async function deleteFromCloudinary(imageUrl: string): Promise<void> {
  if (!imageUrl) return;
  
  try {
    // Extract public_id from Cloudinary URL
    // Format: https://res.cloudinary.com/cloud/image/upload/v123/quickclinic/avatars/user_xyz.png
    const matches = imageUrl.match(/\/([^/]+\/[^/]+\/[^/]+)$/);
    if (matches && matches[1]) {
      const publicId = matches[1].replace(/\.[^/.]+$/, ''); // Remove extension
      await cloudinary.uploader.destroy(publicId);
    }
  } catch (error) {
    console.error('Error deleting old avatar from Cloudinary:', error);
    // Don't throw - failing to delete old image shouldn't block the new upload
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  try {
    const { userId } = await params;

    // Auth: only the owner can upload their avatar
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    
    // For cookie-based auth, check if token exists in cookies
    const cookieToken = request.cookies.get('token')?.value;
    const actualToken = token || cookieToken;
    
    if (!actualToken) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }
    
    const { valid, userId: requesterId } = await getUserId(actualToken);
    if (!valid || requesterId !== userId) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    // Check if user exists and get current avatar URL
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, profileImageUrl: true },
    });

    if (!user) {
      return NextResponse.json({ message: 'User not found' }, { status: 404 });
    }

    // Parse multipart form data using Next.js built-in API
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    
    if (!file) {
      return NextResponse.json({ message: 'No file uploaded' }, { status: 400 });
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ message: 'File must be an image' }, { status: 400 });
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ message: 'File size must be less than 5MB' }, { status: 400 });
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Delete old avatar from Cloudinary if it exists
    if (user.profileImageUrl) {
      await deleteFromCloudinary(user.profileImageUrl);
    }

    // Upload to Cloudinary
    const avatarUrl = await uploadToCloudinary(buffer, userId);

    // Update user in database
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { profileImageUrl: avatarUrl },
      select: { profileImageUrl: true },
    });

    return NextResponse.json({ avatarUrl: updatedUser.profileImageUrl });
  } catch (error: any) {
    console.error('Error uploading avatar:', error);
    return NextResponse.json({ message: error.message || 'Upload failed' }, { status: 500 });
  }
}
