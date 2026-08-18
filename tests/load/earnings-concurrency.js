import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    earnings_concurrency_race: {
      executor: 'shared-iterations',
      vus: 50,
      iterations: 100,
      maxDuration: '30s',
    },
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const DOCTOR_ID = __ENV.DOCTOR_ID || 'doc_earnings_test';
const APPOINTMENT_ID = __ENV.APPOINTMENT_ID || 'appt_earnings_test';
const TOKEN = __ENV.DOCTOR_TOKEN || '';

export default function () {
  const payload = JSON.stringify({
    status: 'COMPLETED',
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
    },
  };

  const res = http.patch(
    `${BASE_URL}/api/doctors/${DOCTOR_ID}/appointments/${APPOINTMENT_ID}`,
    payload,
    params
  );

  check(res, {
    'status is 200 or 400': (r) => r.status === 200 || r.status === 400,
  });
}
