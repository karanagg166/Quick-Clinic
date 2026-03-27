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
  console.log("Start seeding...");

  // ---------- LOCATIONS ----------
  const locations = [
    { pincode: 121004, city: "Faridabad", state: "Haryana" },
    { pincode: 560001, city: "Bangalore", state: "Karnataka" },
    { pincode: 110001, city: "New Delhi", state: "Delhi" },
  ];

  for (const loc of locations) {
    await prisma.location.upsert({
      where: { pincode: loc.pincode },
      update: {},
      create: loc,
    });
  }
  console.log("Locations seeded");

  // ---------- PATIENT ----------
  const patientEmail = "karan@gmail.com";
  const patientPlain = "karan166";
  const patientHashed = await hash(patientPlain, 10);

  const patientUser = await prisma.user.upsert({
    where: { email: patientEmail },
    update: {
      name: "Karan Aggarwal",
      phoneNo: "7838222130",
      age: 22,
      role: "PATIENT",
      gender: "MALE",
      pinCode: 121004,
    },
    create: {
      email: patientEmail,
      phoneNo: "7838222130",
      name: "Karan Aggarwal",
      password: patientHashed,
      age: 22,
      gender: "MALE",
      role: "PATIENT",
      address: "Flat 1, Example St",
      pinCode: 121004,
    },
  });

  console.log("User ensured for patient:", patientUser.id);

  // create / upsert patient row using userId
  await prisma.patient.upsert({
    where: { userId: patientUser.id },
    update: {
      medicalHistory: "coronavirus",
      allergies: "skin",
      currentMedications: "paracetamol",
    },
    create: {
      userId: patientUser.id,
      medicalHistory: "coronavirus",
      allergies: "skin",
      currentMedications: "paracetamol",
    },
  });

  console.log("Patient record ensured for user:", patientUser.id);

  // ---------- DOCTOR ----------
  const doctorEmail = "priyanshu@gmail.com";
  const doctorPlain = "priyanshu166";
  const doctorHashed = await hash(doctorPlain, 10);

  const doctorUser = await prisma.user.upsert({
    where: { email: doctorEmail },
    update: {
      name: "Dr. Priyanshu",
      phoneNo: "9520183169",
      age: 21,
      role: "DOCTOR",
      pinCode: 560001,
      gender: "MALE",
    },
    create: {
      email: doctorEmail,
      phoneNo: "9520183169",
      name: "Dr. Priyanshu",
      password: doctorHashed,
      age: 21,
      gender: "MALE",
      role: "DOCTOR",
      address: "Clinic St",
      pinCode: 560001,
    },
  });

  console.log("User ensured for doctor:", doctorUser.id);

  // create / upsert doctor row using userId
  const doctorRecord = await prisma.doctor.upsert({
    where: { userId: doctorUser.id },
    update: {
      specialty: "GENERAL_PHYSICIAN",
      experience: 12,
      fees: 700,
    },
    create: {
      userId: doctorUser.id,
      specialty: "GENERAL_PHYSICIAN",
      experience: 12,
      fees: 700,
    },
  });

  console.log("Doctor record ensured:", doctorRecord.id);

  // weekly schedule JSON
  const weeklySchedule = [
    {
      day: "Monday",
      slots: [
        { slotNo: 1, start: "09:00", end: "12:00" },
        { slotNo: 2, start: "16:00", end: "19:00" },
      ],
    },
    {
      day: "Tuesday",
      slots: [{ slotNo: 1, start: "09:00", end: "12:00" }],
    },
    { day: "Wednesday", slots: [] },
    {
      day: "Thursday",
      slots: [{ slotNo: 1, start: "10:00", end: "14:00" }],
    },
    {
      day: "Friday",
      slots: [
        { slotNo: 1, start: "09:00", end: "12:00" },
        { slotNo: 2, start: "16:00", end: "18:00" },
      ],
    },
    {
      day: "Saturday",
      slots: [{ slotNo: 1, start: "09:00", end: "13:00" }],
    },
    { day: "Sunday", slots: [] },
  ];

  // ensure schedule exists
  await prisma.schedule.upsert({
    where: { doctorId: doctorRecord.id },
    update: { weeklySchedule },
    create: { doctorId: doctorRecord.id, weeklySchedule },
  });

  console.log("Schedule ensured for doctor:", doctorRecord.id);

  // ---------- ADMIN (Super Admin) ----------
  const adminEmail = "harsh@gmail.com";
  const adminPlain = "harsh166"; // Change this in production!
  const adminHashed = await hash(adminPlain, 10);

  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      name: "Super Admin",
      phoneNo: "9999999999",
      age: 30,
      role: "ADMIN",
      gender: "BINARY",
      pinCode: 110001,
    },
    create: {
      email: adminEmail,
      phoneNo: "9999999999",
      name: "Super Admin",
      password: adminHashed,
      age: 30,
      gender: "BINARY",
      role: "ADMIN",
      address: "HQ",
      pinCode: 110001,
      isActive: true, // Super admin is active by default
    },
  });

  // Ensure Admin profile exists
  await prisma.admin.upsert({
    where: { userId: adminUser.id },
    update: {},
    create: {
      userId: adminUser.id,
    },
  });

  console.log("Super Admin ensured:", adminUser.id);

  console.log("Seeding finished.");
}

main()
  .catch((e) => {
    console.error("Seeding error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
