#!/usr/bin/env bash
set -euo pipefail
set -x

# 1. Initialise git repo and add MIT licence
cat <<'LIC' > LICENSE
MIT License

Copyright (c) Latchflow Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
LIC

git init >/dev/null 2>&1 || true
current_branch="$(git symbolic-ref --short HEAD 2>/dev/null || echo '')"
if [ "$current_branch" != "main" ]; then
  git branch -m main || true
fi

# 2. Create directory layout
mkdir -p apps/admin-ui packages/core packages/plugins/core infra docs .github/workflows .husky
mkdir -p packages/core/src

# 3. Generate README.md
cat <<'MD' > README.md
# Latchflow

Trigger-gated secure file release system.

```
Trigger -> Action
```

## Core Features
- Encrypt bundles
- Plugin Triggers & Actions
- Audit log

## Status
- [ ] Encrypt bundles
- [ ] Plugin Triggers & Actions
- [ ] Audit log

## Get Started
```sh
pnpm install && pnpm dev
```
MD

# 4. Baseline project files
cat <<'GI' > .gitignore
# Node
node_modules
npm-debug.log*
yarn-debug.log*
yarn-error.log*
.pnpm-debug.log*

# macOS
.DS_Store
.AppleDouble
.LSOverride

# Linux
*~
Thumbs.db
GI

cat <<'COC' > CODE_OF_CONDUCT.md
# Contributor Covenant Code of Conduct

## Our Pledge
We as members, contributors, and leaders pledge to make participation in our
community a harassment-free experience for everyone.

## Enforcement
Instances of abusive, harassing, or otherwise unacceptable behavior may be
reported by contacting the project team.

This Code of Conduct is adapted from the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
COC

cat <<'CONTRIB' > CONTRIBUTING.md
# Contributing to Latchflow

## Pull Requests
- Fork the repository and create your branch from `main`.
- Run lint and tests before submitting.

## Issues
- Use issue templates when available.
- Be clear and include relevant context.
CONTRIB

cat <<'RM' > docs/ROADMAP.md
# Roadmap

| Phase | Description |
|-------|-------------|
| 0 | Project scaffolding |
| 1 | Core encryption module |
| 2 | Plugin architecture |
| 3 | Trigger framework |
| 4 | Action implementations |
| 5 | Admin UI |
| 6 | Deployment infrastructure |
| 7 | Beta release |
RM

# 5. Workspaces & tooling
cat <<'PKG' > package.json
{
  "name": "latchflow",
  "private": true,
  "version": "0.0.0",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "lint": "eslint .",
    "test": "vitest",
    "typecheck": "tsc --noEmit",
    "dev": "echo 'dev server not yet implemented'",
    "prepare": "husky install"
  },
  "devDependencies": {
    "@commitlint/cli": "^18.4.0",
    "@commitlint/config-conventional": "^18.4.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "eslint": "^8.0.0",
    "husky": "^9.0.0",
    "lint-staged": "^15.0.0",
    "prettier": "^3.0.0",
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  },
  "lint-staged": {
    "*.{ts,js,tsx,jsx}": [
      "eslint --fix",
      "prettier --check",
      "tsc --noEmit"
    ]
  }
}
PKG

touch pnpm-lock.yaml

cat <<'TS' > tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2020",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true
  },
  "include": ["packages/**/*.ts"]
}
TS

# 6. ESLint, Prettier, Husky, Commitlint
cat <<'ESL' > .eslintrc.json
{
  "parser": "@typescript-eslint/parser",
  "extends": ["eslint:recommended"],
  "env": {"es2020": true, "node": true},
  "ignorePatterns": ["dist"],
  "rules": {}
}
ESL

cat <<'PRETTIER' > .prettierrc
{
  "printWidth": 100,
  "singleQuote": true
}
PRETTIER

cat <<'CL' > commitlint.config.cjs
module.exports = {extends: ['@commitlint/config-conventional']};
CL
cat <<'PRECOMMIT' > .husky/pre-commit
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

npx --no-install lint-staged
PRECOMMIT
chmod +x .husky/pre-commit
cat <<'COMMITMSG' > .husky/commit-msg
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

npx --no-install commitlint --edit "$1"
COMMITMSG
chmod +x .husky/commit-msg
# 7. GitHub CI
dirname=.github/workflows
cat <<'CI' > $dirname/ci.yml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
        with:
          version: 8
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm typecheck
      - name: Upload coverage to Codecov
        run: bash <(curl -s https://codecov.io/bash)
CI
# 8. Dependabot
cat <<'DB' > .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: npm
    directory: "/"
    schedule:
      interval: weekly
DB

# 9. First sample code
cat <<'COREPKG' > packages/core/package.json
{
  "name": "@latchflow/core",
  "version": "0.0.0",
  "main": "src/index.ts",
  "types": "src/index.ts"
}
COREPKG

cat <<'CORE' > packages/core/src/index.ts
export function hello(): void {
  console.log('Latchflow core ready!');
}
CORE

cat <<'TEST' > packages/core/src/index.test.ts
import { describe, it, expect } from 'vitest';
import { hello } from './index';

describe('hello', () => {
  it('returns undefined', () => {
    expect(hello()).toBeUndefined();
  });
});
TEST

# 10. Initial CHANGELOG
cat <<'CH' > CHANGELOG.md
# Changelog
All notable changes to this project will be documented in this file.

## [Unreleased]
- Initial scaffold
CH

# 11. Commit
git add -A
if git diff --cached --quiet; then
  echo "No changes to commit"
else
  git commit -m "chore: bootstrap Latchflow scaffold"
fi
