# InteriorPro Web

Next.js 16 app for the InteriorPro dashboard, auth flow, and project submission UI.

## Development

Run the web app from this directory:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment

Next.js loads local environment variables from this app directory. For local development, keep Supabase browser-safe keys in:

```text
apps/web/.env.local
```

Use the repo-level `.env.example` as the template. Never put Supabase service-role keys in `NEXT_PUBLIC_*` variables.
