# Contributing to Telerithm

Thanks for your interest in contributing. This guide covers the basics.

## Getting Started

1. Fork the repository
2. Clone your fork
3. Create a feature branch (`git checkout -b feature/my-change`)
4. Make your changes
5. Push and open a pull request

## Development Setup

```bash
# Start the full stack
make init

# Or run backend and frontend separately
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

## Before Submitting

- Run the type checker: `cd backend && npx tsc --noEmit`
- Run tests: `cd backend && npm test`
- Run the frontend build: `cd frontend && npx next build`
- Keep commits focused. One logical change per commit.

## Pull Requests

- Open an issue first to discuss larger changes
- Keep PRs small and focused
- Add a clear description of what changed and why
- Make sure CI passes

## Code Style

- TypeScript strict mode
- Prettier for formatting (run `npx prettier --write .` if needed)
- No unused imports or variables

## Reporting Bugs

Open an issue with:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Environment (OS, Node version, browser)

## Feature Requests

Open an issue describing:

- The problem you're trying to solve
- Your proposed solution
- Any alternatives you considered

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
