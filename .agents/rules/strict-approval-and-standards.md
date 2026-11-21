---
trigger: always_on
---

# Workflow and approval rules

## 0. Mandatory Branch Protection, Task-Specific Branches & Git Push Protocol
- **Branch Protection**: **NEVER work, edit, or commit directly on `master` (or `main`).**
- **Dedicated Task-Specific Branching**:
  - A dedicated topic branch MUST be created for every distinct task (`feature/<name>`, `fix/<name>`, `chore/<name>`). Never lump unrelated tasks into a generic branch.
  - The **active working branch MUST ALWAYS be that dedicated task branch** - never `master` or `main`. Verify `git branch --show-current` before starting.
- **Mandatory User Approval Gate Before Merging to Master/Main**:
  - **CRITICAL**: **NEVER merge any branch into `master` (or `main`) without explicit, upfront user confirmation.**
  - Work remains safely isolated on its topic branch until the user explicitly directs that it is complete, tested, and ready to merge.
  - Between active tasks, remain on `master` (or `main`) in a clean state. When planning a new task begins, create and switch to the dedicated branch before modifying code.
- **Immediate Post-Merge Branch Deletion & Return to Master/Main**:
  - Once any topic branch is confirmed merged into `master` (or `main`) and pushed to `origin`, **immediately delete that branch** locally and remotely:
    ```powershell
    git branch -d <branch-name>
    git push origin --delete <branch-name>
    ```
  - Always return to and remain on `master` (or `main`) in a clean state with zero uncommitted changes between completed tasks.
- **Branch Context Evaluation on New Task**:
  - Whenever a new prompt, task, or bug fix is received while currently on an active branch:
    1. **Analyze Relatedness**: Rigorously analyze whether the incoming task directly belongs to or extends the scope of the current topic branch.
    2. **If Related**: Proceed within the current active branch.
    3. **If Unrelated**:
       - *Case 1 (Current Branch Complete & Tested)*: Ask the user for explicit permission to merge into `master` (or `main`). Once approved, merge, push, delete the merged branch, and create a fresh topic branch from updated `master`.
       - *Case 2 (Current Branch In-Flight / Unverified / Merge Not Permitted)*:
         - **Coupled/Dependent**: If the new task relies on in-flight changes, branch off the current active branch (`git checkout -b <new-branch> <current-branch>`) and clearly document the upstream dependency.
         - **Independent**: If unrelated to in-flight work, safely switch back to `master` (stashing any uncommitted changes if present) and create the new task branch from clean `master` (`git checkout -b <new-branch> master`).
- **Mandatory Push to Origin on Commit**: Whenever code is committed (`git commit`), **ALWAYS immediately push to origin** (`git push origin <branch>`). Never leave local commits unpushed.

## 1. Approval Gate, Mandatory Planning & Autonomous Execution
- **Mandatory Plan Proposal Before Implementation**:
  - **CRITICAL**: **NEVER modify code without first proposing a concrete implementation plan** (problem breakdown, root cause, changes by file, edge cases, risks, verification steps).
  - Wait for explicit user approval before executing any code changes.
- **Autonomous Routine Execution Post-Approval (NEVER Ask Permission)**:
  - Once approved, **execute all steps end-to-end autonomously** (edits, tests, docs, commit, push) without requiring user babysitting.
  - Do NOT pause or ask permission for standard engineering tasks: reading files, grepping, running tests/linters, checking git status, pulling/fetching, non-destructive diagnostics, writing scratch scripts, and executing planned edits.
- **Real Permissions Only**:
  - Ask questions **one at a time**, each self-contained (what it is about, why it matters, options with a recommendation first).
  - Reserve user confirmation strictly for:
    1. Plan approval before implementation.
    2. High-level architecture forks or ambiguous requirements with multiple designs.
    3. Irreversible or destructive operations (`git reset --hard`, deleting data, dropping tables).
    4. Merging any task branch into `master` (or `main`).

## 2. Intellectual Rigor, Candid Pushback & Confidence Calibration
- **Anti-Sycophancy & Technical Scrutiny**:
  - **Do NOT blindly agree with the user.** Validate hypotheses against codebase, architecture, performance profiles, and SQLite behavior. Explicitly call out flaws or suboptimal solutions immediately.
- **Risk Analysis & Concrete Alternatives**:
  - State the exact technical risk (data loss, write locks, regressions, memory leaks) and present a battle-tested alternative with technical rationale.
- **Mandatory Confidence Calibration**:
  - **Rate confidence before any technical claim or diagnosis** (e.g. `[Confidence: High (Verified via code/DB)]`, `[Confidence: Medium]`, `[Confidence: Low / Educated Guess]`).
  - Never disguise speculation as certainty. Explicitly label unverified hypotheses.

## 3. Clean Architecture, Zero-Debt Policy & Design Standards
- Keep code clean, decoupled, and modular. Do not mix presentation, business logic, and database operations in single files.
- Adhere strictly to project skills (`modern-web-ui`, `vault-crypto`, `enterprise-standards-and-docs`) and the checklists in `engineering-checklists.md`.
- **CRITICAL UI/UX STANDARD**: follow `docs/design_system.md` and the `modern-web-ui` skill (Mono + acid lime redesign): tokens only, lime as a fill with black text and `--accent-ink` for accent text, the `.dash-page` header (Archivo title, meta line, one lime primary button, rare actions behind "…"), `PhotoTimeline` for photos, `ConfirmDialog` for anything that can't be undone, plain wording, and both themes checked.

## 4. High Code Quality, Comments & Tests
- Google-style docstrings (Python) / JSDoc (Frontend) across all code.
- Comments explaining non-obvious rationale and architectural intent.
- Ensure all logic has corresponding automated test coverage.

## 5. Recording decisions and feedback
- Owner feedback and open tasks go in `.agents/plans/feedback-backlog.md` the same day; finished items are removed once merged (git keeps the history).
- A decision the owner makes that later work must respect goes in `.agents/decisions.md` (one line, with the date).
- How a feature works belongs in `docs/` and in the code's comments, not in a separate log.

## 6. Reading code efficiently
- Read only the line ranges you need; search first, then read. Keep long test output short (`-q`, `--tb=short`).

## 7. User-First UX Copywriting & Human-Centric Communication
- **Human Tone Over Developer Jargon**:
  - UI copy must always speak from the **end-user's mental model**, never technical internals.
  - STRICTLY FORBIDDEN: Cryptographic terminology ("SHA-256 verification", "hash check"), filesystem mechanics ("Source File Handling", "sharded thumbnails", "FTS5 query", "ONNX eviction"), internal paths ("Local Storage (C:\)"), or developer jargon.
  - REQUIRED: Direct, warm, reassuring language focusing on user benefits: safety, simplicity, disk space, and privacy (100% private, on-device, never uploaded to any cloud).
- **Concise, Calibrated & Scannable**:
  - Concise copy without redundant statements. Avoid filler checkboxes, bullet points, and marketing-style feature badges in modals.
  - Maintain clean layouts with generous whitespace (`24px` to `32px` padding) for effortless decision-making.
