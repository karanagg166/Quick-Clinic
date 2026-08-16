// prisma/seed.ts
import 'dotenv/config';
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "bcryptjs";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("==========================================");
  console.log("  Quick-Clinic Database Reset & Seed");
  console.log("==========================================");

  // 1. CLEAN ALL EXISTING DATA FROM THE DATABASE
  console.log("Wiping all existing database records...");
  const tablenames = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename != '_prisma_migrations';
  `;

  const tables = tablenames
    .map(({ tablename }) => `"${tablename}"`)
    .join(", ");

  if (tables.length > 0) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} CASCADE;`);
    console.log("All tables truncated successfully.");
  }

  const defaultPasswordHash = await hash("karan166", 10);

  // 2. LOCATIONS
  console.log("Seeding locations...");
  const locations = [
    { pincode: 110001, city: "New Delhi", state: "Delhi" },
    { pincode: 121004, city: "Faridabad", state: "Haryana" },
    { pincode: 122001, city: "Gurugram", state: "Haryana" },
    { pincode: 201301, city: "Noida", state: "Uttar Pradesh" },
    { pincode: 560001, city: "Bangalore", state: "Karnataka" },
    { pincode: 400001, city: "Mumbai", state: "Maharashtra" },
    { pincode: 500001, city: "Hyderabad", state: "Telangana" },
    { pincode: 600001, city: "Chennai", state: "Tamil Nadu" },
    { pincode: 700001, city: "Kolkata", state: "West Bengal" },
  ];

  for (const loc of locations) {
    await prisma.location.create({ data: loc });
  }
  console.log(`✓ Seeded ${locations.length} locations`);

  // 3. ADMINS
  console.log("Seeding admins...");
  const mainAdminUser = await prisma.user.create({
    data: {
      email: "admin@gmail.com",
      phoneNo: "9999999990",
      name: "Super Admin",
      password: defaultPasswordHash,
      age: 30,
      gender: "MALE",
      role: "ADMIN",
      address: "Quick Clinic Headquarters, Connaught Place",
      pinCode: 110001,
      emailVerified: true,
      isActive: true,
    },
  });

  const superAdminRecord = await prisma.admin.create({
    data: {
      userId: mainAdminUser.id,
    },
  });

  const superAdminUser = await prisma.user.create({
    data: {
      email: "harsh@gmail.com",
      phoneNo: "9999999999",
      name: "Harsh Super Admin",
      password: defaultPasswordHash,
      age: 32,
      gender: "MALE",
      role: "ADMIN",
      address: "Quick Clinic Headquarters, Connaught Place",
      pinCode: 110001,
      emailVerified: true,
      isActive: true,
    },
  });

  await prisma.admin.create({
    data: {
      userId: superAdminUser.id,
      managerId: superAdminRecord.id,
    },
  });

  const opsAdminUser = await prisma.user.create({
    data: {
      email: "admin.ops@quickclinic.com",
      phoneNo: "9888888888",
      name: "Operations Admin",
      password: defaultPasswordHash,
      age: 29,
      gender: "FEMALE",
      role: "ADMIN",
      address: "Quick Clinic Operations Hub, Cyber City",
      pinCode: 122001,
      emailVerified: true,
      isActive: true,
    },
  });

  await prisma.admin.create({
    data: {
      userId: opsAdminUser.id,
      managerId: superAdminRecord.id,
    },
  });
  console.log("✓ Seeded super admin, harsh, and ops admin");

  // Standard weekly schedule definition
  const standardWeeklySchedule = [
    {
      day: "Monday",
      slots: [
        { slotNo: 1, start: "09:00", end: "13:00" },
        { slotNo: 2, start: "15:00", end: "19:00" },
      ],
    },
    {
      day: "Tuesday",
      slots: [
        { slotNo: 1, start: "09:00", end: "13:00" },
        { slotNo: 2, start: "15:00", end: "19:00" },
      ],
    },
    {
      day: "Wednesday",
      slots: [
        { slotNo: 1, start: "09:00", end: "13:00" },
        { slotNo: 2, start: "15:00", end: "18:00" },
      ],
    },
    {
      day: "Thursday",
      slots: [
        { slotNo: 1, start: "10:00", end: "14:00" },
        { slotNo: 2, start: "16:00", end: "20:00" },
      ],
    },
    {
      day: "Friday",
      slots: [
        { slotNo: 1, start: "09:00", end: "13:00" },
        { slotNo: 2, start: "15:00", end: "19:00" },
      ],
    },
    {
      day: "Saturday",
      slots: [{ slotNo: 1, start: "09:00", end: "14:00" }],
    },
    { day: "Sunday", slots: [] },
  ];

  // 4. DOCTORS
  console.log("Seeding doctors...");
  const doctorsData = [
    {
      email: "doctor@gmail.com",
      name: "Dr. Clinic Doctor",
      phoneNo: "9876543211",
      age: 40,
      gender: "MALE" as const,
      address: "Quick Clinic Health Center, Connaught Place",
      pinCode: 110001,
      specialty: "GENERAL_PHYSICIAN" as const,
      experience: 15,
      fees: 500,
      doctorBio: "Principal Doctor at Quick Clinic specializing in general wellness, diagnostics, and patient consultations.",
      latitude: 28.6315,
      longitude: 77.2167,
      balance: 25000,
      qualifications: ["MBBS", "MD"] as const,
    },
    {
      email: "priyanshu@gmail.com",
      name: "Dr. Priyanshu Sharma",
      phoneNo: "9520183169",
      age: 38,
      gender: "MALE" as const,
      address: "Apollo Clinic, Indiranagar",
      pinCode: 560001,
      specialty: "GENERAL_PHYSICIAN" as const,
      experience: 12,
      fees: 700,
      doctorBio: "Senior General Physician specializing in preventive medicine, lifestyle diseases, and family health management.",
      latitude: 12.9716,
      longitude: 77.5946,
      balance: 14000,
      qualifications: ["MBBS", "MD"] as const,
    },
    {
      email: "ananya.iyer@gmail.com",
      name: "Dr. Ananya Iyer",
      phoneNo: "9811122334",
      age: 44,
      gender: "FEMALE" as const,
      address: "Max Super Specialty Heart Centre, Saket",
      pinCode: 110001,
      specialty: "CARDIOLOGIST" as const,
      experience: 16,
      fees: 1500,
      doctorBio: "Consultant Interventional Cardiologist with extensive expertise in hypertension, cardiac arrhythmia, and coronary artery disease.",
      latitude: 28.6139,
      longitude: 77.2090,
      balance: 32000,
      qualifications: ["MBBS", "MD", "DM"] as const,
    },
    {
      email: "rajesh.verma@gmail.com",
      name: "Dr. Rajesh Verma",
      phoneNo: "9876543210",
      age: 35,
      gender: "MALE" as const,
      address: "Skin & Laser Wellness Clinic, Sector 15",
      pinCode: 121004,
      specialty: "DERMATOLOGIST" as const,
      experience: 9,
      fees: 800,
      doctorBio: "Board-certified Dermatologist offering advanced clinical and cosmetic skin solutions, acne management, and hair therapy.",
      latitude: 28.4089,
      longitude: 77.3178,
      balance: 8500,
      qualifications: ["MBBS", "MD", "DNB"] as const,
    },
    {
      email: "sneha.patel@gmail.com",
      name: "Dr. Sneha Patel",
      phoneNo: "9123456780",
      age: 39,
      gender: "FEMALE" as const,
      address: "Rainbow Children's Clinic, Sector 54",
      pinCode: 122001,
      specialty: "PEDIATRICIAN" as const,
      experience: 11,
      fees: 650,
      doctorBio: "Compassionate Pediatrician focusing on neonatal care, adolescent health, developmental milestones, and routine vaccinations.",
      latitude: 28.4595,
      longitude: 77.0266,
      balance: 12000,
      qualifications: ["MBBS", "DNB"] as const,
    },
    {
      email: "vikram.rao@gmail.com",
      name: "Dr. Vikram Rao",
      phoneNo: "9820011223",
      age: 46,
      gender: "MALE" as const,
      address: "Lilavati Orthopedic Centre, Bandra West",
      pinCode: 400001,
      specialty: "ORTHOPEDIC" as const,
      experience: 18,
      fees: 1200,
      doctorBio: "Renowned Orthopedic and Joint Replacement Surgeon with thousands of successful knee, hip, and arthroscopic procedures.",
      latitude: 18.9388,
      longitude: 72.8354,
      balance: 24000,
      qualifications: ["MBBS", "MS", "MCH"] as const,
    },
    {
      email: "meera.nambiar@gmail.com",
      name: "Dr. Meera Nambiar",
      phoneNo: "9440123456",
      age: 42,
      gender: "FEMALE" as const,
      address: "NeuroLife Institute, Banjara Hills",
      pinCode: 500001,
      specialty: "NEUROLOGIST" as const,
      experience: 14,
      fees: 1800,
      doctorBio: "Expert Neurologist specializing in neurodegenerative disorders, chronic headache syndromes, stroke rehab, and epilepsy management.",
      latitude: 17.3850,
      longitude: 78.4867,
      balance: 19500,
      qualifications: ["MBBS", "MD", "DM"] as const,
    },
    {
      email: "rohan.gupta@gmail.com",
      name: "Dr. Rohan Gupta",
      phoneNo: "9818877665",
      age: 33,
      gender: "MALE" as const,
      address: "Elite Dental Studio, Sector 62",
      pinCode: 201301,
      specialty: "DENTIST" as const,
      experience: 7,
      fees: 500,
      doctorBio: "Cosmetic & Restorative Dentist proficient in root canal therapy, digital smile designing, aligners, and dental implants.",
      latitude: 28.5355,
      longitude: 77.3910,
      balance: 6000,
      qualifications: ["BDS", "MDS"] as const,
    },
  ];

  const createdDoctors: Array<{ doctorId: string; userId: string; email: string; name: string }> = [];

  for (const doc of doctorsData) {
    const user = await prisma.user.create({
      data: {
        email: doc.email,
        phoneNo: doc.phoneNo,
        name: doc.name,
        password: defaultPasswordHash,
        age: doc.age,
        gender: doc.gender,
        role: "DOCTOR",
        address: doc.address,
        pinCode: doc.pinCode,
        emailVerified: true,
        isActive: true,
      },
    });

    const doctor = await prisma.doctor.create({
      data: {
        userId: user.id,
        specialty: doc.specialty,
        experience: doc.experience,
        fees: doc.fees,
        doctorBio: doc.doctorBio,
        latitude: doc.latitude,
        longitude: doc.longitude,
        balance: doc.balance,
      },
    });

    // Qualifications
    for (const q of doc.qualifications) {
      await prisma.doctorQualification.create({
        data: {
          doctorId: doctor.id,
          qualification: q,
        },
      });
    }

    // Weekly Schedule
    await prisma.schedule.create({
      data: {
        doctorId: doctor.id,
        weeklySchedule: standardWeeklySchedule,
      },
    });

    // Bank Account
    await prisma.bankAccount.create({
      data: {
        userId: user.id,
        bankAccountNumber: `ACC${Math.floor(1000000000 + Math.random() * 9000000000)}`,
        bankIFSC: "HDFC0001234",
        bankAccountHolderName: doc.name,
        bankName: "HDFC Bank",
      },
    });

    createdDoctors.push({
      doctorId: doctor.id,
      userId: user.id,
      email: doc.email,
      name: doc.name,
    });
  }
  console.log(`✓ Seeded ${createdDoctors.length} doctors with full profiles, schedules, & bank details`);

  // Sample Leave for Dr. Vikram Rao
  const doctorVikram = createdDoctors.find((d) => d.email === "vikram.rao@gmail.com");
  if (doctorVikram) {
    const leaveStart = new Date();
    leaveStart.setDate(leaveStart.getDate() + 10);
    const leaveEnd = new Date(leaveStart);
    leaveEnd.setDate(leaveEnd.getDate() + 3);

    await prisma.leave.create({
      data: {
        doctorId: doctorVikram.doctorId,
        reason: "Attending International Orthopedic Summit",
        startDate: leaveStart,
        endDate: leaveEnd,
      },
    });
  }

  // 5. PATIENTS
  console.log("Seeding patients...");
  const patientsData = [
    {
      email: "patient@gmail.com",
      name: "Standard Patient",
      phoneNo: "9876543212",
      age: 26,
      gender: "MALE" as const,
      address: "Connaught Place, New Delhi",
      pinCode: 110001,
      medicalHistory: "No major medical history, regular checkups",
      allergies: "None",
      currentMedications: "Multivitamins daily",
    },
    {
      email: "karan@gmail.com",
      name: "Karan Aggarwal",
      phoneNo: "7838222130",
      age: 22,
      gender: "MALE" as const,
      address: "Flat 402, Green Valley Apartments, NIT",
      pinCode: 121004,
      medicalHistory: "Mild seasonal asthma, Covid-19 recovery in 2021",
      allergies: "Penicillin, Dust mites",
      currentMedications: "Cetirizine 10mg (SOS)",
    },
    {
      email: "aarav.mehta@gmail.com",
      name: "Aarav Mehta",
      phoneNo: "9871100223",
      age: 28,
      gender: "MALE" as const,
      address: "12/A, Koramangala 4th Block",
      pinCode: 560001,
      medicalHistory: "Borderline hypertension",
      allergies: "None",
      currentMedications: "Amlodipine 2.5mg daily",
    },
    {
      email: "pooja.sharma@gmail.com",
      name: "Pooja Sharma",
      phoneNo: "9810998877",
      age: 34,
      gender: "FEMALE" as const,
      address: "B-24, Vasant Kunj",
      pinCode: 110001,
      medicalHistory: "Occasional migraine",
      allergies: "Sulfa drugs",
      currentMedications: "Vitamin D3 supplements",
    },
  ];

  const createdPatients: Array<{ patientId: string; userId: string; email: string; name: string }> = [];

  for (const pat of patientsData) {
    const user = await prisma.user.create({
      data: {
        email: pat.email,
        phoneNo: pat.phoneNo,
        name: pat.name,
        password: defaultPasswordHash,
        age: pat.age,
        gender: pat.gender,
        role: "PATIENT",
        address: pat.address,
        pinCode: pat.pinCode,
        emailVerified: true,
        isActive: true,
      },
    });

    const patient = await prisma.patient.create({
      data: {
        userId: user.id,
        medicalHistory: pat.medicalHistory,
        allergies: pat.allergies,
        currentMedications: pat.currentMedications,
      },
    });

    createdPatients.push({
      patientId: patient.id,
      userId: user.id,
      email: pat.email,
      name: pat.name,
    });
  }
  console.log(`✓ Seeded ${createdPatients.length} patients with medical backgrounds`);

  // 6. SLOTS & LIVE APPOINTMENTS
  console.log("Generating initial slots and appointments...");
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const priyanshu = createdDoctors.find((d) => d.email === "priyanshu@gmail.com")!;
  const ananya = createdDoctors.find((d) => d.email === "ananya.iyer@gmail.com")!;
  const rajesh = createdDoctors.find((d) => d.email === "rajesh.verma@gmail.com")!;
  const karan = createdPatients.find((p) => p.email === "karan@gmail.com")!;
  const aarav = createdPatients.find((p) => p.email === "aarav.mehta@gmail.com")!;

  // Slot generator helper
  async function generateSlotsForDoctor(
    doctorId: string,
    date: Date,
    startHour: number,
    endHour: number,
    slotMinutes = 15
  ) {
    const slots = [];
    const current = new Date(date);
    current.setUTCHours(startHour, 0, 0, 0);

    const end = new Date(date);
    end.setUTCHours(endHour, 0, 0, 0);

    while (current < end) {
      const slotStart = new Date(current);
      current.setUTCMinutes(current.getUTCMinutes() + slotMinutes);
      const slotEnd = new Date(current);

      const slot = await prisma.slot.create({
        data: {
          doctorId,
          date,
          startTime: slotStart,
          endTime: slotEnd,
          status: "AVAILABLE",
        },
      });
      slots.push(slot);
    }
    return slots;
  }

  // Generate slots for today & tomorrow for key doctors
  const priyanshuSlotsToday = await generateSlotsForDoctor(priyanshu.doctorId, today, 9, 13);
  const priyanshuSlotsTomorrow = await generateSlotsForDoctor(priyanshu.doctorId, tomorrow, 9, 13);

  const ananyaSlotsToday = await generateSlotsForDoctor(ananya.doctorId, today, 10, 14);
  const rajeshSlotsToday = await generateSlotsForDoctor(rajesh.doctorId, today, 9, 12);

  // Appointment 1: Karan booked confirmed online appointment with Dr. Priyanshu
  if (priyanshuSlotsToday.length > 0) {
    const slot = priyanshuSlotsToday[0];
    await prisma.slot.update({
      where: { id: slot.id },
      data: { status: "BOOKED" },
    });

    const payment = await prisma.payment.create({
      data: {
        userId: karan.userId,
        amount: 70000,
        currency: "INR",
        status: "PAID",
        razorpayOrderId: "order_seed_001",
        razorpayPaymentId: "pay_seed_001",
      },
    });

    await prisma.appointment.create({
      data: {
        doctorId: priyanshu.doctorId,
        patientId: karan.patientId,
        slotId: slot.id,
        status: "CONFIRMED",
        paymentMethod: "ONLINE",
        transactionId: payment.id,
        notes: "Routine quarterly health checkup & blood sugar review.",
        isAppointmentOffline: false,
      },
    });
  }

  // Appointment 2: Aarav booked offline appointment with Dr. Ananya
  if (ananyaSlotsToday.length > 1) {
    const slot = ananyaSlotsToday[1];
    await prisma.slot.update({
      where: { id: slot.id },
      data: { status: "BOOKED" },
    });

    await prisma.appointment.create({
      data: {
        doctorId: ananya.doctorId,
        patientId: aarav.patientId,
        slotId: slot.id,
        status: "CONFIRMED",
        paymentMethod: "OFFLINE",
        notes: "Consultation for occasional palpitation during cardio workout.",
        isAppointmentOffline: true,
      },
    });
  }

  // Appointment 3: Completed past consultation for Karan with Dr. Rajesh
  if (rajeshSlotsToday.length > 0) {
    const slot = rajeshSlotsToday[0];
    await prisma.slot.update({
      where: { id: slot.id },
      data: { status: "BOOKED" },
    });

    await prisma.appointment.create({
      data: {
        doctorId: rajesh.doctorId,
        patientId: karan.patientId,
        slotId: slot.id,
        status: "COMPLETED",
        paymentMethod: "OFFLINE",
        notes: "Skin allergy rash consultation. Prescribed topical antihistamine.",
        isAppointmentOffline: true,
      },
    });
  }
  console.log("✓ Seeded realistic slots, payments, and appointments");

  // 7. DOCTOR-PATIENT RELATIONS & CHAT MESSAGES
  console.log("Seeding chat relationships & messages...");
  const relation1 = await prisma.doctorPatientRelation.create({
    data: {
      doctorsUserId: priyanshu.userId,
      patientsUserId: karan.userId,
    },
  });

  await prisma.chatMessages.createMany({
    data: [
      {
        doctorPatientRelationId: relation1.id,
        senderId: karan.userId,
        text: "Hello Dr. Priyanshu, looking forward to our consultation today.",
        createdAt: new Date(Date.now() - 3600000 * 3),
      },
      {
        doctorPatientRelationId: relation1.id,
        senderId: priyanshu.userId,
        text: "Hello Karan! Please have your latest fasting blood test report handy during the call.",
        createdAt: new Date(Date.now() - 3600000 * 2),
      },
      {
        doctorPatientRelationId: relation1.id,
        senderId: karan.userId,
        text: "Sure doctor, I have uploaded the PDF and will share it.",
        createdAt: new Date(Date.now() - 3600000 * 1),
      },
    ],
  });

  const relation2 = await prisma.doctorPatientRelation.create({
    data: {
      doctorsUserId: ananya.userId,
      patientsUserId: aarav.userId,
    },
  });

  await prisma.chatMessages.createMany({
    data: [
      {
        doctorPatientRelationId: relation2.id,
        senderId: aarav.userId,
        text: "Good morning Dr. Ananya, should I avoid morning coffee before the consultation?",
        createdAt: new Date(Date.now() - 7200000),
      },
      {
        doctorPatientRelationId: relation2.id,
        senderId: ananya.userId,
        text: "Good morning Aarav. Yes, please avoid high caffeine drinks 4 hours prior to our ECG.",
        createdAt: new Date(Date.now() - 3600000),
      },
    ],
  });
  console.log("✓ Seeded doctor-patient relations and message history");

  // 8. RATINGS & COMMENTS
  console.log("Seeding doctor reviews & ratings...");
  await prisma.rating.create({
    data: {
      doctorId: priyanshu.doctorId,
      patientId: karan.patientId,
      rating: 5,
    },
  });
  await prisma.comment.create({
    data: {
      doctorId: priyanshu.doctorId,
      patientId: karan.patientId,
      text: "Dr. Priyanshu is exceptional! Thorough diagnosis, empathetic listener, and very clear prescription advice.",
    },
  });

  await prisma.rating.create({
    data: {
      doctorId: rajesh.doctorId,
      patientId: karan.patientId,
      rating: 4,
    },
  });
  await prisma.comment.create({
    data: {
      doctorId: rajesh.doctorId,
      patientId: karan.patientId,
      text: "Great experience with Dr. Rajesh. The rash resolved within 3 days of following his prescribed ointment regimen.",
    },
  });

  await prisma.rating.create({
    data: {
      doctorId: ananya.doctorId,
      patientId: aarav.patientId,
      rating: 5,
    },
  });
  await prisma.comment.create({
    data: {
      doctorId: ananya.doctorId,
      patientId: aarav.patientId,
      text: "World-class cardiologist. Clear explanations and very reassuring approach.",
    },
  });
  console.log("✓ Seeded ratings and patient feedback comments");

  // 9. WITHDRAWALS
  console.log("Seeding doctor withdrawals...");
  await prisma.withdrawal.create({
    data: {
      doctorId: priyanshu.doctorId,
      amount: 500000, // ₹5,000 in paise
      status: "COMPLETED",
      razorpayPayoutId: "pout_seed_99812",
      processedAt: new Date(Date.now() - 86400000 * 2),
    },
  });

  await prisma.withdrawal.create({
    data: {
      doctorId: ananya.doctorId,
      amount: 1000000, // ₹10,000 in paise
      status: "PENDING",
    },
  });
  console.log("✓ Seeded withdrawal records");

  // 10. NOTIFICATIONS & LOGS
  console.log("Seeding notifications and audit logs...");
  await prisma.notification.createMany({
    data: [
      {
        userId: karan.userId,
        message: "Your appointment with Dr. Priyanshu Sharma is confirmed for today.",
        isRead: false,
        status: "UNREAD",
      },
      {
        userId: priyanshu.userId,
        message: "New confirmed appointment with patient Karan Aggarwal.",
        isRead: true,
        status: "READ",
        readAt: new Date(),
      },
    ],
  });

  await prisma.auditLog.createMany({
    data: [
      {
        userId: superAdminUser.id,
        action: "System Database Initialized",
        tag: "SYSTEM",
        metadata: { env: "development", seededAt: new Date().toISOString() },
      },
      {
        userId: opsAdminUser.id,
        action: "Admin Hierarchy Assigned",
        tag: "ONBOARDING",
        metadata: { managerId: superAdminRecord.id },
      },
    ],
  });

  await prisma.accessLog.createMany({
    data: [
      {
        userId: superAdminUser.id,
        action: "SUPER_ADMIN_LOGIN",
        tag: "AUTH",
      },
      {
        userId: karan.userId,
        action: "PATIENT_PORTAL_ACCESS",
        tag: "PORTAL",
      },
    ],
  });
  console.log("✓ Seeded notifications and audit/access logs");

  console.log("==========================================");
  console.log("  Database Reset & Seeding Completed Successfully!  ");
  console.log("==========================================");
  console.log("Demo Credentials:");
  console.log("  - Super Admin: harsh@gmail.com / karan166");
  console.log("  - Ops Admin:   admin.ops@quickclinic.com / karan166");
  console.log("  - Doctor 1:    priyanshu@gmail.com / karan166 (General Physician, Bangalore)");
  console.log("  - Doctor 2:    ananya.iyer@gmail.com / karan166 (Cardiologist, Delhi)");
  console.log("  - Doctor 3:    rajesh.verma@gmail.com / karan166 (Dermatologist, Faridabad)");
  console.log("  - Doctor 4:    sneha.patel@gmail.com / karan166 (Pediatrician, Gurugram)");
  console.log("  - Doctor 5:    vikram.rao@gmail.com / karan166 (Orthopedic, Mumbai)");
  console.log("  - Doctor 6:    meera.nambiar@gmail.com / karan166 (Neurologist, Hyderabad)");
  console.log("  - Doctor 7:    rohan.gupta@gmail.com / karan166 (Dentist, Noida)");
  console.log("  - Patient 1:   karan@gmail.com / karan166");
  console.log("  - Patient 2:   aarav.mehta@gmail.com / karan166");
  console.log("  - Patient 3:   pooja.sharma@gmail.com / karan166");
  console.log("==========================================");
}

main()
  .catch((e) => {
    console.error("Seeding error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
