---
trigger: always_on
---

# 🛡️ Enterprise Workflow & Approval Rules

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
  - Do NOT pause or ask permission for standard engineering tasks: reading files, grepping, symbol discovery (`codegraph_explore`), running tests/linters, checking git status, pulling/fetching, non-destructive diagnostics, writing scratch scripts, and executing planned edits.
- **Real Permissions Only**:
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
- Adhere strictly to project skills (`modern-web-ui`, `local-slm-engineering`, `sqlite-vector-search`, `zero-trust-crypto`, `enterprise-standards-and-docs`).
- **CRITICAL UI/UX STANDARD (View Headers & Toolbars)**: Must comply strictly with Section 4 of `modern-web-ui`:
  1. Balanced 3-Column flex layout (`flex: 1` Left / `flex: 0 1 auto` Center / `flex: 1` Right).
  2. Centered modern display title (`22px` to `24px` Plus Jakarta Sans, `fontWeight: 800`, `letterSpacing: -0.03em`).
  3. Inline frosted capsule count badge (`[ N photos ]`) on the exact same horizontal baseline (no stacked subtitles).
  4. Dual-theme frosted liquid glass floating container (`backgroundColor: "var(--glass-surface)"`, `backdropFilter: "blur(24px)"`, `WebkitBackdropFilter: "blur(24px)"`, `border: "1px solid var(--glass-border)"`, `borderRadius: "var(--radius-lg)"`, `boxShadow: "var(--glass-shadow)"`, `color: "var(--text-primary)"`). STRICTLY FORBIDDEN to hardcode dark `rgba(23, 23, 23, ...)` or static dark backgrounds.
  5. Pill geometry (`var(--radius-full)`) on navigation, action, and filter buttons (`backgroundColor: "var(--glass-pill-bg)"`, `border: "1px solid var(--glass-border)"`).

## 4. High Code Quality, Comments & Tests
- Google-style docstrings (Python) / JSDoc (Frontend) across all code.
- Comments explaining non-obvious rationale and architectural intent.
- Ensure all logic has corresponding automated test coverage.

## 5. Mandatory Functionality & Decision Point Documentation
- **CRITICAL**: Every newly added feature, capability, workflow, or functional decision MUST be documented in `.agents/history/features_and_functional_decisions.md`:
  1. **Functionality Overview**: Purpose, UX behavior, and system flow.
  2. **Functional Decision Points & Rationale**: Design choices, rejected alternatives, constraints, tradeoffs.
  3. **Technical Touchpoints**: API endpoints, database schema/queries, and UI components.
  4. **State & Lifecycle Impact**: Interactions with existing states, persistence, and edge cases.

## 6. Mandatory Token Efficiency & MCP Optimization (`codegraph` & `headroom`)
- Maximize context efficiency and reduce token overhead using MCP tools:
  1. **`codegraph_explore` (MCP)**:
     - Always use as the **first** discovery tool for surveying features, symbols, call paths, hierarchies, and blast radius.
     - NEVER run multi-slice `view_file` loops across large files to find symbols. Pinpoint line ranges with `codegraph_explore` first, then read only that slice.
     - Avoid repetitive grep-and-read loops when `codegraph_explore` can return exact symbols in a single call.
  2. **`headroom_compress` (MCP)**:
     - **IMMEDIATELY** compress verbose outputs exceeding ~50 lines (pytest logs, DB dumps, large JSONs) before processing.
     - Use `headroom_retrieve` on demand for specific details rather than decompressing everything. Never accumulate repeated raw logs in context.
  3. **Context Hygiene**:
     - Never read whole large files when a sliced range suffices (`StartLine` and `EndLine`). Compress test logs immediately between runs.

## 7. User-First UX Copywriting & Human-Centric Communication
- **Human Tone Over Developer Jargon**:
  - UI copy must always speak from the **end-user's mental model**, never technical internals.
  - STRICTLY FORBIDDEN: Cryptographic terminology ("SHA-256 verification", "hash check"), filesystem mechanics ("Source File Handling", "sharded thumbnails", "FTS5 query", "ONNX eviction"), internal paths ("Local Storage (C:\)"), or developer jargon.
  - REQUIRED: Direct, warm, reassuring language focusing on user benefits: safety, simplicity, disk space, and privacy (100% private, on-device, never uploaded to any cloud).
- **Concise, Calibrated & Scannable**:
  - Concise copy without redundant statements. Avoid filler checkboxes, bullet points, and marketing-style feature badges in modals.
  - Maintain clean layouts with generous whitespace (`24px` to `32px` padding) for effortless decision-making.
