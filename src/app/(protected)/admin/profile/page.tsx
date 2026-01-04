"use client";

import AdminProfileForm from "@/components/admin/profile/AdminProfileForm";

export default function AdminProfilePage() {
    return (
        <div className="p-6 max-w-4xl mx-auto space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">Profile Settings</h1>
            </div>
            <AdminProfileForm />
        </div>
    );
}
