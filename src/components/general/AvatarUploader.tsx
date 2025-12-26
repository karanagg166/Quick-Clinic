"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import { useUserStore } from "@/store/userStore";

interface Props {
  userId: string;
  initialUrl?: string;
}

export default function AvatarUploader({ userId, initialUrl }: Props) {
  const { updateUser } = useUserStore();
  const [previewUrl, setPreviewUrl] = useState(initialUrl || "");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const handleFileSelect =  (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('File size must be less than 5MB');
      return;
    }

    setSelectedFile(file);
    setError(null);

    // Create preview
    const reader = new FileReader();
    reader.onloadend = async () => {
      setPreviewUrl(reader.result as string);
      
    };
    reader.readAsDataURL(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const res = await fetch(`/api/user/${userId}/avatar/upload`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || 'Upload failed');

      console.log("upload request response: ", data);

      setPreviewUrl(data.avatarUrl);
      updateUser({ profileImageUrl: data.avatarUrl });
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  };


  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="w-20 h-20 rounded-full overflow-hidden bg-gray-100 border-2 border-gray-200 flex-shrink-0">
          {previewUrl ? (
            <Image src={previewUrl} alt="avatar" width={80} height={80} className="object-cover w-full h-full" />
          ) : (
            <div className="flex items-center justify-center w-full h-full text-xs text-gray-500">No Avatar</div>
          )}
        </div>
        <div className="flex-1">
          <label className="text-xs font-semibold text-gray-500 ml-1 uppercase">Profile Picture</label>
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 transition"
            >
              Choose File
            </button>
            {selectedFile && (
              <button
                type="button"
                onClick={handleUpload}
                disabled={uploading}
                className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700 transition disabled:opacity-50"
              >
                {uploading ? 'Uploading...' : 'Upload'}
              </button>
            )}
          </div>
          {selectedFile && (
            <p className="text-xs text-gray-600 mt-1">{selectedFile.name}</p>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      </div>

     

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
