-- AlterTable
ALTER TABLE "Companion" ADD COLUMN     "idCardBack" TEXT,
ADD COLUMN     "idCardFront" TEXT,
ADD COLUMN     "idNumber" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "realName" TEXT,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;
