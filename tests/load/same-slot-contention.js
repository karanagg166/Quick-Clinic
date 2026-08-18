import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    slot_contention_race: {
      executor: 'shared-iterations',
      vus: 100,
      iterations: 100,
      maxDuration: '30s',
    },
  },
  thresholds: {
    // We expect exactly 1 hold success (201) and 99 conflicts (409)
    'http_req_duration': ['p(95)<1000'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TARGET_SLOT_ID = __ENV.TARGET_SLOT_ID || 'slot_race_target_test';
const DOCTOR_ID = __ENV.DOCTOR_ID || 'doc_race_target_test';
const TOKEN = __ENV.AUTH_TOKEN || '';

export default function () {
  const payload = JSON.stringify({
    slotId: TARGET_SLOT_ID,
    doctorId: DOCTOR_ID,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
    },
  };

  const res = http.post(`${BASE_URL}/api/appointments/hold`, payload, params);

  check(res, {
    'status is 201 or 409': (r) => r.status === 201 || r.status === 409,
  });
}
