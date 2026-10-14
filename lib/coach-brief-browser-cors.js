const PRODUCTION_ORIGIN = "https://office.beeschool.jp";
const LOCAL_ORIGIN = /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/;

export function allowedCoachBriefOrigin(origin) {
  return origin === PRODUCTION_ORIGIN || LOCAL_ORIGIN.test(origin || "") ? origin : null;
}

export async function withCoachBriefBrowserCors(request, handler) {
  const suppliedOrigin = request.headers.get("Origin");
  const origin = allowedCoachBriefOrigin(suppliedOrigin);
  const headers = new Headers({ "Cache-Control": "no-store", Vary: "Origin" });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info");
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: origin ? 204 : 403, headers });
  }
  if (suppliedOrigin && !origin) {
    return new Response(JSON.stringify({ error: "Not authorized." }), {
      status: 403, headers: { ...Object.fromEntries(headers), "Content-Type": "application/json" }
    });
  }
  const response = await handler(request);
  const resultHeaders = new Headers(response.headers);
  for (const [name, value] of headers) resultHeaders.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText,
    headers: resultHeaders });
}
