# Security policy

## Supported version

Security fixes are applied to the latest published release of Let Me See Code. Users should reproduce and report issues using the newest version whenever possible.

## Reporting a vulnerability

Please do not publish an unpatched vulnerability, secret, private capture, authentication material, or sensitive website data in a public issue.

Use GitHub’s **Report a vulnerability** option in the repository’s Security tab when private vulnerability reporting is enabled. Include:

- the affected extension version;
- Chrome version and operating system;
- a concise description of the impact;
- the smallest safe reproduction steps;
- relevant extension logs with private information removed; and
- a suggested fix, if available.

If private reporting is not yet enabled, contact the maintainer through the public profile at [github.com/CodeGodManIsHere](https://github.com/CodeGodManIsHere) without posting exploit details. The maintainer can arrange a private channel.

## Scope

Security reports may include unauthorized data collection, ineffective redaction of recognized secret fields, unsafe automatic navigation or interaction, permission expansion, external transmission, archive path traversal, extension-page script injection, or capture data being retained after cancellation.

Normal browser limitations, intentionally captured public page content, and inaccessible server-side data are not vulnerabilities by themselves.

