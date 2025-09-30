-- Extend InvocationStatus enum
ALTER TYPE "public"."InvocationStatus" ADD VALUE IF NOT EXISTS 'RETRYING';
ALTER TYPE "public"."InvocationStatus" ADD VALUE IF NOT EXISTS 'FAILED_PERMANENT';

-- Add retryAt column to ActionInvocation
ALTER TABLE "public"."ActionInvocation" ADD COLUMN IF NOT EXISTS "retryAt" TIMESTAMP(3);
