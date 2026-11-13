// Ember – Cloudflare Pages worker (advanced mode).
// Serves the app as usual and relays two Govee API calls, because browsers
// can't call Govee's API directly. Only these two Govee endpoints are allowed;
// the API key comes from the app on your phone and is never stored here.
const GOVEE = "https://openapi.api.govee.com/router/api/v1/";
const ALLOWED = { "user/devices": "GET", "device/state": "POST" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/govee/")) {
      const path = url.pathname.slice("/govee/".length);
      const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
      if (ALLOWED[path] !== request.method) return json(404, { code: 404, message: "Not allowed" });
      const key = request.headers.get("Govee-API-Key");
      if (!key) return json(400, { code: 400, message: "Missing Govee API key" });
      const init = { method: request.method, headers: { "Govee-API-Key": key, "Content-Type": "application/json" } };
      if (request.method === "POST") init.body = await request.text();
      try {
        const r = await fetch(GOVEE + path, init);
        return new Response(r.body, { status: r.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
      } catch (e) {
        return json(502, { code: 502, message: "Couldn't reach Govee" });
      }
    }
    return env.ASSETS.fetch(request);
  },
};
