import type { NextRequest } from "next/server";
import { serverApiBaseUrl } from "@/lib/api/client";
import { proxyRequest } from "@/lib/api/proxy";
import { getSessionToken } from "@/lib/auth/session";

// The browser's only way to the authenticated API: the session token stays in
// its httpOnly cookie and is attached here, on the server.

export const dynamic = "force-dynamic";

interface ProxyContext {
  params: Promise<{ path: string[] }>;
}

async function handle(request: NextRequest, context: ProxyContext): Promise<Response> {
  const { path } = await context.params;
  return proxyRequest(request, path, {
    token: await getSessionToken(),
    backendBaseUrl: serverApiBaseUrl(),
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
// Answered by the proxy with 405 and no CORS headers, so a cross-site preflight
// for the proxy header fails (Next would otherwise answer OPTIONS itself).
export const OPTIONS = handle;
