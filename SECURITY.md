# Security

## What UndaFi does not promise

UndaFi is a hobby project offered as is. It makes no security claims: it is
not an alarm system and must not be relied on to protect people or property.

## Reporting a problem

If you find a way that UndaFi could put its users at risk (for example, a
way for another website or another device to control the dashboard, or to
read the saved email password), please report it privately:

- Use **"Report a vulnerability"** under the repository's Security tab.

Please do not open a public issue for this kind of problem. This is a
one-person hobby project, so a fix may take a while.

## How UndaFi limits access

- The dashboard listens only on the PC itself and on its Tailscale address.
- It refuses requests that come from other websites.
- There is no password page: anyone inside your Tailscale network can open
  the dashboard.
- The email password is stored unencrypted in the `data` folder on your PC.
