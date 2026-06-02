import { prisma } from "./prisma";

async function main() {
  try {
    const doctors = await prisma.doctor.findMany({
      include: {
        user: {
          include: {
            location: true,
          }
        }
      }
    });
    console.log("Doctors list in DB:");
    console.log(JSON.stringify(doctors, null, 2));
  } catch (err) {
    console.error("Error querying doctors:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
