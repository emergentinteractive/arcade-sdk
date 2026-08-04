# Contributing

Thanks for helping improve the Emergent Arcade SDK. Contributions of bug reports,
tests, documentation, and focused code changes are welcome.

## Before you start

- Search existing issues and pull requests before opening a new one.
- Discuss substantial API or protocol changes in an issue before implementing them.
- Report vulnerabilities privately by following [SECURITY.md](SECURITY.md), not in an
  issue or pull request.

## Local development

The SDK requires Node.js 20 or newer. From a standalone checkout:

```sh
npm install
npm test
npm run typecheck
```

Before submitting a release-related change, run the complete package check:

```sh
npm run release:check
```

## Pull requests

Keep each pull request small enough to review as one coherent change. Include:

- a clear explanation of the problem and approach;
- tests for behavior changes and regressions;
- documentation for public API or protocol changes; and
- a changelog entry when the change affects SDK users.

Preserve compatibility unless the breaking change has been discussed and clearly
documented. Do not commit generated archives, credentials, or npm tokens.

By contributing, you agree that your contribution is licensed under this project's
MIT License.
