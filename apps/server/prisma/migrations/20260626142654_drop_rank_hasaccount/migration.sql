/*
  Warnings:

  - You are about to drop the column `hasAccount` on the `Companion` table. All the data in the column will be lost.
  - You are about to drop the column `rank` on the `Companion` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Companion" DROP COLUMN "hasAccount",
DROP COLUMN "rank";
