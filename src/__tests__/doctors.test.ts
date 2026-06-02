import test from "node:test";
import assert from "node:assert";
import { NextRequest } from "next/server";
import { GET } from "../app/api/doctors/route";

test("GET /api/doctors - retrieves all doctors when no filters are applied", async () => {
  const req = new NextRequest("http://localhost:3000/api/doctors");
  const res = await GET(req);
  assert.strictEqual(res.status, 200);

  const doctors = await res.json();
  assert.ok(Array.isArray(doctors));
  assert.ok(doctors.length > 0);
});

test("GET /api/doctors - filters by city (case-insensitive & trimmed)", async () => {
  const req = new NextRequest("http://localhost:3000/api/doctors?city=%20%20jabalpur%20%20");
  const res = await GET(req);
  assert.strictEqual(res.status, 200);

  const doctors = await res.json();
  assert.ok(Array.isArray(doctors));
  assert.ok(doctors.length > 0);
  doctors.forEach((doc: any) => {
    assert.strictEqual(doc.city.toLowerCase(), "jabalpur");
  });
});

test("GET /api/doctors - filters by state (case-insensitive & trimmed)", async () => {
  const req = new NextRequest("http://localhost:3000/api/doctors?state=%20%20madhya%20pradesh%20%20");
  const res = await GET(req);
  assert.strictEqual(res.status, 200);

  const doctors = await res.json();
  assert.ok(Array.isArray(doctors));
  assert.ok(doctors.length > 0);
  doctors.forEach((doc: any) => {
    assert.strictEqual(doc.state.toLowerCase(), "madhya pradesh");
  });
});

test("GET /api/doctors - filters by doctor name (case-insensitive & trimmed)", async () => {
  const req = new NextRequest("http://localhost:3000/api/doctors?name=%20%20priyanshu%20%20");
  const res = await GET(req);
  assert.strictEqual(res.status, 200);

  const doctors = await res.json();
  assert.ok(Array.isArray(doctors));
  assert.ok(doctors.length > 0);
  doctors.forEach((doc: any) => {
    assert.ok(doc.name.toLowerCase().includes("priyanshu"));
  });
});

test("GET /api/doctors - filters by specialty (case-insensitive)", async () => {
  const req = new NextRequest("http://localhost:3000/api/doctors?specialization=pediatrician");
  const res = await GET(req);
  assert.strictEqual(res.status, 200);

  const doctors = await res.json();
  assert.ok(Array.isArray(doctors));
  assert.ok(doctors.length > 0);
  doctors.forEach((doc: any) => {
    assert.strictEqual(doc.specialty, "PEDIATRICIAN");
  });
});

test("GET /api/doctors - ignores specialty when value is 'all'", async () => {
  const req = new NextRequest("http://localhost:3000/api/doctors?specialization=all");
  const res = await GET(req);
  assert.strictEqual(res.status, 200);

  const doctors = await res.json();
  assert.ok(Array.isArray(doctors));
  // Should return all doctors
  assert.ok(doctors.length > 1);
});

test("GET /api/doctors - filters by gender", async () => {
  const req = new NextRequest("http://localhost:3000/api/doctors?gender=male");
  const res = await GET(req);
  assert.strictEqual(res.status, 200);

  const doctors = await res.json();
  assert.ok(Array.isArray(doctors));
  assert.ok(doctors.length > 0);
  doctors.forEach((doc: any) => {
    assert.strictEqual(doc.gender, "MALE");
  });
});

test("GET /api/doctors - ignores gender when value is 'all'", async () => {
  const req = new NextRequest("http://localhost:3000/api/doctors?gender=all");
  const res = await GET(req);
  assert.strictEqual(res.status, 200);

  const doctors = await res.json();
  assert.ok(Array.isArray(doctors));
  assert.ok(doctors.length > 1);
});

test("GET /api/doctors - filters by min fees (greater than or equal)", async () => {
  const req = new NextRequest("http://localhost:3000/api/doctors?minFees=800");
  const res = await GET(req);
  assert.strictEqual(res.status, 200);

  const doctors = await res.json();
  assert.ok(Array.isArray(doctors));
  assert.ok(doctors.length > 0);
  doctors.forEach((doc: any) => {
    assert.ok(doc.fees >= 800);
  });
});

test("GET /api/doctors - filters by max fees (less than or equal)", async () => {
  const req = new NextRequest("http://localhost:3000/api/doctors?maxFees=800");
  const res = await GET(req);
  assert.strictEqual(res.status, 200);

  const doctors = await res.json();
  assert.ok(Array.isArray(doctors));
  assert.ok(doctors.length > 0);
  doctors.forEach((doc: any) => {
    assert.ok(doc.fees <= 800);
  });
});

test("GET /api/doctors - filters by fees range (minFees & maxFees)", async () => {
  const req = new NextRequest("http://localhost:3000/api/doctors?minFees=700&maxFees=2000");
  const res = await GET(req);
  assert.strictEqual(res.status, 200);

  const doctors = await res.json();
  assert.ok(Array.isArray(doctors));
  assert.ok(doctors.length > 0);
  doctors.forEach((doc: any) => {
    assert.ok(doc.fees >= 700 && doc.fees <= 2000);
  });
});

test("GET /api/doctors - filters by min experience (greater than or equal)", async () => {
  const req = new NextRequest("http://localhost:3000/api/doctors?minExperience=15");
  const res = await GET(req);
  assert.strictEqual(res.status, 200);

  const doctors = await res.json();
  assert.ok(Array.isArray(doctors));
  assert.ok(doctors.length > 0);
  doctors.forEach((doc: any) => {
    assert.ok(doc.experience >= 15);
  });
});

test("GET /api/doctors - filters by max experience (less than or equal)", async () => {
  const req = new NextRequest("http://localhost:3000/api/doctors?maxExperience=15");
  const res = await GET(req);
  assert.strictEqual(res.status, 200);

  const doctors = await res.json();
  assert.ok(Array.isArray(doctors));
  assert.ok(doctors.length > 0);
  doctors.forEach((doc: any) => {
    assert.ok(doc.experience <= 15);
  });
});

test("GET /api/doctors - filters by experience range (minExperience & maxExperience)", async () => {
  const req = new NextRequest("http://localhost:3000/api/doctors?minExperience=5&maxExperience=20");
  const res = await GET(req);
  assert.strictEqual(res.status, 200);

  const doctors = await res.json();
  assert.ok(Array.isArray(doctors));
  assert.ok(doctors.length > 0);
  doctors.forEach((doc: any) => {
    assert.ok(doc.experience >= 5 && doc.experience <= 20);
  });
});

test("GET /api/doctors - filters by exact age", async () => {
  const req = new NextRequest("http://localhost:3000/api/doctors?age=21");
  const res = await GET(req);
  assert.strictEqual(res.status, 200);

  const doctors = await res.json();
  assert.ok(Array.isArray(doctors));
  assert.ok(doctors.length > 0);
  doctors.forEach((doc: any) => {
    assert.strictEqual(doc.age, 21);
  });
});

test("GET /api/doctors - handles non-numeric age, fees, and experience gracefully", async () => {
  const req = new NextRequest("http://localhost:3000/api/doctors?age=invalid&minFees=invalid&maxFees=invalid&minExperience=invalid&maxExperience=invalid");
  const res = await GET(req);
  assert.strictEqual(res.status, 200);

  const doctors = await res.json();
  assert.ok(Array.isArray(doctors));
  // Should bypass invalid inputs and return all doctors
  assert.ok(doctors.length > 1);
});
