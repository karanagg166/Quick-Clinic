import { prisma } from '@/lib/prisma';
import type { Specialty, Qualification, Gender, Role } from '@/generated/prisma';

export const GOLDEN_PASSWORD = 'Password123!';

export const GOLDEN_DOCTORS = [
  {
    key: 'doctor1',
    user: {
      name: 'Dr. Aarav Sharma',
      email: 'golden_doc1_cardio@quickclinic.test',
      phoneNo: '9811100001',
      age: 45,
      gender: 'MALE' as Gender,
      role: 'DOCTOR' as Role,
      address: '101 Heart Care Center, Sector 15',
      city: 'Faridabad',
      state: 'Haryana',
      pinCode: 121004,
      password: GOLDEN_PASSWORD,
    },
    doctor: {
      specialty: 'CARDIOLOGIST' as Specialty,
      fees: 800,
      experience: 15,
      doctorBio: 'Senior interventional cardiologist with 15+ years experience.',
      qualifications: ['MBBS', 'MD', 'DM'] as Qualification[],
      latitude: 28.4089,
      longitude: 77.3178,
    },
  },
  {
    key: 'doctor2',
    user: {
      name: 'Dr. Priya Patel',
      email: 'golden_doc2_derma@quickclinic.test',
      phoneNo: '9811100002',
      age: 36,
      gender: 'FEMALE' as Gender,
      role: 'DOCTOR' as Role,
      address: '202 Skin Health Clinic, Connaught Place',
      city: 'Delhi',
      state: 'Delhi',
      pinCode: 110001,
      password: GOLDEN_PASSWORD,
    },
    doctor: {
      specialty: 'DERMATOLOGIST' as Specialty,
      fees: 1200,
      experience: 8,
      doctorBio: 'Specialist in clinical dermatology and aesthetic treatments.',
      qualifications: ['MBBS', 'MD'] as Qualification[],
      latitude: 28.6139,
      longitude: 77.209,
    },
  },
  {
    key: 'doctor3',
    user: {
      name: 'Dr. Rohan Verma',
      email: 'golden_doc3_gp@quickclinic.test',
      phoneNo: '9811100003',
      age: 30,
      gender: 'MALE' as Gender,
      role: 'DOCTOR' as Role,
      address: '303 Family Health Hub, Cyber City',
      city: 'Gurgaon',
      state: 'Haryana',
      pinCode: 122002,
      password: GOLDEN_PASSWORD,
    },
    doctor: {
      specialty: 'GENERAL_PHYSICIAN' as Specialty,
      fees: 400,
      experience: 4,
      doctorBio: 'Primary care practitioner specializing in preventative medicine.',
      qualifications: ['MBBS'] as Qualification[],
      latitude: 28.4595,
      longitude: 77.0266,
    },
  },
  {
    key: 'doctor4',
    user: {
      name: 'Dr. Ananya Iyer',
      email: 'golden_doc4_ortho@quickclinic.test',
      phoneNo: '9811100004',
      age: 50,
      gender: 'FEMALE' as Gender,
      role: 'DOCTOR' as Role,
      address: '404 Bone & Joint Hospital, Sector 62',
      city: 'Noida',
      state: 'Uttar Pradesh',
      pinCode: 201301,
      password: GOLDEN_PASSWORD,
    },
    doctor: {
      specialty: 'ORTHOPEDIC' as Specialty,
      fees: 1500,
      experience: 20,
      doctorBio: 'Renowned orthopedic surgeon specializing in joint replacement.',
      qualifications: ['MBBS', 'MS', 'MCH'] as Qualification[],
      latitude: 28.5355,
      longitude: 77.391,
    },
  },
  {
    key: 'doctor5',
    user: {
      name: 'Dr. Kabir Sen',
      email: 'golden_doc5_psych@quickclinic.test',
      phoneNo: '9811100005',
      age: 40,
      gender: 'MALE' as Gender,
      role: 'DOCTOR' as Role,
      address: '505 Mind Wellness Center, Saket',
      city: 'Delhi',
      state: 'Delhi',
      pinCode: 110017,
      password: GOLDEN_PASSWORD,
    },
    doctor: {
      specialty: 'PSYCHIATRIST' as Specialty,
      fees: 1000,
      experience: 10,
      doctorBio: 'Consultant psychiatrist focused on cognitive wellness.',
      qualifications: ['MBBS', 'MD'] as Qualification[],
      latitude: 28.5244,
      longitude: 77.2167,
    },
  },
  {
    key: 'doctor6',
    user: {
      name: 'Dr. Meera Nambiar',
      email: 'golden_doc6_pedia@quickclinic.test',
      phoneNo: '9811100006',
      age: 34,
      gender: 'FEMALE' as Gender,
      role: 'DOCTOR' as Role,
      address: '606 Child Care Clinic, Indirapuram',
      city: 'Ghaziabad',
      state: 'Uttar Pradesh',
      pinCode: 201014,
      password: GOLDEN_PASSWORD,
    },
    doctor: {
      specialty: 'PEDIATRICIAN' as Specialty,
      fees: 600,
      experience: 6,
      doctorBio: 'Compassionate pediatrician dedicated to child development.',
      qualifications: ['MBBS', 'DNB'] as Qualification[],
      latitude: 28.6385,
      longitude: 77.3694,
    },
  },
];

export const GOLDEN_PATIENTS = Array.from({ length: 8 }).map((_, i) => ({
  key: `patient${i + 1}`,
  name: `Golden Patient ${i + 1}`,
  email: `golden_patient${i + 1}@quickclinic.test`,
  phoneNo: `982220000${i + 1}`,
  age: 22 + i * 4,
  gender: (i % 2 === 0 ? 'MALE' : 'FEMALE') as Gender,
  role: 'PATIENT' as Role,
  address: `${100 + i} Patient Street, Block ${String.fromCharCode(65 + i)}`,
  city: ['Faridabad', 'Delhi', 'Gurgaon', 'Noida'][i % 4],
  state: ['Haryana', 'Delhi', 'Haryana', 'Uttar Pradesh'][i % 4],
  pinCode: [121004, 110001, 122002, 201301][i % 4],
  password: GOLDEN_PASSWORD,
  medicalHistory: `Medical condition note for patient ${i + 1}`,
  allergies: i % 2 === 0 ? 'None' : 'Dust, Pollen',
  currentMedications: i % 3 === 0 ? 'None' : 'Daily Vitamins',
}));

export const GOLDEN_ADMINS = [
  {
    key: 'admin1',
    name: 'Super Admin One',
    email: 'golden_admin1@quickclinic.test',
    phoneNo: '9833300001',
    age: 40,
    gender: 'MALE' as Gender,
    role: 'ADMIN' as Role,
    address: 'Executive Tower 1, Administrative HQ',
    city: 'Faridabad',
    state: 'Haryana',
    pinCode: 121004,
    password: GOLDEN_PASSWORD,
  },
  {
    key: 'admin2',
    name: 'Ops Admin Two',
    email: 'golden_admin2@quickclinic.test',
    phoneNo: '9833300002',
    age: 35,
    gender: 'FEMALE' as Gender,
    role: 'ADMIN' as Role,
    address: 'Operations Wing 2, Administrative HQ',
    city: 'Faridabad',
    state: 'Haryana',
    pinCode: 121004,
    password: GOLDEN_PASSWORD,
  },
];

export async function cleanupGoldenDataset() {
  const allEmails = [
    ...GOLDEN_DOCTORS.map((d) => d.user.email),
    ...GOLDEN_PATIENTS.map((p) => p.email),
    ...GOLDEN_ADMINS.map((a) => a.email),
  ];

  try {
    const users = await prisma.user.findMany({
      where: { email: { in: allEmails } },
      select: { id: true, doctor: { select: { id: true } }, patient: { select: { id: true } } },
    });

    const userIds = users.map((u) => u.id);
    const doctorIds = users.map((u) => u.doctor?.id).filter(Boolean) as string[];
    const patientIds = users.map((u) => u.patient?.id).filter(Boolean) as string[];

    if (userIds.length === 0) return;

    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });

    const relations = await prisma.doctorPatientRelation.findMany({
      where: { OR: [{ doctorsUserId: { in: userIds } }, { patientsUserId: { in: userIds } }] },
      select: { id: true },
    });
    const relIds = relations.map((r) => r.id);
    if (relIds.length > 0) {
      await prisma.chatMessages.deleteMany({ where: { doctorPatientRelationId: { in: relIds } } });
      await prisma.doctorPatientRelation.deleteMany({ where: { id: { in: relIds } } });
    }

    await prisma.payment.deleteMany({ where: { userId: { in: userIds } } });
    if (doctorIds.length > 0) {
      await prisma.withdrawal.deleteMany({ where: { doctorId: { in: doctorIds } } });
    }
    await prisma.bankAccount.deleteMany({ where: { userId: { in: userIds } } });

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

    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.accessLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.otp.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.admin.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { email: { in: allEmails } } });
  } catch (error) {
    console.warn('Golden dataset cleanup warning:', error);
  }
}
