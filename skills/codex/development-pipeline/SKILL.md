---
name: development-pipeline
description: "Run feature or bug-fix work through a lightweight Codex-owned multi-platform relay workflow: Codex/ChatGPT drafts and finalizes design, ClaudeCode/GLM and DeepSeek review or execute stages, and the AI Platform only generates prompts, stores config, and scans artifact files."
---

# Development Pipeline

Use this skill to coordinate a requirement across multiple AI coding/review surfaces while keeping the platform lightweight.

## Operating Mode

- Treat the repository `AGENTS.md` and nearest nested instructions as binding.
- Read the codebase before deciding the implementation shape.
- Prefer existing project patterns over new abstractions.
- Keep the platform role lightweight: it generates prompts, records model/config metadata, and scans artifact files. It does not call Codex, DeepSeek, ClaudeCode CLI, or any model by itself.
- Treat Codex/ChatGPT as the orchestrator, primary designer, and final judge. Use ClaudeCode/GLM to review the Codex draft design for implementation feasibility or to perform heavy implementation. Use DeepSeek to challenge the Codex draft design and perform independent code review.
- Every external platform must write its result to the artifact path provided by the prompt before the stage is considered complete.
- Keep the user loop small. Ask only when a product decision is genuinely ambiguous or risky.
- Do not commit, push, deploy, or create a PR unless the user explicitly asks for that action in the current thread.

## Workflow

1. Codex intake: ask clarifying questions, restate the objective, define acceptance criteria, and write the intake artifact.
2. Code discovery: before design, read the actual codebase and identify entry points, data sources, storage format, identity fields, loading mechanisms, and likely files to change.
3. Codex draft design: Codex writes the primary design proposal based on intake and code discovery.
4. Design review loop: GLM/ClaudeCode and DeepSeek review the Codex draft, focusing on feasibility, risks, omissions, and simpler alternatives. They do not create competing final plans.
5. Final design: Codex decides which review comments to accept, records rejected comments with reasons, and writes the single final implementation plan.
6. Implementation: for small changes Codex may implement directly; for heavier work generate a handoff prompt for ClaudeCode/GLM or another coding platform.
7. Verification: run or request focused validation, recording commands, results, and blockers in the verification artifact.
8. Review: DeepSeek can provide independent code review; Codex performs the final review and decides whether to request rework.
9. Handoff: summarize changes, verification, residual risks, and leave the repo ready for final approval.

## Artifact Protocol

- The platform supplies a relay run directory and one artifact file per stage.
- Use Markdown artifacts. Include summary, inputs used, decisions, risks/blockers, and next steps.
- Do not rely on chat memory as the source of truth. If another platform needs context, point it to prior artifact files.
- If a stage cannot run, still write the artifact and explain the blocker.
- Keep large logs out of chat responses; put durable evidence in the artifact file.

## Approval Gates

Pause for user approval before changing product behavior beyond the request, running destructive commands, deploying, pushing, committing, opening a PR, sending sensitive data externally, or choosing between materially different product directions.

## Output Shape

For substantial work, end with `Changed`, `Verified`, and `Next`. For small work, use natural prose and keep it brief.

## Reference

Use [references/stage-checklists.md](references/stage-checklists.md) when a task is broad, risky, or needs a visible phase checklist.
