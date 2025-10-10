const NOW_ISO = "2024-01-01T12:00:00.000Z";

function createAssignment({
  id,
  name,
  maxDownloads,
  downloadsRemaining,
  downloadsUsed,
  cooldownRemainingSeconds,
}) {
  const resolvedMaxDownloads =
    maxDownloads ??
    (downloadsRemaining === null || downloadsRemaining === undefined
      ? null
      : downloadsRemaining + (downloadsUsed ?? 0));

  const resolvedDownloadsRemaining =
    downloadsRemaining ?? (resolvedMaxDownloads ?? 0) - (downloadsUsed ?? 0);

  const resolvedDownloadsUsed =
    downloadsUsed ??
    (resolvedMaxDownloads !== null && resolvedDownloadsRemaining !== null
      ? Math.max(resolvedMaxDownloads - resolvedDownloadsRemaining, 0)
      : 0);

  const cooldown = cooldownRemainingSeconds ?? 0;

  return {
    assignmentId: `assignment-${id}`,
    assignmentUpdatedAt: NOW_ISO,
    bundle: {
      id,
      name,
      description: null,
      storagePath: null,
      checksum: null,
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    },
    summary: {
      bundleId: id,
      name,
      maxDownloads: resolvedMaxDownloads,
      downloadsUsed: resolvedDownloadsUsed,
      downloadsRemaining: resolvedDownloadsRemaining,
      cooldownSeconds: cooldown > 0 ? cooldown : null,
      lastDownloadAt: resolvedDownloadsUsed > 0 ? NOW_ISO : null,
      nextAvailableAt:
        cooldown > 0 ? new Date(Date.parse(NOW_ISO) + cooldown * 1000).toISOString() : null,
      cooldownRemainingSeconds: cooldown,
    },
  };
}

function buildBundlesNoCooldown() {
  return {
    items: [
      createAssignment({
        id: "bundle-operations-update",
        name: "Operations Launch Pack",
        maxDownloads: 5,
        downloadsRemaining: 3,
      }),
      createAssignment({
        id: "bundle-quarterly-report",
        name: "Q4 Compliance Report",
        maxDownloads: null,
        downloadsRemaining: null,
      }),
      createAssignment({
        id: "bundle-release-plan",
        name: "Release Coordination Plan",
        maxDownloads: 1,
        downloadsRemaining: 1,
      }),
    ],
  };
}

function buildBundlesWithCooldown() {
  return {
    items: [
      createAssignment({
        id: "bundle-operations-update",
        name: "Operations Launch Pack",
        maxDownloads: 5,
        downloadsRemaining: 2,
      }),
      createAssignment({
        id: "bundle-client-artifacts",
        name: "Client Artifact Vault",
        maxDownloads: 3,
        downloadsRemaining: 0,
        cooldownRemainingSeconds: 3600,
      }),
      createAssignment({
        id: "bundle-legal-disclosures",
        name: "Legal Disclosures 2024",
        maxDownloads: 10,
        downloadsRemaining: 10,
      }),
    ],
  };
}

module.exports = {
  buildBundlesNoCooldown,
  buildBundlesWithCooldown,
};
