# Contributing guidelines

Thank you for contributing to this project. Follow these guidelines to submit changes.

## Development setup

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/<your-username>/telegram-alerts.git
   cd telegram-alerts
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy the configuration template:
   ```bash
   cp wrangler.toml.example wrangler.toml
   ```

## Running tests and verification

Always run the test suite and type check before submitting changes:

```bash
# Run unit and integration tests
npm test

# Run TypeScript type check
npm run build
```

Every pull request must pass all tests without errors.

## Pull request process

1. Create a descriptive branch from `main`:
   ```bash
   git checkout -b feat/your-feature-name
   ```
2. Make your changes and add tests under the `test/` directory.
3. Commit with concise conventional commit messages.
4. Push to your fork and submit a pull request against `main`.
5. Describe the motivation, behavior change, and verification steps in the pull request description.
