/**
 * Every server test runs in test mode with its own settings — server/.env (which
 * holds the production database) is never read. Database tests point at
 * TEST_DATABASE_URL, a dedicated database whose name must end in "_test"
 * (src/config/env.ts refuses anything else); unit tests get a placeholder that
 * is never connected to.
 */
process.env.NODE_ENV = "test";
process.env.COMMISSAIRE_SKIP_DOTENV = "1";
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || "postgresql://unused@127.0.0.1:1/commissaire_test";
process.env.JWT_ACCESS_SECRET ||= "test-secret-test-secret-test-secret-123";
process.env.MAIL_TRANSPORT = "log";
process.env.SMS_ENABLED = "false";
process.env.APP_URL = "http://app.test";
process.env.GOOGLE_CLIENT_IDS = "test-client";
process.env.AUTH_RATE_LIMIT = "10000";
process.env.TRIAL_RATE_LIMIT = "10000";
process.env.DB_POOL_MAX = "4";
process.env.LOG_LEVEL = "silent";
process.env.TRIAL_ACCESS_ENABLED = "true"; // Quick Trial Access (014); one test switches it off to check the shutdown
