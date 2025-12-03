/*
  Warnings:

  - You are about to drop the column `submitted_at` on the `form_submissions` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `form_submissions` table. All the data in the column will be lost.
  - Added the required column `updated_at` to the `form_submissions` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "form_submissions" DROP CONSTRAINT "form_submissions_user_id_fkey";

-- AlterTable
ALTER TABLE "form_submissions" DROP COLUMN "submitted_at",
DROP COLUMN "user_id",
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "submitted_by_id" INTEGER,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
