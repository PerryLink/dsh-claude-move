# Security Policy

## Reporting a vulnerability

**Please report security issues privately** — do not open a public issue.

Use GitHub's private vulnerability reporting: repo page → **Security** → **Report a vulnerability** → **Advisories**. This opens a confidential [GitHub Security Advisory](https://docs.github.com/en/code-security/security-advisories) where we can coordinate a fix before anything becomes public.

If you cannot use the Security tab, email the maintainer (see the [repository owner's public profile](https://github.com/PerryLink)) with the subject `[dsh-claude-move security]`.

## Before you report

- **Redact everything sensitive.** Remove tokens, API keys, authorization headers, credentials, and real transcript contents from logs and repro steps; use synthetic placeholders.
- Include only what is needed to reproduce: versions (`dsh`, plugin, Node, OS), the minimal trigger, and the observed effect.
- Never share real secrets with us — suspected secrets in your own data are your responsibility to rotate.

## What to expect

- **Acknowledgment:** within 5 business days (usually sooner).
- **Triage and fix:** we will confirm the issue, assess severity, and prepare a fix. You will be kept informed of progress in the advisory.
- **Disclosure:** coordinated disclosure by default. We publish the advisory (GHSA) when the fix is released; you will be credited in the advisory and release notes unless you request anonymity.
- **Scope:** this project is a DSH plugin that imports local Claude Code data. Bugs in the DSH platform itself belong to [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness/security) — report those upstream.

## Credit

Contributors who report confirmed vulnerabilities are acknowledged in the advisory and CHANGELOG (or stay anonymous on request). This project does not operate a paid bug bounty program.
