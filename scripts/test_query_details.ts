import { prisma } from "../src/lib/prisma";

async function runApiQuery(queryParams: Record<string, string>) {
  const searchParams = {
    get: (key: string) => queryParams[key] || null
  };

  const filters: any = {};
  const userFilters: any = {};
  const locationFilters: any = {};

  if (searchParams.get("name")) {
    userFilters.name = {
      contains: searchParams.get("name") as string,
      mode: "insensitive",
    };
  }

  if (searchParams.get("city")) {
    locationFilters.city = {
      contains: searchParams.get("city") as string,
      mode: "insensitive",
    };
  }

  if (searchParams.get("state")) {
    locationFilters.state = {
      contains: searchParams.get("state") as string,
      mode: "insensitive",
    };
  }

  if (Object.keys(locationFilters).length > 0) {
    userFilters.location = locationFilters;
  }

  const genderInput = searchParams.get("gender");
  if (genderInput && genderInput !== "all") {
    const genderUpper = genderInput.toUpperCase();
    userFilters.gender = genderUpper;
  }

  if (searchParams.get("age")) {
    userFilters.age = Number(searchParams.get("age"));
  }

  if (Object.keys(userFilters).length > 0) {
    filters.user = userFilters;
  }

  const specialtyVal = searchParams.get("specialty") || searchParams.get("specialization");
  if (specialtyVal && specialtyVal !== "all") {
    const specialtyUpper = specialtyVal.toUpperCase();
    filters.specialty = specialtyUpper;
  }

  if (searchParams.get("fees")) {
    filters.fees = { lte: Number(searchParams.get("fees")) };
  }

  if (searchParams.get("experience")) {
    filters.experience = { gte: Number(searchParams.get("experience")) };
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

  console.log(`Params: ${JSON.stringify(queryParams)} -> found ${raw.length} doctors.`);
  for (const doc of raw) {
    console.log(`  Name: ${doc.user?.name}, City: ${doc.user?.location?.city}, Specialty: ${doc.specialty}`);
  }
}

async function main() {
  await runApiQuery({ city: "Jabalpur" });
  await runApiQuery({ city: "Bangalore" });
  await runApiQuery({ specialization: "PEDIATRICIAN" });
  await runApiQuery({ name: "Harsh" });
  await runApiQuery({ experience: "15" });
  await runApiQuery({ fees: "800" });
}

main().finally(() => prisma.$disconnect());
