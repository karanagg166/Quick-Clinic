import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as doctorsGET } from '@/app/api/doctors/route';
import { seedPart2Dataset, cleanupPart2Dataset, Part2Dataset } from '@/__tests__/helpers/part2-dataset';

describe('Phase 4 — Doctor Search & Filter Testing Suite', () => {
  let dataset: Part2Dataset;

  beforeAll(async () => {
    dataset = await seedPart2Dataset();
  });

  afterAll(async () => {
    if (dataset) {
      await cleanupPart2Dataset(dataset);
    }
  });

  // --------------------------------------------------------------------------
  // 4.1 Specialty Filtering
  // --------------------------------------------------------------------------
  describe('4.1 Specialty Filtering', () => {
    it('4.1.1 Returns only doctors matching single specialty (CARDIOLOGIST)', async () => {
      const req = new NextRequest('http://localhost:3000/api/doctors?specialty=CARDIOLOGIST');
      const res = await doctorsGET(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      const doctors = Array.isArray(data) ? data : data.doctors;
      expect(doctors.length).toBeGreaterThanOrEqual(1);
      expect(doctors.every((d: any) => d.specialty === 'CARDIOLOGIST')).toBe(true);
    });

    it('4.1.2 Case-insensitivity: lowercase "dermatologist" matches DERMATOLOGIST', async () => {
      const req = new NextRequest('http://localhost:3000/api/doctors?specialty=dermatologist');
      const res = await doctorsGET(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      const doctors = Array.isArray(data) ? data : data.doctors;
      expect(doctors.length).toBeGreaterThanOrEqual(1);
      expect(doctors.every((d: any) => d.specialty === 'DERMATOLOGIST')).toBe(true);
    });

    it('4.1.3 Alias support: "specialization" query parameter works identically to "specialty"', async () => {
      const req = new NextRequest('http://localhost:3000/api/doctors?specialization=PEDIATRICIAN');
      const res = await doctorsGET(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      const doctors = Array.isArray(data) ? data : data.doctors;
      expect(doctors.length).toBeGreaterThanOrEqual(1);
      expect(doctors.every((d: any) => d.specialty === 'PEDIATRICIAN')).toBe(true);
    });

    it('4.1.4 "all" specialty parameter returns unfiltered list', async () => {
      const req = new NextRequest('http://localhost:3000/api/doctors?specialty=all');
      const res = await doctorsGET(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      const doctors = Array.isArray(data) ? data : data.doctors;
      expect(doctors.length).toBeGreaterThanOrEqual(6);
    });
  });

  // --------------------------------------------------------------------------
  // 4.2 Name & Text Search
  // --------------------------------------------------------------------------
  describe('4.2 Name & Text Search', () => {
    it('4.2.1 Finds doctor by prefix search (e.g. "Amit")', async () => {
      const req = new NextRequest('http://localhost:3000/api/doctors?name=Amit');
      const res = await doctorsGET(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      const doctors = Array.isArray(data) ? data : data.doctors;
      expect(doctors.length).toBeGreaterThanOrEqual(1);
      expect(doctors.some((d: any) => d.name.includes('Amit'))).toBe(true);
    });

    it('4.2.2 Case-insensitive partial name search (e.g. "priya")', async () => {
      const req = new NextRequest('http://localhost:3000/api/doctors?name=priya');
      const res = await doctorsGET(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      const doctors = Array.isArray(data) ? data : data.doctors;
      expect(doctors.length).toBeGreaterThanOrEqual(1);
      expect(doctors.some((d: any) => d.name.toLowerCase().includes('priya'))).toBe(true);
    });

    it('4.2.3 Returns empty array when searching nonexistent doctor name', async () => {
      const req = new NextRequest('http://localhost:3000/api/doctors?name=NonexistentDoctorX99');
      const res = await doctorsGET(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      const doctors = Array.isArray(data) ? data : data.doctors;
      expect(doctors.length).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // 4.3 Fee Range Filtering
  // --------------------------------------------------------------------------
  describe('4.3 Fee Range Filtering', () => {
    it('4.3.1 Filter by maxFees (<= 500)', async () => {
      const req = new NextRequest('http://localhost:3000/api/doctors?maxFees=500');
      const res = await doctorsGET(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      const doctors = Array.isArray(data) ? data : data.doctors;
      expect(doctors.length).toBeGreaterThanOrEqual(1);
      expect(doctors.every((d: any) => d.fees <= 500)).toBe(true);
    });

    it('4.3.2 Filter by minFees (>= 800)', async () => {
      const req = new NextRequest('http://localhost:3000/api/doctors?minFees=800');
      const res = await doctorsGET(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      const doctors = Array.isArray(data) ? data : data.doctors;
      expect(doctors.length).toBeGreaterThanOrEqual(1);
      expect(doctors.every((d: any) => d.fees >= 800)).toBe(true);
    });

    it('4.3.3 Filter by bounded range (minFees=400 & maxFees=700)', async () => {
      const req = new NextRequest('http://localhost:3000/api/doctors?minFees=400&maxFees=700');
      const res = await doctorsGET(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      const doctors = Array.isArray(data) ? data : data.doctors;
      expect(doctors.length).toBeGreaterThanOrEqual(1);
      expect(doctors.every((d: any) => d.fees >= 400 && d.fees <= 700)).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 4.4 Experience & Demographics Filtering
  // --------------------------------------------------------------------------
  describe('4.4 Experience & Demographics Filtering', () => {
    it('4.4.1 Filter by minExperience (>= 10 years)', async () => {
      const req = new NextRequest('http://localhost:3000/api/doctors?minExperience=10');
      const res = await doctorsGET(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      const doctors = Array.isArray(data) ? data : data.doctors;
      expect(doctors.length).toBeGreaterThanOrEqual(1);
      expect(doctors.every((d: any) => d.experience >= 10)).toBe(true);
    });

    it('4.4.2 Filter by doctor gender (FEMALE)', async () => {
      const req = new NextRequest('http://localhost:3000/api/doctors?gender=FEMALE');
      const res = await doctorsGET(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      const doctors = Array.isArray(data) ? data : data.doctors;
      expect(doctors.length).toBeGreaterThanOrEqual(1);
      expect(doctors.every((d: any) => d.gender === 'FEMALE')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // 4.5 Location, Coordinates & Distance Sorting
  // --------------------------------------------------------------------------
  describe('4.5 Location, Coordinates & Distance Sorting', () => {
    it('4.5.1 Rejects invalid coordinates (lat > 90) with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/doctors?lat=95.5&lng=77.2');
      const res = await doctorsGET(req);
      expect(res.status).toBe(400);

      const data = await res.json();
      expect(data.error).toMatch(/between -90 and 90/i);
    });

    it('4.5.2 Rejects invalid coordinates (lng < -180) with 400 Bad Request', async () => {
      const req = new NextRequest('http://localhost:3000/api/doctors?lat=28.6&lng=-185.0');
      const res = await doctorsGET(req);
      expect(res.status).toBe(400);
    });

    it('4.5.3 Valid coordinates calculate distanceKm and sort doctors nearest first', async () => {
      // Patient at Connaught Place, New Delhi (28.6315, 77.2167)
      const req = new NextRequest('http://localhost:3000/api/doctors?lat=28.6315&lng=77.2167');
      const res = await doctorsGET(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.distanceUnavailable).toBe(false);
      expect(Array.isArray(data.doctors)).toBe(true);

      const docsWithDistance = data.doctors.filter((d: any) => typeof d.distanceKm === 'number');
      expect(docsWithDistance.length).toBeGreaterThan(0);

      // Verify sorted in ascending order of distance
      for (let i = 0; i < docsWithDistance.length - 1; i++) {
        expect(docsWithDistance[i].distanceKm).toBeLessThanOrEqual(docsWithDistance[i + 1].distanceKm);
      }
    });

    it('4.5.4 City filter matches doctors in Delhi', async () => {
      const req = new NextRequest('http://localhost:3000/api/doctors?city=Delhi');
      const res = await doctorsGET(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      const doctors = Array.isArray(data) ? data : data.doctors;
      expect(doctors.length).toBeGreaterThanOrEqual(1);
    });
  });

  // --------------------------------------------------------------------------
  // 4.6 Combined Complex Filtering
  // --------------------------------------------------------------------------
  describe('4.6 Combined Complex Filtering', () => {
    it('4.6.1 Specialty + Min Experience + Max Fees + Location coordinates', async () => {
      const req = new NextRequest(
        'http://localhost:3000/api/doctors?specialty=CARDIOLOGIST&minExperience=5&maxFees=1000&lat=28.6&lng=77.2'
      );
      const res = await doctorsGET(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.distanceUnavailable).toBe(false);
      expect(data.doctors.length).toBeGreaterThanOrEqual(1);

      const match = data.doctors[0];
      expect(match.specialty).toBe('CARDIOLOGIST');
      expect(match.experience).toBeGreaterThanOrEqual(5);
      expect(match.fees).toBeLessThanOrEqual(1000);
      expect(typeof match.distanceKm).toBe('number');
    });

    it('4.6.2 Mutually exclusive combined filter yields empty list cleanly (e.g. CARDIOLOGIST with fees <= 100)', async () => {
      const req = new NextRequest('http://localhost:3000/api/doctors?specialty=CARDIOLOGIST&maxFees=100');
      const res = await doctorsGET(req);
      expect(res.status).toBe(200);

      const data = await res.json();
      const doctors = Array.isArray(data) ? data : data.doctors;
      expect(doctors.length).toBe(0);
    });
  });
});
