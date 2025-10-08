import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { config as appConfig } from "./lib/config";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow access to login and public routes
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  // Check for session cookie
  const sessionCookie = request.cookies.get(appConfig.sessionCookieName);

  // Redirect to login if no session
  if (!sessionCookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
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
