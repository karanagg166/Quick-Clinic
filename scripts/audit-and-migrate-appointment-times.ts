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
  console.log(`\n=== Quick-Clinic Appointment Time Audit ===`);
  console.log(`Mode: ${isApply ? 'APPLY MIGRATION (APPROVED)' : 'DRY-RUN AUDIT & BACKUP'}`);
  console.log(`Authoritative Timezone: ${DEFAULT_CLINIC_TIMEZONE}`);
  console.log(`Canonical Epoch Cutoff: ${CANONICAL_TIMEZONE_EPOCH.toISOString()}\n`);

  const slots = await prisma.slot.findMany({
    include: {
      appointments: {
        include: {
          doctor: { include: { user: { select: { name: true, email: true } } } },
          patient: { include: { user: { select: { name: true, email: true } } } },
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
  console.log(`- Legacy Booked Appointments: ${legacyBookedCount}`);
  console.log(`- Legacy Available/Unbooked Slots: ${legacyAvailableCount}`);
  console.log(`- Total Records Requiring Attention: ${auditItems.length}\n`);

  // Create backups directory
  const backupDir = path.resolve(__dirname, 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `appointment_slots_backup_${timestamp}.json`);
  fs.writeFileSync(backupFile, JSON.stringify({ slots, auditItems }, null, 2));
  console.log(`✓ Created pre-migration backup at: ${backupFile}`);

  if (auditItems.length > 0) {
    console.log(`\nSample Legacy Audit Items (first 5):`);
    console.log(JSON.stringify(auditItems.slice(0, 5), null, 2));
  }

  if (!isApply) {
    console.log(`\n[DRY RUN COMPLETE]`);
    console.log(`Authoritative appointments were PRESERVED without silent alteration.`);
    console.log(`To apply migration after reviewing backups, re-run with: --apply\n`);
    return;
  }

  // If approved apply:
  console.log(`\nApplying migration to ${auditItems.length} records in a single database transaction...`);
  await prisma.$transaction(async (tx) => {
    for (const item of auditItems) {
      await tx.slot.update({
        where: { id: item.slotId },
        data: {
          startTime: new Date(item.targetStartUtc),
          endTime: new Date(item.targetEndUtc),
        },
      });
    }
  });

  console.log(`✓ Migration applied successfully to ${auditItems.length} slots.`);
}

runAudit()
  .catch((err) => {
    console.error('Audit/Migration error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
