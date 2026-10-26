# OpenCode in Projeto

The Discord 2 service mode installs OpenCode 1.19.4 and calls it for queued decisions (`/agent-plan`). The Worker supplies channel history, learned evidence, available commands and current owned controls. OpenCode returns JSON; it has no direct Discord credential or unrestricted shell/file tools. Existing Worker checks remain responsible for executing and confirming each selected action.

- Model: existing repository variable `RPG_MODEL`, service-mode default `opencode/glm-5.3-flash-free`. An explicitly configured `RPG_MODEL` remains authoritative. The legacy single-run workflow keeps its own previous default.
- Provider keys: existing Actions secrets `OPENCODE_API_KEY` / `OPENAI_API_KEY`. They are passed only to the planner process. Model/provider availability must be verified live.
- Protocol: executor version 4. An idle older session must be renewed by stopping and starting the player. Do not renew while a game action is pending.
- No silent Llama fallback for OpenCode planning or chat decisions.
- Planning errors, invalid JSON and timeouts stop the player with the actual error category. A plan is never proof of a game action or XP.
- Memory is supplied explicitly from stored observations and learning evidence on each decision. This does not retrain model weights.
- The Actions session remains temporary (25 minutes). This is not 24/7 hosting or a guarantee of complete autonomous play.
- No other branches are merged, deleted or deployed by this change.

## Headless transport

Planner revision `server-v5` uses the documented `opencode serve` HTTP API instead of parsing `opencode run` stdout. The server binds only to loopback and has an ephemeral Basic Auth password. Health, session creation and model response have separate bounded timeouts (20/15/55 seconds), and the process is always terminated after the decision. Errors report a stage and sanitized category/status; provider messages and logs are not published. Tests cover successful planning, provider quota errors, model timeout cleanup and exclusion of Discord credentials. Unit tests and a green workflow do not establish live model availability.

If waiting for a model response times out, the planner checks the session's assistant messages for a completed JSON decision before stopping. This recovers a valid decision when response completion itself hangs, without submitting the prompt twice. Error logs remain local and only an allowlisted category is returned.

The free Flash default was selected explicitly after live Big Pickle requests timed out at the model stage. A catalog listing does not establish successful inference; verify a real returned decision before claiming the agent works.
