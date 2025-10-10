import { useQuery } from "@tanstack/react-query";
import type { paths, components } from "@latchflow/api-types";
import { apiClient, ApiError } from "@/lib/api-client";

// Extract types from OpenAPI-generated types
type PortalBundlesResponse =
  paths["/portal/bundles"]["get"]["responses"][200]["content"]["application/json"];
type PortalBundleItem = components["schemas"]["PortalBundleItem"];

export type Assignment = PortalBundleItem["summary"] & {
  assignmentId: PortalBundleItem["assignmentId"];
  assignmentUpdatedAt: PortalBundleItem["assignmentUpdatedAt"];
  bundle: PortalBundleItem["bundle"];
};

export function useAssignments() {
  return useQuery({
    queryKey: ["assignments"],
    queryFn: async () => {
      try {
        const data = await apiClient.get<PortalBundlesResponse>("/portal/bundles");
        return data.items.map(
          (item): Assignment => ({
            ...item.summary,
            assignmentId: item.assignmentId,
            assignmentUpdatedAt: item.assignmentUpdatedAt,
            bundle: item.bundle,
          }),
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          // Redirect to login on auth failure
          window.location.href = "/login";
          throw error;
        }
        throw error;
      }
    },
  });
}
