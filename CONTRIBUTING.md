# 🤝 Contributing to SecurePhotos

Thank you for your interest in contributing to SecurePhotos! We are building a truly private, offline media vault that respects user ownership, and we welcome contributions from developers, designers, and privacy advocates of all experience levels.

---

## 🌟 Ways to Contribute

You do not need to write complex Rust or Python code to make a difference:

- 🐛 **Report Bugs**: Find something broken? Open an issue with clear steps to reproduce.
- 💡 **Suggest Ideas**: Have an idea for a feature or workflow? Start a discussion or open an enhancement issue.
- 📖 **Improve Documentation**: Found a typo or unclear instruction? Help us make our guides easier to understand.
- 🎨 **Design and UX**: Help refine icons, layouts, themes, or micro-interactions.
- 💻 **Write Code**: Fix bugs, add unit tests, improve performance, or build planned features from our [Roadmap](docs/roadmap.md).

---

## 🛠️ Quick Local Setup

Before making code changes, make sure your computer has the necessary tools:

1. **Prerequisites**:
   - **Node.js** (v20 or v22 LTS)
   - **Python** (v3.11 or v3.12)
   - **Rust and Cargo** (v1.80+)
2. **Clone and Install**:
   ```bash
   git clone https://github.com/SumitKanchan4/SecurePhotos.git
   cd SecurePhotos
   npm install
   ```
3. **Run Locally**:
   - Double-click `scripts/dev.bat` or run:
     ```bash
     npm run tauri dev
     ```

For complete environment configuration, sidecar details, and dependency troubleshooting, check out our [Developer Guide](docs/development.md).

---

## 🌿 Branching and Workflow

To keep our git history clean and protect our main branch:

1. **Always Work on a Topic Branch**:
   - Never commit directly to `master`.
   - Create a dedicated branch for your work:
     - `feature/your-feature-name` for new capabilities
     - `fix/issue-description` for bug fixes
     - `chore/task-name` for documentation, dependencies, or maintenance
2. **Keep Commits Clear**:
   - Write clear, friendly commit messages following standard conventions (e.g. `fix: prevent audio playback overlap in stories`).
3. **Push to Your Branch**:
   - Push your topic branch to your fork or origin before opening a pull request.

---

## 🧪 Testing and Quality Checks

We take reliability seriously because SecurePhotos manages personal memories. Please ensure your changes do not break existing features:

1. **Run Backend Tests**:
   ```bash
   cd engine
   pytest tests/
   ```
   All tests should pass before opening a PR.
2. **Check Frontend Build**:
   ```bash
   npm run build
   ```
3. **Write Helpful Tests**:
   - If you fix a bug, add a test case to prevent regressions.
   - If you build a new API endpoint, include automated test coverage.
4. **Follow Project Style**:
   - Write clear docstrings for Python functions.
   - Use TypeScript types instead of `any`.
   - Keep files modular and avoid giant single-file components.

---

## 📬 Submitting a Pull Request

When you are ready:

1. Open a Pull Request against the `master` branch.
2. Fill out the PR description:
   - What does this change accomplish?
   - How did you test it?
   - Any screenshots or recordings for UI updates.
3. Link related issues (e.g. `Fixes #42`).
4. Our maintainers will review your PR and provide friendly, constructive feedback.

---

## 📜 Community Values

SecurePhotos is a collaborative, respectful open-source project. We expect all contributors to:
- Be kind, welcoming, and patient with others.
- Respect different viewpoints and experience levels.
- Focus on what is best for user privacy, security, and simplicity.
