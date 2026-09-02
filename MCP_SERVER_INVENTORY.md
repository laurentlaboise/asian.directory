# MCP Server Inventory — Portable Reference

**Owner:** laurentlaboise · **Repo context:** `asian.directory` · **Captured:** 2026-09-02
**Scope:** 25 MCP servers · 850 tools exposed to the assistant session this was captured from.

This file is written to be **model-agnostic**. Hand it to Claude, GPT, Gemini, Llama, Mistral,
Cursor, Windsurf, Cline, Copilot, or any agent framework that speaks the Model Context Protocol.
Nothing below depends on a specific vendor's prompt format — the tool names are the MCP tool names
as published by each server, and the wiring section covers every major client shape.

---

## 0. How to use this file with any assistant

Three ways, in order of usefulness:

1. **As a capability map.** Paste §2 (the table) into any assistant's context and ask it to pick
   the right server for a task. It does not need the servers connected to reason about them.
2. **As a connection guide.** §5 gives the config shape for every major MCP client. The server
   list in §3 tells you which ones are worth wiring for a given kind of work.
3. **As a tool index.** §8 is the complete flat list of tool names, grouped by server, for
   grepping, for building allowlists, and for pre-flighting whether an agent can do a job before
   you give it the job.

**One caveat that applies everywhere:** tool names are stable, transport endpoints are not.
Vendors move their MCP URLs. Always confirm the current endpoint in the vendor's own docs before
pasting a URL into a config. §6 flags which ones are volatile.

---

## 1. Naming convention

In the session this was captured from, tools are namespaced:

```
mcp__<ServerName>__<tool_name>
```

Other clients namespace differently — Cursor and VS Code show `server.tool`, the OpenAI Agents SDK
exposes the bare `tool_name` under a server object, LangChain adapters usually flatten to
`tool_name`. **Strip the `mcp__<Server>__` prefix to get the canonical MCP tool name.**
Everything in §8 is listed with the prefix so it round-trips cleanly either way.

---

## 2. The inventory at a glance

| # | Server | Category | Tools | Write access | Primary use |
|---|--------|----------|-------|--------------|-------------|
| 1 | ElevenLabs | Media generation / voice agents | 103 | Yes | TTS, image/video gen, transcription, conversational agent platform |
| 2 | Make | Automation platform | 96 | Yes | Scenario CRUD, execution logs, data stores, webhooks, blueprint validation |
| 3 | ClickUp | Project management | 58 | Yes | Tasks, lists, docs, time tracking, chat, reminders |
| 4 | GitHub | Code hosting / CI | 55 | Yes | Repos, PRs, issues, Actions, reviews, code search, secret scanning |
| 5 | Airtable | Database / no-code | 43 | Yes | Bases, tables, records, fields, interfaces, automations |
| 6 | Figma | Design | 42 | Yes | Design-to-code, code-to-design, Code Connect, FigJam, shaders |
| 7 | Notion | Docs / knowledge base | 41 | Yes | Pages, databases, comments, search, agent sessions |
| 8 | Lovable | AI app builder | 40 | Yes | Project creation, agent messaging, deploys, DB queries, analytics |
| 9 | Vercel | Hosting / deploys | 37 | Yes | Deploys, build + runtime logs, projects, domains, web analytics |
| 10 | Calendly | Scheduling | 36 | Yes | Event types, availability, bookings, routing forms, invitees |
| 11 | Lucid | Diagramming | 34 | Yes | ERDs, org charts, mind maps, sequence diagrams, SVG import |
| 12 | Canva | Design / brand | 32 | Yes | Design generation, brand templates, exports, folders, comments |
| 13 | Asana | Project management | 31 | Yes | Tasks, projects, portfolios, status updates, search |
| 14 | Gmail | Email | 29 | Yes | Search, read, send, reply, forward, drafts, labels |
| 15 | Shopify | E-commerce | 26 | Yes | Products, collections, orders, inventory, discounts, GraphQL Admin |
| 16 | Bitly | Link management | 26 | Yes | Short links, QR codes, click analytics, bulk upload |
| 17 | Cloudflare Developer Platform | Infrastructure | 23 | Yes | D1, KV, R2, Hyperdrive, Workers inspection, docs search |
| 18 | Claude Code Remote | Agent orchestration | 22 | Yes | Spawn sessions, cron triggers, PR subscriptions, repo attach |
| 19 | Slack | Messaging | 20 | Yes | Read/send messages, threads, canvases, search, reactions |
| 20 | Zapier | Automation broker | 16 | Yes | Dynamic access to 9,000+ apps via enable/execute action pattern |
| 21 | Supermetrics | Marketing analytics | 14 | Partial | 150+ ad/analytics sources, campaign reads + creates |
| 22 | Google Drive | File storage | 11 | Yes | Search, read, create, share, trash files |
| 23 | Google Calendar | Scheduling | 9 | Yes | Events CRUD, availability, time suggestions |
| 24 | Booking.com | Travel data | 3 | No | Accommodation search, attractions, property Q&A |
| 25 | Tripadvisor | Travel data | 3 | No | Hotel search, details, comparison |

**Totals:** 25 servers · 850 tools · 23 with write access · 2 read-only.

---

## 3. Server profiles

Each profile is written so an assistant with no prior knowledge of the server can decide whether
to reach for it, and knows the call order that actually works.

### ElevenLabs — 103 tools
Two distinct halves. **Creative** (`creative_*`, 23 tools) generates speech, images, video, and
transcriptions onto an editable "flow" canvas. **Agents** (`agents_*`, 79 tools) is the full
conversational-agent platform: agent CRUD, knowledge bases with RAG, phone numbers, tests,
branches, deployments, triage tickets.

- Call order for media: `creative_create_flow` → `creative_generate_*` → poll
  `creative_get_flow_run_status` until `all_completed`.
- Speech requires a `voice_id` from `creative_list_voices` — never invent one.
- Chained generations (lipsync, voiceover over video) must share one `flow_id`.
- Local files: `creative_create_asset_upload` → PUT bytes → `creative_finalize_asset_upload`.
  A public https URL can skip all three via `creative_attach_reference_file`.

### Make — 96 tools
The deepest automation surface here. Full scenario lifecycle (create, activate, run, replay),
execution history with per-module detail, data stores, data structures, webhooks with learn mode,
connections, teams, organizations, and a set of `validate_*` tools that check blueprints before
you commit them.

- Validate before writing: `validate_blueprint_schema`, `validate_module_configuration`,
  `validate_scheduling_schema` catch most scenario errors offline.
- `apps_recommend` + `app-modules_list` + `app_documentation_get` is the discovery path when you
  don't know which module implements a step.

### ClickUp — 58 tools
Task management plus docs, chat, and time tracking. Start from
`clickup_get_workspace_hierarchy` — nearly every other call needs a list/folder/space ID from it.
`clickup_search` and `clickup_filter_tasks` cover retrieval; `clickup_resolve_assignees` and
`clickup_find_member_by_name` translate human names into IDs.

### GitHub — 55 tools
Repos, branches, commits, file CRUD, PRs with full review workflow, issues with sub-issues and
types, Actions runs and job logs, code/commit/PR/user search, secret scanning, and PR activity
subscriptions.

- PR reviews: `pull_request_review_write(create)` → `add_comment_to_pending_review` (repeat) →
  `pull_request_review_write(submit_pending)`. Single-shot comments skip the pending flow.
- Use `list_*` for enumeration, `search_*` for criteria. Set `minimal_output` when you only need
  IDs — these responses get large fast.

### Airtable — 43 tools
Bases, tables, fields, records, views, interfaces, pages, automations, comments. The documented
call order matters: `search_bases` → `list_tables_for_base` → `get_table_schema` (required before
filtering on select fields, to get choice IDs) → `list_records_for_table`.

- Bases with `interfaceOnly` permission reject table-level reads. Use `list_records_for_page` /
  `get_record_for_page` instead.
- Always operate on internal IDs (`app…`, `tbl…`, `fld…`, `rec…`), never display names.

### Figma — 42 tools
Bidirectional. **Read:** `get_design_context`, `get_screenshot`, `get_metadata`,
`get_variable_defs`, `get_figjam`. **Write:** `use_figma`, `create_new_file`, `generate_diagram`,
`upload_assets`. **Bridge:** `get_code_connect_map` / `add_code_connect_map` link Figma components
to codebase components. Also shaders and generative plugins.

- `use_figma` has a mandatory skill to load first (`/figma-use` or the `skill://` fallback).

### Notion — 41 tools
Pages, databases, data sources, views, folders, comments, attachments, plus an agent-session
subsystem (`notion-spawn-session`, `notion-send-message-to-session`, `notion-wait-session`).
`notion-search` is the entry point; `notion-fetch` retrieves by URL or ID.

### Lovable — 40 tools
AI app builder driving a cloud sandbox (TypeScript + Tailwind + shadcn/ui). You talk to *its*
agent: `create_project(initial_message, workspace_id)` then `send_message`. `plan_mode=true`
discusses before writing code. `get_diff` reviews what changed. Consumes workspace credits.

### Vercel — 37 tools
Deploys, build logs, runtime logs and errors, projects, teams, domains (including purchase),
deployment protection, web analytics, and the collaboration toolbar threads. `get_runtime_errors`
+ `get_deployment_build_logs` are the debugging pair.

### Calendly — 36 tools
Event types, availability schedules, busy times, bookings, invitees, no-shows, routing forms,
organization membership, single-use scheduling links. **Always ground first** with
`users-get_current_user` — every downstream call needs the host URI, and URI ≠ URL.

### Lucid — 34 tools
Structured diagram generation: `lucid_create_erd`, `lucid_create_org_chart`,
`lucid_create_mind_map`, `lucid_create_sequence_diagram`, plus generic
`lucid_create_diagram_from_specification` and SVG conversion. Export via
`lucid_export_document_as_PNG`.

### Canva — 32 tools
`generate-design` / `generate-design-structured` create from a prompt; `create-design-from-brand-template`
enforces brand consistency; `export-design` produces files; `search-designs` / `search-folders`
navigate. Brand kits and templates are first-class.

### Asana — 31 tools
Tasks, projects, portfolios, teams, status updates, attachments, comments, and templates.
`search_objects` is the general finder; `get_my_tasks` is the personal view. Preview variants
(`create_task_preview_v4`) render before committing.

### Gmail — 29 tools
Full mailbox control: `search_threads` (Gmail query syntax), `get_thread`, `send_message`,
`reply`, `forward`, drafts, labels, spam, trash. Sending is irreversible — draft first when the
recipient is external.

### Shopify — 26 tools
Products, collections, orders, customers, inventory, discounts, ShopifyQL analytics — plus
`graphql_query` / `graphql_mutation` against the Admin API for everything without a dedicated
tool (metafields, metaobjects, pages, markets, gift cards). `graphql_schema` and
`validate_graphql_codeblocks` help you construct those correctly.

### Bitly — 26 tools
Short links, QR codes (create, update, fetch image, analytics), click analytics at link and group
level, custom domains, bulk upload, data export. Every tool takes `response_format` (`json` or
`text`).

### Cloudflare Developer Platform — 23 tools
D1 (create/query/delete SQL databases), KV namespaces, R2 buckets, Hyperdrive configs, Workers
listing and source inspection, plus `search_cloudflare_documentation`. Note: Workers are
**read-only** here — you can inspect code, not deploy it.

### Claude Code Remote — 22 tools
Agent-orchestration layer: spawn and message sibling sessions, attach GitHub repos mid-session,
create cron/one-shot triggers, schedule self-reminders (`send_later`), subscribe to PR activity,
and register inbound webhooks. Vendor-specific to Claude Code — not portable to other clients.

### Slack — 20 tools
Read channels and threads, send and schedule messages, search public and private, canvases,
reactions, user profiles, channel membership. `slack_send_message_draft` proposes before posting.

### Zapier — 16 tools
A broker, not a fixed toolset. `discover_zapier_actions` searches 9,000+ apps →
`enable_zapier_action` adds one → `inspect_zapier_actions` returns its exact schema →
`execute_zapier_read_action` / `execute_zapier_write_action` runs it. **Always inspect before
executing** — the parameter schema is dynamic and resolved per connection.

### Supermetrics — 14 tools
150+ marketing data sources behind one query interface. Fixed call order:
`data_source_discovery()` → `data_source_discovery(ds_id)` → `accounts_discovery` +
`field_discovery` → `data_query` → `get_async_query_results` until ready. Also creates and
updates campaigns on supported platforms.

### Google Drive — 11 tools
Search, read content, download, create, update, copy, share, permissions, trash. `search_files`
supports Drive query syntax; `read_file_content` handles Google-native formats.

### Google Calendar — 9 tools
Events CRUD, multi-calendar listing, search, RSVP, and `suggest_time` for finding mutual
availability.

### Booking.com — 3 tools (read-only)
`accommodations_search`, `attractions_search`, `answer_property_qa_by_ids_v2`.

### Tripadvisor — 3 tools (read-only)
`search_hotels`, `hotel_details`, `compare_hotels`.

---

## 4. Task → server routing

Model-agnostic decision table. Use it to pick a server without loading every schema.

| If the task is… | Reach for | Fallback |
|---|---|---|
| Ship code / review a PR / read CI logs | GitHub | Claude Code Remote (orchestration only) |
| Debug a live deployment | Vercel (`get_runtime_errors`, build logs) | Cloudflare (Workers inspection) |
| Store or query structured records | Airtable | Cloudflare D1, Notion databases |
| Automate a multi-app workflow | Make (deep, scenario-level) | Zapier (broad, action-level) |
| Reach an app with no dedicated server | Zapier `discover` → `enable` → `execute` | Make `apps_recommend` |
| Generate voice, video, or images | ElevenLabs creative | Canva (brand-consistent), Figma |
| Produce a branded visual asset | Canva | Figma |
| Draw a system/architecture diagram | Lucid | Figma FigJam |
| Turn a design into code | Figma `get_design_context` | — |
| Write or research docs | Notion | Google Drive |
| Track work | ClickUp *or* Asana (pick one — both are wired) | Notion |
| Email | Gmail | Slack (internal) |
| Schedule with externals | Calendly | Google Calendar |
| Marketing performance data | Supermetrics | Bitly (link-level), Vercel web analytics |
| E-commerce operations | Shopify | — |
| Short links + QR for campaigns | Bitly | — |
| Travel/hospitality data (relevant to a directory site) | Booking.com, Tripadvisor | — |
| Stand up a new app fast | Lovable | Vercel + GitHub |

**Overlap warnings.** ClickUp and Asana both cover task management — pick one per project or state
will fork. Make and Zapier overlap on automation; Make is better when you own the workflow logic,
Zapier when you just need one action against a long-tail app. Google Calendar and Calendly both
touch scheduling but are not synced with each other.

---

## 5. Wiring these into any client

### 5.1 The universal shape

Nearly every MCP client reads a JSON object keyed `mcpServers`. Two transports exist:

```json
{
  "mcpServers": {
    "remote-example": {
      "type": "http",
      "url": "https://mcp.vendor.com/mcp",
      "headers": { "Authorization": "Bearer ${VENDOR_TOKEN}" }
    },
    "local-example": {
      "command": "npx",
      "args": ["-y", "some-mcp-server"],
      "env": { "API_KEY": "${API_KEY}" }
    }
  }
}
```

Older servers use `"type": "sse"` with an `/sse` URL. Newer ones use streamable HTTP at `/mcp`.
If a connection hangs on handshake, try the other one before assuming the endpoint is wrong.

### 5.2 Per-client notes

| Client | Config location | Notes |
|---|---|---|
| Claude Code (CLI) | `.mcp.json` in project, or `claude mcp add` | Project scope commits to the repo; user scope is global |
| Claude Code (web) | Connectors UI on claude.ai | OAuth only; no local `command` servers |
| Claude Desktop | `claude_desktop_config.json` | Supports both transports; restart required after edits |
| Cursor | `.cursor/mcp.json` (project) or global settings | Same `mcpServers` shape |
| VS Code / Copilot | `.vscode/mcp.json` | Uses `servers` key, not `mcpServers`; supports `inputs` for secret prompts |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | Same shape |
| Cline / Roo | Extension settings JSON | Same shape |
| Zed | `settings.json` → `context_servers` | Different key name, same fields |
| OpenAI Agents SDK | Python/TS: `MCPServerStreamableHttp` / `MCPServerStdio` | Pass server objects into the agent's `mcp_servers` list |
| OpenAI Responses API | `tools: [{ type: "mcp", server_url, authorization }]` | Remote servers only; the API calls them directly |
| Gemini CLI | `~/.gemini/settings.json` → `mcpServers` | Same shape |
| LangChain / LangGraph | `langchain-mcp-adapters` | Converts MCP tools to LangChain tools; flattens names |
| LlamaIndex | `llama-index-tools-mcp` | `McpToolSpec` wraps a server as a tool spec |
| n8n | MCP Client node | Point at the remote URL; credentials stored in n8n |
| LM Studio / Ollama front-ends | App-level MCP settings | Local `command` servers work; OAuth remotes usually don't |

### 5.3 Auth reality check

- **OAuth connectors** (most of the servers here — Notion, Asana, Canva, Slack, Gmail, Drive,
  Calendar, Shopify, Figma, Vercel, ClickUp, Airtable, Calendly, Lucid, Bitly, Lovable) authorize
  per-user through a browser flow. They generally cannot be moved to a headless environment by
  copying a config file — each client authorizes separately.
- **Token/API-key servers** (Make, Supermetrics, ElevenLabs, Zapier's generated endpoint, GitHub
  PATs) travel fine between clients: same URL, same header, works anywhere.
- **Never commit tokens.** Use `${ENV_VAR}` interpolation where the client supports it, and a
  `.env` that is gitignored where it doesn't.

---

## 6. Endpoint volatility

Endpoints below are the ones vendors publish for remote MCP access. **Verify each against the
vendor's current docs before use** — these move more often than the tool names do, and a stale URL
fails as an opaque handshake error.

| Server | Typical remote endpoint pattern | Stability |
|---|---|---|
| Notion | `https://mcp.notion.com/mcp` | Stable |
| Asana | `https://mcp.asana.com/sse` | Stable, still SSE |
| Canva | `https://mcp.canva.com/mcp` | Stable |
| Figma | `https://mcp.figma.com/mcp` (remote) or `http://127.0.0.1:3845/mcp` (desktop app) | Desktop port occasionally changes |
| Vercel | `https://mcp.vercel.com` | Stable |
| Cloudflare | Per-product subdomains under `*.mcp.cloudflare.com/sse` | Split across several servers |
| Zapier | Per-user URL issued from the Zapier MCP dashboard | Unique per user — never share |
| Make | `https://<zone>.make.com/mcp/api/v1/u/<token>/sse` | Zone + token specific |
| Everything else | Vendor's own integrations/MCP docs page | Check before wiring |

---

## 7. Destructive-tool watchlist

Tools that mutate or delete external state, grouped by blast radius. Any agent given these should
run with confirmation prompts on, or with an allowlist that excludes them.

**Irreversible or externally visible immediately**
- `mcp__Gmail__send_message`, `reply`, `forward` — mail leaves the building
- `mcp__Slack__slack_send_message` — posts to a channel; use `slack_send_message_draft` first
- `mcp__github__merge_pull_request`, `push_files`, `create_or_update_file`, `delete_file`
- `mcp__Vercel__deploy_to_vercel`, `buy_domain`, `buy_pro`, `buy_credits`, `buy_addon` — spends money
- `mcp__Shopify__create-discount`, `bulk-update-product-status`, `set-inventory`
- `mcp__Canva__publish-brand-template`, `mcp__Airtable__publish_interface`

**Data destruction**
- `mcp__Airtable__delete_table`, `delete_records_for_table`, `delete_automation`, `delete_interface`
- `mcp__Cloudflare_Developer_Platform__d1_database_delete`, `kv_namespace_delete`, `r2_bucket_delete`
- `mcp__Make__scenarios_delete`, `data-stores_delete`, `organizations_delete`, `teams_delete`
- `mcp__ClickUp__clickup_delete_task`, `mcp__Asana__delete_task`
- `mcp__Google_Drive__trash_file`, `mcp__Gmail__trash_thread`
- `mcp__ElevenLabs__agents_delete`, `agents_bulk_delete_knowledge_base`

**Arbitrary execution**
- `mcp__Shopify__graphql_mutation` — full Admin API write access
- `mcp__Cloudflare_Developer_Platform__d1_database_query` — arbitrary SQL including DDL
- `mcp__Zapier__execute_zapier_write_action` — whatever the enabled action does
- `mcp__Make__rpc_execute`, `mcp__Make__scenarios_run`
- `mcp__Lovable__query_database`

**Undo that exists:** Airtable has `revert_action`. Gmail and Drive have `untrash_*`. Almost
nothing else here is reversible from the tool layer.

---

## 8. Complete tool index

850 tools across 25 servers. Strip the `mcp__<Server>__` prefix for the canonical MCP tool name.


### Airtable (43 tools)

```
mcp__Airtable__create_automation
mcp__Airtable__create_base
mcp__Airtable__create_field
mcp__Airtable__create_interface
mcp__Airtable__create_page
mcp__Airtable__create_record_comment
mcp__Airtable__create_records_for_table
mcp__Airtable__create_table
mcp__Airtable__delete_automation
mcp__Airtable__delete_interface
mcp__Airtable__delete_page
mcp__Airtable__delete_records_for_table
mcp__Airtable__delete_table
mcp__Airtable__describe_page_element
mcp__Airtable__describe_page_type
mcp__Airtable__fetch_automation_input_data
mcp__Airtable__get_automation
mcp__Airtable__get_create_automation_instructions
mcp__Airtable__get_form_schema
mcp__Airtable__get_record_for_page
mcp__Airtable__get_table_schema
mcp__Airtable__list_automations
mcp__Airtable__list_bases
mcp__Airtable__list_external_accounts
mcp__Airtable__list_pages_for_base
mcp__Airtable__list_record_comments
mcp__Airtable__list_records_for_page
mcp__Airtable__list_records_for_table
mcp__Airtable__list_tables_for_base
mcp__Airtable__list_views_for_table
mcp__Airtable__list_workspaces
mcp__Airtable__ping
mcp__Airtable__publish_interface
mcp__Airtable__revert_action
mcp__Airtable__search_bases
mcp__Airtable__search_candidate_linked_records
mcp__Airtable__search_records
mcp__Airtable__submit_form
mcp__Airtable__test_automation_webhook_trigger
mcp__Airtable__update_automation
mcp__Airtable__update_field
mcp__Airtable__update_records_for_table
mcp__Airtable__update_table
```

### Asana (31 tools)

```
mcp__Asana__add_comment
mcp__Asana__create_project
mcp__Asana__create_project_from_template
mcp__Asana__create_project_preview_v3
mcp__Asana__create_project_status_update
mcp__Asana__create_task_from_template
mcp__Asana__create_task_preview_v4
mcp__Asana__create_tasks
mcp__Asana__delete_task
mcp__Asana__get_agent
mcp__Asana__get_attachments
mcp__Asana__get_items_for_portfolio
mcp__Asana__get_me
mcp__Asana__get_my_tasks
mcp__Asana__get_portfolio
mcp__Asana__get_portfolios
mcp__Asana__get_project
mcp__Asana__get_projects
mcp__Asana__get_status_overview
mcp__Asana__get_task
mcp__Asana__get_task_stories
mcp__Asana__get_tasks
mcp__Asana__get_teams
mcp__Asana__get_user
mcp__Asana__get_users
mcp__Asana__get_workspace_agents
mcp__Asana__search_objects
mcp__Asana__search_tasks
mcp__Asana__search_tasks_preview
mcp__Asana__update_project
mcp__Asana__update_tasks
```

### Bitly (26 tools)

```
mcp__Bitly__bitly_bulk_upload_file
mcp__Bitly__bitly_bulk_upload_validate
mcp__Bitly__bitly_create_qr_code
mcp__Bitly__bitly_create_short_link
mcp__Bitly__bitly_create_short_link_with_qr
mcp__Bitly__bitly_delete_short_link
mcp__Bitly__bitly_export_data
mcp__Bitly__bitly_get_custom_domains
mcp__Bitly__bitly_get_custom_link_details
mcp__Bitly__bitly_get_group_analytics
mcp__Bitly__bitly_get_group_details
mcp__Bitly__bitly_get_group_preferences
mcp__Bitly__bitly_get_group_qr_codes
mcp__Bitly__bitly_get_group_short_links
mcp__Bitly__bitly_get_group_short_links_sorted
mcp__Bitly__bitly_get_groups
mcp__Bitly__bitly_get_link_analytics
mcp__Bitly__bitly_get_link_destination
mcp__Bitly__bitly_get_organizations
mcp__Bitly__bitly_get_qr_code
mcp__Bitly__bitly_get_qr_code_analytics
mcp__Bitly__bitly_get_qr_code_image
mcp__Bitly__bitly_get_short_link_details
mcp__Bitly__bitly_get_user
mcp__Bitly__bitly_update_qr_code
mcp__Bitly__bitly_update_short_link
```

### Booking_com (3 tools)

```
mcp__Booking_com__accommodations_search
mcp__Booking_com__answer_property_qa_by_ids_v2
mcp__Booking_com__attractions_search
```

### Calendly (36 tools)

```
mcp__Calendly__availability-get_user_availability_schedule
mcp__Calendly__availability-list_user_availability_schedules
mcp__Calendly__availability-list_user_busy_times
mcp__Calendly__event_types-create_event_type
mcp__Calendly__event_types-get_event_type
mcp__Calendly__event_types-list_event_type_availability_schedule
mcp__Calendly__event_types-list_event_type_available_times
mcp__Calendly__event_types-list_event_types
mcp__Calendly__event_types-update_event_type
mcp__Calendly__event_types-update_event_type_availability_schedule
mcp__Calendly__list_calendly_skills
mcp__Calendly__load_calendly_skill
mcp__Calendly__locations-list_user_meeting_locations
mcp__Calendly__meetings-cancel_event
mcp__Calendly__meetings-create_invitee
mcp__Calendly__meetings-create_invitee_no_show
mcp__Calendly__meetings-delete_invitee_no_show
mcp__Calendly__meetings-get_event
mcp__Calendly__meetings-get_event_invitee
mcp__Calendly__meetings-get_invitee_no_show
mcp__Calendly__meetings-list_event_invitees
mcp__Calendly__meetings-list_events
mcp__Calendly__organizations-create_organization_invitation
mcp__Calendly__organizations-get_organization
mcp__Calendly__organizations-get_organization_membership
mcp__Calendly__organizations-list_organization_invitations
mcp__Calendly__organizations-list_organization_memberships
mcp__Calendly__organizations-revoke_organization_invitation
mcp__Calendly__routing_forms-get_routing_form
mcp__Calendly__routing_forms-get_routing_form_submission
mcp__Calendly__routing_forms-list_routing_form_submissions
mcp__Calendly__routing_forms-list_routing_forms
mcp__Calendly__scheduling_links-create_single_use_scheduling_link
mcp__Calendly__shares-create_share
mcp__Calendly__users-get_current_user
mcp__Calendly__users-get_user
```

### Canva (32 tools)

```
mcp__Canva__comment-on-design
mcp__Canva__copy-design
mcp__Canva__create-brand-template-draft
mcp__Canva__create-design-from-brand-template
mcp__Canva__create-design-from-candidate
mcp__Canva__create-folder
mcp__Canva__edit-design
mcp__Canva__export-design
mcp__Canva__generate-design
mcp__Canva__generate-design-structured
mcp__Canva__get-assets
mcp__Canva__get-brand-template-dataset
mcp__Canva__get-design-dataset
mcp__Canva__get-export-formats
mcp__Canva__help
mcp__Canva__import-design-from-url
mcp__Canva__list-brand-kits
mcp__Canva__list-comments
mcp__Canva__list-folder-items
mcp__Canva__list-replies
mcp__Canva__merge-designs
mcp__Canva__move-item-to-folder
mcp__Canva__publish-brand-template
mcp__Canva__read-design
mcp__Canva__reply-to-comment
mcp__Canva__request-outline-review
mcp__Canva__resize-design
mcp__Canva__resolve-shortlink
mcp__Canva__search-brand-templates
mcp__Canva__search-designs
mcp__Canva__search-folders
mcp__Canva__upload-asset-from-url
```

### Claude_Code_Remote (22 tools)

```
mcp__Claude_Code_Remote__add_repo
mcp__Claude_Code_Remote__archive_session
mcp__Claude_Code_Remote__create_session
mcp__Claude_Code_Remote__create_trigger
mcp__Claude_Code_Remote__delete_trigger
mcp__Claude_Code_Remote__fire_trigger
mcp__Claude_Code_Remote__get_session
mcp__Claude_Code_Remote__interrupt_session
mcp__Claude_Code_Remote__list_environments
mcp__Claude_Code_Remote__list_repos
mcp__Claude_Code_Remote__list_sessions
mcp__Claude_Code_Remote__list_triggers
mcp__Claude_Code_Remote__register_repo_root
mcp__Claude_Code_Remote__send_later
mcp__Claude_Code_Remote__set_session_tags
mcp__Claude_Code_Remote__set_session_title
mcp__Claude_Code_Remote__subscribe_pr_activity
mcp__Claude_Code_Remote__unarchive_session
mcp__Claude_Code_Remote__unsubscribe_pr_activity
mcp__Claude_Code_Remote__unwatch_url
mcp__Claude_Code_Remote__update_trigger
mcp__Claude_Code_Remote__watch_url
```

### ClickUp (58 tools)

```
mcp__ClickUp__clickup_add_tag_to_task
mcp__ClickUp__clickup_add_task_dependency
mcp__ClickUp__clickup_add_task_link
mcp__ClickUp__clickup_add_task_to_list
mcp__ClickUp__clickup_add_time_entry
mcp__ClickUp__clickup_attach_task_file
mcp__ClickUp__clickup_create_comment
mcp__ClickUp__clickup_create_document
mcp__ClickUp__clickup_create_document_page
mcp__ClickUp__clickup_create_folder
mcp__ClickUp__clickup_create_list
mcp__ClickUp__clickup_create_list_in_folder
mcp__ClickUp__clickup_create_reminder
mcp__ClickUp__clickup_create_task
mcp__ClickUp__clickup_create_task_comment
mcp__ClickUp__clickup_delete_comment
mcp__ClickUp__clickup_delete_task
mcp__ClickUp__clickup_download_task_attachment
mcp__ClickUp__clickup_filter_tasks
mcp__ClickUp__clickup_find_member_by_name
mcp__ClickUp__clickup_get_bulk_tasks_time_in_status
mcp__ClickUp__clickup_get_chat_channel_messages
mcp__ClickUp__clickup_get_chat_channels
mcp__ClickUp__clickup_get_chat_message_replies
mcp__ClickUp__clickup_get_current_time_entry
mcp__ClickUp__clickup_get_custom_fields
mcp__ClickUp__clickup_get_document_pages
mcp__ClickUp__clickup_get_folder
mcp__ClickUp__clickup_get_list
mcp__ClickUp__clickup_get_task
mcp__ClickUp__clickup_get_task_comments
mcp__ClickUp__clickup_get_task_time_in_status
mcp__ClickUp__clickup_get_threaded_comments
mcp__ClickUp__clickup_get_time_entries
mcp__ClickUp__clickup_get_workspace_hierarchy
mcp__ClickUp__clickup_get_workspace_members
mcp__ClickUp__clickup_list_document_pages
mcp__ClickUp__clickup_merge_document
mcp__ClickUp__clickup_merge_document_page
mcp__ClickUp__clickup_merge_tasks
mcp__ClickUp__clickup_move_task
mcp__ClickUp__clickup_remove_tag_from_task
mcp__ClickUp__clickup_remove_task_dependency
mcp__ClickUp__clickup_remove_task_from_list
mcp__ClickUp__clickup_remove_task_link
mcp__ClickUp__clickup_request_attachment_upload
mcp__ClickUp__clickup_resolve_assignees
mcp__ClickUp__clickup_search
mcp__ClickUp__clickup_search_reminders
mcp__ClickUp__clickup_send_chat_message
mcp__ClickUp__clickup_start_time_tracking
mcp__ClickUp__clickup_stop_time_tracking
mcp__ClickUp__clickup_update_comment
mcp__ClickUp__clickup_update_document_page
mcp__ClickUp__clickup_update_folder
mcp__ClickUp__clickup_update_list
mcp__ClickUp__clickup_update_reminder
mcp__ClickUp__clickup_update_task
```

### Cloudflare_Developer_Platform (23 tools)

```
mcp__Cloudflare_Developer_Platform__d1_database_create
mcp__Cloudflare_Developer_Platform__d1_database_delete
mcp__Cloudflare_Developer_Platform__d1_database_get
mcp__Cloudflare_Developer_Platform__d1_database_query
mcp__Cloudflare_Developer_Platform__d1_databases_list
mcp__Cloudflare_Developer_Platform__hyperdrive_config_delete
mcp__Cloudflare_Developer_Platform__hyperdrive_config_edit
mcp__Cloudflare_Developer_Platform__hyperdrive_config_get
mcp__Cloudflare_Developer_Platform__hyperdrive_configs_list
mcp__Cloudflare_Developer_Platform__kv_namespace_create
mcp__Cloudflare_Developer_Platform__kv_namespace_delete
mcp__Cloudflare_Developer_Platform__kv_namespace_get
mcp__Cloudflare_Developer_Platform__kv_namespace_update
mcp__Cloudflare_Developer_Platform__kv_namespaces_list
mcp__Cloudflare_Developer_Platform__migrate_pages_to_workers_guide
mcp__Cloudflare_Developer_Platform__r2_bucket_create
mcp__Cloudflare_Developer_Platform__r2_bucket_delete
mcp__Cloudflare_Developer_Platform__r2_bucket_get
mcp__Cloudflare_Developer_Platform__r2_buckets_list
mcp__Cloudflare_Developer_Platform__search_cloudflare_documentation
mcp__Cloudflare_Developer_Platform__workers_get_worker
mcp__Cloudflare_Developer_Platform__workers_get_worker_code
mcp__Cloudflare_Developer_Platform__workers_list
```

### ElevenLabs (103 tools)

```
mcp__ElevenLabs__agents_add_triage_ticket_comment
mcp__ElevenLabs__agents_add_triage_ticket_turn_comment
mcp__ElevenLabs__agents_bulk_delete_knowledge_base
mcp__ElevenLabs__agents_bulk_move_knowledge_base
mcp__ElevenLabs__agents_calculate_llm_usage
mcp__ElevenLabs__agents_compile_procedures
mcp__ElevenLabs__agents_create
mcp__ElevenLabs__agents_create_branch
mcp__ElevenLabs__agents_create_deployment
mcp__ElevenLabs__agents_create_draft
mcp__ElevenLabs__agents_create_kb_folder
mcp__ElevenLabs__agents_create_kb_text
mcp__ElevenLabs__agents_create_kb_url
mcp__ElevenLabs__agents_create_manual_triage_ticket
mcp__ElevenLabs__agents_create_mcp_server
mcp__ElevenLabs__agents_create_procedure
mcp__ElevenLabs__agents_create_test
mcp__ElevenLabs__agents_create_tool
mcp__ElevenLabs__agents_create_triage_ticket
mcp__ElevenLabs__agents_delete
mcp__ElevenLabs__agents_delete_draft
mcp__ElevenLabs__agents_delete_kb_document
mcp__ElevenLabs__agents_delete_mcp_server
mcp__ElevenLabs__agents_delete_phone_number
mcp__ElevenLabs__agents_delete_procedure
mcp__ElevenLabs__agents_delete_procedure_draft
mcp__ElevenLabs__agents_delete_test
mcp__ElevenLabs__agents_delete_tool
mcp__ElevenLabs__agents_delete_triage_ticket
mcp__ElevenLabs__agents_duplicate
mcp__ElevenLabs__agents_get
mcp__ElevenLabs__agents_get_branch
mcp__ElevenLabs__agents_get_conversation
mcp__ElevenLabs__agents_get_kb_dependents
mcp__ElevenLabs__agents_get_kb_document
mcp__ElevenLabs__agents_get_knowledge_size
mcp__ElevenLabs__agents_get_link
mcp__ElevenLabs__agents_get_mcp_server
mcp__ElevenLabs__agents_get_phone_number
mcp__ElevenLabs__agents_get_procedure
mcp__ElevenLabs__agents_get_procedure_draft
mcp__ElevenLabs__agents_get_summaries
mcp__ElevenLabs__agents_get_test
mcp__ElevenLabs__agents_get_test_run
mcp__ElevenLabs__agents_get_tool
mcp__ElevenLabs__agents_get_tool_dependents
mcp__ElevenLabs__agents_get_tool_executions
mcp__ElevenLabs__agents_get_topics
mcp__ElevenLabs__agents_get_triage_ticket
mcp__ElevenLabs__agents_get_triage_ticket_assignable_users
mcp__ElevenLabs__agents_get_version
mcp__ElevenLabs__agents_get_widget
mcp__ElevenLabs__agents_list
mcp__ElevenLabs__agents_list_branches
mcp__ElevenLabs__agents_list_conversations
mcp__ElevenLabs__agents_list_knowledge_base
mcp__ElevenLabs__agents_list_mcp_server_tools
mcp__ElevenLabs__agents_list_mcp_servers
mcp__ElevenLabs__agents_list_phone_numbers
mcp__ElevenLabs__agents_list_procedures
mcp__ElevenLabs__agents_list_test_runs
mcp__ElevenLabs__agents_list_tests
mcp__ElevenLabs__agents_list_tools
mcp__ElevenLabs__agents_list_triage_tickets
mcp__ElevenLabs__agents_merge_branch
mcp__ElevenLabs__agents_merge_branch_preview
mcp__ElevenLabs__agents_query_knowledge_base_rag
mcp__ElevenLabs__agents_resolve_conversation
mcp__ElevenLabs__agents_run_tests
mcp__ElevenLabs__agents_search_conversation_messages
mcp__ElevenLabs__agents_search_knowledge_base
mcp__ElevenLabs__agents_update
mcp__ElevenLabs__agents_update_branch
mcp__ElevenLabs__agents_update_kb_document
mcp__ElevenLabs__agents_update_mcp_server
mcp__ElevenLabs__agents_update_phone_number
mcp__ElevenLabs__agents_update_procedure_draft
mcp__ElevenLabs__agents_update_tool
mcp__ElevenLabs__agents_update_triage_ticket
mcp__ElevenLabs__creative_add_flow_asset_node
mcp__ElevenLabs__creative_add_flow_node
mcp__ElevenLabs__creative_attach_reference_file
mcp__ElevenLabs__creative_create_asset_upload
mcp__ElevenLabs__creative_create_flow
mcp__ElevenLabs__creative_edit_image
mcp__ElevenLabs__creative_finalize_asset_upload
mcp__ElevenLabs__creative_generate_image
mcp__ElevenLabs__creative_generate_in_flow
mcp__ElevenLabs__creative_generate_speech
mcp__ElevenLabs__creative_generate_video
mcp__ElevenLabs__creative_get_available_assets
mcp__ElevenLabs__creative_get_flow
mcp__ElevenLabs__creative_get_flow_node_types
mcp__ElevenLabs__creative_get_flow_run_status
mcp__ElevenLabs__creative_get_model_guide
mcp__ElevenLabs__creative_get_model_schema
mcp__ElevenLabs__creative_list_voices
mcp__ElevenLabs__creative_run_flow_nodes
mcp__ElevenLabs__creative_show_flow_results
mcp__ElevenLabs__creative_transcribe_audio
mcp__ElevenLabs__creative_update_node
mcp__ElevenLabs__creative_upload_flow_reference
mcp__ElevenLabs__get_more_tools
```

### Figma (42 tools)

```
mcp__Figma__add_code_connect_map
mcp__Figma__create_generative_plugin
mcp__Figma__create_new_file
mcp__Figma__create_shader
mcp__Figma__download_assets
mcp__Figma__export_video
mcp__Figma__generate_diagram
mcp__Figma__get_code_connect_map
mcp__Figma__get_code_connect_suggestions
mcp__Figma__get_context_for_code_connect
mcp__Figma__get_design_context
mcp__Figma__get_figjam
mcp__Figma__get_figma_skill
mcp__Figma__get_generative_plugin
mcp__Figma__get_libraries
mcp__Figma__get_metadata
mcp__Figma__get_motion_context
mcp__Figma__get_screenshot
mcp__Figma__get_shader
mcp__Figma__get_shader_effect
mcp__Figma__get_shader_fill
mcp__Figma__get_variable_defs
mcp__Figma__list_file_components_for_code_connect
mcp__Figma__list_file_shaders
mcp__Figma__list_generative_plugins
mcp__Figma__list_shader_effects
mcp__Figma__list_shader_fills
mcp__Figma__list_shaders
mcp__Figma__read_skill_uri
mcp__Figma__search_design_system
mcp__Figma__send_code_connect_mappings
mcp__Figma__update_generative_plugin
mcp__Figma__update_shader
mcp__Figma__upload_assets
mcp__Figma__use_figma
mcp__Figma__weave_cancel_tool_run
mcp__Figma__weave_get_tool_inputs
mcp__Figma__weave_get_tool_run_output
mcp__Figma__weave_list_tools
mcp__Figma__weave_run_tool
mcp__Figma__weave_upload_asset
mcp__Figma__whoami
```

### Gmail (29 tools)

```
mcp__Gmail__apply_sensitive_message_label
mcp__Gmail__apply_sensitive_thread_label
mcp__Gmail__create_draft
mcp__Gmail__create_label
mcp__Gmail__delete_label
mcp__Gmail__forward
mcp__Gmail__get_draft
mcp__Gmail__get_message
mcp__Gmail__get_thread
mcp__Gmail__label_message
mcp__Gmail__label_thread
mcp__Gmail__list_drafts
mcp__Gmail__list_labels
mcp__Gmail__mark_message_spam
mcp__Gmail__mark_thread_spam
mcp__Gmail__reply
mcp__Gmail__search_threads
mcp__Gmail__send_message
mcp__Gmail__trash_message
mcp__Gmail__trash_thread
mcp__Gmail__unlabel_message
mcp__Gmail__unlabel_thread
mcp__Gmail__unmark_message_spam
mcp__Gmail__unmark_thread_spam
mcp__Gmail__untrash_message
mcp__Gmail__untrash_thread
mcp__Gmail__update_draft
mcp__Gmail__update_label
mcp__Gmail__update_message_labels
```

### Google_Calendar (9 tools)

```
mcp__Google_Calendar__create_event
mcp__Google_Calendar__delete_event
mcp__Google_Calendar__get_event
mcp__Google_Calendar__list_calendars
mcp__Google_Calendar__list_events
mcp__Google_Calendar__respond_to_event
mcp__Google_Calendar__search_events
mcp__Google_Calendar__suggest_time
mcp__Google_Calendar__update_event
```

### Google_Drive (11 tools)

```
mcp__Google_Drive__copy_file
mcp__Google_Drive__create_file
mcp__Google_Drive__download_file_content
mcp__Google_Drive__get_file_metadata
mcp__Google_Drive__get_file_permissions
mcp__Google_Drive__list_recent_files
mcp__Google_Drive__read_file_content
mcp__Google_Drive__search_files
mcp__Google_Drive__share_file
mcp__Google_Drive__trash_file
mcp__Google_Drive__update_file
```

### Lovable (40 tools)

```
mcp__Lovable__add_connector
mcp__Lovable__create_project
mcp__Lovable__create_workspace_skill
mcp__Lovable__delete_workspace_skill
mcp__Lovable__deploy_project
mcp__Lovable__enable_database
mcp__Lovable__get_database_status
mcp__Lovable__get_diff
mcp__Lovable__get_file_upload_url
mcp__Lovable__get_me
mcp__Lovable__get_message
mcp__Lovable__get_project
mcp__Lovable__get_project_analytics
mcp__Lovable__get_project_analytics_trend
mcp__Lovable__get_project_knowledge
mcp__Lovable__get_workspace
mcp__Lovable__get_workspace_knowledge
mcp__Lovable__get_workspace_skill
mcp__Lovable__initiate_project
mcp__Lovable__list_connectors
mcp__Lovable__list_custom_connectors
mcp__Lovable__list_design_systems
mcp__Lovable__list_edits
mcp__Lovable__list_files
mcp__Lovable__list_messages
mcp__Lovable__list_projects
mcp__Lovable__list_template_projects
mcp__Lovable__list_workspace_skills
mcp__Lovable__list_workspaces
mcp__Lovable__move_projects_to_folder
mcp__Lovable__query_database
mcp__Lovable__read_file
mcp__Lovable__remix_project
mcp__Lovable__render_project_widget
mcp__Lovable__send_message
mcp__Lovable__set_folder_visibility
mcp__Lovable__set_project_knowledge
mcp__Lovable__set_project_visibility
mcp__Lovable__set_workspace_knowledge
mcp__Lovable__update_workspace_skill
```

### Lucid (34 tools)

```
mcp__Lucid__fetch
mcp__Lucid__get_mcp_resource
mcp__Lucid__list_document_thread_comments
mcp__Lucid__list_document_threads
mcp__Lucid__lucid_add_block
mcp__Lucid__lucid_add_dynamic_table
mcp__Lucid__lucid_add_items_to_dynamic_table
mcp__Lucid__lucid_add_line
mcp__Lucid__lucid_convert_svg_to_diagram
mcp__Lucid__lucid_create_diagram_from_specification
mcp__Lucid__lucid_create_document_share_link
mcp__Lucid__lucid_create_erd
mcp__Lucid__lucid_create_folder
mcp__Lucid__lucid_create_mind_map
mcp__Lucid__lucid_create_org_chart
mcp__Lucid__lucid_create_sequence_diagram
mcp__Lucid__lucid_delete_items
mcp__Lucid__lucid_edit_dynamic_table_metadata
mcp__Lucid__lucid_edit_item
mcp__Lucid__lucid_export_document_as_PNG
mcp__Lucid__lucid_fetch_item_image
mcp__Lucid__lucid_get_document_metadata
mcp__Lucid__lucid_import_integration_cards
mcp__Lucid__lucid_list_folder_contents
mcp__Lucid__lucid_list_integrations
mcp__Lucid__lucid_search_document
mcp__Lucid__lucid_shape_details
mcp__Lucid__lucid_shape_library
mcp__Lucid__lucid_submit_feedback
mcp__Lucid__lucid_update_document
mcp__Lucid__lucid_update_folder
mcp__Lucid__post_document_thread_comment
mcp__Lucid__search
mcp__Lucid__share_document_with_collaborators
```

### Make (96 tools)

```
mcp__Make__app-module_get
mcp__Make__app-modules_list
mcp__Make__app_documentation_get
mcp__Make__apps_list
mcp__Make__apps_recommend
mcp__Make__connection-metadata_get
mcp__Make__connections_get
mcp__Make__connections_list
mcp__Make__credential-requests_list-app-modules-with-creds
mcp__Make__data-store-records_create
mcp__Make__data-store-records_delete
mcp__Make__data-store-records_list
mcp__Make__data-store-records_replace
mcp__Make__data-store-records_update
mcp__Make__data-stores_create
mcp__Make__data-stores_delete
mcp__Make__data-stores_get
mcp__Make__data-stores_list
mcp__Make__data-stores_update
mcp__Make__data-structures_create
mcp__Make__data-structures_delete
mcp__Make__data-structures_generate
mcp__Make__data-structures_get
mcp__Make__data-structures_list
mcp__Make__data-structures_update
mcp__Make__enums_countries
mcp__Make__enums_regions
mcp__Make__enums_timezones
mcp__Make__executions_get
mcp__Make__executions_get-detail
mcp__Make__executions_list
mcp__Make__extract_blueprint_components
mcp__Make__extract_module_components
mcp__Make__folders_create
mcp__Make__folders_delete
mcp__Make__folders_list
mcp__Make__folders_update
mcp__Make__hook-config_get
mcp__Make__hook-metadata_get
mcp__Make__hooks_create
mcp__Make__hooks_delete
mcp__Make__hooks_get
mcp__Make__hooks_learn_start
mcp__Make__hooks_learn_stop
mcp__Make__hooks_list
mcp__Make__hooks_ping
mcp__Make__hooks_update
mcp__Make__key-metadata_get
mcp__Make__keys_delete
mcp__Make__keys_get
mcp__Make__keys_list
mcp__Make__organizations_create
mcp__Make__organizations_delete
mcp__Make__organizations_get
mcp__Make__organizations_list
mcp__Make__organizations_update
mcp__Make__rpc_execute
mcp__Make__scenario-custom-properties_create
mcp__Make__scenario-custom-properties_delete
mcp__Make__scenario-custom-properties_get
mcp__Make__scenario-custom-properties_replace
mcp__Make__scenario-custom-properties_update
mcp__Make__scenario-labels_assign
mcp__Make__scenario-labels_create
mcp__Make__scenario-labels_delete
mcp__Make__scenario-labels_list
mcp__Make__scenario-labels_unassign
mcp__Make__scenario-labels_update
mcp__Make__scenarios_activate
mcp__Make__scenarios_create
mcp__Make__scenarios_deactivate
mcp__Make__scenarios_delete
mcp__Make__scenarios_get
mcp__Make__scenarios_interface
mcp__Make__scenarios_list
mcp__Make__scenarios_replay
mcp__Make__scenarios_run
mcp__Make__scenarios_set-interface
mcp__Make__scenarios_update
mcp__Make__show_execution_result
mcp__Make__show_executions_list
mcp__Make__show_scenarios_list
mcp__Make__teams_create
mcp__Make__teams_delete
mcp__Make__teams_get
mcp__Make__teams_list
mcp__Make__tools_create
mcp__Make__tools_get
mcp__Make__tools_update
mcp__Make__users_me
mcp__Make__validate_blueprint_schema
mcp__Make__validate_epoch_configuration
mcp__Make__validate_hook_configuration
mcp__Make__validate_module_configuration
mcp__Make__validate_scenario_interface
mcp__Make__validate_scheduling_schema
```

### Notion (41 tools)

```
mcp__Notion__notion-check-mcp-next-steps
mcp__Notion__notion-convert-page-to-skill
mcp__Notion__notion-create-attachment
mcp__Notion__notion-create-comment
mcp__Notion__notion-create-database
mcp__Notion__notion-create-file-upload
mcp__Notion__notion-create-folder
mcp__Notion__notion-create-pages
mcp__Notion__notion-create-view
mcp__Notion__notion-download-attachment
mcp__Notion__notion-duplicate-page
mcp__Notion__notion-fetch
mcp__Notion__notion-get-async-task
mcp__Notion__notion-get-comments
mcp__Notion__notion-get-session-status
mcp__Notion__notion-get-teams
mcp__Notion__notion-get-users
mcp__Notion__notion-list-favorite-pages
mcp__Notion__notion-list-private-pages
mcp__Notion__notion-list-recent-pages
mcp__Notion__notion-list-session-events
mcp__Notion__notion-list-shared-pages
mcp__Notion__notion-move-pages
mcp__Notion__notion-query-data-sources
mcp__Notion__notion-query-meeting-notes
mcp__Notion__notion-query-multiple-data-sources
mcp__Notion__notion-query-sessions
mcp__Notion__notion-read-session-event
mcp__Notion__notion-search
mcp__Notion__notion-search-agents
mcp__Notion__notion-search-sessions
mcp__Notion__notion-search-skills
mcp__Notion__notion-send-message-to-session
mcp__Notion__notion-show-advanced-analysis-next-steps
mcp__Notion__notion-spawn-session
mcp__Notion__notion-stop-session
mcp__Notion__notion-update-data-source
mcp__Notion__notion-update-folder
mcp__Notion__notion-update-page
mcp__Notion__notion-update-view
mcp__Notion__notion-wait-session
```

### Shopify (26 tools)

```
mcp__Shopify__add-to-collection
mcp__Shopify__bulk-update-product-status
mcp__Shopify__create-collection
mcp__Shopify__create-discount
mcp__Shopify__create-product
mcp__Shopify__find-sample-product
mcp__Shopify__get-collection
mcp__Shopify__get-inventory-levels
mcp__Shopify__get-new-store-previews
mcp__Shopify__get-order
mcp__Shopify__get-product
mcp__Shopify__get-shop-info
mcp__Shopify__graphql_mutation
mcp__Shopify__graphql_query
mcp__Shopify__graphql_schema
mcp__Shopify__list-customers
mcp__Shopify__list-orders
mcp__Shopify__run-analytics-query
mcp__Shopify__search_collections
mcp__Shopify__search_docs_chunks
mcp__Shopify__search_products
mcp__Shopify__set-inventory
mcp__Shopify__switch-shop
mcp__Shopify__update-collection
mcp__Shopify__update-product
mcp__Shopify__validate_graphql_codeblocks
```

### Slack (20 tools)

```
mcp__Slack__slack_add_reaction
mcp__Slack__slack_create_canvas
mcp__Slack__slack_create_conversation
mcp__Slack__slack_get_reactions
mcp__Slack__slack_list_channel_members
mcp__Slack__slack_list_user_channels
mcp__Slack__slack_read_canvas
mcp__Slack__slack_read_channel
mcp__Slack__slack_read_file
mcp__Slack__slack_read_thread
mcp__Slack__slack_read_user_profile
mcp__Slack__slack_schedule_message
mcp__Slack__slack_search_channels
mcp__Slack__slack_search_emojis
mcp__Slack__slack_search_public
mcp__Slack__slack_search_public_and_private
mcp__Slack__slack_search_users
mcp__Slack__slack_send_message
mcp__Slack__slack_send_message_draft
mcp__Slack__slack_update_canvas
```

### Supermetrics_Marketing_Analytics (14 tools)

```
mcp__Supermetrics_Marketing_Analytics__accounts_discovery
mcp__Supermetrics_Marketing_Analytics__campaign_and_resource_get
mcp__Supermetrics_Marketing_Analytics__campaign_create
mcp__Supermetrics_Marketing_Analytics__campaign_update
mcp__Supermetrics_Marketing_Analytics__contact_supermetrics
mcp__Supermetrics_Marketing_Analytics__data_query
mcp__Supermetrics_Marketing_Analytics__data_source_discovery
mcp__Supermetrics_Marketing_Analytics__field_discovery
mcp__Supermetrics_Marketing_Analytics__get_async_query_results
mcp__Supermetrics_Marketing_Analytics__get_today
mcp__Supermetrics_Marketing_Analytics__manage_dashboards
mcp__Supermetrics_Marketing_Analytics__manage_user_and_team
mcp__Supermetrics_Marketing_Analytics__resources_manage
mcp__Supermetrics_Marketing_Analytics__supermetrics_guide
```

### Tripadvisor (3 tools)

```
mcp__Tripadvisor__compare_hotels
mcp__Tripadvisor__hotel_details
mcp__Tripadvisor__search_hotels
```

### Vercel (37 tools)

```
mcp__Vercel__add_toolbar_reaction
mcp__Vercel__buy_addon
mcp__Vercel__buy_credits
mcp__Vercel__buy_domain
mcp__Vercel__buy_pro
mcp__Vercel__change_toolbar_thread_resolve_status
mcp__Vercel__check_domain_availability_and_price
mcp__Vercel__create_git_project
mcp__Vercel__deploy_to_vercel
mcp__Vercel__edit_toolbar_message
mcp__Vercel__get_access_to_vercel_url
mcp__Vercel__get_agent_run
mcp__Vercel__get_agent_run_trace
mcp__Vercel__get_deployment
mcp__Vercel__get_deployment_build_logs
mcp__Vercel__get_domain_order
mcp__Vercel__get_git_deployment_context
mcp__Vercel__get_project
mcp__Vercel__get_project_deployment_protection
mcp__Vercel__get_purchase_quote
mcp__Vercel__get_runtime_errors
mcp__Vercel__get_runtime_logs
mcp__Vercel__get_toolbar_thread
mcp__Vercel__get_web_analytics
mcp__Vercel__import-claude-design-from-url
mcp__Vercel__list_agent_run_projects
mcp__Vercel__list_agent_runs
mcp__Vercel__list_deployments
mcp__Vercel__list_projects
mcp__Vercel__list_teams
mcp__Vercel__list_toolbar_threads
mcp__Vercel__pause_project
mcp__Vercel__reply_to_toolbar_thread
mcp__Vercel__search_vercel_documentation
mcp__Vercel__unpause_project
mcp__Vercel__update_project_deployment_protection
mcp__Vercel__web_fetch_vercel_url
```

### Zapier (16 tools)

```
mcp__Zapier__auto_provision_mcp
mcp__Zapier__create_zapier_skill
mcp__Zapier__delete_zapier_skill
mcp__Zapier__disable_zapier_action
mcp__Zapier__discover_zapier_actions
mcp__Zapier__enable_zapier_action
mcp__Zapier__execute_zapier_read_action
mcp__Zapier__execute_zapier_write_action
mcp__Zapier__get_configuration_url
mcp__Zapier__get_zapier_skill
mcp__Zapier__inspect_zapier_actions
mcp__Zapier__list_zapier_connections
mcp__Zapier__manage_zapier_connections
mcp__Zapier__send_feedback
mcp__Zapier__update_zapier_skill
mcp__Zapier__write_code_action
```

### github (55 tools)

```
mcp__github__actions_get
mcp__github__actions_list
mcp__github__actions_run_trigger
mcp__github__add_comment_to_pending_review
mcp__github__add_issue_comment
mcp__github__add_reply_to_pull_request_comment
mcp__github__create_branch
mcp__github__create_or_update_file
mcp__github__create_pull_request
mcp__github__create_repository
mcp__github__delete_file
mcp__github__disable_pr_auto_merge
mcp__github__enable_pr_auto_merge
mcp__github__fork_repository
mcp__github__get_check_run
mcp__github__get_commit
mcp__github__get_file_contents
mcp__github__get_job_logs
mcp__github__get_label
mcp__github__get_latest_release
mcp__github__get_me
mcp__github__get_release_by_tag
mcp__github__get_tag
mcp__github__get_team_members
mcp__github__get_teams
mcp__github__issue_read
mcp__github__issue_write
mcp__github__list_branches
mcp__github__list_commits
mcp__github__list_issue_fields
mcp__github__list_issue_types
mcp__github__list_issues
mcp__github__list_pull_requests
mcp__github__list_releases
mcp__github__list_repository_collaborators
mcp__github__list_tags
mcp__github__merge_pull_request
mcp__github__pull_request_read
mcp__github__pull_request_review_write
mcp__github__push_files
mcp__github__request_copilot_review
mcp__github__resolve_review_thread
mcp__github__run_secret_scanning
mcp__github__search_code
mcp__github__search_commits
mcp__github__search_issues
mcp__github__search_pull_requests
mcp__github__search_repositories
mcp__github__search_users
mcp__github__sub_issue_write
mcp__github__subscribe_pr_activity
mcp__github__unresolve_review_thread
mcp__github__unsubscribe_pr_activity
mcp__github__update_pull_request
mcp__github__update_pull_request_branch
```

---

## 9. Regenerating this file

The inventory reflects what one session had connected on the capture date. Connectors get added
and revoked, and vendors ship tools between releases. To refresh:

1. Ask the assistant to list every MCP tool currently available to it.
2. Group by the server segment of the namespaced name, count per group.
3. Diff against §8 — new names are new capabilities, missing ones are removed or revoked access.

A count that drops sharply for one server usually means an auth expiry, not a product change.
Re-authorize before assuming the tool was removed.
