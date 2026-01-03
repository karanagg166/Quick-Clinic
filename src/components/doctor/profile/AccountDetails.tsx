import type { ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import AvatarUploader from "@/components/general/AvatarUploader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { DoctorProfileFormData } from "@/types/doctorProfile";
import type { UserDetail } from "@/types/common";

interface AccountDetailsProps {
    userId: string | undefined;
    user: UserDetail | null;
    formData: DoctorProfileFormData;
    handleChange: (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
    isVerified: boolean;
}

export function AccountDetails({
    userId,
    user,
    formData,
    handleChange,
    isVerified,
}: AccountDetailsProps) {
    const router = useRouter();

    return (
        <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle>Account Details</CardTitle>
                    <p className="text-sm text-muted-foreground">Manage your basic information</p>
                </div>
                <Button variant="ghost" size="sm" type="button" onClick={() => router.back()}>
                    Cancel
                </Button>
            </CardHeader>
            <CardContent className="space-y-4">
                {userId && (
                    <AvatarUploader userId={userId} initialUrl={user?.profileImageUrl} />
                )}

                <Card className="border-dashed">
                    <CardContent className="p-4 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-semibold">Email verification</p>
                            <p className="text-xs text-muted-foreground">{formData.email || user?.email}</p>
                        </div>
                        {isVerified ? (
                            <Badge variant="default" className="bg-green-100 text-green-700">Verified</Badge>
                        ) : (
                            <Button type="button" size="sm" onClick={() => router.push("/user/verify")}>
                                Verify Email
                            </Button>
                        )}
                    </CardContent>
                </Card>

                <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="name">Full Name</Label>
                        <Input
                            id="name"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            required
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="phoneNo">Mobile Number</Label>
                        <Input
                            id="phoneNo"
                            name="phoneNo"
                            value={formData.phoneNo}
                            onChange={handleChange}
                            required
                        />
                    </div>
                </div>

                <div className="grid md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="age">Age</Label>
                        <Input
                            id="age"
                            type="number"
                            name="age"
                            value={formData.age}
                            onChange={handleChange}
                            min={0}
                            required
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="gender">Gender</Label>
                        <Select
                            value={formData.gender}
                            onValueChange={(value) => handleChange({ target: { name: "gender", value } } as any)}
                            required
                        >
                            <SelectTrigger id="gender">
                                <SelectValue placeholder="Select gender" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="MALE">Male</SelectItem>
                                <SelectItem value="FEMALE">Female</SelectItem>
                                <SelectItem value="BINARY">Binary</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                        <Label>Account Type</Label>
                        <Badge variant="secondary" className="h-10 inline-flex items-center">{formData.role}</Badge>
                    </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="address">Address</Label>
                        <Input
                            id="address"
                            name="address"
                            value={formData.address}
                            onChange={handleChange}
                            required
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="city">City</Label>
                            <Input
                                id="city"
                                name="city"
                                value={formData.city}
                                onChange={handleChange}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="state">State</Label>
                            <Input
                                id="state"
                                name="state"
                                value={formData.state}
                                onChange={handleChange}
                                required
                            />
                        </div>
                    </div>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label htmlFor="pinCode">Pincode</Label>
                        <Input
                            id="pinCode"
                            name="pinCode"
                            value={formData.pinCode}
                            onChange={handleChange}
                            required
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="email">Email</Label>
                        <Input id="email" name="email" value={formData.email} disabled className="bg-muted" />
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
