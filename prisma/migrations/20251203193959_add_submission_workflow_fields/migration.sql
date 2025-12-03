-- AlterTable
ALTER TABLE "form_submissions" ADD COLUMN     "assigned_to_id" INTEGER,
ADD COLUMN     "flagged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "risk_level" TEXT NOT NULL DEFAULT 'low',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'open';

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
