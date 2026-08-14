# Secure remote API access

OpenMausBot always listens on `127.0.0.1`. Remote access requires all three layers:

1. Enable Remote & mobile access in App Settings and copy the one-time bearer token.
2. Run a TLS reverse proxy on the same host, forwarding to `127.0.0.1:8799`.
3. Set `OMB_TRUST_TLS_PROXY=1` only on the OpenMausBot server process.

The proxy must terminate HTTPS, strip client-supplied forwarding headers, and set
`X-Forwarded-Proto: https` itself. OpenMausBot rejects plaintext forwarding, direct
network connections, missing tokens, and forwarded requests when proxy trust is off.

Example Caddy configuration (Caddy manages the certificate automatically):

```caddyfile
openmausbot.example.com {
  reverse_proxy 127.0.0.1:8799 {
    header_up -Forwarded
    header_up -X-Forwarded-For
    header_up -X-Forwarded-Proto
    header_up X-Forwarded-For {remote_host}
    header_up X-Forwarded-Proto https
  }
}
```

Start the harness with `OMB_TRUST_TLS_PROXY=1`. API clients send:

```text
Authorization: Bearer <the one-time token>
```

Disable and re-enable remote access to rotate the bearer token. Never place it in a URL,
log, mobile bundle, repository, or reverse-proxy configuration file.
