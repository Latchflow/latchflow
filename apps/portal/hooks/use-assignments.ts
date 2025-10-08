import { useQuery } from "@tanstack/react-query";
import type { paths, components } from "@latchflow/api-types";
import { apiClient, ApiError } from "@/lib/api-client";

// Extract types from OpenAPI-generated types
export type Assignment = components["schemas"]["AssignmentSummary"];
type AssignmentsResponse =
  paths["/portal/assignments"]["get"]["responses"][200]["content"]["application/json"];

export function useAssignments() {
  return useQuery({
    queryKey: ["assignments"],
    queryFn: async () => {
      try {
        const data = await apiClient.get<AssignmentsResponse>("/portal/assignments");
        return data.items;
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
