import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../../middleware";
import { config as appConfig } from "../../lib/config";

function buildRequest(pathname: string, cookie?: string) {
  const headers = new Headers();
  if (cookie) {
    headers.set("cookie", cookie);
  }

  return new NextRequest(`http://localhost${pathname}`, {
    headers,
  } as RequestInit);
}

function extractPathnameFromLocationHeader(location: string | null) {
  if (!location) return null;
  try {
    const url = new URL(location, "http://localhost");
    return url.pathname;
  } catch {
    return null;
  }
}

describe("portal middleware authentication", () => {
  it("redirects unauthenticated traffic to /login", async () => {
    const request = buildRequest("/bundles");

    const response = await middleware(request);
    const locationPath = extractPathnameFromLocationHeader(
      response?.headers.get("location") ?? null,
    );

    expect(response?.status).toBe(307);
    expect(locationPath).toBe("/login");
  });

  it("clears invalid sessions and redirects to /login", async () => {
    const fetchMock = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response(null, { status: 401 }));

    const cookieHeader = `${appConfig.sessionCookieName}=stale-token`;
    const request = buildRequest("/protected", cookieHeader);

    const response = await middleware(request);
    const locationPath = extractPathnameFromLocationHeader(
      response?.headers.get("location") ?? null,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(locationPath).toBe("/login");
    const setCookie = response?.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(`${appConfig.sessionCookieName}=;`);
  });

  it("redirects authenticated users away from /login", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const cookieHeader = `${appConfig.sessionCookieName}=valid-token`;
    const request = buildRequest("/login", cookieHeader);

    const response = await middleware(request);
    const locationPath = extractPathnameFromLocationHeader(
      response?.headers.get("location") ?? null,
    );

    expect(locationPath).toBe("/");
  });

  it("allows valid sessions to access protected routes", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const cookieHeader = `${appConfig.sessionCookieName}=valid-token`;
    const request = buildRequest("/dashboard", cookieHeader);

    const response = await middleware(request);

    expect(response?.status).toBe(200);
    expect(response?.headers.get("location")).toBeNull();
  });
});
