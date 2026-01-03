"use client";

import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { showToast } from "@/lib/toast";
import { useUserStore } from "@/store/userStore";
import { AccountDetails } from "@/components/patient/profile/AccountDetails";
import { MedicalDetails } from "@/components/patient/profile/MedicalDetails";
import type { PatientProfileFormData, PatientMedicalData } from "@/types/patientProfile";

export default function PatientProfilePage() {
	const router = useRouter();
	const { user, setUser, patientId: storedPatientId, doctorId } = useUserStore();

	const userId = user?.id;
	const [patientId, setPatientId] = useState<string | null>(storedPatientId ?? user?.patientId ?? null);

	const [loadingData, setLoadingData] = useState(true);
	const [saving, setSaving] = useState(false);

	const [formData, setFormData] = useState<PatientProfileFormData>({
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

	const [patientData, setPatientData] = useState<PatientMedicalData>({
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

	const handlePatientChange = (field: keyof PatientMedicalData, value: string) => {
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
					<AccountDetails
						userId={userId}
						user={user}
						formData={formData}
						handleChange={handleChange}
						isVerified={user?.emailVerified ?? false}
					/>

					<MedicalDetails
						patientId={patientId}
						patientData={patientData}
						handlePatientChange={handlePatientChange}
					/>

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
