# ADR 0001: Use Cloudflare Pages For The Frontend

## Status

Accepted

## Context

The app needs a low-maintenance way to host a static React/Vite interface. The frontend should be reviewable even before the AWS backend is deployed.

## Decision

Host the Vite build output on Cloudflare Pages and keep the frontend independent from the backend through `VITE_API_BASE_URL`.

## Consequences

- The demo can be deployed quickly as static assets.
- The app can run in mock mode without AWS infrastructure.
- Backend integration requires setting an environment variable in Cloudflare Pages.
