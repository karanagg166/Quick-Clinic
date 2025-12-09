import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const POST = async (req: NextRequest) => {
	try {
		const body = await req.json();
		const {
			userId,
			medicalHistory = "",
			allergies = "",
			currentMedications = "",
		} = body ?? {};

		if (!userId || typeof userId !== "string") {
			return NextResponse.json({ error: "userId is required" }, { status: 400 });
		}

		const user = await prisma.user.findUnique({ where: { id: userId } });
		if (!user) {
			return NextResponse.json({ error: "User not found" }, { status: 404 });
		}

		const existing = await prisma.patient.findUnique({ where: { userId } });
		if (existing) {
			return NextResponse.json(
				{ error: "Patient profile already exists for this user" },
				{ status: 409 }
			);
		}

		const patient = await prisma.patient.create({
			data: {
				userId,
				medicalHistory,
				allergies,
				currentMedications,
			},
		});

		return NextResponse.json({ patient }, { status: 201 });
	} catch (err: any) {
		console.error("patients-post-error", err);
		return NextResponse.json(
			{ error: err?.message ?? "Server error" },
			{ status: 500 }
		);
	}
};


