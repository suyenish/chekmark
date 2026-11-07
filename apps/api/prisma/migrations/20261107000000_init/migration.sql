-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "PageStatus" AS ENUM ('UPLOADED', 'DETECTING', 'AWAITING_CHECK', 'EXPLAINING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "FailedStage" AS ENUM ('DETECTING', 'EXPLAINING');

-- CreateEnum
CREATE TYPE "MarkType" AS ENUM ('underline_save', 'underline_translate', 'curly', 'unclear');

-- CreateEnum
CREATE TYPE "MarkSource" AS ENUM ('detected', 'corrected', 'added');

-- CreateEnum
CREATE TYPE "ItemKind" AS ENUM ('word', 'grammar');

-- CreateEnum
CREATE TYPE "Rating" AS ENUM ('again', 'hard', 'easy');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "explanation_language" TEXT NOT NULL DEFAULT 'en',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_tokens" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "books" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "source_language" TEXT NOT NULL DEFAULT 'ko',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pages" (
    "id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "page_number" INTEGER,
    "photo_key" TEXT NOT NULL,
    "status" "PageStatus" NOT NULL DEFAULT 'UPLOADED',
    "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failed_stage" "FailedStage",
    "failure_reason" TEXT,
    "detection_result" JSONB,
    "photo_deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marks" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "type" "MarkType" NOT NULL,
    "text" TEXT NOT NULL,
    "normal_form" TEXT,
    "sentence" TEXT,
    "position" JSONB,
    "source" "MarkSource" NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "marks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "ItemKind" NOT NULL,
    "language" TEXT NOT NULL,
    "normal_form" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "senses" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "meaning" TEXT NOT NULL,
    "notes" TEXT,
    "example" TEXT,
    "example_translation" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "senses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sightings" (
    "id" UUID NOT NULL,
    "sense_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "mark_id" UUID NOT NULL,
    "sentence" TEXT NOT NULL,
    "sentence_translation" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sightings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "translations" (
    "id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "mark_id" UUID NOT NULL,
    "translated_text" TEXT NOT NULL,

    CONSTRAINT "translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cards" (
    "id" UUID NOT NULL,
    "sense_id" UUID NOT NULL,
    "sighting_id" UUID,
    "due_at" TIMESTAMP(3) NOT NULL,
    "interval_days" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ease" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "last_rating" "Rating",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_calls" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "page_id" UUID,
    "purpose" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cost" DECIMAL(12,6) NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "login_tokens_token_hash_key" ON "login_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "login_tokens_email_created_at_idx" ON "login_tokens"("email", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "books_user_id_idx" ON "books"("user_id");

-- CreateIndex
CREATE INDEX "pages_book_id_idx" ON "pages"("book_id");

-- CreateIndex
CREATE INDEX "pages_status_status_changed_at_idx" ON "pages"("status", "status_changed_at");

-- CreateIndex
CREATE INDEX "marks_page_id_order_idx" ON "marks"("page_id", "order");

-- CreateIndex
CREATE UNIQUE INDEX "items_user_id_kind_language_normal_form_key" ON "items"("user_id", "kind", "language", "normal_form");

-- CreateIndex
CREATE INDEX "senses_item_id_idx" ON "senses"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "sightings_mark_id_key" ON "sightings"("mark_id");

-- CreateIndex
CREATE INDEX "sightings_sense_id_idx" ON "sightings"("sense_id");

-- CreateIndex
CREATE INDEX "sightings_page_id_idx" ON "sightings"("page_id");

-- CreateIndex
CREATE UNIQUE INDEX "translations_mark_id_key" ON "translations"("mark_id");

-- CreateIndex
CREATE INDEX "translations_page_id_idx" ON "translations"("page_id");

-- CreateIndex
CREATE UNIQUE INDEX "cards_sense_id_key" ON "cards"("sense_id");

-- CreateIndex
CREATE INDEX "cards_due_at_idx" ON "cards"("due_at");

-- CreateIndex
CREATE INDEX "ai_calls_created_at_idx" ON "ai_calls"("created_at");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marks" ADD CONSTRAINT "marks_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "senses" ADD CONSTRAINT "senses_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sightings" ADD CONSTRAINT "sightings_sense_id_fkey" FOREIGN KEY ("sense_id") REFERENCES "senses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sightings" ADD CONSTRAINT "sightings_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sightings" ADD CONSTRAINT "sightings_mark_id_fkey" FOREIGN KEY ("mark_id") REFERENCES "marks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translations" ADD CONSTRAINT "translations_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "translations" ADD CONSTRAINT "translations_mark_id_fkey" FOREIGN KEY ("mark_id") REFERENCES "marks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_sense_id_fkey" FOREIGN KEY ("sense_id") REFERENCES "senses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_sighting_id_fkey" FOREIGN KEY ("sighting_id") REFERENCES "sightings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_page_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
