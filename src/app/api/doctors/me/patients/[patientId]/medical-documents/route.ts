import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { logAccess, logAudit } from "@/lib/logger";
import { verifyDoctorPatientMedicalAccess } from "@/lib/medical-record-access";
import { MedicalDocumentType } from "@/generated/prisma";

interface RouteParams {
  params: Promise<{
    patientId: string;
  }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    if (authUser.role !== "DOCTOR") {
      return NextResponse.json(
        { error: "Access denied. Only doctors can access this endpoint." },
        { status: 403 }
      );
    }

    const { patientId } = await params;
    if (!patientId) {
      return NextResponse.json(
        { error: "Patient ID is required" },
        { status: 400 }
      );
    }

    const doctor = await prisma.doctor.findUnique({
      where: { userId: authUser.id },
      select: { id: true },
    });

    if (!doctor) {
      return NextResponse.json(
        { error: "Doctor profile not found" },
        { status: 404 }
      );
    }

    // Server-side authorization check: must have CONFIRMED or COMPLETED appointment
    const accessCheck = await verifyDoctorPatientMedicalAccess(doctor.id, patientId);
    if (!accessCheck.allowed) {
      // Audit log denied medical record access attempt
      await logAudit(
        authUser.id,
        "MEDICAL_DOCUMENT_ACCESS_DENIED",
        {
          patientId,
          doctorId: doctor.id,
          reason: accessCheck.reason || "NO_ELIGIBLE_APPOINTMENT",
        },
        "MEDICAL_RECORD"
      );

      return NextResponse.json(
        { error: "Access denied. You do not have an active or completed appointment with this patient." },
        { status: 403 }
      );
    }

    // Query filters
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim();
    const typeParam = searchParams.get("type")?.trim();
    const mimeTypeParam = searchParams.get("mimeType")?.trim() || searchParams.get("fileType")?.trim();
    const sortParam = searchParams.get("sort")?.trim() || "reportDate:desc";

    const where: any = {
      patientId,
    };

    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { hospitalOrDoctor: { contains: search, mode: "insensitive" } },
        { notes: { contains: search, mode: "insensitive" } },
      ];
    }

    if (typeParam && Object.values(MedicalDocumentType).includes(typeParam as any)) {
      where.type = typeParam as MedicalDocumentType;
    }

    if (mimeTypeParam) {
      where.mimeType = { contains: mimeTypeParam, mode: "insensitive" };
    }

    const [field, direction] = sortParam.split(":");
    const orderBy: any = {};
    if (field === "title" || field === "createdAt" || field === "reportDate") {
      orderBy[field] = direction === "asc" ? "asc" : "desc";
    } else {
      orderBy.reportDate = "desc";
    }

    // Fetch medical document metadata (strictly omit storagePath)
    const documents = await prisma.medicalDocument.findMany({
      where,
      orderBy,
      select: {
        id: true,
        patientId: true,
        title: true,
        type: true,
        fileName: true,
        mimeType: true,
        fileSize: true,
        reportDate: true,
        hospitalOrDoctor: true,
        notes: true,
        processingStatus: true,
        processingError: true,
        processedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Strictly sanitize document metadata: ensure storagePath is never leaked
    const sanitizedDocuments = documents.map((doc: any) => {
      const { storagePath, ...rest } = doc;
      return rest;
    });

    // Fetch patient safe demographic summary
    const patientRecord = await prisma.patient.findUnique({
      where: { id: patientId },
      select: {
        id: true,
        user: {
          select: {
            name: true,
            age: true,
            gender: true,
            profileImageUrl: true,
          },
        },
      },
    });

    // Log successful listing access
    await logAccess(
      authUser.id,
      patientId,
      "MEDICAL_DOCUMENT_LIST",
      "MEDICAL_RECORD"
    );

    return NextResponse.json(
      {
        patient: {
          id: patientRecord?.id || patientId,
          name: patientRecord?.user?.name || "Patient",
          age: patientRecord?.user?.age ?? null,
          gender: patientRecord?.user?.gender ?? null,
          profileImageUrl: patientRecord?.user?.profileImageUrl ?? null,
          qualifyingAppointment: {
            id: accessCheck.appointment?.id,
            status: accessCheck.appointment?.status,
            date: accessCheck.appointment?.slot?.date || accessCheck.appointment?.bookedAt,
          },
        },
        documents: sanitizedDocuments,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Failed to fetch patient medical documents for doctor:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to retrieve medical documents" },
      { status: 500 }
    );
  }
}
