// Offline smoke test for the dsh-easy-balance halves (no browser, no Harness).
// Renders the two Client components against a minimal React stub and drives the
// Host route handler against a stubbed fetch, so both code paths run for real.

const ok = [];
const bad = [];
function check(name, condition, detail) {
  if (condition) ok.push(name);
  else bad.push(name + (detail === undefined ? "" : " :: " + detail));
}

// ---------------------------------------------------------------- Client half

let captured = null;
globalThis.window = { __ModuleLoader__: { load: (spec) => { captured = spec; } } };

function depsEqual(a, b) {
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  return a.every((value, index) => Object.is(value, b[index]));
}

function createStore() {
  return { list: [], index: 0, dirty: false, pending: [] };
}

const React = {
  __store: createStore(),
  createElement(type, props, ...children) {
    return { type, props: { ...(props || {}), children } };
  },
  useState(initial) {
    const store = React.__store;
    const i = store.index++;
    if (!(i in store.list)) store.list[i] = typeof initial === "function" ? initial() : initial;
    const set = (next) => {
      store.list[i] = typeof next === "function" ? next(store.list[i]) : next;
      store.dirty = true;
    };
    return [store.list[i], set];
  },
  useRef(initial) {
    const store = React.__store;
    const i = store.index++;
    if (!(i in store.list)) store.list[i] = { current: initial };
    return store.list[i];
  },
  useEffect(effect, deps) {
    const store = React.__store;
    const i = store.index++;
    const cell = store.list[i];
    if (cell !== undefined && depsEqual(cell.deps, deps)) return;
    store.list[i] = { deps, cleanup: undefined, effect };
    store.pending.push(store.list[i]);
  },
  useLayoutEffect(effect, deps) {
    React.useEffect(effect, deps);
  },
  useMemo(factory, deps) {
    const store = React.__store;
    const i = store.index++;
    const cell = store.list[i];
    if (cell !== undefined && depsEqual(cell.deps, deps)) return cell.value;
    const value = factory();
    store.list[i] = { deps, value };
    return value;
  },
  useCallback(fn, deps) {
    const store = React.__store;
    const i = store.index++;
    const cell = store.list[i];
    if (cell !== undefined && depsEqual(cell.deps, deps)) return cell.value;
    store.list[i] = { deps, value: fn };
    return fn;
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    React.__store.index++;
    return getSnapshot();
  },
};

function unmount(store) {
  for (const cell of store.list) {
    if (cell !== null && typeof cell === "object" && typeof cell.cleanup === "function") cell.cleanup();
  }
}

function expandElement(node) {
  if (node !== null && typeof node === "object" && !Array.isArray(node) && typeof node.type === "function") {
    return expandElement(node.type(node.props));
  }
  return node;
}

function texts(node, out = []) {
  const current = expandElement(node);
  if (current === null || current === undefined || current === false || current === true) return out;
  if (typeof current === "string" || typeof current === "number") {
    out.push(String(current));
    return out;
  }
  if (Array.isArray(current)) {
    for (const child of current) texts(child, out);
    return out;
  }
  if (typeof current === "object" && current.props !== undefined) {
    for (const child of current.props.children) texts(child, out);
    return out;
  }
  return out;
}

function findNodes(node, predicate, out = []) {
  const current = expandElement(node);
  if (current === null || current === undefined) return out;
  if (Array.isArray(current)) {
    for (const child of current) findNodes(child, predicate, out);
    return out;
  }
  if (typeof current === "object" && current.props !== undefined) {
    if (predicate(current)) out.push(current);
    for (const child of current.props.children) findNodes(child, predicate, out);
  }
  return out;
}

const usagePayload = {
  fetchedAt: 1,
  deepseek: {
    configured: true,
    ok: true,
    available: true,
    balances: [{ currency: "CNY", total: "68.04", granted: "0.00", toppedUp: "68.04" }],
  },
  opencodeGo: {
    configured: true,
    ok: true,
    windows: {
      rolling: { status: "ok", percent: 6, resetsAt: "2026-10-01T16:30:03.186Z" },
      weekly: { status: "ok", percent: 6, resetsAt: "2026-10-05T00:00:00.000Z" },
      monthly: { status: "ok", percent: 16, resetsAt: "2026-10-20T08:07:46.000Z" },
    },
  },
};

let clientPayload = usagePayload;
const fetchCalls = [];
globalThis.fetch = async (url) => {
  fetchCalls.push(String(url));
  return { ok: true, status: 200, json: async () => clientPayload };
};

await import(new URL("../client.js", import.meta.url).href);

check("client registers its factory with the package id", captured !== null && captured.id === "dsh-easy-balance", String(captured && captured.id));

const client = captured.factory((id) => {
  if (id === "react") return React;
  throw new Error("unexpected require: " + id);
});

check("client exports apply", typeof client.apply === "function");
check("client declares its services", Array.isArray(client.inject) && client.inject.includes("slots") && client.inject.includes("locale"), JSON.stringify(client.inject));

const registrations = [];
const dictionaries = [];
let injectedServices = null;

let directorySnapshot = {
  current: { provider: "opencode-go", model: "deepseek-v4.1-flash" },
  groups: [{ id: "opencode-go", name: "OpenCode Go", models: [] }],
  status: "ready",
};
let loads = 0;
let directoryForThrows = false;
let bindingGeneration = 1;

/** A fresh store per binding generation: a re-attach hands out a new directory. */
function makeStore(generation) {
  return {
    generation,
    getSnapshot() {
      return generation === bindingGeneration ? directorySnapshot : { current: null, groups: [], status: "idle" };
    },
    subscribe() {
      return () => {};
    },
  };
}
const fakeStore = makeStore(1);
const fakeDirectories = {
  directoryFor(sessionId) {
    if (sessionId !== "session-1") throw new Error("unexpected session " + String(sessionId));
    if (directoryForThrows) throw new Error("ui-model-selection: session resolved no binding");
    return {
      store: makeStore(bindingGeneration),
      load: async () => {
        loads += 1;
        return directorySnapshot;
      },
    };
  },
};

const ctx = {
  effect(callback) {
    return callback();
  },
  locale: {
    register(ns, dicts) {
      dictionaries.push({ ns, dicts });
      return () => {};
    },
    bind(ns) {
      return (key) => {
        const entry = dictionaries.find((item) => item.ns === ns);
        const dict = entry ? entry.dicts.zh : {};
        return dict[key] === undefined ? key : dict[key];
      };
    },
  },
  slots: {
    inject(slot, callback) {
      callback();
      return () => {};
    },
    register(options, Component) {
      registrations.push({ options, Component });
      return () => {};
    },
  },
  inject(services, callback) {
    injectedServices = services;
    callback({ slots: ctx.slots, modelDirectories: fakeDirectories });
  },
  get() {
    return undefined;
  },
};

client.apply(ctx);

check("client registers two seats", registrations.length === 2, "count=" + registrations.length);
const usageReg = registrations.find((entry) => entry.options.name === "conversation.composer.dock");
const providerReg = registrations.find((entry) => entry.options.name === "conversation.input.right");
check("usage strip registered on the composer dock", usageReg !== undefined);
check("structure strip waits for the model directory service", usageReg !== undefined && usageReg.options.id === "easy-balance.usage");
check("provider chip registered on the composer input row", providerReg !== undefined);
check("provider chip declares the model directory dependency", Array.isArray(injectedServices) && injectedServices.includes("modelDirectories"), JSON.stringify(injectedServices));
check("bilingual dictionaries registered", dictionaries.length === 1 && dictionaries[0].dicts.zh !== undefined && dictionaries[0].dicts.en !== undefined);

function injectProps(registration) {
  const face = registration.options.inject;
  return typeof face === "function" ? face() : face || {};
}

function attachRefs(node, element) {
  if (node === null || node === undefined || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) attachRefs(child, element);
    return;
  }
  if (node.props !== undefined) {
    if (node.props.ref !== undefined && node.props.ref !== null) node.props.ref.current = element;
    for (const child of node.props.children) attachRefs(child, element);
  }
}

function runPendingEffects(store) {
  const pending = store.pending;
  store.pending = [];
  for (const cell of pending) cell.cleanup = cell.effect();
}

/**
 * One mounted component instance: hook cells persist across `rerender`, the way
 * a live chip keeps its state while the session re-attaches underneath it.
 * @param Component - component under test.
 * @param props - initial props.
 * @param elements - simulated DOM elements for `ref` props.
 * @returns the instance and its tree.
 */
function createRenderer(Component, props, elements = []) {
  const store = createStore();
  const run = (nextProps) => {
    React.__store = store;
    store.index = 0;
    store.dirty = false;
    const tree = Component(nextProps);
    for (const element of elements) {
      if (element !== undefined) attachRefs(tree, element);
    }
    runPendingEffects(store);
    return tree;
  };
  let tree = run(props);
  const settle = async (nextProps) => {
    for (let i = 0; i < 25; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (!store.dirty) break;
      tree = run(nextProps);
    }
    return tree;
  };
  return {
    store,
    get tree() {
      return tree;
    },
    settle,
    async rerender(nextProps) {
      tree = run(nextProps);
      return settle(nextProps);
    },
  };
}

async function render(Component, props, elements = []) {
  const instance = createRenderer(Component, props, elements);
  const tree = await instance.settle(props);
  return { tree, store: instance.store };
}

// --- usage strip
{
  const { tree, store } = await render(usageReg.Component, { ...injectProps(usageReg) });
  const flat = texts(tree).join(" | ");
  check("strip renders the DeepSeek balance", flat.includes("68.04"), flat);
  check("strip renders the rolling window", flat.includes("6%"), flat);
  check("strip renders the monthly window", flat.includes("16%"), flat);
  check("strip fetched the host route", fetchCalls.some((url) => url.includes("/easy-balance/usage")), JSON.stringify(fetchCalls));
  const percents = findNodes(tree, (node) => node.props["data-percent"] !== undefined).map((node) => node.props["data-percent"]);
  check("strip exposes each window percentage", percents.join(",") === "6,6,16", percents.join(","));
  check("strip uses only theme tokens", !flat.includes("#") && !flat.includes("rgb("), flat);
  const refresh = findNodes(tree, (node) => node.type === "button");
  check("strip offers a refresh control", refresh.length >= 1, "buttons=" + refresh.length);

  const root = findNodes(tree, (node) => node.props["data-easy-balance"] !== undefined)[0];
  check("strip renders one row element", root !== undefined && root.type === "div");
  const css = texts(root).join("");
  check("strip claims its own full row", css.includes("flex:1 1 100%") && css.includes("order:1"), css.slice(0, 120));
  check(
    "strip lets the composer dock row wrap through its slot anchor",
    css.includes('div:has(>[data-slot="conversation.composer.dock"]):has([data-easy-balance]){flex-wrap:wrap;row-gap:2px}'),
    css.slice(0, 260),
  );
  check("strip tightens the line gap and keeps its own bottom margin", css.includes("row-gap:2px") && css.includes("margin-bottom:8px"), css.slice(0, 200));
  check("strip leaves the balance text in the same tone as its neighbours", css.includes("[data-part=value]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"), css.slice(0, 400));

  const sequence = [];
  (function walk(node) {
    const current = expandElement(node);
    if (current === null || current === undefined) return;
    if (Array.isArray(current)) { for (const child of current) walk(child); return; }
    if (typeof current !== "object" || current.props === undefined) return;
    if (current.type === "style") return;
    if (current.type === "svg") sequence.push("ring");
    else if (current.props["data-part"] !== undefined) sequence.push(current.props["data-part"]);
    for (const child of current.props.children) walk(child);
  })(tree);
  check(
    "each window reads name then ring then percent",
    /pill,label,ring,percent,pill,label,ring,percent,pill,label,ring,percent/.test(sequence.join(",")),
    sequence.join(","),
  );
  check("strip truncates instead of wrapping", css.includes("text-overflow:ellipsis") && css.includes("[data-easy-balance]{flex:1 1 100%"), css.slice(0, 120));
  check("strip draws a progress ring per window", findNodes(tree, (node) => node.type === "circle").length === 6, "circles=" + findNodes(tree, (node) => node.type === "circle").length);
  const bars = findNodes(tree, (node) => node.props.style !== undefined && node.props.style.width === 36);
  check("strip no longer draws a bar track", bars.length === 0, "bars=" + bars.length);
  check("strip keeps the number outside the truncating label", findNodes(tree, (node) => node.props["data-part"] === "percent").length === 3, "percents=" + findNodes(tree, (node) => node.props["data-part"] === "percent").length);
  unmount(store);
}

// --- a category whose provider is not configured renders nothing at all
{
  const payload = {
    fetchedAt: 1,
    deepseek: { configured: false },
    opencodeGo: { configured: true, ok: true, windows: usagePayload.opencodeGo.windows },
  };
  clientPayload = payload;
  const { tree, store } = await render(usageReg.Component, { ...injectProps(usageReg) });
  const flat = texts(tree).join(" | ");
  check("an unconfigured provider shows no balance text", !flat.includes("DeepSeek"), flat);
  check("an unconfigured provider shows no separator", findNodes(tree, (node) => node.props["data-part"] === "sep").length === 0, flat);
  check("the configured category still renders", flat.includes("OpenCode Go") && flat.includes("16%"), flat);
  check("the configured category keeps the ring", findNodes(tree, (node) => node.type === "circle").length === 6);
  unmount(store);

  clientPayload = {
    fetchedAt: 1,
    deepseek: { configured: false },
    opencodeGo: { configured: false },
  };
  const empty = await render(usageReg.Component, { ...injectProps(usageReg) });
  check("no configured category renders no strip at all", empty.tree === null, JSON.stringify(empty.tree));
  unmount(empty.store);
  clientPayload = usagePayload;
}

// --- dock row wrap: the runtime fallback when the stylesheet cannot reach the row
{
  const dockRow = { style: { flexWrap: "", rowGap: "" } };
  const anchor = { style: { display: "contents" }, parentElement: dockRow };
  const stripElement = { parentElement: anchor };
  const computed = { display: "flex", flexWrap: "nowrap", rowGap: "12px" };
  globalThis.getComputedStyle = () => computed;
  const { store } = await render(usageReg.Component, { ...injectProps(usageReg) }, [stripElement]);
  check("strip wraps the dock row when the selector did not reach it", dockRow.style.flexWrap === "wrap", JSON.stringify(dockRow.style));
  check("strip tightens the row gap it just enabled", dockRow.style.rowGap === "2px", JSON.stringify(dockRow.style));
  unmount(store);
  check("strip restores the dock row when it unmounts", dockRow.style.flexWrap === "" && dockRow.style.rowGap === "", JSON.stringify(dockRow.style));
  computed.flexWrap = "wrap";
  computed.rowGap = "2px";
  const second = await render(usageReg.Component, { ...injectProps(usageReg) }, [stripElement]);
  check("strip leaves a row the stylesheet already wraps untouched", dockRow.style.flexWrap === "" && dockRow.style.rowGap === "", JSON.stringify(dockRow.style));
  unmount(second.store);
  delete globalThis.getComputedStyle;
}

// --- provider chip
{
  const { tree, store } = await render(providerReg.Component, { ...injectProps(providerReg), sessionId: "session-1" });
  const flat = texts(tree).join(" | ");
  check("chip renders the provider name", flat.includes("OpenCode Go"), flat);
  const chip = findNodes(tree, (node) => node.props["data-provider"] !== undefined)[0];
  check("chip carries the provider id", chip !== undefined && chip.props["data-provider"] === "opencode-go", chip && String(chip.props["data-provider"]));
  check("chip tooltip names the provider", chip !== undefined && String(chip.props.title).includes("opencode-go"), chip && String(chip.props.title));
  unmount(store);
}

// --- provider chip survives the two ways it used to vanish after a long run
{
  // 1. A cleared shared catalog nulls the directory's `current`; the durable
  //    modelSelection projection still names the provider.
  directorySnapshot = { current: null, groups: [], status: "loading" };
  const projection = { lastUsed: null, next: { provider: "opencode-go", model: "deepseek-v4.1-flash" } };
  const useProjection = (key) => (key === "modelSelection" ? projection : undefined);
  const { tree, store } = await render(providerReg.Component, {
    ...injectProps(providerReg),
    sessionId: "session-1",
    useProjection,
  });
  const chip = findNodes(tree, (node) => node.props["data-provider"] !== undefined)[0];
  check("a cleared catalog still names the provider from the durable projection", chip !== undefined && chip.props["data-provider"] === "opencode-go", JSON.stringify(texts(tree)));
  check("a cleared catalog falls back to the provider id", texts(tree).join(" | ").includes("opencode-go"), texts(tree).join(" | "));
  check("a cleared catalog is asked to reload", loads > 0, "loads=" + loads);
  unmount(store);

  // 2. A re-attach hands out a new binding and disposes the previous store: the
  //    chip must follow the live directory instead of freezing on the dead one.
  directorySnapshot = { current: { provider: "opencode-go", model: "deepseek-v4.1-flash" }, groups: [], status: "ready" };
  bindingGeneration = 1;
  // One live instance, re-rendered: exactly what a resident composer does when
  // the session re-attaches underneath a chip that never unmounts.
  const liveProps = { ...injectProps(providerReg), sessionId: "session-1" };
  const live = createRenderer(providerReg.Component, liveProps);
  await live.settle(liveProps);
  check("chip reads the first binding", live.tree !== null && live.tree.props["data-provider"] === "opencode-go", JSON.stringify(texts(live.tree)));
  // the re-attach: a new binding, a new directory, and the old store now reads null
  directorySnapshot = { current: { provider: "lm-studio", model: "qwen3.8-27b" }, groups: [], status: "ready" };
  bindingGeneration = 2;
  await live.rerender(liveProps);
  check("chip follows the new binding after a re-attach", live.tree !== null && live.tree.props["data-provider"] === "lm-studio", JSON.stringify(texts(live.tree)));
  unmount(live.store);

  // 3. Nothing known at all: still renders nothing rather than a wrong label.
  directorySnapshot = { current: null, groups: [], status: "idle" };
  const none = await render(providerReg.Component, { ...injectProps(providerReg), sessionId: "session-1" });
  check("chip renders nothing when no selection is known", none.tree === null, JSON.stringify(texts(none.tree)));
  unmount(none.store);

  // 4. A directory that cannot be resolved yet must not be remembered as broken.
  directoryForThrows = true;
  const broken = await render(providerReg.Component, { ...injectProps(providerReg), sessionId: "session-1" });
  check("chip hides while its directory cannot be resolved", broken.tree === null);
  directoryForThrows = false;
  directorySnapshot = { current: { provider: "deepseek-official", model: "deepseek-v4-pro" }, groups: [], status: "ready" };
  const recovered = await render(providerReg.Component, { ...injectProps(providerReg), sessionId: "session-1" });
  check("chip recovers as soon as the directory resolves again", recovered.tree !== null && recovered.tree.props["data-provider"] === "deepseek-official", JSON.stringify(texts(recovered.tree)));
  unmount(broken.store);
  unmount(recovered.store);

  directorySnapshot = {
    current: { provider: "opencode-go", model: "deepseek-v4.1-flash" },
    groups: [{ id: "opencode-go", name: "OpenCode Go", models: [] }],
    status: "ready",
  };
  bindingGeneration = 1;
}

// --- error path: both providers failing must still render
{
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const response = await savedFetch(url);
    const body = await response.json();
    return { ok: true, status: 200, json: async () => ({ ...body, deepseek: { ok: false, error: "no-api-key" }, opencodeGo: { ok: false, error: "http-500" } }) };
  };
  const errorRender = await render(usageReg.Component, { ...injectProps(usageReg) });
  const flat = texts(errorRender.tree).join(" | ");
  check("strip renders a missing key as a message", flat.includes("未配置 API Key"), flat);
  check("strip renders an HTTP failure as a message", flat.includes("HTTP 错误 500"), flat);
  unmount(errorRender.store);
  globalThis.fetch = savedFetch;
}

// ---------------------------------------------------------------- Host half

const hostModule = await import(new URL("../index.js", import.meta.url).href);
check("host exports apply", typeof hostModule.apply === "function");
check("host requires the web carrier", Array.isArray(hostModule.inject) && hostModule.inject.includes("webServer"), JSON.stringify(hostModule.inject));

function hostCtxFor(routes, rejection) {
  return {
    get(name) {
      if (name === "credentials") {
        return {
          resolve(ref) {
            check("credential reference is a plain name", typeof ref === "string", String(ref));
            if (hiddenCredentials.includes(ref)) return Promise.resolve(undefined);
            return Promise.resolve({ value: "sk-test-" + ref, source: "test" });
          },
        };
      }
      if (name === "llm") {
        return { listProviders: async () => providerRoutes.map((id) => ({ id, name: id })) };
      }
      if (name === "connection") return { requestRejection: () => rejection };
      return undefined;
    },
    effect(callback) {
      callback();
      return () => {};
    },
    webServer: {
      register(route) {
        routes.push(route);
        return () => {};
      },
    },
  };
}

let providerRoutes = ["opencode-go", "deepseek-official", "lm-studio"];
let hiddenCredentials = [];

const routes = [];
hostModule.apply(hostCtxFor(routes, undefined));

check("host registers exactly one route", routes.length === 1, "count=" + routes.length);
check("host route path", routes[0] !== undefined && routes[0].path === "/easy-balance/usage", routes[0] && routes[0].path);
check("host route is exact", routes[0] !== undefined && routes[0].kind === "exact");

const upstream = [];
globalThis.fetch = async (url, init) => {
  upstream.push({ url: String(url), authorization: init.headers.authorization });
  if (String(url).includes("api.deepseek.com")) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "68.04", granted_balance: "0.00", topped_up_balance: "68.04" }] }),
    };
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({ usage: { rolling: { status: "ok", percent: 6, resetsAt: "2026-10-01T16:30:03.186Z" }, weekly: { status: "ok", percent: 6, resetsAt: "2026-10-05T00:00:00.000Z" }, monthly: { status: "ok", percent: 16, resetsAt: "2026-10-20T08:07:46.000Z" } } }),
  };
};

function fakeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(key, value) {
      this.headers[key] = value;
    },
    end(body) {
      this.body = body === undefined ? "" : String(body);
    },
  };
}

{
  const res = fakeRes();
  await routes[0].handler({ method: "GET", url: "/easy-balance/usage" }, res);
  check("host route answers 200", res.statusCode === 200, String(res.statusCode));
  const body = JSON.parse(res.body);
  check("host reports the DeepSeek balance", body.deepseek.ok === true && body.deepseek.balances[0].total === "68.04", JSON.stringify(body.deepseek));
  check("host reports all three Go windows", body.opencodeGo.ok === true && body.opencodeGo.windows.monthly.percent === 16, JSON.stringify(body.opencodeGo));
  check("host uses the balance character name", body.deepseek.balances[0].toppedUp === "68.04", JSON.stringify(body.deepseek.balances[0]));
  check("host sends both bearer keys", upstream.filter((call) => String(call.authorization).startsWith("Bearer sk-test-")).length === 2, JSON.stringify(upstream.map((call) => call.authorization)));
  check("host keeps the response uncached at the HTTP layer", res.headers["cache-control"] === "no-store");
  check("host never leaks a key into the body", !res.body.includes("sk-test-"), "body leaked a credential");
}

{
  const before = upstream.length;
  const cached = fakeRes();
  await routes[0].handler({ method: "GET", url: "/easy-balance/usage" }, cached);
  check("second read is served from the cache", upstream.length === before, "upstream calls=" + (upstream.length - before));
  const forced = fakeRes();
  await routes[0].handler({ method: "GET", url: "/easy-balance/usage?refresh=1" }, forced);
  check("refresh bypasses the cache", upstream.length === before + 2, "upstream calls=" + (upstream.length - before));
}

{
  const res = fakeRes();
  await routes[0].handler({ method: "POST", url: "/easy-balance/usage" }, res);
  check("host rejects non-GET", res.statusCode === 405 && res.headers.allow === "GET", String(res.statusCode));
}

{
  const routes2 = [];
  hostModule.apply(hostCtxFor(routes2, 401));
  const res = fakeRes();
  await routes2[0].handler({ method: "GET", url: "/easy-balance/usage" }, res);
  check("host refuses an unauthenticated request", res.statusCode === 401, String(res.statusCode));
}

// --- host: a category is only read when its provider is configured
{
  const savedRoutes = providerRoutes;
  providerRoutes = ["deepseek-official", "lm-studio"];
  upstream.length = 0;
  const res = fakeRes();
  await routes[0].handler({ method: "GET", url: "/easy-balance/usage?refresh=1" }, res);
  const body = JSON.parse(res.body);
  check("a missing provider route hides its category", body.opencodeGo.configured === false, JSON.stringify(body.opencodeGo));
  check("a hidden category is never fetched", upstream.every((call) => !call.url.includes("opencode.ai")), JSON.stringify(upstream.map((call) => call.url)));
  check("the other category still reads", body.deepseek.configured === true && body.deepseek.ok === true, JSON.stringify(body.deepseek));

  providerRoutes = savedRoutes;
  hiddenCredentials = ["DEEPSEEK_API_KEY"];
  upstream.length = 0;
  const res2 = fakeRes();
  await routes[0].handler({ method: "GET", url: "/easy-balance/usage?refresh=1" }, res2);
  const body2 = JSON.parse(res2.body);
  check("a missing credential hides its category", body2.deepseek.configured === false, JSON.stringify(body2.deepseek));
  check("a category without a credential is never fetched", upstream.every((call) => !call.url.includes("api.deepseek.com")), JSON.stringify(upstream.map((call) => call.url)));
  hiddenCredentials = [];
}

// ---------------------------------------------------------------- Report

console.log("\nPASS " + ok.length);
for (const name of ok) console.log("  ok  " + name);
if (bad.length > 0) {
  console.log("\nFAIL " + bad.length);
  for (const name of bad) console.log("  xx  " + name);
  process.exitCode = 1;
} else {
  console.log("\nAll checks passed.");
}
