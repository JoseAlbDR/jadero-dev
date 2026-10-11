# Security policy

Thanks for taking the time to look. This is a personal site run by one person, so please read the
short version below before reporting.

## How to report

Report privately through GitHub: open the repository's **Security** tab and click **Report a
vulnerability** (private vulnerability reporting). Please don't open a public issue, pull request
or discussion for a security problem.

A useful report says what you found, where (URL, endpoint or file), how to reproduce it, and what
an attacker could do with it. Please don't access or change data that isn't yours, and stop as
soon as you have shown the problem.

## Scope

In scope:

- The public site (jadero.dev) in every locale.
- The APIs behind it.
- The ask-me agent, including prompt injection that leaks data it should not see or makes it
  misuse its tools.
- This repository's CI: the GitHub Actions workflows and what they can reach.

Out of scope:

- Volumetric denial of service (flooding the site or the APIs with traffic).
- Problems in third-party services the site uses (hosting, AI providers, mail, GitHub itself).
  Report those to the vendor.
- Findings that need a compromised device, browser or account to start with.
- Missing best-practice headers or settings with no concrete way to exploit them.

## Supported version

Only the deployed site and the `main` branch get fixes. There are no maintained older releases.

## What to expect

This is best effort from a solo maintainer. I aim to acknowledge a report within 7 days and to
keep you posted while I work on a fix. Once it is fixed I'm happy to credit you in the release
notes if you want. There is no bug bounty.
