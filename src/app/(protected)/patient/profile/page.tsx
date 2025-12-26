"use client";

import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AvatarUploader from "@/components/general/AvatarUploader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { showToast } from "@/lib/toast";
import { useUserStore } from "@/store/userStore";

type PatientFields = {
	medicalHistory: string;
	allergies: string;
	currentMedications: string;
};

export default function PatientProfilePage() {
	const router = useRouter();
	const { user, setUser, patientId: storedPatientId, doctorId } = useUserStore();

	const userId = user?.id;
	const [patientId, setPatientId] = useState<string | null>(storedPatientId ?? user?.patientId ?? null);
	const isVerified = user?.emailVerified ?? false;

	const [loadingData, setLoadingData] = useState(true);
	const [saving, setSaving] = useState(false);

	const [formData, setFormData] = useState({
		name: "",
		email: "",
		phoneNo: "",
		age: "",
		address: "",
		city: "",
		state: "",
		pinCode: "",
		gender: "",
		role: "PATIENT",
	});

	const [patientData, setPatientData] = useState<PatientFields>({
		medicalHistory: "",
		allergies: "",
		currentMedications: "",
	});

	useEffect(() => {
		if (!userId) {
			setLoadingData(false);
			router.push("/auth/login");
			return;
		}

		const fetchProfile = async () => {
			try {
				setLoadingData(true);

				const userRes = await fetch(`/api/user/${userId}`, {
					method: "GET",
					headers: { "Content-Type": "application/json" },
					credentials: "include",
				});

				if (!userRes.ok) {
					throw new Error("Failed to load user profile");
				}

				const userPayload = await userRes.json();

				setFormData({
					name: userPayload.name ?? "",
					email: userPayload.email ?? "",
					phoneNo: userPayload.phoneNo ?? "",
					age: userPayload.age?.toString() ?? "",
					address: userPayload.address ?? "",
					city: userPayload.city ?? "",
					state: userPayload.state ?? "",
					pinCode: userPayload.pinCode?.toString() ?? "",
					gender: userPayload.gender ?? "",
					role: userPayload.role ?? "PATIENT",
				});

				setUser(userPayload, userPayload.patientId ?? null, userPayload.doctorId ?? null);
				const nextPatientId = userPayload.patientId ?? patientId ?? storedPatientId ?? null;

				if (nextPatientId) {
					const patientRes = await fetch(`/api/patients/${nextPatientId}`, { credentials: "include" });
					if (patientRes.ok) {
						const { patient } = await patientRes.json();
						setPatientData({
							medicalHistory: patient?.medicalHistory ?? "",
							allergies: patient?.allergies ?? "",
							currentMedications: patient?.currentMedications ?? "",
						});
						setPatientId(nextPatientId);
					}
				}
			} catch (err: any) {
				console.error("profile-load", err);
				showToast.error(err?.message ?? "Unable to load profile");
			} finally {
				setLoadingData(false);
			}
		};

		fetchProfile();
	}, [patientId, router, setUser, storedPatientId, userId]);

	const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
		const { name, value } = e.target;
		setFormData((prev) => ({
			...prev,
			[name]: value,
		}));
	};

	const handlePatientChange = (field: keyof PatientFields, value: string) => {
		setPatientData((prev) => ({ ...prev, [field]: value }));
	};

	const handleSave = async (e: FormEvent) => {
		e.preventDefault();
		if (!userId) {
			showToast.error("Missing user");
			return;
		}

		if (!/^[0-9]{6}$/.test(formData.pinCode)) {
			showToast.warning("Please enter a valid 6-digit pincode.");
			return;
		}

		setSaving(true);

		try {
			const userResponse = await fetch(`/api/user/${userId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: formData.name,
					phoneNo: formData.phoneNo,
					age: Number(formData.age),
					address: formData.address,
					city: formData.city,
					state: formData.state,
					pinCode: Number(formData.pinCode),
					gender: formData.gender,
				}),
			});

			const updatedUser = await userResponse.json();
			if (!userResponse.ok) {
				throw new Error(updatedUser?.error || "Failed to update profile");
			}

			let activePatientId = patientId ?? updatedUser.patientId ?? storedPatientId ?? null;

			if (activePatientId) {
				const res = await fetch(`/api/patients/${activePatientId}`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						medicalHistory: patientData.medicalHistory,
						allergies: patientData.allergies,
						currentMedications: patientData.currentMedications,
					}),
				});

				if (!res.ok) {
					const err = await res.json();
					throw new Error(err?.error || "Failed to update patient details");
				}
			} else {
				const res = await fetch(`/api/patients`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						userId,
						medicalHistory: patientData.medicalHistory,
						allergies: patientData.allergies,
						currentMedications: patientData.currentMedications,
					}),
				});

				const payload = await res.json();
				if (!res.ok) {
					throw new Error(payload?.error || "Failed to create patient profile");
				}

				activePatientId = payload.patient?.id ?? null;
				setPatientId(activePatientId);
			}

			const nextUserPayload = {
				...updatedUser,
				patientId: activePatientId,
			};

			setUser(nextUserPayload, activePatientId ?? undefined, doctorId ?? undefined);
			showToast.success("Profile updated successfully");
		} catch (err: any) {
			console.error("profile-save", err);
			showToast.error(err?.message ?? "Something went wrong");
		} finally {
			setSaving(false);
		}
	};

	if (loadingData) {
		return (
			<div className="min-h-screen flex items-center justify-center bg-background px-4 py-10">
				<div className="space-y-4 w-full max-w-2xl">
					<Skeleton className="h-12 w-40" />
					<Skeleton className="h-96 w-full" />
					<Skeleton className="h-80 w-full" />
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-background px-4 py-10">
			<div className="max-w-4xl mx-auto space-y-6">
				<div className="flex flex-col gap-2">
					<h1 className="text-3xl font-semibold">Your Profile</h1>
					<p className="text-muted-foreground">Update your account and medical details</p>
				</div>

				<form onSubmit={handleSave} className="space-y-6">
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

					<Card className="shadow-sm">
						<CardHeader>
							<div className="flex items-center justify-between">
								<div>
									<CardTitle>Medical Details</CardTitle>
									<p className="text-sm text-muted-foreground">Keep your care team updated</p>
								</div>
								{patientId && <Badge variant="outline">Patient ID: {patientId}</Badge>}
							</div>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="medicalHistory">Medical History</Label>
								<Textarea
									id="medicalHistory"
									value={patientData.medicalHistory}
									onChange={(e) => handlePatientChange("medicalHistory", e.target.value)}
									placeholder="Chronic conditions, surgeries, notes"
									rows={4}
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="allergies">Allergies</Label>
								<Textarea
									id="allergies"
									value={patientData.allergies}
									onChange={(e) => handlePatientChange("allergies", e.target.value)}
									placeholder="Food, drug, or seasonal allergies"
									rows={3}
								/>
							</div>

							<div className="space-y-2">
								<Label htmlFor="currentMedications">Current Medications</Label>
								<Textarea
									id="currentMedications"
									value={patientData.currentMedications}
									onChange={(e) => handlePatientChange("currentMedications", e.target.value)}
									placeholder="List active prescriptions"
									rows={3}
								/>
							</div>
						</CardContent>
					</Card>

					<div className="flex justify-end">
						<Button type="submit" size="lg" disabled={saving} className="w-full md:w-48">
							{saving ? "Saving..." : "Save Profile"}
						</Button>
					</div>
				</form>
			</div>
		</div>
	);
}
