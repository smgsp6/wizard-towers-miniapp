# Privacy requirements

This is a public repository. Never put an email address in a Git commit's author or committer identity. Use an empty email for both identities, including for amended, rebased and merge commits. Do not use a personal email or a noreply address.

Verify commit identities without printing any addresses:

```sh
git log --format='%ae%n%ce' HEAD | grep -c '.'
```

The expected count is zero. The CI workflow checks the same requirement. Never put real Telegram IDs, tokens, secrets or private game data in repository files, screenshots, logs or artifacts. Use synthetic data for tests.
