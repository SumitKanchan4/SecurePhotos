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

## 2. Clean Architecture & Zero-Debt Policy
- Keep code clean, decoupled, and modular.
- Do not mix presentation, business logic, and database operations in single files.
- Adhere strictly to the project's specialized skills (`modern-web-ui`, `local-slm-engineering`, `sqlite-vector-search`, `zero-trust-crypto`, `enterprise-standards-and-docs`).

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
     - Always use `codegraph_explore` as the primary discovery tool when surveying features, tracing call paths, understanding component hierarchies, or checking the blast radius of changes before editing.
     - Avoid repetitive, expensive grep-and-read loops across multiple files when `codegraph_explore` can return the exact symbols and caller trees in a single capped call.
  2. **`headroom_compress` (MCP)**:
     - Proactively compress large verbose outputs, lengthy build/test logs, massive JSON schemas, or big text blobs using `headroom_compress` before processing them.
     - Use `headroom_retrieve` on demand when specific details from compressed content are required.
  3. **Context Hygiene**:
     - Never read whole large files when a sliced range suffices. Always use `StartLine` and `EndLine` in `view_file` to keep the context window compact and cost-effective.


