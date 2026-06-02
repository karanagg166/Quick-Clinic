import { prisma } from "../src/lib/prisma";

async function testFilter(searchParams: any) {
  try {
    const filters: any = {};
    const userFilters: any = {};
    const locationFilters: any = {};

    if (searchParams.name) {
      userFilters.name = {
        contains: searchParams.name,
        mode: "insensitive",
      };
    }

    if (searchParams.city) {
      locationFilters.city = {
        contains: searchParams.city,
        mode: "insensitive",
      };
    }

    if (searchParams.state) {
      locationFilters.state = {
        contains: searchParams.state,
        mode: "insensitive",
      };
    }

    if (Object.keys(locationFilters).length > 0) {
      userFilters.location = locationFilters;
    }

    if (searchParams.gender) {
      userFilters.gender = searchParams.gender;
    }

    if (searchParams.age) {
      userFilters.age = Number(searchParams.age);
    }

    if (Object.keys(userFilters).length > 0) {
      filters.user = userFilters;
    }

    if (searchParams.specialization) {
      filters.specialty = searchParams.specialization;
    }

    if (searchParams.fees) {
      filters.fees = { lte: Number(searchParams.fees) };
    }

    if (searchParams.experience) {
      filters.experience = { gte: Number(searchParams.experience) };
    }

    const raw = await prisma.doctor.findMany({
      where: filters,
      include: {
        user: {
          include: {
            location: true,
          }
        },
        doctorQualifications: true
      }
    });

    console.log(`Query for ${JSON.stringify(searchParams)}: found ${raw.length} doctors.`);
  } catch (e) {
    console.error(`Error for ${JSON.stringify(searchParams)}:`, e);
  }
}

async function main() {
  await testFilter({});
  await testFilter({ city: "Bangalore" });
  await testFilter({ city: "Delhi" });
  await testFilter({ name: "Priyanshu" });
  await testFilter({ gender: "MALE" });
  await testFilter({ gender: "FEMALE" });
  await testFilter({ specialization: "GENERAL_PHYSICIAN" });
  await testFilter({ fees: 1000 });
  await testFilter({ fees: 500 });
  await testFilter({ experience: 10 });
  await testFilter({ experience: 15 });
  await testFilter({ age: 21 });
  await testFilter({ age: 30 });
  await prisma.$disconnect();
}

main();
