---
trigger: always_on
---

# 🛡️ Enterprise Workflow & Approval Rules

## 0. Mandatory Branch Protection, Task-Specific Branches & Git Push Protocol
- **CRITICAL**: **NEVER work, edit, or commit directly on the `master` (or `main`) branch.**
- **Dedicated Task-Specific Branching**:
  - A dedicated topic branch MUST be created for every distinct feature, bug fix, chore, or refactor matching the specific task being implemented (e.g. `feature/<specific-feature-name>`, `fix/<specific-bug-name>`, `chore/<specific-task-name>`).
  - Do NOT lump multiple unrelated tasks or ongoing experiments into a single generic branch.
  - The **active working branch MUST ALWAYS be that dedicated task branch** — never `master` or `main`.
  - Always verify `git branch --show-current` before starting any task, creating or switching to the specific topic branch.
- **Mandatory User Approval Gate Before Merging to Master/Main**:
  - **CRITICAL**: **NEVER merge any branch into `master` (or `main`) without explicit, upfront permission and confirmation from the user.**
  - Work remains safely isolated on its dedicated task branch until the user explicitly directs that it is complete, tested, and ready to merge.
  - This guarantees that no half-cooked, partially tested, or in-flight code is ever merged into the production `master` baseline.
  - Between active tasks and discussions, remain on `master` (or `main`) in a clean state. As soon as discussion or planning for a new task begins, create the dedicated topic branch (`feature/*`, `fix/*`, `chore/*`) and switch to it before modifying any code.
- **Mandatory Push to Origin on Commit**: Whenever code is committed (`git commit`), **ALWAYS immediately push to origin** (`git push origin <branch>`). Never leave local commits sitting unpushed, as unpushed commits lead to drift, stale checkins, and merge conflicts.

## 1. Approval Gate, Mandatory Planning & Autonomous Execution
- **Mandatory Plan Proposal Before Implementation**:
  - **CRITICAL**: **NEVER start modifying code or generating implementation without first proposing a concrete implementation plan.**
  - The plan must state: problem breakdown, root cause, proposed changes by component/file, edge cases, risks, and verification steps.
  - Wait for the user's explicit approval ("Proceed" / approval) before executing any source code modifications.
- **Autonomous Routine Execution Post-Approval (NEVER Ask Permission)**:
  - Once the user gives a directive or approves an implementation plan, **execute all steps end-to-end autonomously** (edits, tests, docs, commit, push) without forcing the user to babysit the screen or approve routine intermediate steps.
  - Do NOT pause or ask permission for standard engineering tasks: reading files, searching/grepping, discovering symbols (`codegraph_explore`), running tests/pytest, running linters, checking git status, pulling `git pull origin <branch>` / fetching latest, running non-destructive diagnostics, writing scratch scripts, and executing planned implementation steps.
- **Real Permissions Only**:
  - Reserve user confirmation strictly for:
    1. Plan approval before implementation begins.
    2. High-level architecture forks or ambiguous product requirements with multiple viable designs.
    3. Irreversible or destructive operations (e.g. `git reset --hard`, deleting user data, dropping database tables).
    4. Merging any task branch into `master` (or `main`).

## 2. Intellectual Rigor, Candid Pushback & Confidence Calibration
- **Anti-Sycophancy & Technical Scrutiny**:
  - **Do NOT blindly agree with the user.** Rigorously validate every hypothesis, suggestion, or premise against the actual codebase, architecture, performance profiles, and SQLite/system behavior.
  - If the user's understanding has a gap, is factually mistaken, or proposes a suboptimal solution, **explicitly call it out immediately**.
- **Risk Analysis & Concrete Alternatives**:
  - When challenging a user's direction or pointing out a flaw, clearly articulate:
    1. The exact technical risk or bottleneck in their approach (e.g. data loss, write lock starvation, regression, memory leak).
    2. The superior, battle-tested alternative with technical rationale.
- **Mandatory Confidence Calibration**:
  - **Rate confidence before any technical claim or diagnosis** (e.g. `[Confidence: High (Verified via code/DB)]`, `[Confidence: Medium]`, `[Confidence: Low / Educated Guess]`).
  - **Never disguise speculation as certainty.** If guessing, making an unverified assumption, or relying on heuristic deduction without direct verification, explicitly say: *"I am hypothesizing/guessing here based on X, because Y has not yet been verified."*

## 3. Clean Architecture, Zero-Debt Policy & Design Standards
- Keep code clean, decoupled, and modular.
- Do not mix presentation, business logic, and database operations in single files.
- Adhere strictly to the project's specialized skills (`modern-web-ui`, `local-slm-engineering`, `sqlite-vector-search`, `zero-trust-crypto`, `enterprise-standards-and-docs`).
- **CRITICAL UI/UX STANDARD**: All view headers and drill-down toolbars (Albums, People, Categories, Vault, etc.) MUST strictly comply with Section 4 of `modern-web-ui`:
  1. Balanced 3-Column flex layout (`flex: 1` Left / `flex: 0 1 auto` Center / `flex: 1` Right).
  2. Centered modern display title (`22px`–`24px` Plus Jakarta Sans, `fontWeight: 800`, `letterSpacing: -0.03em`).
  3. Inline frosted capsule count badge (`[ N photos ]`) on the exact same horizontal baseline (no awkward stacked subtitles).
  4. Dual-theme frosted liquid glass floating container (`backgroundColor: "var(--glass-surface)"`, `backdropFilter: "blur(24px)"`, `WebkitBackdropFilter: "blur(24px)"`, `border: "1px solid var(--glass-border)"`, `borderRadius: "var(--radius-lg)"`, `boxShadow: "var(--glass-shadow)"`, `color: "var(--text-primary)"`). STRICTLY FORBIDDEN to hardcode dark `rgba(23, 23, 23, ...)` or static dark backgrounds in headers.
  5. Pill geometry (`var(--radius-full)`) on all navigation, action, and filter buttons (`backgroundColor: "var(--glass-pill-bg)"`, `border: "1px solid var(--glass-border)"`).

## 4. High Code Quality, Comments & Tests
- All code must feature Google-style docstrings (Python) / JSDoc (Frontend).
- Comments must explain non-obvious rationale and architectural intent.
- Ensure all logic has corresponding automated test coverage.

## 5. Mandatory Functionality & Decision Point Documentation
- **CRITICAL**: Every newly added feature, capability, workflow, or functional decision point MUST be explicitly documented in the living registry: `docs/features_and_functional_decisions.md` (and cross-referenced in `walkthrough.md` / feature specs).
- For every functional change or addition, the documentation MUST specify:
  1. **Functionality Overview**: Purpose, UX behavior, and system flow.
  2. **Functional Decision Points & Rationale**: Why it was designed this way, rejected alternatives, constraints, and tradeoffs.
  3. **Technical Touchpoints**: API endpoints, database schema/queries, and UI components.
  4. **State & Lifecycle Impact**: How it interacts with existing states, data persistence, and edge cases.

## 6. Mandatory Token Efficiency & MCP Optimization (`codegraph` & `headroom`)
- **CRITICAL**: Maximize context efficiency and reduce token costs by prioritizing MCP tools:
  1. **`codegraph_explore` (MCP)**:
     - Always use `codegraph_explore` as the **first** discovery tool when surveying features, locating symbols, tracing call paths, understanding component hierarchies, or checking the blast radius of changes before editing.
     - **NEVER** run multi-slice `view_file` loops across a large file to find a function or component — use `codegraph_explore` first to pinpoint the exact line range, then read only that slice.
     - Avoid repetitive, expensive grep-and-read loops across multiple files when `codegraph_explore` can return the exact symbols and caller trees in a single capped call.
  2. **`headroom_compress` (MCP)**:
     - **IMMEDIATELY** compress large verbose outputs using `headroom_compress` **before processing** them. This applies to:
       - Pytest / test run logs (even a single run can be 150+ lines)
       - Large database query results (long lists of rows, full table dumps)
       - Massive JSON schemas or API responses
       - Any text blob exceeding ~50 lines
     - Use `headroom_retrieve` **on demand** when specific details from compressed content are required — do NOT decompress everything upfront.
     - **NEVER** let repeated full pytest logs, full file dumps, or verbose query results accumulate in the context window raw across multiple tool calls.
  3. **Context Hygiene**:
     - Never read whole large files when a sliced range suffices. Always use `StartLine` and `EndLine` in `view_file` to keep the context window compact and cost-effective.
     - When running pytest multiple times in a session, compress each run's output immediately — do not accumulate raw logs.

## 7. User-First UX Copywriting & Human-Centric Communication
- **Human Tone Over Developer Jargon**:
  - UI labels, descriptions, toasts, dialogs, and helper text must always speak from the **end-user's mental model**, NEVER from an internal technical or systems-engineering perspective.
  - STRICTLY FORBIDDEN: Cryptographic terminology (e.g. "SHA-256 verification", "hash check"), database/filesystem mechanics (e.g. "Source File Handling", "sharded thumbnail generation", "FTS5 query", "ONNX eviction"), technical path strings (e.g. "Local Storage (C:\)"), or developer architecture terms.
  - REQUIRED: Direct, warm, concise, and reassuring human language focused on real user benefits: safety, simplicity, disk space, and privacy.
- **Concise, Calibrated & Meaningful**:
  - Keep copy concise and scannable. Avoid redundant statements (e.g., if a user is importing to the app, do not mechanically state "importing to app storage").
  - Emphasize user confidence and core value: 100% private, on-device, never uploaded to any cloud.
- **Visual De-Cluttering & Breathing Room**:
  - Avoid filler checkboxes, bullet points, and marketing-style feature badges inside modal workflows (e.g. "Auto-deduplication active", "Visual quality preservation").
  - Maintain clean, spacious layouts with generous whitespace (`24px`–`32px` padding) that allow users to digest decisions effortlessly without cognitive overload.
