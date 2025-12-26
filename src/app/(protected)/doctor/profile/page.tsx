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
import { showToast } from "@/lib/toast";
import { useUserStore } from "@/store/userStore";

type DoctorFields = {
	specialty: string;
	experience: string;
	fees: string;
	qualifications: string[];
};

export default function DoctorProfilePage() {
	const router = useRouter();
	const { user, setUser, doctorId: storedDoctorId, patientId } = useUserStore();

	const userId = user?.id;
	const [doctorId, setDoctorId] = useState<string | null>(storedDoctorId ?? user?.doctorId ?? null);
	const isVerified = user?.emailVerified ?? false;

	const [loadingData, setLoadingData] = useState(true);
	const [saving, setSaving] = useState(false);
	const [loadingEnums, setLoadingEnums] = useState(true);

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
		role: "DOCTOR",
	});

	const [doctorData, setDoctorData] = useState<DoctorFields>({
		specialty: "",
		experience: "",
		fees: "",
		qualifications: [],
	});

	const [specialties, setSpecialties] = useState<string[]>([]);
	const [qualificationsList, setQualificationsList] = useState<string[]>([]);

	useEffect(() => {
		const fetchEnums = async () => {
			try {
				setLoadingEnums(true);
				const [spRes, qRes] = await Promise.all([
					fetch("/api/doctors/specializations"),
					fetch("/api/doctors/qualifications"),
				]);

				if (spRes.ok) {
					const data = await spRes.json();
					setSpecialties(data.specialties ?? []);
				}

				if (qRes.ok) {
					const data = await qRes.json();
					setQualificationsList(data.qualifications ?? []);
				}
			} catch (err) {
				console.error("doctor-enums", err);
			} finally {
				setLoadingEnums(false);
			}
		};

		fetchEnums();
	}, []);

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
					role: userPayload.role ?? "DOCTOR",
				});

				setUser(userPayload, userPayload.patientId ?? null, userPayload.doctorId ?? null);
				const nextDoctorId = userPayload.doctorId ?? doctorId ?? storedDoctorId ?? null;

				if (nextDoctorId) {
					const doctorRes = await fetch(`/api/doctors/${nextDoctorId}`, { credentials: "include" });
					if (doctorRes.ok) {
						const { doctor } = await doctorRes.json();
						setDoctorData({
							specialty: doctor?.specialty ?? "",
							experience: doctor?.experience?.toString() ?? "",
							fees: doctor?.fees?.toString() ?? "",
							qualifications: Array.isArray(doctor?.qualifications) ? doctor.qualifications : [],
						});
						setDoctorId(nextDoctorId);
					}
				}
			} catch (err: any) {
				console.error("doctor-profile-load", err);
				showToast.error(err?.message ?? "Unable to load profile");
			} finally {
				setLoadingData(false);
			}
		};

		fetchProfile();
	}, [doctorId, router, setUser, storedDoctorId, userId]);

	const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
		const { name, value } = e.target;
		setFormData((prev) => ({
			...prev,
			[name]: value,
		}));
	};

	const handleDoctorChange = (field: keyof DoctorFields, value: string) => {
		setDoctorData((prev) => ({ ...prev, [field]: value }));
	};

	const toggleQualification = (value: string) => {
		setDoctorData((prev) => ({
			...prev,
			qualifications: prev.qualifications.includes(value)
				? prev.qualifications.filter((q) => q !== value)
				: [...prev.qualifications, value],
		}));
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

		if (!doctorData.specialty) {
			showToast.warning("Please select your specialty.");
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

			let activeDoctorId = doctorId ?? updatedUser.doctorId ?? storedDoctorId ?? null;

			if (activeDoctorId) {
				const res = await fetch(`/api/doctors/${activeDoctorId}`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						specialty: doctorData.specialty,
						experience: Number(doctorData.experience),
						fees: Number(doctorData.fees),
						qualifications: doctorData.qualifications,
					}),
				});

				if (!res.ok) {
					const err = await res.json();
					throw new Error(err?.error || "Failed to update doctor details");
				}
			} else {
				const res = await fetch(`/api/doctors`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						userId,
						specialty: doctorData.specialty,
						experience: Number(doctorData.experience || 0),
						fees: Number(doctorData.fees || 0),
						qualifications: doctorData.qualifications,
					}),
				});

				const payload = await res.json();
				if (!res.ok) {
					throw new Error(payload?.error || "Failed to create doctor profile");
				}

				activeDoctorId = payload.doctor?.id ?? null;
				setDoctorId(activeDoctorId);
			}

			const nextUserPayload = {
				...updatedUser,
				doctorId: activeDoctorId,
			};

			setUser(nextUserPayload, patientId ?? undefined, activeDoctorId ?? undefined);
			showToast.success("Profile updated successfully");
		} catch (err: any) {
			console.error("doctor-profile-save", err);
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
					<p className="text-muted-foreground">Update your account and professional details</p>
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
									<CardTitle>Professional Details</CardTitle>
									<p className="text-sm text-muted-foreground">Help patients understand your expertise</p>
								</div>
								{doctorId && <Badge variant="outline">Doctor ID: {doctorId}</Badge>}
							</div>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="specialty">Specialty</Label>
								<Select
									value={doctorData.specialty}
									onValueChange={(value) => handleDoctorChange("specialty", value)}
								>
									<SelectTrigger id="specialty">
										<SelectValue placeholder="Select specialty" />
									</SelectTrigger>
									<SelectContent>
										{(loadingEnums ? [] : specialties).map((sp) => (
											<SelectItem key={sp} value={sp}>
												{sp}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>

							<div className="grid md:grid-cols-2 gap-4">
								<div className="space-y-2">
									<Label htmlFor="experience">Experience (years)</Label>
									<Input
										id="experience"
										type="number"
										value={doctorData.experience}
										onChange={(e) => handleDoctorChange("experience", e.target.value)}
										min={0}
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="fees">Consultation Fees (₹)</Label>
									<Input
										id="fees"
										type="number"
										value={doctorData.fees}
										onChange={(e) => handleDoctorChange("fees", e.target.value)}
										min={0}
									/>
								</div>
							</div>

							<div className="space-y-3">
								<Label>Qualifications</Label>
								<Card className="p-4 max-h-64 overflow-y-auto border-dashed">
									<div className="grid md:grid-cols-2 gap-3">
										{(loadingEnums ? [] : qualificationsList).map((qualification) => (
											<label key={qualification} className="flex items-center gap-2 text-sm cursor-pointer">
												<input
													type="checkbox"
													className="h-4 w-4 rounded border-gray-300"
													checked={doctorData.qualifications.includes(qualification)}
													onChange={() => toggleQualification(qualification)}
												/>
												{qualification}
											</label>
										))}
										{!loadingEnums && qualificationsList.length === 0 && (
											<p className="text-sm text-muted-foreground">No qualifications found.</p>
										)}
									</div>
								</Card>

								{doctorData.qualifications.length > 0 && (
									<div className="flex flex-wrap gap-2">
										{doctorData.qualifications.map((q) => (
											<Badge key={q} variant="secondary">
												{q}
											</Badge>
										))}
									</div>
								)}
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
