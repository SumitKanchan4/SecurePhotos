# Contributing to SecurePhotos

Thank you for your interest in SecurePhotos. It is a private, offline photo library, and help of every kind is welcome.

## Ways to help

You don't need to write code to make a difference:

- **Report a bug.** Open an issue with the steps that cause it and what you expected to happen.
- **Suggest an idea.** Open an issue that describes the problem you'd like solved.
- **Improve the documentation.** Fix a mistake or make an instruction clearer.
- **Help with design.** Layouts, icons, wording and accessibility all matter.
- **Write code.** Fix a bug, add a test or build something new.

For security problems, please follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Setting up

You need:

- Node.js 20 or 22
- Python 3.12
- Rust 1.80 or later, with the MSVC toolchain
- Windows 10 or 11

Then:

```powershell
git clone https://github.com/SumitKanchan4/SecurePhotos.git
cd SecurePhotos
npm install
.\scripts\run-desktop-app.ps1
```

The script starts the photo engine and the app together. The [developer guide](docs/development.md) covers everything else, including the Python environment and building the installer.

## Branches and commits

- Never commit to `master` directly. Work on a branch:
  - `feature/short-name` for something new,
  - `fix/short-name` for a bug fix,
  - `chore/short-name` for documentation, dependencies or upkeep.
- Write commit messages that say what changed, for example `fix: stop story music overlapping`.
- Push your branch and open a pull request against `master`.

## Before you open a pull request

SecurePhotos looks after people's memories, so please check that nothing breaks:

```powershell
.venv\Scripts\python.exe -m pytest engine/tests   # engine tests
npm test                                          # app tests
npm run build                                     # type check and production build
```

- If you fix a bug, add a test that would have caught it.
- If you add an engine endpoint, add tests for it.
- Give Python functions a docstring, and use TypeScript types rather than `any`.
- Keep files focused; split a component that grows too large.

## The pull request

Please describe:

- what the change does and why,
- how you tested it,
- screenshots for anything you changed on screen,
- the issue it fixes, if there is one (for example `Fixes #42`).

You'll get a review with friendly, specific feedback.

## How we work together

Be kind and patient, respect other points of view and levels of experience, and keep the people who use SecurePhotos, their privacy and their photos, at the centre of every decision.
