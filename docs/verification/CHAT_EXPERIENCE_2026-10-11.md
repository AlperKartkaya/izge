# Chat experience release verification — 2026-10-11

## Delivered

- Shared composer uses a keyboard-accessible **+** menu for local file upload,
  public search/company tools and reviewer selection. Selected tools appear as
  highlighted composer chips. Attachment selection no longer opens Memory.
- Private assistant conversations support new/history/archive/restore/delete.
  Archived/deleted threads reject new work; active runs block archive/delete.
  Deletion hides conversation records without deleting company artifacts.
  Owner checks apply even to workspace admins. Legacy notification threads remain
  accessible through their existing links.
- Conversation uploads retain restricted artifact permissions and can be cited
  in subsequent answers. History and Team Chat lists scroll independently;
  Team Chat's conversations panel can collapse.
- Inline Markdown code and safe HTTP(S) links render alongside existing bold,
  mention and source rendering. Agent avatars/navigation/favicon use the supplied
  transparent logo; the website's original asset was not modified.
- Punctuation-only requests, including `@izge .`, ask how to help without company
  retrieval or fabricated priorities. General answers use the actual model with
  an explicit policy against unsolicited company assertions.
- Codex output budgets account for selected reasoning effort. Structured partial
  responses can retry with a larger bounded budget; streaming text is not
  duplicated by retrying after visible output. Incomplete/unterminated streams
  still fail rather than being presented as completed answers.
- Codex hosted web search uses the provider's actual tool and URL annotations.
  Other profiles do not advertise unsupported native search. Existing configured
  Brave/MCP tools remain available through the permission-controlled path.

## Evidence

- Fresh final backend suite: **123 passed**. Frontend: **35 passed**; lint and
  TypeScript/Vite build passed. Existing datetime deprecation and bundle-size
  warnings remain; no dependency was added.
- Changed backend services/routes/models/schemas: Pyright **0 errors, 0 warnings**.
  Python compilation and `git diff --check` passed.
- Disposable deployment/data copy: real Qwen greeting and uploaded-file retrieval
  passed, including a citation to the uploaded artifact and its Friday 15:00
  checkpoint. Deterministic punctuation response passed without retrieval.
  Archive/restore/delete and rejection of work on deleted conversations passed.
- Real GPT-6 Luna/high completed the full native-search pipeline with actual
  `web_search_call` events and provider citations to python.org. A separate high
  effort greeting completed with the corrected output budget. Private results:
  `~/.local/share/izge/chat-qa/runtime-results.json`.
- Browser on disposable data: file-picker wiring and an actual upload, rendered
  inline code/bold in source preview, tool menu/chip/focus, new/history,
  archive/read-only/restore, delete and collapsed Team Chat passed. Deletion's
  confirmation was accepted through a QA-only browser stub; the deleted item
  disappeared and another conversation became active.
- Final deployed browser: title/favicons/logo, history, native-search menu/chip,
  textarea focus and no body scrolling verified. No model questions or file
  uploads were written to the presentation data during this browser smoke.

## Deployment and data

Coolify service `rqzkyybf7nkmlb77yxic6ron` restarted with updated backend/frontend
images. Backend, colleague, frontend and unchanged website are healthy.
Product `http://localhost:8080/health`, website `http://localhost:8081` and Coolify
`http://localhost:8000` (following redirect) return HTTP 200.

- Migration head: `c12a4d8e7f31` (additive conversations table).
- Counts preserved: **10 artifacts / 8 users / 4 work tasks / 4 automations**.
- Online SQLite/files backup:
  `backups/pre-chat-experience-20261011-164536/data.tar.gz`.
- Backend image:
  `sha256:468161c20a13e5168da87025d4f5db9678041f3f6fb906d161e5219cfde58035`.
- Frontend image:
  `sha256:83b899eb425fb5c336e3ee5375364104176975fe9e1ee60bfb0bad123b54b6c8`.
- Temporary QA containers/network were removed after validation. Screenshots and
  results remain in the private QA directory; its temporary credentials env was
  removed. Nothing staged, committed or pushed.

## Explicit limits

GLM/DeepSeek keys, a company inference endpoint and live customer MCP/Brave
credentials were not configured, so those external services were not live-tested.
Native capability distinctions and upstream sources are recorded in
`docs/research/NATIVE_WEB_SEARCH_2026-10-11.md`.

The Codex bridge is local but GPT inference/search is cloud-based and relies on
an unofficial private endpoint. Its protocol may change; the bounded 8192-token
ceiling can still reject especially long reasoning/output. Qwen remains local.
This Mac must stay awake with Docker/Ollama running; deployment here is not a
24/7 production-server guarantee. Model-generated findings still need review.
