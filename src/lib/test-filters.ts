import { prisma } from "./prisma";
import { Gender } from "../generated/prisma";

async function runTest(label: string, filters: any) {
  try {
    const raw = await prisma.doctor.findMany({
      where: filters,
      include: {
        user: {
          include: {
            location: true,
          }
        }
      }
    });
    console.log(`\n--- ${label} ---`);
    console.log(`Filters applied:`, JSON.stringify(filters));
    console.log(`Results found: ${raw.length}`);
    raw.forEach((d: any) => {
      console.log(`- Doctor ${d.user.name}: Fees ${d.fees}, Exp ${d.experience}, Gender ${d.user.gender}`);
    });
  } catch (err) {
    console.error(`Error in ${label}:`, err);
  }
}

async function main() {
  // Test 1: Empty filters
  await runTest("Empty Filters", {});

  // Test 2: Gender filter MALE
  await runTest("Gender MALE", {
    user: {
      gender: "MALE"
    }
  });

  // Test 3: Gender filter FEMALE
  await runTest("Gender FEMALE", {
    user: {
      gender: "FEMALE"
    }
  });

  // Test 4: Fees <= 800
  await runTest("Fees <= 800", {
    fees: { lte: 800 }
  });

  // Test 5: Experience >= 10
  await runTest("Experience >= 10", {
    experience: { gte: 10 }
  });

  // Test 6: Combined Fees <= 800 AND Experience >= 10
  await runTest("Fees <= 800 AND Experience >= 10", {
    fees: { lte: 800 },
    experience: { gte: 10 }
  });

  await prisma.$disconnect();
}

main();
