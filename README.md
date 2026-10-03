# dsh-easy-balance

A DeepSeek Harness Web UI plugin that adds two ambient facts to the conversation:

1. **Provider beside the model** — a small chip immediately left of the composer's
   model selector showing which provider serves the selected model
   (`opencode-go`, `lm-studio`, `deepseek`, …). Hovering it names the exact
   `provider · model` pair. The chip follows the same durable selection the
   selector renders, so switching a model switches the chip.
2. **Balances below the composer** — an ambient strip on its **own row** under the
   round/context row of the composer dock, showing the **DeepSeek account
   balance** and the **OpenCode Go plan usage** for the 5-hour rolling, weekly
   and monthly windows. Each window is one pill in the shipped composer-dock
   language: a 14px progress ring (the same geometry and tone as the context
   meter, turning amber past 70% and red past 90%), the window name, and the
   percent used; hovering shows the reset instant. A refresh control forces a
   fresh read; the strip otherwise refreshes itself every 5 minutes.

Layout contract: the strip claims the full dock row (`flex: 1 1 100%`) and is
`order: 1`, so it renders after the shipped stats pills and the context meter and
the dock row wraps it onto its own line. That line keeps a small gap from the row
above (`row-gap: 2px` on the dock row) and its own `margin-bottom: 8px` below. It
never wraps internally: text truncates with an ellipsis while the rings and
numbers stay legible, so sidebars can squeeze the composer without the strip
growing to two or three lines. Every text run — the DeepSeek amount included —
uses the same tertiary label tone; only a ring past 70%/90% switches to the warn
or error tone.

The dock row is the strip's *box-tree* parent but not its DOM parent: slot
entries render inside the slot's `display: contents` anchor
(`<div data-slot="conversation.composer.dock">`). The stylesheet therefore
addresses the row through that anchor
(`div:has(> [data-slot="conversation.composer.dock"]):has([data-easy-balance])`),
and the component also checks the row's computed `flex-wrap` after mount and
falls back to setting the row's inline `flex-wrap` when the selector could not
reach it (an engine without `:has()`, or a changed anchor), restoring the
previous value on unmount.

## Install

```
dsh plugin --profile <profile> add /absolute/path/to/dsh-easy-balance
```

or install the local directory through the Plugin Manager (`install_bundle`).
The bundle patch inserts one Host row (`easy-balance`); the package also declares a
`dsh.client` half, so the browser bundle is served from `/plugins`.

## How it works

| Half | File | Role |
| --- | --- | --- |
| Host | `index.js` | Registers `GET /easy-balance/usage`, reads both providers, caches a successful read for 45 s |
| Client | `client.js` | Registers `conversation.input.right` (provider chip) and `conversation.composer.dock` (balance strip) |

Both upstream reads need credentials, so they happen on the Host and never in
the browser:

| Fact | Endpoint | Credential reference |
| --- | --- | --- |
| DeepSeek balance | `GET https://api.deepseek.com/user/balance` | `DEEPSEEK_API_KEY` |
| OpenCode Go usage | `GET https://opencode.ai/zen/go/v1/usage` | `OPENCODE_GO_API_KEY` |

Credentials resolve through `ctx.credentials` (the same seam that fills
`$DSH_HOME/.credentials.yaml`), so a rotated key reaches the next read without a
restart. The route answers only requests the connection layer admits, sends
`cache-control: no-store`, and never includes a key in the response body.

`GET /easy-balance/usage?refresh=1` skips a cached value; a request that arrives
while a read is in flight joins that read instead of starting another.

A category is reported only when its provider is actually part of the profile:
the composition must expose a registered `llm` route for it (any `deepseek*`
route for the balance, `opencode-go` for the plan usage) **and** resolve that
provider's credential. Without both, the Host answers `{ "configured": false }`
without calling upstream at all, and the Client renders nothing for that
category — no balance, no usage window, not even an error placeholder; the strip
disappears entirely when no category is configured. A *configured* provider that
fails still reports its error, so a real failure stays visible.

## Response shape

```json
{
  "fetchedAt": 1759330000000,
  "deepseek": {
    "configured": true,
    "ok": true,
    "available": true,
    "balances": [
      { "currency": "CNY", "total": "68.04", "granted": "0.00", "toppedUp": "68.04" }
    ]
  },
  "opencodeGo": {
    "configured": true,
    "ok": true,
    "windows": {
      "rolling": { "status": "ok", "percent": 6, "resetsAt": "2026-10-01T16:30:03.186Z" },
      "weekly": { "status": "ok", "percent": 6, "resetsAt": "2026-10-05T00:00:00.000Z" },
      "monthly": { "status": "ok", "percent": 16, "resetsAt": "2026-10-20T08:07:46.000Z" }
    }
  }
}
```

| Result | Meaning |
| --- | --- |
| `{ "configured": false }` | Provider not configured (no route, or no credential) — the Client hides the category |
| `{ "configured": true, "ok": true, ... }` | Current value |
| `{ "configured": true, "ok": false, "error": "<code>" }` | Configured but the read failed: `unauthorized`, `network`, `timeout`, `bad-json`, `http-<status>` |

One category failing never hides the other.

## Tests

`node test/smoke.mjs` runs both halves offline: it materializes the Client
bundle against a React stub (slot ids, rendered text, error mapping), drives the
Host route handler against a stubbed `fetch`, and asserts the credential
references, cache, `?refresh=1` bypass, method guard and connection fence. It is
a logic test, not visual verification.

## Design notes and limits

- **Additive seats.** The provider chip uses `conversation.input.right`, an
  ordered list slot with no shipped occupants, so nothing is shadowed. The strip
  uses `conversation.composer.dock` beside the shipped `stats` entry, and claims
  its own row by addressing that slot's own anchor (see above); no shipped class
  name is referenced.
- **Theme consistency.** The strip ships its stylesheet as a `<style>` element
  inside its own row (removed with the component), referencing only
  `--dsw-alias-*` tokens and the host's `--dsh-content-font-*` properties, so
  light and dark palettes and host font scaling both apply. No Harness Client
  package is imported at runtime.
- **The provider chip outlives a model-catalog reset.** It resolves the session's
  model directory on *every* render — `directoryFor` keys directories by the
  session's current binding and hands out a fresh one after a re-attach, disposing
  the old store, so a memoized directory freezes on a dead store — reads the
  provider from the durable `modelSelection` projection when the shared model
  catalog has been cleared (a Host generation reset nulls the directory's
  `current`), and asks a cleared catalog to reload on its own (15 s throttle) so
  the label returns without the user opening the model menu.
- **DeepSeek category needs the API-key route.** It reads the platform balance with
  `DEEPSEEK_API_KEY`. A DSH *account* sign-in alone (the `deepseek-account` route)
  does not show a balance, because that figure comes from a different service.
- **No fixed dollar limits.** The OpenCode Go endpoint reports percentages only,
  and the plan's monthly limit differs per model, so the strip shows percent
  plus reset time rather than deriving an amount.
- **Route path.** `/easy-balance/usage` is the only path this plugin adds. Renaming
  it means changing `USAGE_PATH` in both halves.
- The strip is per-session ambient chrome; its reads are shared process-wide by
  the Host cache, so opening many sessions does not multiply upstream calls.
- The provider chip renders nothing until the session has a known model
  selection, matching the model selector's own fallback behaviour.
- The chip shows the catalog's provider name. A route without a `displayName`
  in `llm-pi-ai` falls back to its route id (`opencode-go`), so adding
  `displayName: OpenCode Go` to that provider entry makes both the chip and the
  model menu's group heading read nicer.
