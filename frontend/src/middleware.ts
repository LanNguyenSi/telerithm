import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/register"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = request.cookies.get("telerithm_token")?.value;
  if (!token) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Only the presence of a session is checked here. Which role the session has
  // is not decided from a cookie: the admin pages ask the backend (requireAdmin
  // in lib/auth/guard.ts), because the readable telerithm_user cookie can be
  // forged.
  return NextResponse.next();
}

// /bff is the API proxy: it answers a request without the session cookie with
// its own 401, which a fetch from a client component can read; a redirect to
// /login would hand that fetch an HTML page instead.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api(?:/|$)|bff(?:/|$)).*)"],
};
