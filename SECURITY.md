# Security Policy

## Supported Versions

Active development is on `master`. Self-hosted deployments tracking `master` (or the latest tagged release of the SDK / app-suite) are supported.

telerithm ingests application logs and exposes them via an HTTP API and dashboard. Vulnerabilities (auth bypass, log-injection enabling stored XSS, cross-tenant log leak, secret leak in stored logs) are treated as serious.

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security reports.

Email **contact@lan-nguyen-si.de** with:

- Affected surface (SDK, backend, frontend, ingest)
- Reproduction steps or proof-of-concept
- Impact assessment

You will get an acknowledgement within 72 hours and an initial assessment within 7 days. A fix timeline depends on severity and complexity, communicated in the assessment.
