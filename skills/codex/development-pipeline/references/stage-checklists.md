# Development Pipeline Stage Checklists

## Requirement Analysis

- Identify user-facing workflow and success criteria.
- Locate relevant routes, views, APIs, services, storage files, and tests.
- Check for existing partial implementation or dirty worktree changes.
- Note constraints from `AGENTS.md`.

## Design

- Prefer adapting existing components/services.
- Avoid adding dependencies unless the repo already uses them or the benefit is clear.
- Keep generated documentation under `doc/`.
- Use GET/POST only for backend HTTP endpoints in this project.

## Implementation

- Before editing, read nearby code and types.
- Keep edits within the requested module boundaries.
- Avoid broad refactors while delivering feature work.
- Preserve encoding and avoid reintroducing garbled text.

## Verification

- Frontend: SFC parse/template compile, type checks, build when Node is usable, and browser check when local access is allowed.
- Backend: TypeScript diagnostics or build, endpoint smoke checks when server is running.
- Workflow/prompt changes: verify generated prompt text is actionable and references the project-level Codex skill.
- Report existing unrelated failures separately.

## Review

- Check API compatibility and persisted config migration.
- Check UI text, empty states, disabled states, and copy actions.
- Check that final handoff does not claim tests that were not run.

## Handoff

- Provide the user a final summary suitable for approving a pull.
- Include exact files changed and remaining risk.
- Do not ask the user to manually copy files available in the workspace.
