import { test, expect } from "vitest";
import { GET as specializationsGET } from "@/app/api/doctors/specializations/route";
import { GET as qualificationsGET } from "@/app/api/doctors/qualifications/route";
import { NextRequest } from "next/server";

test("GET /api/doctors/specializations - returns array of medical specializations", async () => {
  const res = await specializationsGET();
  expect(res.status).toBe(200);

  const data = await res.json();
  expect(data.specialties).toBeDefined();
  expect(Array.isArray(data.specialties)).toBe(true);
  expect(data.specialties).toContain("CARDIOLOGIST");
  expect(data.specialties).toContain("PEDIATRICIAN");
  expect(data.specialties).toContain("GENERAL_PHYSICIAN");
});

test("GET /api/doctors/qualifications - returns array of medical qualifications", async () => {
  const req = new NextRequest("http://localhost:3000/api/doctors/qualifications");
  const res = await qualificationsGET(req);
  expect(res.status).toBe(200);

  const data = await res.json();
  expect(data.qualifications).toBeDefined();
  expect(Array.isArray(data.qualifications)).toBe(true);
  expect(data.qualifications).toContain("MBBS");
  expect(data.qualifications).toContain("MD");
});
