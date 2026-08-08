import { vi, beforeEach } from 'vitest';

// Provide default test environment variables
process.env.JWT_SECRET = 'test_jwt_secret_must_be_long_enough_for_hs256';
process.env.CRON_SECRET = 'test_cron_secret_123';
process.env.RAZORPAY_KEY_ID = 'rzp_test_key123';
process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret123';

beforeEach(() => {
  vi.clearAllMocks();
});
