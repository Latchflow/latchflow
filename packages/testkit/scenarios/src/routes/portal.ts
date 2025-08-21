import type { FileItem } from "@latchflow/testkit-api-types";
import type { InMemoryStore } from "../store.js";
import type { RouteDescriptor } from "../types.js";

export const portalMe = (): RouteDescriptor => ({
  method: "GET",
  path: "/portal/me",
  handler: () => ({ status: 200, json: { recipient: { id: "r-1" }, bundles: [] } }),
});
export const portalBundles = (store: InMemoryStore): RouteDescriptor => ({
  method: "GET",
  path: "/portal/bundles",
  handler: () => ({ status: 200, json: { items: Array.from(store.bundles.values()) } }),
});
export const portalBundleObjects = (store: InMemoryStore): RouteDescriptor => ({
  method: "GET",
  path: "/portal/bundles/:bundleId/objects",
  handler: ({ req }) => {
    const bundleId = req.url.pathname.split("/")[3];
    const objects = Array.from(store.bundleObjects.values()).filter((o) => o.bundleId === bundleId);
    const files = objects.map((o) => store.files.get(o.fileId)).filter(Boolean) as FileItem[];
    return { status: 200, json: { items: files } };
  },
});
export const portalBundleDownload = (): RouteDescriptor => ({
  method: "GET",
  path: "/portal/bundles/:bundleId",
  handler: () => ({
    status: 200,
    body: new TextEncoder().encode("bundle-binary"),
    headers: { "content-type": "application/octet-stream" },
  }),
});
export const portalOtpResend = (): RouteDescriptor => ({
  method: "POST",
  path: "/portal/auth/otp/resend",
  handler: () => ({ status: 200, json: { status: "resent" } }),
});
