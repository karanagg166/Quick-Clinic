import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '10s', target: 20 },
    { duration: '20s', target: 50 },
    { duration: '10s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export default function () {
  const specialties = ['CARDIOLOGIST', 'DERMATOLOGIST', 'GENERAL_PHYSICIAN', 'PEDIATRICIAN'];
  const specialty = specialties[Math.floor(Math.random() * specialties.length)];

  const res = http.get(`${BASE_URL}/api/doctors?specialty=${specialty}`);
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response has doctors array': (r) => {
      try {
        const json = JSON.parse(r.body);
        return Array.isArray(json) || Array.isArray(json.doctors);
      } catch (e) {
        return false;
      }
    },
  });

  sleep(0.5);
}
