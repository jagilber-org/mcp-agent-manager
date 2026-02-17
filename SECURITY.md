# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly:

1. **Do NOT** open a public GitHub issue for security vulnerabilities
2. Email the maintainers or use GitHub's private vulnerability reporting feature
3. Include steps to reproduce and potential impact

## Security Practices

- All environment variables and secrets are managed via `.env` files (gitignored)
- Pre-commit hooks block credential patterns and `.env` file commits
- No secrets or PII in source code - use `constitution.json` rule S-1
- Dependencies are reviewed before adoption

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.3.x   | Yes       |
| < 0.3   | No        |
