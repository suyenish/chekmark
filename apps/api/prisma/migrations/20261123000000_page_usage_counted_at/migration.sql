-- When a page last counted towards the daily limit. Older rows stay null and fall back to status_changed_at.
ALTER TABLE "pages" ADD COLUMN "usage_counted_at" TIMESTAMP(3);
