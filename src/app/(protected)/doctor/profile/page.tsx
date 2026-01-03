"use client";

import type { ChangeEvent, FormEvent } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { showToast } from "@/lib/toast";
import { useUserStore } from "@/store/userStore";
import { AccountDetails } from "@/components/doctor/profile/AccountDetails";
import { ProfessionalDetails } from "@/components/doctor/profile/ProfessionalDetails";
import type { DoctorProfileFormData, DoctorProfessionalData } from "@/types/doctorProfile";

export default function DoctorProfilePage() {
	const router = useRouter();
	const { user, setUser, doctorId: storedDoctorId, patientId } = useUserStore();

	const userId = user?.id;
	const [doctorId, setDoctorId] = useState<string | null>(storedDoctorId ?? user?.doctorId ?? null);

	const [loadingData, setLoadingData] = useState(true);
	const [saving, setSaving] = useState(false);
	const [loadingEnums, setLoadingEnums] = useState(true);

	const [formData, setFormData] = useState<DoctorProfileFormData>({
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

	const [doctorData, setDoctorData] = useState<DoctorProfessionalData>({
		specialty: "",
		experience: "",
		fees: "",
		qualifications: [],
		doctorBio: "",
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
							doctorBio: doctor?.doctorBio ?? "",
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

	const handleDoctorChange = (field: keyof DoctorProfessionalData, value: string) => {
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
						doctorBio: doctorData.doctorBio,
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
						doctorBio: doctorData.doctorBio,
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
					<AccountDetails
						userId={userId}
						user={user}
						formData={formData}
						handleChange={handleChange}
						isVerified={user?.emailVerified ?? false}
					/>

					<ProfessionalDetails
						doctorId={doctorId}
						doctorData={doctorData}
						handleDoctorChange={handleDoctorChange}
						toggleQualification={toggleQualification}
						specialties={specialties}
						qualificationsList={qualificationsList}
						loadingEnums={loadingEnums}
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
