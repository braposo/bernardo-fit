<!-- TRIGGER.DEV SKILLS START -->
## Trigger.dev agent skills

This project has Trigger.dev agent skills installed in `.agents/skills/`. Before writing or changing Trigger.dev code (background tasks, scheduled tasks, realtime, or chat.agent AI agents), load the most relevant skill: `trigger-authoring-chat-agent`, `trigger-authoring-tasks`, `trigger-chat-agent-advanced`, `trigger-cost-savings`, `trigger-getting-started`, `trigger-realtime-and-frontend`.
<!-- TRIGGER.DEV SKILLS END -->

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
