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
- `GOOGLE_CLIENT_ID=<same Google server/web client ID used by the Flutter app>`

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

### Temporary fixed OTP support

The backend also supports an optional fixed OTP fallback for testing:

- enable with `DEV_FIXED_OTP_ENABLED=true`
- default fallback code is `1234`
- restrict usage with `DEV_FIXED_OTP_ALLOWED_EMAILS=email1@example.com,email2@example.com`

This fallback is intended to be temporary and should be limited to explicit test/admin emails. All other users must continue using the real emailed OTP.

### Google sign-in behavior

- Google sign-in is invite-only.
- The backend only allows Google login for users who already exist in the database.
- If an invited user signs in with the same email, the backend links their `googleId` and preserves the existing role.
- Unknown Google emails are rejected and are not auto-created.

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
