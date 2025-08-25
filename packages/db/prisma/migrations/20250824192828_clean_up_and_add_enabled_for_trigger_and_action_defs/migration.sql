/*
  Warnings:

  - You are about to drop the column `ownerId` on the `TriggerDefinition` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."TriggerDefinition" DROP CONSTRAINT "TriggerDefinition_ownerId_fkey";

-- AlterTable
ALTER TABLE "public"."ActionDefinition" ADD COLUMN     "isEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "public"."TriggerDefinition" DROP COLUMN "ownerId",
ADD COLUMN     "isEnabled" BOOLEAN NOT NULL DEFAULT true;
