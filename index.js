/**
 * Host half of dsh-easy-balance.
 *
 * Serves exactly one JSON route the browser half reads:
 *
 *   GET /easy-balance/usage[?refresh=1]
 *
 * Both upstream reads happen here, never in the browser, because each needs a
 * credential that stays on the Host:
 *
 *   - DeepSeek platform balance: `GET https://api.deepseek.com/user/balance`
 *     (`is_available` + one entry per currency).
 *   - OpenCode Go plan usage:    `GET https://opencode.ai/zen/go/v1/usage`
 *     (rolling 5h / weekly / monthly percent used plus the reset instant).
 *
 * A category is only reported as usable — and only read at all — when its
 * provider is actually part of this composition: a registered `llm` route for
 * that provider plus a credential for it. Without both, the category answers
 * `{ configured: false }` and the Client renders nothing for it, so an
 * unconfigured provider never shows a balance or a usage window.
 *
 * A successful read is cached briefly so that every open page, and every
 * session's composer, share one upstream call. `?refresh=1` skips a cached
 * value (but still joins an in-flight read).
 *
 * The route answers only requests the connection layer admits, mirroring the
 * shipped web-route plugins; the API keys never cross to the browser.
 */

/** Exact route path the Client half reads. */
const USAGE_PATH = "/easy-balance/usage";

/** How long one successful read serves every caller. */
const CACHE_TTL_MS = 45_000;

/** Bound for each upstream request. */
const FETCH_TIMEOUT_MS = 12_000;

/** DeepSeek platform balance endpoint (API-key authenticated). */
const DEEPSEEK_BALANCE_URL = "https://api.deepseek.com/user/balance";

/** OpenCode Go plan usage endpoint (API-key authenticated, undocumented). */
const OPENCODE_GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage";

/** Credential references resolved through `ctx.credentials`. */
const DEEPSEEK_KEY_REF = "DEEPSEEK_API_KEY";
const OPENCODE_GO_KEY_REF = "OPENCODE_GO_API_KEY";

/**
 * Registered `llm` route prefixes that make each category applicable. The
 * shipped DeepSeek routes are `deepseek-official` (API key) and
 * `deepseek-account`; the OpenCode Go route is `opencode-go`.
 */
const DEEPSEEK_ROUTE = "deepseek";
const OPENCODE_GO_ROUTE = "opencode-go";

/** The web carrier is required; the route exists only in a Web composition. */
export const inject = ["webServer"];

/**
 * Register the usage route.
 * @param ctx - owning Host context.
 */
export function apply(ctx) {
  /** Last successful read plus its timestamp and any in-flight read. */
  const cache = { at: 0, value: null, inflight: null };

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: "exact",
        path: USAGE_PATH,
        handler: async (req, res) => {
          if (reject(ctx, req, res)) return;
          if (req.method !== "GET") {
            res.statusCode = 405;
            res.setHeader("allow", "GET");
            res.end();
            return;
          }
          const force = /[?&]refresh=1(&|$)/.test(String(req.url ?? ""));
          try {
            sendJson(res, 200, await read(ctx, cache, force));
          } catch (error) {
            sendJson(res, 500, {
              error: "internal",
              message: String((error && error.message) || error),
            });
          }
        },
      }),
    `easy-balance: GET ${USAGE_PATH}`,
  );
}

/**
 * Answer a request the connection layer refuses.
 * @param ctx - owning Host context.
 * @param req - incoming request.
 * @param res - response to end when the request is refused.
 * @returns whether the request was refused (and answered).
 */
function reject(ctx, req, res) {
  const connection = ctx.get("connection");
  if (connection === undefined || typeof connection.requestRejection !== "function") return false;
  const rejection = connection.requestRejection(req);
  if (rejection === undefined) return false;
  res.statusCode = rejection;
  res.end();
  return true;
}

/**
 * Read the cached value, one in-flight read, or a fresh read.
 * @param ctx - owning Host context.
 * @param cache - process-local cache cell.
 * @param force - skip a cached value.
 * @returns the usage document.
 */
async function read(ctx, cache, force) {
  if (!force && cache.value !== null && Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  if (cache.inflight !== null) return cache.inflight;
  cache.inflight = collect(ctx)
    .then((value) => {
      cache.value = value;
      cache.at = Date.now();
      return value;
    })
    .finally(() => {
      cache.inflight = null;
    });
  return cache.inflight;
}

/**
 * Read both categories independently so one failure never hides the other, and
 * only read the ones whose provider is configured in this composition.
 * @param ctx - owning Host context.
 * @returns the usage document sent to the browser.
 */
async function collect(ctx) {
  const routes = await providerRoutes(ctx);
  const [deepseek, opencodeGo] = await Promise.all([readDeepSeek(ctx, routes), readOpencodeGo(ctx, routes)]);
  return { fetchedAt: Date.now(), deepseek, opencodeGo };
}

/**
 * List the provider routes this composition currently serves.
 * @param ctx - owning Host context.
 * @returns route ids, or null when the `llm` service cannot answer.
 */
async function providerRoutes(ctx) {
  const llm = ctx.get("llm");
  if (llm === undefined || llm === null || typeof llm.listProviders !== "function") return null;
  try {
    const providers = await llm.listProviders();
    if (!Array.isArray(providers)) return null;
    return providers
      .map((provider) => (provider !== null && typeof provider === "object" ? text(provider.id) : null))
      .filter((id) => id !== null);
  } catch {
    return null;
  }
}

/**
 * Whether one category's provider is part of the composition.
 * @param routes - registered route ids, or null when unknown.
 * @param prefix - route id, or id prefix, that serves the category.
 * @returns false only when the route is known to be missing.
 */
function routeAvailable(routes, prefix) {
  if (routes === null) return true;
  return routes.some((id) => id === prefix || id.startsWith(prefix + "-"));
}

/**
 * Read the DeepSeek platform balance.
 * @param ctx - owning Host context.
 * @param routes - registered provider routes.
 * @returns `{configured:false}`, `{configured:true, ok:true, ...}` or `{configured:true, ok:false, error}`.
 */
async function readDeepSeek(ctx, routes) {
  if (!routeAvailable(routes, DEEPSEEK_ROUTE)) return { configured: false };
  const key = await resolveKey(ctx, DEEPSEEK_KEY_REF);
  if (key === undefined) return { configured: false };
  const response = await getJson(DEEPSEEK_BALANCE_URL, key);
  if (response.error !== undefined) return { configured: true, ok: false, error: response.error };
  const body = record(response.body);
  const infos = Array.isArray(body.balance_infos) ? body.balance_infos : [];
  return {
    configured: true,
    ok: true,
    available: body.is_available === true,
    balances: infos.map((info) => {
      const entry = record(info);
      return {
        currency: text(entry.currency),
        total: text(entry.total_balance),
        granted: text(entry.granted_balance),
        toppedUp: text(entry.topped_up_balance),
      };
    }),
  };
}

/**
 * Read the OpenCode Go plan usage for this key.
 * @param ctx - owning Host context.
 * @param routes - registered provider routes.
 * @returns `{configured:false}`, `{configured:true, ok:true, windows}` or `{configured:true, ok:false, error}`.
 */
async function readOpencodeGo(ctx, routes) {
  if (!routeAvailable(routes, OPENCODE_GO_ROUTE)) return { configured: false };
  const key = await resolveKey(ctx, OPENCODE_GO_KEY_REF);
  if (key === undefined) return { configured: false };
  const response = await getJson(OPENCODE_GO_USAGE_URL, key);
  if (response.error !== undefined) return { configured: true, ok: false, error: response.error };
  const usage = record(record(response.body).usage);
  return {
    configured: true,
    ok: true,
    windows: {
      rolling: usageWindow(usage.rolling),
      weekly: usageWindow(usage.weekly),
      monthly: usageWindow(usage.monthly),
    },
  };
}

/**
 * Resolve one credential reference without importing the credentials package:
 * a reference is a branded string, so its runtime value is the plain name.
 * @param ctx - owning Host context.
 * @param name - environment-variable-style reference.
 * @returns the secret value, or undefined when unset.
 */
async function resolveKey(ctx, name) {
  const credentials = ctx.get("credentials");
  if (credentials === undefined) return undefined;
  try {
    const resolved = await credentials.resolve(name);
    const value = resolved && typeof resolved.value === "string" ? resolved.value.trim() : "";
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Perform one JSON GET with a bound timeout.
 * @param url - absolute endpoint.
 * @param apiKey - bearer credential.
 * @returns `{body}` or `{error}` with a stable code.
 */
async function getJson(url, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) return { error: "unauthorized" };
    if (!response.ok) return { error: `http-${response.status}` };
    try {
      return { body: await response.json() };
    } catch {
      return { error: "bad-json" };
    }
  } catch (error) {
    const aborted = error !== null && typeof error === "object" && error.name === "AbortError";
    return { error: aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Normalize one usage window.
 * @param value - raw window record.
 * @returns `{status, percent, resetsAt}` with null for anything unusable.
 */
function usageWindow(value) {
  const window = record(value);
  const percent = typeof window.percent === "number" ? window.percent : Number(window.percent);
  return {
    status: typeof window.status === "string" ? window.status : null,
    percent: Number.isFinite(percent) ? percent : null,
    resetsAt: typeof window.resetsAt === "string" && window.resetsAt !== "" ? window.resetsAt : null,
  };
}

/**
 * @param value - candidate.
 * @returns the value when it is a plain object, otherwise an empty object.
 */
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/**
 * @param value - candidate.
 * @returns the value when it is a string, otherwise null.
 */
function text(value) {
  return typeof value === "string" ? value : null;
}

/**
 * Send one JSON response.
 * @param res - HTTP response.
 * @param status - HTTP status.
 * @param payload - JSON-serializable body.
 */
function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
}
