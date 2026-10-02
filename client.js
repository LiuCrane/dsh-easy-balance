// Client half of dsh-easy-balance.
//
// Registration-only bundle: the factory body runs at materialization and
// contributes two additive seats of the resident composer.
//
//   conversation.input.right       a provider chip immediately left of the
//                                  model selector ("opencode-go")
//   conversation.composer.dock     an ambient strip below the composer card
//                                  with the DeepSeek balance and the
//                                  OpenCode Go 5h / weekly / monthly usage
//
// Both read the Host route `GET /easy-balance/usage`; the API keys stay on the
// Host. Styling uses only `--dsw-alias-*` theme tokens.
window.__ModuleLoader__.load({
  id: "dsh-easy-balance",
  factory(require) {
    const React = require("react");
    const h = React.createElement;

    /** Locale namespace owning every visible string. */
    const NS = "easyBalance";
    /** Host route serving both provider reads. */
    const USAGE_PATH = "/easy-balance/usage";
    /** Background refresh cadence for the ambient strip. */
    const POLL_MS = 300000;

    const zh = {
      "provider.label": "服务商",
      "provider.deepseek": "DeepSeek",
      "provider.go": "OpenCode Go",
      "window.rolling": "5小时",
      "window.weekly": "本周",
      "window.monthly": "本月",
      "state.loading": "用量查询中…",
      "state.unavailable": "用量不可用",
      "state.balance": "余额",
      "state.granted": "赠送",
      "state.toppedUp": "充值",
      "state.available": "可用",
      "state.unavailableAccount": "账户不可用",
      "action.refresh": "刷新",
      "action.retry": "重试",
      "error.noApiKey": "未配置 API Key",
      "error.unauthorized": "API Key 无效",
      "error.network": "网络错误",
      "error.timeout": "请求超时",
      "error.badJson": "响应解析失败",
      "error.http": "HTTP 错误",
      "error.unknown": "未知错误",
      "reset.label": "重置",
      "reset.none": "重置时间未知",
    };
    const en = {
      "provider.label": "Provider",
      "provider.deepseek": "DeepSeek",
      "provider.go": "OpenCode Go",
      "window.rolling": "5h",
      "window.weekly": "Week",
      "window.monthly": "Month",
      "state.loading": "Loading usage…",
      "state.unavailable": "Usage unavailable",
      "state.balance": "balance",
      "state.granted": "granted",
      "state.toppedUp": "topped up",
      "state.available": "available",
      "state.unavailableAccount": "account unavailable",
      "action.refresh": "Refresh",
      "action.retry": "Retry",
      "error.noApiKey": "no API key",
      "error.unauthorized": "invalid API key",
      "error.network": "network error",
      "error.timeout": "request timed out",
      "error.badJson": "bad response",
      "error.http": "HTTP error",
      "error.unknown": "unknown error",
      "reset.label": "resets",
      "reset.none": "reset time unknown",
    };

    /**
     * Stylesheet rendered with the strip. It carries the layout contract the
     * slot alone cannot express:
     *
     *   - the strip claims a full row (`flex: 1 1 100%`) and is ordered after
     *     the shipped composer-dock entries and the context meter, so it sits on
     *     its own line below them;
     *   - the composer dock row is the strip's box-tree parent, but its DOM
     *     parent is the slot's `display: contents` anchor
     *     (`<div data-slot="conversation.composer.dock">`), so the row is
     *     addressed through that anchor and only while this strip is inside it.
     *     That rule also tightens the row's own line gap, since the strip is the
     *     row's second line. The component verifies the result at runtime and
     *     falls back to setting the row's inline `flex-wrap`/`row-gap` (see
     *     {@link UsageStrip}).
     *
     * Everything else follows the shipped composer-dock pill language
     * (`StatsPills.module.css` and `ContextMeter.module.css`): the same type
     * size, pill geometry, hover fill and separator token. Only `--dsw-alias-*`
     * and the host's `--dsh-content-font-*` properties carry values.
     */
    const STRIP_CSS = [
      "[data-easy-balance]{flex:1 1 100%;order:1;min-width:0;margin-bottom:8px;display:flex;align-items:center;justify-content:center;flex-wrap:nowrap;gap:6px;overflow:hidden;white-space:nowrap;",
      "font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));",
      "color:var(--dsw-alias-label-tertiary)}",
      'div:has(>[data-easy-balance]),div:has(>[data-slot="conversation.composer.dock"]):has([data-easy-balance]){flex-wrap:wrap;row-gap:2px}',
      "[data-easy-balance] [data-part=pill]{box-sizing:border-box;max-width:100%;min-width:0;font:inherit;font-variant-numeric:tabular-nums;",
      "align-items:center;gap:6px;padding:1px 8px;display:inline-flex;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:999px}",
      "[data-easy-balance] [data-part=pill] svg{flex:none;width:14px;height:14px}",
      "[data-easy-balance] [data-part=label]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      "[data-easy-balance] [data-part=value]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      "[data-easy-balance] [data-part=error]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-state-error-primary)}",
      "[data-easy-balance] [data-part=percent]{flex:none;font-variant-numeric:tabular-nums}",
      "[data-easy-balance] [data-part=sep]{flex:none;color:var(--dsw-alias-separator-primary)}",
      "[data-easy-balance] [data-part=refresh]{flex:none;cursor:pointer;font:inherit;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:999px;padding:1px 8px}",
      "[data-easy-balance] [data-part=refresh]:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
    ].join("");

    /** Ring geometry, copied from the shipped context meter so both read as one family. */
    const RING_RADIUS = 5.5;
    const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

    /** Shared inline styles; only theme tokens carry color. */
    const S = {
      chip: {
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        maxWidth: 120,
        border: "1px solid var(--dsw-alias-border-l1)",
        borderRadius: 999,
        padding: "1px 8px",
        fontSize: 11,
        lineHeight: "16px",
        color: "var(--dsw-alias-label-secondary)",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      },
      chipDot: {
        width: 5,
        height: 5,
        borderRadius: "50%",
        background: "var(--dsw-alias-brand-primary)",
        flex: "0 0 auto",
      },
    };

    /** Stable no-op used when the model directory is unavailable. */
    const noop = () => {};

    /**
     * Token color for one usage percentage. Quiet while there is room (the same
     * tone the shipped ring uses) and semantic only near a limit.
     * @param percent - 0..100 or null.
     * @returns a theme token reference.
     */
    function tone(percent) {
      if (typeof percent !== "number" || !Number.isFinite(percent)) return "var(--dsw-alias-label-tertiary)";
      if (percent >= 90) return "var(--dsw-alias-state-error-primary)";
      if (percent >= 70) return "var(--dsw-alias-state-warn-primary)";
      return "var(--dsw-alias-label-tertiary)";
    }

    /**
     * One 14px progress ring, matching the shipped context meter's geometry.
     * @param props - percent (0..100 or null).
     * @returns the ring element.
     */
    function Ring(props) {
      const percent = typeof props.percent === "number" && Number.isFinite(props.percent) ? props.percent : null;
      const clamped = percent === null ? 0 : Math.max(0, Math.min(100, percent));
      return h(
        "svg",
        { viewBox: "0 0 14 14", width: 14, height: 14, "aria-hidden": "true", focusable: "false" },
        h("circle", {
          cx: 7,
          cy: 7,
          r: RING_RADIUS,
          fill: "none",
          stroke: "var(--dsw-alias-border-l3)",
          strokeWidth: 2,
        }),
        h("circle", {
          cx: 7,
          cy: 7,
          r: RING_RADIUS,
          fill: "none",
          stroke: tone(percent),
          strokeWidth: 2,
          strokeLinecap: "round",
          strokeDasharray: String((RING_CIRCUMFERENCE * clamped) / 100) + " " + String(RING_CIRCUMFERENCE),
          transform: "rotate(-90 7 7)",
        }),
      );
    }

    /**
     * @param code - provider error code from the Host.
     * @param t - bound translate.
     * @returns the user-facing message.
     */
    function errorText(code, t) {
      if (code === "no-api-key") return t("error.noApiKey");
      if (code === "unauthorized") return t("error.unauthorized");
      if (code === "network") return t("error.network");
      if (code === "timeout") return t("error.timeout");
      if (code === "bad-json") return t("error.badJson");
      if (typeof code === "string" && code.indexOf("http-") === 0) return t("error.http") + " " + code.slice(5);
      return t("error.unknown");
    }

    /**
     * @param iso - reset instant.
     * @returns a short local rendering, or null.
     */
    function resetText(iso) {
      if (typeof iso !== "string" || iso === "") return null;
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return iso;
      return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    }

    /**
     * @param currency - ISO currency code.
     * @returns a display prefix for the amount.
     */
    function currencyPrefix(currency) {
      if (currency === "CNY") return "¥";
      if (currency === "USD") return "$";
      return typeof currency === "string" && currency !== "" ? currency + " " : "";
    }

    /**
     * One usage window as a dock pill: name, ring, percent. The name is the
     * only part that truncates; the ring and number always stay readable.
     * @param props - label, window record, translate.
     * @returns the window pill.
     */
    function WindowPill(props) {
      const data = props.window || {};
      const percent = typeof data.percent === "number" && Number.isFinite(data.percent) ? data.percent : null;
      const reset = resetText(data.resetsAt);
      const title =
        props.label +
        ": " +
        (percent === null ? "?" : percent + "%") +
        " · " +
        (reset === null ? props.t("reset.none") : props.t("reset.label") + " " + reset);
      return h(
        "span",
        { "data-part": "pill", title },
        h("span", { "data-part": "label" }, props.label),
        h(Ring, { percent }),
        h(
          "span",
          {
            "data-part": "percent",
            "data-percent": percent === null ? "unknown" : String(percent),
            style: { color: tone(percent) },
          },
          percent === null ? "?" : percent + "%",
        ),
      );
    }

    /**
     * Wrap strip content in the row element that owns the stylesheet and the
     * full-row layout contract.
     * @param ref - receives the row element.
     * @param children - strip content.
     * @returns the strip element.
     */
    function strip(ref, ...children) {
      return h("div", { "data-easy-balance": "", ref }, h("style", null, STRIP_CSS), ...children);
    }

    /** Layout effects run before paint when the platform provides them. */
    const useLayoutEffect = React.useLayoutEffect === undefined ? React.useEffect : React.useLayoutEffect;

    /**
     * Ensure the composer dock row wraps, with the strip's own narrow line gap.
     * The stylesheet does this through the slot's `display: contents` anchor;
     * this check covers a row the selector cannot reach (an engine without
     * `:has()`, or a changed anchor), and restores the previous inline values
     * when the strip unmounts.
     * @param rowRef - the strip row element.
     */
    function useDockRowWrap(rowRef) {
      useLayoutEffect(() => {
        const root = rowRef.current;
        const anchor = root === null || root === undefined ? null : root.parentElement;
        const row = anchor === null || anchor === undefined ? null : anchor.parentElement;
        if (row === null || row === undefined || typeof getComputedStyle !== "function") return undefined;
        const computed = getComputedStyle(row);
        if (computed.display !== "flex" || (computed.flexWrap === "wrap" && computed.rowGap === "2px")) return undefined;
        const previousWrap = row.style.flexWrap;
        const previousRowGap = row.style.rowGap;
        row.style.flexWrap = "wrap";
        row.style.rowGap = "2px";
        return () => {
          row.style.flexWrap = previousWrap;
          row.style.rowGap = previousRowGap;
        };
      }, [rowRef]);
    }

    /**
     * Ambient strip: DeepSeek balance plus the OpenCode Go plan windows.
     * @param props - injected face (t).
     * @returns the strip element.
     */
    function UsageStrip(props) {
      const t = props.t;
      const [state, setState] = React.useState({ kind: "loading" });
      const runRef = React.useRef(null);
      const rowRef = React.useRef(null);

      useDockRowWrap(rowRef);

      React.useEffect(() => {
        let live = true;
        const run = (force) => {
          const url = force ? USAGE_PATH + "?refresh=1" : USAGE_PATH;
          fetch(url, { headers: { accept: "application/json" }, credentials: "same-origin" })
            .then((response) => {
              if (!response.ok) throw new Error("HTTP " + response.status);
              return response.json();
            })
            .then((body) => {
              if (live) setState({ kind: "ready", value: body });
            })
            .catch((error) => {
              if (live) setState({ kind: "failure", message: String((error && error.message) || error) });
            });
        };
        runRef.current = run;
        run(false);
        const timer = setInterval(() => run(false), POLL_MS);
        return () => {
          live = false;
          runRef.current = null;
          clearInterval(timer);
        };
      }, []);

      const refresh = React.useCallback(() => {
        const run = runRef.current;
        if (run === null) return;
        setState({ kind: "loading" });
        run(true);
      }, []);

      if (state.kind === "loading") {
        return strip(rowRef, h("span", { "data-part": "pill" }, h("span", { "data-part": "label" }, t("state.loading"))));
      }
      if (state.kind === "failure") {
        return strip(
          rowRef,
          h(
            "span",
            { "data-part": "pill" },
            h("span", { "data-part": "error" }, t("state.unavailable") + " · " + state.message),
          ),
          h("button", { "data-part": "refresh", type: "button", onClick: refresh }, t("action.retry")),
        );
      }

      const value = state.value || {};
      const deepseek = value.deepseek || {};
      const go = value.opencodeGo || {};

      const deepseekValue =
        deepseek.ok === true
          ? Array.isArray(deepseek.balances) && deepseek.balances.length > 0
            ? deepseek.balances
                .map((balance) => {
                  const entry = balance || {};
                  return currencyPrefix(entry.currency) + (entry.total === null || entry.total === undefined ? "—" : entry.total);
                })
                .join(" + ")
            : "—"
          : errorText(deepseek.error, t);
      const deepseekTitle =
        deepseek.ok === true
          ? t("provider.deepseek") +
            " · " +
            (deepseek.available === true ? t("state.available") : t("state.unavailableAccount")) +
            (Array.isArray(deepseek.balances)
              ? deepseek.balances
                  .map((balance) => {
                    const entry = balance || {};
                    return (
                      currencyPrefix(entry.currency) +
                      String(entry.total) +
                      " (" +
                      t("state.granted") +
                      " " +
                      String(entry.granted) +
                      ", " +
                      t("state.toppedUp") +
                      " " +
                      String(entry.toppedUp) +
                      ")"
                    );
                  })
                  .join(" · ")
              : "")
          : deepseekValue;

      const windows = go.ok === true && go.windows ? go.windows : null;

      // A category whose provider is not configured in this composition shows
      // nothing at all: no balance, no usage window, not even a placeholder.
      const showDeepSeek = deepseek.configured !== false;
      const showGo = go.configured !== false;
      if (!showDeepSeek && !showGo) return null;

      const content = [];
      if (showDeepSeek) {
        content.push(
          h(
            "span",
            { key: "deepseek", "data-part": "pill", title: deepseekTitle },
            h("span", { "data-part": "label" }, t("provider.deepseek")),
            h("span", { "data-part": deepseek.ok === true ? "value" : "error" }, deepseekValue),
          ),
        );
      }
      if (showDeepSeek && showGo) content.push(h("span", { key: "sep", "data-part": "sep" }, "|"));
      if (showGo) {
        content.push(h("span", { key: "go", "data-part": "pill", title: t("provider.go") }, h("span", { "data-part": "label" }, t("provider.go"))));
        if (windows === null) {
          content.push(
            h("span", { key: "go-error", "data-part": "pill" }, h("span", { "data-part": "error" }, errorText(go.error, t))),
          );
        } else {
          content.push(h(WindowPill, { key: "rolling", label: t("window.rolling"), window: windows.rolling, t }));
          content.push(h(WindowPill, { key: "weekly", label: t("window.weekly"), window: windows.weekly, t }));
          content.push(h(WindowPill, { key: "monthly", label: t("window.monthly"), window: windows.monthly, t }));
        }
      }
      content.push(
        h(
          "button",
          { key: "refresh", "data-part": "refresh", type: "button", onClick: refresh, title: t("action.refresh") },
          t("action.refresh"),
        ),
      );

      return strip(rowRef, ...content);
    }

    /**
     * Provider chip for the composer model row.
     * @param props - injected face (directories, t) plus the session identity.
     * @returns the chip, or null while no selection is known.
     */
    function ProviderChip(props) {
      const t = props.t;
      const directories = props.directories;
      const sessionId = props.sessionId;

      const directory = React.useMemo(() => {
        if (directories === undefined || directories === null || typeof directories.directoryFor !== "function") return null;
        if (sessionId === undefined || sessionId === null) return null;
        try {
          return directories.directoryFor(sessionId);
        } catch {
          return null;
        }
      }, [directories, sessionId]);

      const store = directory === null ? null : directory.store;
      const subscribe = React.useCallback(
        (notify) => {
          if (store === null) return noop;
          return store.subscribe(notify);
        },
        [store],
      );
      const getSnapshot = React.useCallback(() => (store === null ? null : store.getSnapshot()), [store]);
      const state = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

      React.useEffect(() => {
        if (directory === null) return undefined;
        let live = true;
        Promise.resolve()
          .then(() => (live ? directory.load() : undefined))
          .catch(() => {});
        return () => {
          live = false;
        };
      }, [directory]);

      const current = state !== null && state !== undefined && state.current ? state.current : null;
      if (current === null || typeof current.provider !== "string" || current.provider === "") return null;

      const groups = state !== null && state !== undefined && Array.isArray(state.groups) ? state.groups : [];
      const found = groups.find((group) => group !== null && typeof group === "object" && group.id === current.provider);
      const label = found !== undefined && typeof found.name === "string" && found.name !== "" ? found.name : current.provider;

      return h(
        "span",
        {
          style: S.chip,
          title: t("provider.label") + ": " + current.provider + " · " + String(current.model),
          "data-provider": current.provider,
        },
        h("span", { style: S.chipDot, "aria-hidden": "true" }),
        h("span", { style: { overflow: "hidden", textOverflow: "ellipsis" } }, label),
      );
    }

    /**
     * Contribute both seats over the locale dictionaries.
     * @param ctx - Client root context.
     */
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "easy-balance: dictionaries");
      const t = ctx.locale.bind(NS);

      ctx.slots.inject("conversation.composer.dock", () =>
        ctx.slots.register(
          {
            name: "conversation.composer.dock",
            id: "easy-balance.usage",
            order: 20,
            inject: () => ({ t }),
          },
          UsageStrip,
        ),
      );

      ctx.inject(["slots", "modelDirectories"], (scope) => {
        scope.slots.inject("conversation.input.right", () =>
          scope.slots.register(
            {
              name: "conversation.input.right",
              id: "easy-balance.provider",
              order: 50,
              inject: () => ({ t, directories: scope.modelDirectories }),
            },
            ProviderChip,
          ),
        );
      });
    }

    return { inject: ["slots", "locale"], apply };
  },
});
