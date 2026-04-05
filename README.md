# backend_softlogic

## Local Development

This backend is now set up to run fully against a local-only database stack.

### 1. Start local services

```bash
npm run local:db:up
```

This starts:

- PostgreSQL on `localhost:54320`
- Redis on `localhost:6379`

### 2. Create your local `.env`

Copy `.env.example` to `.env` and update any machine-specific values.

Important local defaults:

- `DATABASE_URL=postgresql://postgres:password@localhost:54320/softlogic_whiteboard`
- `REDIS_URL=redis://localhost:6379`

### 3. Sync schema and seed admin

```bash
npx prisma generate
npx prisma db push
npm run prisma:seed
```

The seed creates this invite-only super admin by default:

- Email: `admin@softlogicwhiteboard.com`

### 4. Start the API

```bash
npm run dev
```

Health endpoint:

- `http://localhost:3000/api/health`

### OTP email in local dev

If SMTP delivery is unavailable on the machine or network, the invite-only OTP flow still creates the OTP record first and the auth flow remains testable locally.

### Local smoke checks

```bash
npm run local:smoke:auth
npm run local:smoke:whiteboard
npm run local:smoke:export
```

These validate the seeded invite-only auth path and backend whiteboard CRUD against the local database.

### Tear down the local stack

```bash
npm run local:db:down
```
