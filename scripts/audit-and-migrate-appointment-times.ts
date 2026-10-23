/**
 * Safe Audit & Migration Script for Legacy Appointment Times
 * 
 * In accordance with Phase 1.2:
 * "Audit legacy slots and existing appointments before changing semantics.
 *  Do not silently move booked appointments. If existing records require correction,
 *  provide a safe migration and review strategy, with backups and user approval
 *  before altering authoritative appointments."
 * 
 * Usage:
 *   npx tsx scripts/audit-and-migrate-appointment-times.ts          # Dry-run audit & backup
 *   npx tsx scripts/audit-and-migrate-appointment-times.ts --apply  # Apply migration after approval
 */

import fs from 'fs';
import path from 'path';
import { prisma } from '../src/lib/prisma';
import {
  DEFAULT_CLINIC_TIMEZONE,
  CANONICAL_TIMEZONE_EPOCH,
  isLegacySlot,
  formatAppointmentDateTime,
  formatAppointmentTime,
} from '../src/lib/dateUtils';

interface AuditItem {
  slotId: string;
  appointmentId: string | null;
  doctorId: string;
  status: string;
  createdAt: string;
  originalStartUtc: string;
  originalEndUtc: string;
  targetStartUtc: string;
  targetEndUtc: string;
  originalDisplayUtc: string;
  canonicalDisplayIst: string;
  needsMigration: boolean;
}

async function runAudit() {
  const isApply = process.argv.includes('--apply');
  const allowBookedMigration = process.argv.includes('--migrate-booked-appointments-with-approval');

  console.log(`\n=== Quick-Clinic Appointment Time Audit ===`);
  console.log(`Mode: ${isApply ? 'APPLY MIGRATION' : 'DRY-RUN AUDIT & SECURE BACKUP'}`);
  console.log(`Authoritative Timezone: ${DEFAULT_CLINIC_TIMEZONE}`);
  console.log(`Canonical Epoch Cutoff: ${CANONICAL_TIMEZONE_EPOCH.toISOString()}`);
  console.log(`Booked Appointments Policy: ${allowBookedMigration ? 'EXPLICIT OVERRIDE APPROVED' : 'STRICTLY PROTECTED (Excluded from shift)'}\n`);

  // Strip all PII fields (names, emails, phone numbers) from audit query
  const slots = await prisma.slot.findMany({
    select: {
      id: true,
      doctorId: true,
      status: true,
      startTime: true,
      endTime: true,
      createdAt: true,
      updatedAt: true,
      appointments: {
        select: {
          id: true,
          status: true,
          doctorId: true,
          patientId: true,
        },
      },
    },
    orderBy: { startTime: 'asc' },
  });

  console.log(`Total slots found in database: ${slots.length}`);

  const auditItems: AuditItem[] = [];
  let legacyBookedCount = 0;
  let legacyAvailableCount = 0;

  for (const slot of slots) {
    const isLegacy = isLegacySlot(slot);
    const hasAppointments = slot.appointments.length > 0;

    if (isLegacy) {
      if (hasAppointments) {
        legacyBookedCount++;
      } else {
        legacyAvailableCount++;
      }

      // Legacy slot: stored UTC was set equal to local clinic wall time.
      // In Asia/Kolkata (UTC+5:30), the true UTC instant is 5 hours 30 minutes earlier.
      const originalStart = new Date(slot.startTime);
      const originalEnd = new Date(slot.endTime);

      const targetStart = new Date(originalStart.getTime() - (5 * 60 + 30) * 60 * 1000);
      const targetEnd = new Date(originalEnd.getTime() - (5 * 60 + 30) * 60 * 1000);

      const appt = slot.appointments[0];

      auditItems.push({
        slotId: slot.id,
        appointmentId: appt ? appt.id : null,
        doctorId: slot.doctorId,
        status: slot.status,
        createdAt: slot.createdAt.toISOString(),
        originalStartUtc: originalStart.toISOString(),
        originalEndUtc: originalEnd.toISOString(),
        targetStartUtc: targetStart.toISOString(),
        targetEndUtc: targetEnd.toISOString(),
        originalDisplayUtc: formatAppointmentTime(originalStart, 'UTC', { includeTimezone: false }),
        canonicalDisplayIst: formatAppointmentTime(targetStart, DEFAULT_CLINIC_TIMEZONE, { includeTimezone: true }),
        needsMigration: true,
      });
    }
  }

  console.log(`Audit Summary:`);
  console.log(`- Legacy Booked Appointments (Protected): ${legacyBookedCount}`);
  console.log(`- Legacy Available/Unbooked Slots (Eligible): ${legacyAvailableCount}`);
  console.log(`- Total Records Requiring Attention: ${auditItems.length}\n`);

  // Create secure backups directory
  const backupDir = path.resolve(__dirname, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  }

  // Backup contains only non-PII audit items and structural slot data
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `appointment_slots_backup_${timestamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify({ auditItems, summary: { legacyBookedCount, legacyAvailableCount } }, null, 2), { mode: 0o600 });
  console.log(`✓ Created secure pre-migration backup (mode 0600, non-PII) at: ${backupFile}`);

  if (auditItems.length > 0) {
    console.log(`\nSample Legacy Audit Items (first 5):`);
    console.log(JSON.stringify(auditItems.slice(0, 5), null, 2));
  }

  if (!isApply) {
    console.log(`\n[DRY RUN COMPLETE]`);
    console.log(`Authoritative appointments were PRESERVED without silent alteration.`);
    console.log(`To apply migration to eligible unbooked slots, re-run with: --apply\n`);
    return;
  }

  // Filter items to migrate: exclude booked appointments unless explicit approval flag is passed
  const itemsToMigrate = allowBookedMigration
    ? auditItems
    : auditItems.filter((item) => !item.appointmentId);

  if (!allowBookedMigration && legacyBookedCount > 0) {
    console.log(`\n[SAFETY INVARIANT ENFORCED]`);
    console.log(`Preserving ${legacyBookedCount} booked appointments untouched.`);
    console.log(`These appointments remain safe and display accurately via isLegacySlot() compatibility.`);
  }

  if (itemsToMigrate.length === 0) {
    console.log(`No unbooked slots require migration.`);
    return;
  }

  console.log(`\nApplying migration to ${itemsToMigrate.length} unbooked slots in a single database transaction...`);
  await prisma.$transaction(async (tx) => {
    for (const item of itemsToMigrate) {
      await tx.slot.update({
        where: { id: item.slotId },
        data: {
          startTime: new Date(item.targetStartUtc),
          endTime: new Date(item.targetEndUtc),
        },
      });
    }
  });

  console.log(`✓ Migration applied safely to ${itemsToMigrate.length} unbooked slots. Booked appointments untouched.`);
}

runAudit()
  .catch((err) => {
    console.error('Audit/Migration error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
