# Security policy

## Reporting a vulnerability

Please report security vulnerabilities **privately** through GitHub's private
vulnerability reporting: open this repository's **Security** tab and choose
**Report a vulnerability**. Only the maintainers can see the report.

Do not report vulnerabilities in public issues, pull requests or discussions,
and do not share exploit details publicly before a fix is available. If the
**Report a vulnerability** button is missing, open a public issue that asks the
maintainers to enable private reporting, without describing the problem.

Please include:

- the affected version or commit;
- which part is affected: the public game server, the private admin, pack or
  image import, or the browser client;
- steps to reproduce, and the configuration involved (for example `HOST`,
  `PUBLIC_ORIGIN`, `TRUSTED_PROXIES`, or the reverse proxy in front of the game);
- the impact you expect, and any suggested fix.

Leave out session tokens, room codes of live games, private hostnames and
content you can't share.

## What to expect

Trovekit Game is maintained by volunteers. Reports are handled on a best-effort
basis, without guaranteed response times and without a bug bounty. Fixes are
made on the default branch; there are no separately maintained release lines.
Reporters are credited in the advisory if they wish.

## Scope

In scope are vulnerabilities in this repository's code when it is deployed as
the [deployment guide](docs/DEPLOYMENT.md) describes: one game process behind an
HTTPS/WSS reverse proxy, and the admin bound to loopback and reached through SSH.

These are documented limits rather than vulnerabilities:

- an admin exposed to a network or the internet (the admin has no accounts or
  passwords and must stay on loopback);
- volumetric denial of service; the built-in rate limits protect a small
  instance only;
- the documented session model: bearer tokens in browser localStorage, guest
  room codes that allow joining a lobby, and uploaded images readable by anyone
  who knows their URL;
- vulnerabilities in dependencies that don't affect Trovekit Game (report those
  upstream; do tell us if Trovekit Game is exploitable through one);
- the rights to content in packs you create or import.
