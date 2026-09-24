<!-- TRIGGER.DEV SKILLS START -->
## Trigger.dev agent skills

This project has Trigger.dev agent skills installed in `.agents/skills/`. Before writing or changing Trigger.dev code (background tasks, scheduled tasks, realtime, or chat.agent AI agents), load the most relevant skill: `trigger-authoring-chat-agent`, `trigger-authoring-tasks`, `trigger-chat-agent-advanced`, `trigger-cost-savings`, `trigger-getting-started`, `trigger-realtime-and-frontend`.
<!-- TRIGGER.DEV SKILLS END -->

## Trigger environment requirement

- Production apps and admin chat must use the hosted Trigger.dev **Production** worker. The user explicitly authorized this on 24 September 2026, superseding the previous Development-only requirement for production.
- Use Trigger.dev **Development** for local work and Vercel preview apps.
- Run the local `trigger dev` worker, using the existing `tr_dev_` key. For branch isolation, use a named Development branch and set the same `TRIGGER_PREVIEW_BRANCH` in the calling app (the SDK uses this variable for Development branches too).
- Production uses a `tr_prod_` key with no Development/Preview branch override. Keep preview/local chat scoped to its Development key and named branch. Do not enable Trigger Preview or Staging unless requested.
- Keep app and worker Redis namespaces aligned. Reuse existing credentials without displaying them. Verify the Development worker is registered before marking it ready.
- Development tasks execute on the machine running `trigger dev`; the worker must stay running for local/preview use. Production runs on Trigger's hosted workers and must not depend on this computer.

## UI and design work

- Before reviewing or changing user-facing UI, read root `DESIGN.md` and the references it identifies for the affected surface.
- Follow its current design decisions, component patterns, interaction contracts, responsive behaviour and accessibility guidance. Older mockups do not override later approved decisions.
- Verify visual changes in the browser at desktop and mobile sizes, and report any verification that could not be completed.
- When the user establishes or replaces a reusable design rule, update `DESIGN.md` in the same pull request.

## Git and pull request workflow

- Make every repository change on a dedicated branch and open a GitHub pull request.
- Never commit or push directly to `main` or `master` unless the user explicitly requests that exact action.
- If work starts while `main` or `master` is checked out, create a `codex/` feature branch before editing or committing.
- Keep the pull request focused. Do not merge it unless the user explicitly asks you to merge it.
- Treat the pull request checks as the authoritative full validation for the change.

## Local and CI testing

- While developing, run only the smallest relevant test file or targeted check needed for the code being changed.
- Do not run the complete `npm test` suite locally by default. GitHub Actions runs it for every pull request and after changes land on `master`.
- Run the full suite locally only when the user explicitly asks, or when diagnosing a failure that cannot be isolated with a targeted test.
- Before opening a pull request, run `git diff --check` and report which targeted checks were run. If GitHub Actions fails, fix the failure on the pull request branch and let CI rerun the complete suite.
