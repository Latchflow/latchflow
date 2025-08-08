module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",        // new feature
        "fix",         // bug fix
        "docs",        // documentation changes
        "style",       // formatting, no code change
        "refactor",    // code restructure without behavior change
        "perf",        // performance improvements
        "test",        // adding/updating tests
        "build",       // build system or external dependencies
        "ci",          // CI/CD changes
        "chore",       // maintenance, package updates
        "revert",      // reverting changes
        "plugin",      // new/updated Latchflow plugin
        "schema",      // DB schema changes
        "security"     // security-related fixes
      ]
    ]
  }
};
