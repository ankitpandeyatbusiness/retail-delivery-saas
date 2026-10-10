// Fake settings for tests only. No real keys, and the real .env is never read.
process.env.NODE_ENV = 'test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-0123456789abcdef0123';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef012';
process.env.SUPERADMIN_JWT_SECRET = 'test-superadmin-secret-0123456789abcdef01';
process.env.OTP_PEPPER = 'test-otp-pepper';
process.env.DELIVERY_PIN_SECRET = 'test-delivery-pin-secret';
process.env.SMS_MOCK = 'true';
process.env.PAYMENTS_MOCK = 'true';
process.env.STORAGE_MOCK = 'true';
process.env.PUSH_MOCK = 'true';