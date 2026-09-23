import { NextRequest, NextResponse } from "next/server";

const configuredApi = process.env.NEXT_PUBLIC_API_URL ?? "/api";
const apiOrigin = configuredApi.startsWith("/")
  ? ""
  : configuredApi.replace(/\/api\/?$/, "").replace(/\/$/, "");

function policy(nonce: string, development: boolean) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // https: so the sandboxed email preview can show campaign images hosted anywhere.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ""}`,
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
    "worker-src 'self'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const value = policy(nonce, process.env.NODE_ENV !== "production");
  const headers = new Headers(request.headers);
  headers.set("Content-Security-Policy", value);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", value);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|webp|svg|ico)$).*)"],
};
