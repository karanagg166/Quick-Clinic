// prisma/seed.ts
import { PrismaClient } from "../src/generated/prisma/client.js";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("Start seeding...");

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
      city: "Faridabad",
      state: "Haryana",
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
      city: "Faridabad",
      state: "Haryana",
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
      city: "Faridabad",
      state: "Haryana",
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
      city: "Faridabad",
      state: "Haryana",
      pinCode: 560001,
    },
  });

  console.log("User ensured for doctor:", doctorUser.id);

  // create / upsert doctor row using userId
  await prisma.doctor.upsert({
    where: { userId: doctorUser.id },
    update: {
      specialty: "GENERAL_PHYSICIAN",
      experience: 12,
      qualifications: ["MBBS", "MD"],
      fees: 700,
    },
    create: {
      userId: doctorUser.id,
      specialty: "GENERAL_PHYSICIAN",
      experience: 12,
      qualifications: ["MBBS", "MD"],
      fees: 700,
    },
  });

  console.log("Doctor record ensured for user:", doctorUser.id);

  // weekly schedule JSON
  const weeklySchedule = {
    monday: [
      { start: "09:00", end: "12:00" },
      { start: "16:00", end: "19:00" },
    ],
    tuesday: [{ start: "09:00", end: "12:00" }],
    wednesday: [],
    thursday: [{ start: "10:00", end: "14:00" }],
    friday: [
      { start: "09:00", end: "12:00" },
      { start: "16:00", end: "18:00" },
    ],
    saturday: [{ start: "09:00", end: "13:00" }],
    sunday: [],
  };

  // ensure schedule exists
  await prisma.schedule.upsert({
    where: { doctorId: doctorUser.id },
    update: { weeklySchedule },
    create: { doctorId: doctorUser.id, weeklySchedule },
  });

  console.log("Schedule ensured for doctor:", doctorUser.id);

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
