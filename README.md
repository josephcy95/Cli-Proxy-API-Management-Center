# CLI Proxy API Management Center

A clean, compact control panel for managing a CLI Proxy API server and the accounts behind it.

This is a fork of the original Management Center, built to work with the forked [CLI Proxy API](https://github.com/josephcy95/CLIProxyAPI).

## What this fork adds

- **A focused account-management view** for OAuth files, provider status, plans, cooldowns, renewal dates, reset credits, priorities, and weighted round-robin settings.
- **Adaptive Codex tools** including candidate estimates, quota-aware sorting, concurrency-aware routing controls, Free/Paid plan filters, and quick quota refreshes.
- **Codex instructions management** with templates, private instruction routing, model markers, and provider-specific controls.
- **Detailed monitoring** with realtime requests, account usage, API-key usage, prices, token breakdowns, request status, and useful filters.
- **A built-in playground** for quickly testing a selected model, provider, and credential.
- **Qoder and Qoder CN support** with provider-specific login, quota, region, and model-management views.
- **xAI and Codex failure-policy controls** so credentials can be handled more sensibly when quotas or authentication fail.
- **Model context controls** for custom models and provider configuration surfaces that stay practical instead of getting in the way.
- **A dense, responsive interface** designed for managing a large account pool without endless navigation.
- **And many more** small UI fixes, quota improvements, monitoring refinements, provider integrations, and quality-of-life changes.

## Screenshots

### Auth Files

![Auth Files](docs/screenshots/auth-files.png)

### Usage monitoring

![Usage monitoring](docs/screenshots/monitoring.png)

### Codex instructions

![Codex instructions](docs/screenshots/codex-instructions.png)

### Playground

![Playground](docs/screenshots/playground.png)

## Quick start

The Management Center normally runs through the API server. Start the API, open its management page, and connect the panel using the server address and management key.

You can also run this repository locally:

```bash
bun install --frozen-lockfile
bun run dev
```

To build the single-file management page used by the API releases:

```bash
bun run verify
```

## Use it with the API

- **API server:** [josephcy95/CLIProxyAPI](https://github.com/josephcy95/CLIProxyAPI)
- **Management Center:** [josephcy95/Cli-Proxy-API-Management-Center](https://github.com/josephcy95/Cli-Proxy-API-Management-Center)

The two repositories are maintained together, so the API and UI changes are designed to work as a pair.

## License and community

This project keeps the upstream license and attribution. For discussion, feedback, and updates, visit the [LINUX DO](https://linux.do/) community.
