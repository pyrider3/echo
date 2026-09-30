# Security

## Reporting a vulnerability

Please do not publish exploitable security issues in a public issue. Contact the
maintainer privately through the security-advisory feature of the GitHub
repository.

## Secrets

- Never commit `.env.local`, `bridge/.env.local`, or `mobile/private-config.js`.
- Provider API keys belong on the bridge server. The bundled client key fields
  exist only for local development and must not contain production credentials
  in a public APK.
- Rotate a key immediately if it is ever committed or distributed accidentally.
- Use a long random `ECHO_BRIDGE_TOKEN` and keep it identical between the bridge
  environment and the mobile private configuration.

## Privacy

Chat history, cloned voices, memories, photos, and relationship information are
sensitive personal data. Obtain consent before importing another person's chat
or voice, and do not use this project to impersonate a real person.
