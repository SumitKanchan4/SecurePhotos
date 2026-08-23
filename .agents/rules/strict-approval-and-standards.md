---
trigger: always_on
---

# 🛡️ Enterprise Workflow & Approval Rules

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
