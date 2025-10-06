-- Seed a dedicated system user used for automated configuration changes.
INSERT INTO "User" (
  "id",
  "email",
  "name",
  "displayName",
  "isActive",
  "role",
  "createdAt",
  "updatedAt"
)
VALUES (
  'system',
  'system@latchflow.local',
  'System',
  'System',
  true,
  'ADMIN',
  NOW(),
  NOW()
)
ON CONFLICT ("id") DO NOTHING;
