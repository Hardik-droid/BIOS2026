# Vercel frontend and Railway backend

Railway runs the existing Go app with one persistent volume. Vercel serves only the compiled browser assets and forwards `/api`, `/v1`, `/healthz`, and `/version` to Railway. This preserves same-origin login cookies and API calls.

## Railway

Deploy the repository with `railway.json`. It selects `Dockerfile.railway` and checks `/healthz` before accepting the deployment.

Before starting the service:

1. Use a Free or Trial workspace. Do not upgrade to a paid plan.
2. Attach one volume at `/var/lib/localfirst`. The entrypoint requires the volume; data and uploads both live under it.
3. Set `LOCALFIRST_JWT_SECRET` to a random value of at least 32 characters.
4. Set `LOCALFIRST_ADMIN_PASSWORD` to a random value of at least 20 characters using letters, digits, underscores, periods, or hyphens. A generated hexadecimal password works.
5. Generate a public Railway domain targeting the service's `PORT` (8080 by default).
6. Enable Railway Serverless in service settings so the service can sleep when idle. Keep one replica and check the workspace's usage allowance.

The runtime creates the `self` owner credential before accepting HTTP traffic, which closes anonymous first-user registration. It serves the password-only login screen; the cloud frontend supplies the owner account ID automatically. Application records, SQLite databases, and uploads persist in the mounted volume across redeployments. Keep the JWT secret unchanged to preserve existing sessions. The initial owner password is persisted in the credential database; changing the environment value alone does not reset an existing owner's password.

Railway's Free plan currently includes $1 of resources per month, 512 MB RAM, and a 0.5 GB volume. A new trial includes $5 for up to 30 days. This is a limited usage allowance, not unlimited hosting. Verify the account's plan and available credit before deploying.

## Vercel

Build the frontend if its source has changed:

```powershell
cd web
npm.cmd ci --no-audit --no-fund
npm.cmd run build:cloud
cd ..
```

After Railway is healthy, prepare the actual upload folder:

```powershell
node scripts/prepare-vercel.mjs https://YOUR-SERVICE.up.railway.app
```

The script checks the live backend's health and login configuration, then creates an isolated `deploy/vercel-<timestamp>` folder with the browser bundle and concrete Vercel rewrite rules. It includes no local documents, uploads, executable, or backend secrets.

Upload that generated folder to Vercel using the connected integration or an authenticated Vercel CLI. Deploy on the free Hobby plan. Check `/healthz`, sign in, then create/edit/reload a document on the deployed Vercel URL.

Provider authentication is required to create projects, attach a volume, set secrets, generate domains, and publish the deployment. No cloud deployment has been created merely by adding these files.

References: https://docs.railway.com/pricing/plans, https://docs.railway.com/volumes/reference, https://vercel.com/docs/routing/rewrites
