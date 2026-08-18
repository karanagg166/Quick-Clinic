import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { seedPart2Dataset, cleanupPart2Dataset, Part2Dataset } from '@/__tests__/helpers/part2-dataset';

describe('Phase 1 — Realistic Test Environment and Data Verification Suite', () => {
  let dataset: Part2Dataset;

  beforeAll(async () => {
    dataset = await seedPart2Dataset();
  });

  afterAll(async () => {
    if (dataset) {
      await cleanupPart2Dataset(dataset);
    }
  });

  it('1.1 Seeds 1 Super Admin and 2 Sub-Admins with proper hierarchy', async () => {
    expect(dataset.superAdmin).toBeDefined();
    expect(dataset.superAdmin.role).toBe('ADMIN');

    const superAdminInDb = await prisma.admin.findUnique({
      where: { userId: dataset.superAdmin.id },
      include: { subAdmins: true },
    });
    expect(superAdminInDb).not.toBeNull();
    expect(superAdminInDb?.managerId).toBeNull();
    expect(superAdminInDb?.subAdmins.length).toBe(2);

    expect(dataset.subAdmins.length).toBe(2);
    for (const subAdmin of dataset.subAdmins) {
      const subInDb = await prisma.admin.findUnique({
        where: { userId: subAdmin.id },
      });
      expect(subInDb).not.toBeNull();
      expect(subInDb?.managerId).toBe(superAdminInDb?.id);
    }
  });

  it('1.2 Seeds at least 6 diverse Doctors with distinct specialties, locations, and schedules', async () => {
    expect(dataset.doctors.length).toBe(6);

    const specialties = new Set(dataset.doctors.map((d) => d.specialty));
    expect(specialties.size).toBe(6);
    expect(specialties.has('CARDIOLOGIST')).toBe(true);
    expect(specialties.has('DERMATOLOGIST')).toBe(true);
    expect(specialties.has('GENERAL_PHYSICIAN')).toBe(true);
    expect(specialties.has('PEDIATRICIAN')).toBe(true);
    expect(specialties.has('ORTHOPEDIC')).toBe(true);
    expect(specialties.has('PSYCHIATRIST')).toBe(true);

    const cities = new Set(dataset.doctors.map((d) => d.city));
    expect(cities.size).toBeGreaterThanOrEqual(3);

    // Verify qualifications in DB
    for (const doc of dataset.doctors) {
      const dbDoc = await prisma.doctor.findUnique({
        where: { id: doc.doctorId },
        include: {
          doctorQualifications: true,
          schedule: true,
          leaves: true,
        },
      });
      expect(dbDoc).not.toBeNull();
      expect(dbDoc?.doctorQualifications.length).toBeGreaterThan(0);
      expect(dbDoc?.fees).toBe(doc.fees);
      expect(dbDoc?.balance).toBe(doc.balance);

      if (doc.scheduleType === 'LEAVE_SCHEDULED') {
        expect(dbDoc?.leaves.length).toBeGreaterThan(0);
      }
    }
  });

  it('1.3 Seeds at least 8 diverse Patients with distinct medical records', async () => {
    expect(dataset.patients.length).toBe(8);

    const emails = new Set(dataset.patients.map((p) => p.email));
    expect(emails.size).toBe(8);

    for (const patient of dataset.patients) {
      const dbPatient = await prisma.patient.findUnique({
        where: { id: patient.patientId },
        include: { user: true },
      });
      expect(dbPatient).not.toBeNull();
      expect(dbPatient?.medicalHistory).toBe(patient.medicalHistory);
      expect(dbPatient?.allergies).toBe(patient.allergies);
      expect(dbPatient?.user.role).toBe('PATIENT');
    }
  });

  it('1.4 Verifies scoped test run ID isolation', () => {
    expect(dataset.runId).toMatch(/^p2_[a-z0-9]+_[a-z0-9]+$/);
    expect(dataset.superAdmin.email).toContain(dataset.runId);
    expect(dataset.doctors[0].email).toContain(dataset.runId);
    expect(dataset.patients[0].email).toContain(dataset.runId);
  });
});
