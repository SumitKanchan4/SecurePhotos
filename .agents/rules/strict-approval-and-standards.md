---
trigger: always_on
---

# 🛡️ Enterprise Workflow & Approval Rules

## 0. Mandatory Branch Protection (Never Work on Master)
- **CRITICAL**: **NEVER work, edit, or commit directly on the `master` (or `main`) branch.**
- All development, fixes, refactoring, and documentation work must occur on dedicated `feature/*`, `fix/*`, `chore/*`, or related branch.
- Always check the current branch before starting any task, and switch to or create the appropriate topic branch.

## 1. Explicit Approval Gate
- **CRITICAL**: When the user is asking questions, exploring ideas, suggesting changes, or discussing architectures, **DO NOT start implementation, generate feature code, or alter project structure without explicit user confirmation and approval.**
- Always clarify requirements, outline the plan, and wait for the user to say "Proceed" or approve before making modifications.

## 2. Clean Architecture, Zero-Debt Policy & Design Standards
- Keep code clean, decoupled, and modular.
- Do not mix presentation, business logic, and database operations in single files.
- Adhere strictly to the project's specialized skills (`modern-web-ui`, `local-slm-engineering`, `sqlite-vector-search`, `zero-trust-crypto`, `enterprise-standards-and-docs`).
- **CRITICAL UI/UX STANDARD**: All view headers and drill-down toolbars (Albums, People, Categories, Vault, etc.) MUST strictly comply with Section 4 of `modern-web-ui`:
  1. Balanced 3-Column flex layout (`flex: 1` Left / `flex: 0 1 auto` Center / `flex: 1` Right).
  2. Centered modern display title (`22px`–`24px` Plus Jakarta Sans, `fontWeight: 800`, `letterSpacing: -0.03em`).
  3. Inline frosted capsule count badge (`[ N photos ]`) on the exact same horizontal baseline (no awkward stacked subtitles).
  4. Dual-theme frosted liquid glass floating container (`backgroundColor: "var(--glass-surface)"`, `backdropFilter: "blur(24px)"`, `WebkitBackdropFilter: "blur(24px)"`, `border: "1px solid var(--glass-border)"`, `borderRadius: "var(--radius-lg)"`, `boxShadow: "var(--glass-shadow)"`, `color: "var(--text-primary)"`). STRICTLY FORBIDDEN to hardcode dark `rgba(23, 23, 23, ...)` or static dark backgrounds in headers.
  5. Pill geometry (`var(--radius-full)`) on all navigation, action, and filter buttons (`backgroundColor: "var(--glass-pill-bg)"`, `border: "1px solid var(--glass-border)"`).

## 3. High Code Quality, Comments & Tests
- All code must feature Google-style docstrings (Python) / JSDoc (Frontend).
- Comments must explain non-obvious rationale and architectural intent.
- Ensure all logic has corresponding automated test coverage.

## 4. Mandatory Functionality & Decision Point Documentation
- **CRITICAL**: Every newly added feature, capability, workflow, or functional decision point MUST be explicitly documented in the living registry: `docs/features_and_functional_decisions.md` (and cross-referenced in `walkthrough.md` / feature specs).
- For every functional change or addition, the documentation MUST specify:
  1. **Functionality Overview**: Purpose, UX behavior, and system flow.
  2. **Functional Decision Points & Rationale**: Why it was designed this way, rejected alternatives, constraints, and tradeoffs.
  3. **Technical Touchpoints**: API endpoints, database schema/queries, and UI components.
  4. **State & Lifecycle Impact**: How it interacts with existing states, data persistence, and edge cases.

## 5. Mandatory Token Efficiency & MCP Optimization (`codegraph` & `headroom`)
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
