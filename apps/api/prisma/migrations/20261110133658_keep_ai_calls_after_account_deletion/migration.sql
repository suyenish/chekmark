-- DropForeignKey
ALTER TABLE "ai_calls" DROP CONSTRAINT "ai_calls_user_id_fkey";

-- AddForeignKey
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
