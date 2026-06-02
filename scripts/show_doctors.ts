import { prisma } from "../src/lib/prisma";

async function main() {
  const doctors = await prisma.doctor.findMany({
    include: {
      user: {
        include: {
          location: true
        }
      }
    }
  });

  console.log("All Doctors in database:");
  for (const doc of doctors) {
    console.log(`Doctor ID: ${doc.id}`);
    console.log(`Name: ${doc.user?.name}`);
    console.log(`Gender: ${doc.user?.gender}`);
    console.log(`Age: ${doc.user?.age}`);
    console.log(`Specialty: ${doc.specialty}`);
    console.log(`Experience: ${doc.experience}`);
    console.log(`Fees: ${doc.fees}`);
    console.log(`City: ${doc.user?.location?.city}`);
    console.log(`State: ${doc.user?.location?.state}`);
    console.log(`Pincode: ${doc.user?.pinCode}`);
    console.log("------------------------");
  }
}

main().finally(() => prisma.$disconnect());
