-- Set only on temporary demo accounts: when the account is deleted.
ALTER TABLE "users" ADD COLUMN "demo_expires_at" TIMESTAMP(3);
CREATE INDEX "users_demo_expires_at_idx" ON "users"("demo_expires_at");
