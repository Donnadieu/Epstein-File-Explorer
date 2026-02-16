/**
 * Global test setup - runs before all test files.
 * Stubs environment variables so tests don't require real credentials.
 */

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test_db";

// Disable optional services in tests
delete process.env.R2_ACCOUNT_ID;
delete process.env.R2_ACCESS_KEY_ID;
delete process.env.R2_SECRET_ACCESS_KEY;
delete process.env.R2_BUCKET_NAME;
delete process.env.DEEPSEEK_API_KEY;
