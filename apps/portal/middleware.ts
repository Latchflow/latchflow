import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { config as appConfig } from "./lib/config";

const PUBLIC_PATH_PREFIXES = ["/_next", "/api"];
const PUBLIC_PATHS = new Set(["/favicon.ico"]);

function isPublicPath(pathname: string) {
  return (
    PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix)) || PUBLIC_PATHS.has(pathname)
  );
}

async function ensureValidSession(cookieValue: string | undefined) {
  if (!cookieValue) {
    return false;
  }

  try {
    const response = await fetch(`${appConfig.coreApiUrl}/portal/me`, {
      method: "GET",
      headers: {
        cookie: `${appConfig.sessionCookieName}=${cookieValue}`,
        "x-lf-middleware-probe": "1",
        accept: "application/json",
      },
      cache: "no-store",
    });

    if (response.ok) {
      return true;
    }

    if (response.status === 401 || response.status === 403) {
      return false;
    }

    // For unexpected statuses treat as invalid but do not throw.
    return false;
  } catch (error) {
    console.warn("[portal/middleware] Failed to validate recipient session", error);
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(appConfig.sessionCookieName)?.value;
  const isLoginRoute = pathname.startsWith("/login");
  const sessionValid = await ensureValidSession(sessionCookie);

  // Authenticated users should not see the login screen.
  if (isLoginRoute && sessionValid) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // Redirect unauthenticated traffic away from protected pages.
  if (!sessionValid && !isLoginRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const response = NextResponse.redirect(url);
    if (sessionCookie) {
      response.cookies.delete(appConfig.sessionCookieName);
    }
    return response;
  }

  if (isLoginRoute && !sessionValid && sessionCookie) {
    const response = NextResponse.next();
    response.cookies.delete(appConfig.sessionCookieName);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
