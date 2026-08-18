import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    withdrawal_race: {
      executor: 'shared-iterations',
      vus: 50,
      iterations: 50,
      maxDuration: '30s',
    },
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const DOCTOR_ID = __ENV.DOCTOR_ID || 'doc_withdrawal_test';
const TOKEN = __ENV.DOCTOR_TOKEN || '';

export default function () {
  const payload = JSON.stringify({
    amount: 10000,
    currency: 'INR',
    bankAccountNumber: '1234567890',
    bankIFSC: 'HDFC0001234',
    bankAccountHolderName: 'Dr. Test',
    bankName: 'HDFC Bank',
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${TOKEN}`,
    },
  };

  const res = http.post(
    `${BASE_URL}/api/doctors/${DOCTOR_ID}/withdrawals`,
    payload,
    params
  );

  check(res, {
    'status is 201 or 400': (r) => r.status === 201 || r.status === 400,
  });
}
