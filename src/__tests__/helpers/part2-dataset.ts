import { prisma } from '@/lib/prisma';
import { hash } from 'bcryptjs';
import type { Specialty, Qualification, Gender, Role } from '@/generated/prisma';

export const PART2_PASSWORD = 'Password123!';

export interface Part2TestUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  token?: string;
  doctorId?: string;
  patientId?: string;
  adminId?: string;
}

export interface Part2Dataset {
  runId: string;
  superAdmin: Part2TestUser;
  subAdmins: Part2TestUser[];
  doctors: (Part2TestUser & {
    specialty: Specialty;
    fees: number;
    experience: number;
    balance: number;
    scheduleType: string;
    city: string;
    pinCode: number;
  })[];
  patients: (Part2TestUser & {
    age: number;
    gender: Gender;
    city: string;
    medicalHistory: string;
    allergies: string;
  })[];
}

export function generateRunId(): string {
  return `p2_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export async function seedPart2Dataset(customRunId?: string): Promise<Part2Dataset> {
  const runId = customRunId || generateRunId();
  const hashedPassword = await hash(PART2_PASSWORD, 8);

  const ensureLocation = async (pincode: number, city: string, state: string) => {
    return prisma.location.upsert({
      where: { pincode },
      update: { city, state },
      create: { pincode, city, state },
    });
  };

  await Promise.all([
    ensureLocation(110001, 'Delhi', 'Delhi'),
    ensureLocation(201301, 'Noida', 'Uttar Pradesh'),
    ensureLocation(122002, 'Gurgaon', 'Haryana'),
    ensureLocation(121004, 'Faridabad', 'Haryana'),
    ensureLocation(201014, 'Ghaziabad', 'Uttar Pradesh'),
  ]);

  // 1. Seed Super Admin
  const superAdminUser = await prisma.user.create({
    data: {
      name: `Super Admin (${runId})`,
      email: `super_admin_${runId}@quickclinic.test`,
      phoneNo: '9900000001',
      password: hashedPassword,
      role: 'ADMIN',
      age: 42,
      gender: 'MALE',
      address: '100 Executive Suite, Connaught Place',
      pinCode: 110001,
      emailVerified: true,
      isActive: true,
    },
  });

  const superAdminRecord = await prisma.admin.create({
    data: {
      userId: superAdminUser.id,
      managerId: null,
    },
  });

  // 2. Seed 2 Sub-Admins
  const subAdmin1User = await prisma.user.create({
    data: {
      name: `Sub Admin Ops (${runId})`,
      email: `sub_admin1_${runId}@quickclinic.test`,
      phoneNo: '9900000002',
      password: hashedPassword,
      role: 'ADMIN',
      age: 35,
      gender: 'FEMALE',
      address: '101 Ops Branch, Sector 62',
      pinCode: 201301,
      emailVerified: true,
      isActive: true,
    },
  });

  const subAdmin1Record = await prisma.admin.create({
    data: {
      userId: subAdmin1User.id,
      managerId: superAdminRecord.id,
    },
  });

  const subAdmin2User = await prisma.user.create({
    data: {
      name: `Sub Admin Audit (${runId})`,
      email: `sub_admin2_${runId}@quickclinic.test`,
      phoneNo: '9900000003',
      password: hashedPassword,
      role: 'ADMIN',
      age: 38,
      gender: 'MALE',
      address: '102 Audit Tower, Cyber City',
      pinCode: 122002,
      emailVerified: true,
      isActive: true,
    },
  });

  const subAdmin2Record = await prisma.admin.create({
    data: {
      userId: subAdmin2User.id,
      managerId: superAdminRecord.id,
    },
  });

  // 3. Seed 6 Diverse Doctors
  const doctorConfigs = [
    {
      key: 'docA',
      name: `Dr. Amit Patel (${runId})`,
      email: `doc_cardio_${runId}@quickclinic.test`,
      phoneNo: '9810000001',
      age: 48,
      gender: 'MALE' as Gender,
      specialty: 'CARDIOLOGIST' as Specialty,
      fees: 500,
      experience: 10,
      balance: 500000, // 5,000 INR
      city: 'Delhi',
      pinCode: 110001,
      qualifications: ['MBBS', 'MD', 'DM'] as Qualification[],
      scheduleType: 'MORNING',
      weeklySchedule: [
        { day: 'Monday', slots: [{ slotNo: 1, start: '09:00', end: '13:00' }] },
        { day: 'Tuesday', slots: [{ slotNo: 1, start: '09:00', end: '13:00' }] },
        { day: 'Wednesday', slots: [{ slotNo: 1, start: '09:00', end: '13:00' }] },
        { day: 'Thursday', slots: [{ slotNo: 1, start: '09:00', end: '13:00' }] },
        { day: 'Friday', slots: [{ slotNo: 1, start: '09:00', end: '13:00' }] },
      ],
    },
    {
      key: 'docB',
      name: `Dr. Bhavna Rao (${runId})`,
      email: `doc_derma_${runId}@quickclinic.test`,
      phoneNo: '9810000002',
      age: 37,
      gender: 'FEMALE' as Gender,
      specialty: 'DERMATOLOGIST' as Specialty,
      fees: 800,
      experience: 5,
      balance: 80000, // 800 INR
      city: 'Noida',
      pinCode: 201301,
      qualifications: ['MBBS', 'MD'] as Qualification[],
      scheduleType: 'EVENING',
      weeklySchedule: [
        { day: 'Monday', slots: [{ slotNo: 1, start: '16:00', end: '20:00' }] },
        { day: 'Wednesday', slots: [{ slotNo: 1, start: '16:00', end: '20:00' }] },
        { day: 'Friday', slots: [{ slotNo: 1, start: '16:00', end: '20:00' }] },
      ],
    },
    {
      key: 'docC',
      name: `Dr. Chirag Singhal (${runId})`,
      email: `doc_gp_${runId}@quickclinic.test`,
      phoneNo: '9810000003',
      age: 32,
      gender: 'MALE' as Gender,
      specialty: 'GENERAL_PHYSICIAN' as Specialty,
      fees: 300,
      experience: 3,
      balance: 30000, // 300 INR
      city: 'Gurgaon',
      pinCode: 122002,
      qualifications: ['MBBS'] as Qualification[],
      scheduleType: 'SPLIT_SHIFT_WITH_LUNCH',
      weeklySchedule: [
        {
          day: 'Monday',
          slots: [
            { slotNo: 1, start: '09:00', end: '13:00' },
            { slotNo: 2, start: '14:00', end: '17:00' },
          ],
        },
        {
          day: 'Tuesday',
          slots: [{ slotNo: 1, start: '10:00', end: '15:00' }],
        },
        { day: 'Wednesday', slots: [] }, // OFF
        {
          day: 'Saturday',
          slots: [{ slotNo: 1, start: '09:00', end: '12:00' }],
        },
      ],
    },
    {
      key: 'docD',
      name: `Dr. Divya Menon (${runId})`,
      email: `doc_pedia_${runId}@quickclinic.test`,
      phoneNo: '9810000004',
      age: 41,
      gender: 'FEMALE' as Gender,
      specialty: 'PEDIATRICIAN' as Specialty,
      fees: 600,
      experience: 8,
      balance: 120000, // 1200 INR
      city: 'Faridabad',
      pinCode: 121004,
      qualifications: ['MBBS', 'DNB'] as Qualification[],
      scheduleType: 'WEEKENDS_ONLY',
      weeklySchedule: [
        { day: 'Saturday', slots: [{ slotNo: 1, start: '10:00', end: '16:00' }] },
        { day: 'Sunday', slots: [{ slotNo: 1, start: '10:00', end: '14:00' }] },
      ],
    },
    {
      key: 'docE',
      name: `Dr. Eashan Gupta (${runId})`,
      email: `doc_ortho_${runId}@quickclinic.test`,
      phoneNo: '9810000005',
      age: 52,
      gender: 'MALE' as Gender,
      specialty: 'ORTHOPEDIC' as Specialty,
      fees: 1200,
      experience: 18,
      balance: 0,
      city: 'Delhi',
      pinCode: 110001,
      qualifications: ['MBBS', 'MS', 'MCH'] as Qualification[],
      scheduleType: 'LEAVE_SCHEDULED',
      weeklySchedule: [
        { day: 'Monday', slots: [{ slotNo: 1, start: '09:00', end: '14:00' }] },
        { day: 'Tuesday', slots: [{ slotNo: 1, start: '09:00', end: '14:00' }] },
        { day: 'Wednesday', slots: [{ slotNo: 1, start: '09:00', end: '14:00' }] },
      ],
    },
    {
      key: 'docF',
      name: `Dr. Fatima Zahra (${runId})`,
      email: `doc_psych_${runId}@quickclinic.test`,
      phoneNo: '9810000006',
      age: 39,
      gender: 'FEMALE' as Gender,
      specialty: 'PSYCHIATRIST' as Specialty,
      fees: 1000,
      experience: 9,
      balance: 200000, // 2000 INR
      city: 'Noida',
      pinCode: 201301,
      qualifications: ['MBBS', 'MD'] as Qualification[],
      scheduleType: 'NO_UPCOMING_SLOTS',
      weeklySchedule: [],
    },
  ];

  const doctors: Part2Dataset['doctors'] = [];

  for (const cfg of doctorConfigs) {
    const user = await prisma.user.create({
      data: {
        name: cfg.name,
        email: cfg.email,
        phoneNo: cfg.phoneNo,
        password: hashedPassword,
        role: 'DOCTOR',
        age: cfg.age,
        gender: cfg.gender,
        address: `${cfg.name} Clinic, ${cfg.city}`,
        pinCode: cfg.pinCode,
        emailVerified: true,
        isActive: true,
      },
    });

    const doctor = await prisma.doctor.create({
      data: {
        userId: user.id,
        specialty: cfg.specialty,
        fees: cfg.fees,
        experience: cfg.experience,
        balance: cfg.balance,
        doctorBio: `Dr. ${cfg.name} specializes in ${cfg.specialty} with ${cfg.experience} years of clinical expertise.`,
        latitude: cfg.city === 'Delhi' ? 28.6139 : 28.5355,
        longitude: cfg.city === 'Delhi' ? 77.209 : 77.391,
      },
    });

    for (const qual of cfg.qualifications) {
      await prisma.doctorQualification.create({
        data: {
          doctorId: doctor.id,
          qualification: qual,
        },
      });
    }

    if (cfg.weeklySchedule.length > 0) {
      await prisma.schedule.create({
        data: {
          doctorId: doctor.id,
          weeklySchedule: cfg.weeklySchedule,
        },
      });
    }

    // Attach leave for docE (LEAVE_SCHEDULED)
    if (cfg.key === 'docE') {
      const leaveStart = new Date();
      leaveStart.setDate(leaveStart.getDate() + 5);
      leaveStart.setHours(0, 0, 0, 0);

      const leaveEnd = new Date(leaveStart);
      leaveEnd.setDate(leaveEnd.getDate() + 3);
      leaveEnd.setHours(23, 59, 59, 999);

      await prisma.leave.create({
        data: {
          doctorId: doctor.id,
          reason: 'Annual Orthopedic Conference Leave',
          startDate: leaveStart,
          endDate: leaveEnd,
        },
      });
    }

    doctors.push({
      id: user.id,
      email: user.email,
      name: user.name,
      role: 'DOCTOR',
      doctorId: doctor.id,
      specialty: cfg.specialty,
      fees: cfg.fees,
      experience: cfg.experience,
      balance: cfg.balance,
      scheduleType: cfg.scheduleType,
      city: cfg.city,
      pinCode: cfg.pinCode,
    });
  }

  // 4. Seed 8 Diverse Patients
  const patientConfigs = [
    {
      name: `Patient Aarav (${runId})`,
      email: `patient_aarav_${runId}@quickclinic.test`,
      phoneNo: '9820000001',
      age: 24,
      gender: 'MALE' as Gender,
      city: 'Delhi',
      pinCode: 110001,
      medicalHistory: 'Asthma, managed with inhaler',
      allergies: 'Dust, Pollen',
    },
    {
      name: `Patient Sunita (${runId})`,
      email: `patient_sunita_${runId}@quickclinic.test`,
      phoneNo: '9820000002',
      age: 48,
      gender: 'FEMALE' as Gender,
      city: 'Noida',
      pinCode: 201301,
      medicalHistory: 'Type 2 Diabetes, Metformin 500mg daily',
      allergies: 'Sulfa Drugs',
    },
    {
      name: `Patient Rahul (${runId})`,
      email: `patient_rahul_${runId}@quickclinic.test`,
      phoneNo: '9820000003',
      age: 31,
      gender: 'MALE' as Gender,
      city: 'Gurgaon',
      pinCode: 122002,
      medicalHistory: 'Hypertension',
      allergies: 'Penicillin',
    },
    {
      name: `Patient Deepa (${runId})`,
      email: `patient_deepa_${runId}@quickclinic.test`,
      phoneNo: '9820000004',
      age: 29,
      gender: 'FEMALE' as Gender,
      city: 'Faridabad',
      pinCode: 121004,
      medicalHistory: 'None reported',
      allergies: 'None',
    },
    {
      name: `Patient Vikram (${runId})`,
      email: `patient_vikram_${runId}@quickclinic.test`,
      phoneNo: '9820000005',
      age: 65,
      gender: 'MALE' as Gender,
      city: 'Delhi',
      pinCode: 110001,
      medicalHistory: 'Coronary artery disease, Stent placed 2021',
      allergies: 'Aspirin',
    },
    {
      name: `Patient Ananya (${runId})`,
      email: `patient_ananya_${runId}@quickclinic.test`,
      phoneNo: '9820000006',
      age: 19,
      gender: 'FEMALE' as Gender,
      city: 'Noida',
      pinCode: 201301,
      medicalHistory: 'Eczema',
      allergies: 'Shellfish, Peanuts',
    },
    {
      name: `Patient Gaurav (${runId})`,
      email: `patient_gaurav_${runId}@quickclinic.test`,
      phoneNo: '9820000007',
      age: 40,
      gender: 'MALE' as Gender,
      city: 'Gurgaon',
      pinCode: 122002,
      medicalHistory: 'Lower back disc herniation L4-L5',
      allergies: 'NSAIDs',
    },
    {
      name: `Patient Pooja (${runId})`,
      email: `patient_pooja_${runId}@quickclinic.test`,
      phoneNo: '9820000008',
      age: 36,
      gender: 'FEMALE' as Gender,
      city: 'Faridabad',
      pinCode: 121004,
      medicalHistory: 'Hypothyroidism, Levothyroxine 50mcg',
      allergies: 'Iodine contrast dye',
    },
  ];

  const patients: Part2Dataset['patients'] = [];

  for (const cfg of patientConfigs) {
    const user = await prisma.user.create({
      data: {
        name: cfg.name,
        email: cfg.email,
        phoneNo: cfg.phoneNo,
        password: hashedPassword,
        role: 'PATIENT',
        age: cfg.age,
        gender: cfg.gender,
        address: `${cfg.name} Residence, ${cfg.city}`,
        pinCode: cfg.pinCode,
        emailVerified: true,
        isActive: true,
      },
    });

    const patient = await prisma.patient.create({
      data: {
        userId: user.id,
        medicalHistory: cfg.medicalHistory,
        allergies: cfg.allergies,
        currentMedications: 'As detailed in medical history',
      },
    });

    patients.push({
      id: user.id,
      email: user.email,
      name: user.name,
      role: 'PATIENT',
      patientId: patient.id,
      age: cfg.age,
      gender: cfg.gender,
      city: cfg.city,
      medicalHistory: cfg.medicalHistory,
      allergies: cfg.allergies,
    });
  }

  return {
    runId,
    superAdmin: {
      id: superAdminUser.id,
      email: superAdminUser.email,
      name: superAdminUser.name,
      role: 'ADMIN',
      adminId: superAdminRecord.id,
    },
    subAdmins: [
      {
        id: subAdmin1User.id,
        email: subAdmin1User.email,
        name: subAdmin1User.name,
        role: 'ADMIN',
        adminId: subAdmin1Record.id,
      },
      {
        id: subAdmin2User.id,
        email: subAdmin2User.email,
        name: subAdmin2User.name,
        role: 'ADMIN',
        adminId: subAdmin2Record.id,
      },
    ],
    doctors,
    patients,
  };
}

export async function cleanupPart2Dataset(dataset: Part2Dataset) {
  if (!dataset || !dataset.runId) return;

  const allUserIds = [
    dataset.superAdmin.id,
    ...dataset.subAdmins.map((a) => a.id),
    ...dataset.doctors.map((d) => d.id),
    ...dataset.patients.map((p) => p.id),
  ];

  const doctorIds = dataset.doctors.map((d) => d.doctorId).filter(Boolean) as string[];
  const patientIds = dataset.patients.map((p) => p.patientId).filter(Boolean) as string[];

  try {
    await prisma.notification.deleteMany({ where: { userId: { in: allUserIds } } });

    const relations = await prisma.doctorPatientRelation.findMany({
      where: { OR: [{ doctorsUserId: { in: allUserIds } }, { patientsUserId: { in: allUserIds } }] },
      select: { id: true },
    });
    const relIds = relations.map((r) => r.id);
    if (relIds.length > 0) {
      await prisma.chatMessages.deleteMany({ where: { doctorPatientRelationId: { in: relIds } } });
      await prisma.doctorPatientRelation.deleteMany({ where: { id: { in: relIds } } });
    }

    await prisma.payment.deleteMany({ where: { userId: { in: allUserIds } } });
    if (doctorIds.length > 0) {
      await prisma.withdrawal.deleteMany({ where: { doctorId: { in: doctorIds } } });
    }
    await prisma.bankAccount.deleteMany({ where: { userId: { in: allUserIds } } });

    if (doctorIds.length > 0 || patientIds.length > 0) {
      await prisma.appointment.deleteMany({
        where: { OR: [{ doctorId: { in: doctorIds } }, { patientId: { in: patientIds } }] },
      });
    }

    if (doctorIds.length > 0) {
      await prisma.slot.deleteMany({ where: { doctorId: { in: doctorIds } } });
      await prisma.schedule.deleteMany({ where: { doctorId: { in: doctorIds } } });
      await prisma.leave.deleteMany({ where: { doctorId: { in: doctorIds } } });
      await prisma.rating.deleteMany({ where: { doctorId: { in: doctorIds } } });
      await prisma.comment.deleteMany({ where: { doctorId: { in: doctorIds } } });
      await prisma.doctorQualification.deleteMany({ where: { doctorId: { in: doctorIds } } });
      await prisma.doctor.deleteMany({ where: { id: { in: doctorIds } } });
    }

    if (patientIds.length > 0) {
      await prisma.patient.deleteMany({ where: { id: { in: patientIds } } });
    }

    await prisma.auditLog.deleteMany({ where: { userId: { in: allUserIds } } });
    await prisma.accessLog.deleteMany({ where: { userId: { in: allUserIds } } });
    await prisma.otp.deleteMany({ where: { userId: { in: allUserIds } } });
    await prisma.admin.deleteMany({ where: { userId: { in: allUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: allUserIds } } });
  } catch (error) {
    console.warn(`Part 2 dataset cleanup failed for runId ${dataset.runId}:`, error);
  }
}
