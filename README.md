# OpenCode Kiro Auth Plugin

[![release](https://img.shields.io/github/v/release/jtdelia/opencode-kiro-auth)](https://github.com/jtdelia/opencode-kiro-auth/releases)

OpenCode plugin for AWS Kiro (CodeWhisperer). It signs in with your Kiro account and
advertises the models that account can use, including Claude, GPT-5.6, and the
open-weight models Kiro lists. Display names include Kiro's credit rate.

## Features

- **Multiple Auth Methods**: Supports AWS Builder ID (IDC), IAM Identity Center (custom
  Start URL), and Kiro Desktop (CLI-based) authentication.
- **Auto-Sync Kiro CLI**: Automatically imports and synchronizes active sessions from
  your local `kiro-cli` SQLite database.
- **Model Autodiscovery**: Lists the models Kiro reports for the signed-in account
  via `ListAvailableModels`, and falls back to the built-in catalog if that call
  fails.
- **Gradual Context Truncation**: Intelligently prevents error 400 by reducing context
  size dynamically during retries.
- **Intelligent Account Rotation**: Prioritizes multi-account usage based on lowest
  available quota.
- **Local account storage**: Stores accounts and usage in a local libsql database.
- **Native Thinking Mode**: Streams Kiro's native reasoning to OpenCode's thinking
  block, with the reasoning flags declared on every thinking model, so it renders
  without any model configuration.
- **Kiro Effort Mapping**: Maps OpenCode thinking budgets to Kiro's native effort
  levels automatically, across the full `low`–`max` ladder.
- **Automated Recovery**: Exponential backoff for rate limits and automated token
  refresh.

## Installation

OpenCode 2.0.22 loads this plugin from a directory. `opencode plugin add` accepts a
`github:` spec, then the bundled installer stops with `Fetching packages of type "git"
have been disabled`.

Clone the release and add that directory to `plugins`:

```sh
git clone --branch v2.1.0 --depth 1 https://github.com/jtdelia/opencode-kiro-auth.git
```

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-kiro-auth"]
}
```

OpenCode loads `index.ts` from that directory and registers the `kiro` provider. It
advertises the models your Kiro account can use. After login it calls
`ListAvailableModels` on the Q API, overlays display names, credit rates, and
`-thinking` companions from the built-in catalog, and falls back to that catalog
if discovery fails or is disabled. Run `/models` to pick one.

Defining `provider.kiro.models` yourself replaces the plugin's registry entirely.
Only do that to rename or restrict models, and see the reasoning flags below if
any of them are `-thinking` models.

### Thinking Effort Configuration

Every effort-capable Claude model gets a `-thinking` companion, already carrying
the reasoning flags and an effort ladder as variants. GPT-5.6 Sol / Terra / Luna
put that same ladder on the base model. Nothing to configure: pick the model and
cycle its variants to change reasoning depth.

Each `-thinking` entry declares two fields that OpenCode needs in order to render
reasoning:

```json
{
  "reasoning": true,
  "interleaved": { "field": "reasoning_content" }
}
```

Both are required. `reasoning` declares the capability, and `interleaved.field`
tells OpenCode that reasoning arrives in the non-standard `reasoning_content`
delta this plugin emits. If either is missing, OpenCode silently drops every
reasoning chunk and no thinking block appears.

If you override `provider.kiro.models` in your own config, you replace the
plugin's registry wholesale — copy both fields onto any `-thinking` model you
define, or reasoning will stop rendering.

Reasoning itself comes from the API: Kiro streams `reasoningContentEvent` on
thinking models, and the plugin forwards each one as a `reasoning_content` delta.
Nothing needs to be enabled for that. Models that instead inline reasoning as
`<thinking>` tags in their answer are still handled, via a fallback scraper.

Variants set `thinkingConfig.thinkingBudget`, which the plugin maps to Kiro's
native `effort` field. Bands are scaled to Kiro's real thinking ceiling
(1024-128000 on opus-4.8/opus-5), so every effort level including `xhigh` is
reachable from a budget alone:

| OpenCode budget | Kiro effort |
| --------------- | ----------- |
| `<= 16384` | `low` |
| `<= 32768` | `medium` |
| `<= 65536` | `high` |
| `<= 98304` | `xhigh` |
| `> 98304` | `max` |

`xhigh` is only available on opus-4.7, opus-4.8, opus-5, opus-5.5, sonnet-5, and sonnet-5.5. Those models
get a five-variant ladder; the rest get four, and a budget in the `xhigh` band is
clamped to `max`.

GPT-5.6 Sol, Terra, and Luna carry the same `low`–`max` variant ladder on the
base model (no `-thinking` companion). Cycling variants sets Kiro's
`reasoning.effort`. There is no visible reasoning block — GPT hides its
chain-of-thought.

Use `~/.config/opencode/kiro.json` for plugin-wide behavior such as auth sync,
account selection, retry limits, and `auto_effort_mapping`. A top-level `effort`
setting is a global override for all supported models, not a per-model setting.

## Setup

1. **Authentication via Kiro CLI (Recommended)**:
   - Perform login directly in your terminal using `kiro-cli login`.
   - The plugin automatically bootstraps a minimal `kiro` placeholder in
     OpenCode's `auth.json` when it detects the Kiro CLI database, then imports
     and synchronizes your active session on startup.
   - For AWS IAM Identity Center (SSO/IDC), the plugin imports both the token and device
     registration (OIDC client credentials) from the `kiro-cli` database.
2. **Direct Authentication**:
   - Run `opencode auth login`.
   - Select `Other`, type `kiro`, and press enter.
   - You'll be prompted for your **IAM Identity Center Start URL** and **IAM Identity
     Center region** (`sso_region`).
     - Leave it blank to sign in with **AWS Builder ID**.
     - Enter your company's Start URL (e.g. `https://your-company.awsapps.com/start`) to
       use **IAM Identity Center (SSO)**.
   - Note: the TUI `/connect` flow currently does **not** run plugin OAuth prompts
     (Start URL / region), so Identity Center logins may fall back to Builder ID unless
     you use `opencode auth login` (or preconfigure defaults in
     `~/.config/opencode/kiro.json`).
   - For **IAM Identity Center**, you may also need a **profile ARN** (`profileArn`).
     - If `kiro-cli` is installed and you've selected a profile once
       (`kiro-cli profile`), the plugin auto-detects it.
     - Otherwise, set `idc_profile_arn` in `~/.config/opencode/kiro.json`.
   - A browser window will open directly to AWS' verification URL (no local auth
     server). If it doesn't, copy/paste the URL and enter the code printed by OpenCode.
   - You can also pre-configure defaults in `~/.config/opencode/kiro.json` via
     `idc_start_url` and `idc_region`.
3. Configuration will be automatically managed at `~/.config/opencode/kiro.db`.

## Local plugin development

Point OpenCode at a checkout:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/opencode-kiro-auth"]
}
```

OpenCode loads `index.ts` from that directory. Restart OpenCode after you change the
plugin.

## Troubleshooting

### Error: Status: 403 (AccessDeniedException / User is not authorized)

If you're using **IAM Identity Center** (a custom Start URL), the Q Developer /
CodeWhisperer APIs typically require a **profile ARN**.

This plugin reads the active profile ARN from your local `kiro-cli` database
(`state.key = api.codewhisperer.profile`) and sends it as `profileArn`.

Fix:

1. Run `kiro-cli profile` and select a profile (e.g. `QDevProfile-us-east-1`).
2. Retry `opencode auth login` (or restart OpenCode so it re-syncs).

### Error: No accounts

This happens when the plugin has no records in `~/.config/opencode/kiro.db`.

1. Ensure `kiro-cli login` succeeds.
2. Ensure `auto_sync_kiro_cli` is `true` in `~/.config/opencode/kiro.json`.
3. Retry the request; the plugin will attempt a Kiro CLI sync when it detects zero
   accounts.

### Note: `/connect` vs `opencode auth login`

If you need to enter provider-specific values for an OAuth login (like IAM Identity
Center Start URL / region), use `opencode auth login`. The current TUI `/connect` flow
may not display plugin OAuth prompts, so it can’t collect those inputs.

Note for IDC/SSO (OIDC): the plugin may temporarily create an account with a placeholder
email if it cannot fetch the real email during sync (e.g. offline).
It will replace it with the real email once usage/email lookup succeeds.

### Kiro CLI (Google/GitHub OAuth) users: plugin sync does not start

If you authenticated via `kiro-cli login` using Google or GitHub OAuth (not AWS Builder
ID or IAM Identity Center), OpenCode still needs a stored `kiro` auth entry before it
will call the plugin loader.

The plugin now creates that minimal placeholder automatically when it detects the local
Kiro CLI database. Restart OpenCode after `kiro-cli login`; the loader should then run
and sync your actual tokens into `kiro.db`. The placeholder values are not used for API
calls.

If bootstrap is skipped because `auth.json` is malformed, fix the JSON first. The plugin
will not overwrite malformed auth files because they may contain other provider
credentials.

**Important:** Ensure `auto_sync_kiro_cli` is `true` in `~/.config/opencode/kiro.json`
and that `kiro-cli login` succeeds.

The plugin supports extensive configuration options.
Edit `~/.config/opencode/kiro.json`:

```json
{
  "auto_sync_kiro_cli": true,
  "auto_discover_models": true,
  "account_selection_strategy": "lowest-usage",
  "default_region": "us-east-1",
  "idc_start_url": "https://your-company.awsapps.com/start",
  "idc_region": "us-east-1",
  "rate_limit_retry_delay_ms": 5000,
  "rate_limit_max_retries": 3,
  "max_request_iterations": 20,
  "request_timeout_ms": 120000,
  "token_expiry_buffer_ms": 300000,
  "web_search_enabled": true,
  "usage_sync_max_retries": 3,
  "usage_tracking_enabled": true,
  "auto_effort_mapping": true,
  "enable_log_api_request": false
}
```

### Configuration Options

- `auto_sync_kiro_cli`: Automatically sync sessions from Kiro CLI (default: `true`).
- `auto_discover_models`: Fetch Kiro's live model list and advertise those IDs
  (default: `true`). Disable to keep the static catalog only.
- `account_selection_strategy`: Account rotation strategy (`sticky`, `round-robin`,
  `lowest-usage`).
- `default_region`: AWS region for Kiro API calls. Defaults to `us-east-1`.
- `idc_start_url`: Default IAM Identity Center Start URL (e.g.
  `https://your-company.awsapps.com/start`). Leave unset/blank to default to AWS Builder
  ID.
- `idc_region`: IAM Identity Center (SSO OIDC) region (`sso_region`). Defaults to
  `us-east-1`.
- `rate_limit_retry_delay_ms`: Delay between rate limit retries (1000-60000ms).
- `rate_limit_max_retries`: Maximum retry attempts for rate limits (0-10).
- `max_request_iterations`: Maximum loop iterations to prevent hangs (5-1000, default
  20).
- `request_timeout_ms`: Request timeout in milliseconds (30000-600000, default 120000).
- `token_expiry_buffer_ms`: Token refresh buffer time (30000-300000, default 300000).
- `usage_sync_max_retries`: Retry attempts for usage sync (0-5).
- `auth_server_port_start`: Legacy/ignored (no local auth server).
- `auth_server_port_range`: Legacy/ignored (no local auth server).
- `usage_tracking_enabled`: Enable usage tracking and toast notifications (default:
  `true`).
- `web_search_enabled`: Register Kiro's `kiro_web_search` tool (default: `true`).
  Kiro runs the search and bills it as credits. The tool is omitted on free Builder
  ID accounts, which have no profile ARN. Set this to `false` when another search
  tool should handle queries.
- `auto_effort_mapping`: Automatically map OpenCode thinking budgets to Kiro effort
  levels for supported models (default: `true`).
- `enable_log_api_request`: Enable detailed API request logging. Request logs
  include the resolved `additionalModelRequestFields`, so this is how you confirm
  which effort level actually went out on the wire.

## Storage

**Linux/macOS:**

- SQLite Database: `~/.config/opencode/kiro.db`
- Plugin Config: `~/.config/opencode/kiro.json`

**Windows:**

- SQLite Database: `%APPDATA%\opencode\kiro.db`
- Plugin Config: `%APPDATA%\opencode\kiro.json`

## Acknowledgements

Special thanks to [AIClient-2-API](https://github.com/justlovemaki/AIClient-2-API) for
providing the foundational Kiro authentication logic and request patterns.

## Disclaimer

This plugin is provided strictly for learning and educational purposes.
It is an independent implementation and is not affiliated with, endorsed by, or
supported by Amazon Web Services (AWS) or Anthropic.
Use of this plugin is at your own risk.

Feel free to open a PR to optimize this plugin further.
