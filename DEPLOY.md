# Deploying Chess Reviewer

**Backend on one Azure VM**: the API, the Stockfish worker, PostgreSQL, Kafka, and Caddy for HTTPS.
**Website on Vercel** (free).

```
 Browser ──► https://<project>.vercel.app          (website, Vercel)
    │
    └──────► https://<name>.<region>.cloudapp.azure.com   (Azure VM)
                Caddy (HTTPS) → API → Kafka → worker (Stockfish)
                                  └─► PostgreSQL
```

Time needed: about 45 minutes the first time.

---

## Before you start: choose two names

1. **Vercel project name**, e.g. `chess-reviewer-yahya`. Your site becomes
   `https://chess-reviewer-yahya.vercel.app`.
2. **Azure DNS label**, e.g. `chess-api-yahya`. Your API becomes
   `https://chess-api-yahya.<region>.cloudapp.azure.com`.

The rest of this guide calls them `<VERCEL_URL>` and `<API_DOMAIN>`.

---

## Part 1: Create the Azure VM

1. Open [portal.azure.com](https://portal.azure.com), go to **Virtual machines**, and click **Create → Azure virtual machine**.
2. **Basics**
   - Resource group: **Create new**, `chess-reviewer`
   - Virtual machine name: `chess-reviewer`
   - Region: one close to you
   - Image: **Ubuntu Server 24.04 LTS – x64 Gen2**. Don't pick an Arm64 image; Stockfish is built for x64.
   - Size: **Standard_B2s** (2 vCPU, 4 GB RAM)
   - Authentication: **SSH public key** (Azure can generate one; download the `.pem` file and keep it safe)
   - Username: `azureuser`
   - Inbound ports: allow **SSH (22)**, **HTTP (80)**, **HTTPS (443)**
3. **Disks**: OS disk type **Standard SSD**. The default size is fine.
4. Click **Review + create**, then **Create**. Wait about 2 minutes.
5. **Give the VM a name on the internet**
   - Open the VM and click the **Public IP address**, then **Configuration**.
   - Assignment: **Static**. This keeps the address the same after Stop/Start.
   - DNS name label: your label, e.g. `chess-api-yahya`, then **Save**.
   - Copy the full name shown, e.g. `chess-api-yahya.eastus.cloudapp.azure.com`. That's your `<API_DOMAIN>`.
6. **Protect your credits**: search **Cost Management → Budgets** and create a monthly budget of $20 with an email alert at 80%.

---

## Part 2: Install and start the backend on the VM

Connect from PowerShell on your PC (use the path to the key you downloaded):

```powershell
ssh -i C:\path\to\chess-reviewer_key.pem azureuser@<API_DOMAIN>
```

Then run these on the VM:

```bash
# 1. Docker + Git LFS
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
sudo apt-get install -y git-lfs
exit
```

Connect again with the same `ssh` command, so the Docker permission applies, then:

```bash
# 2. Get the code (git lfs pull downloads the Stockfish engine)
git clone https://github.com/yahyaCodeX/chess-reviewer.git
cd chess-reviewer
git lfs pull

# 3. Settings
cp deploy/.env.example deploy/.env
openssl rand -hex 24      # run 3 times, paste one result into each secret below
nano deploy/.env
```

In `deploy/.env`, set:

| Setting | Value |
|---|---|
| `API_DOMAIN` | your `<API_DOMAIN>` |
| `CORS_ORIGINS` | your `<VERCEL_URL>`, e.g. `https://chess-reviewer-yahya.vercel.app` |
| `CORS_ORIGIN_REGEX` | `https://chess-reviewer-yahya(-[a-z0-9-]+)?\.vercel\.app` (use your project name) |
| `FRONTEND_URL` | your `<VERCEL_URL>` |
| `POSTGRES_PASSWORD`, `RATE_LIMIT_SALT`, `ADMIN_TOKEN` | the three random values |

Save (Ctrl+O, Enter, Ctrl+X), then start everything:

```bash
docker compose --env-file deploy/.env -f docker-compose.prod.yml up -d --build
```

The first build takes 3–5 minutes. Check it:

```bash
docker compose --env-file deploy/.env -f docker-compose.prod.yml ps   # all "running"/"healthy"
curl https://<API_DOMAIN>/health                                       # {"status":"ok",...}
```

If `curl` complains about the certificate, wait a minute; Caddy is still fetching it.

---

## Part 3: Put the website on Vercel

1. Open [vercel.com](https://vercel.com), sign in with GitHub, and click **Add New → Project**.
2. Import the `chess-reviewer` repository.
3. Configure:
   - **Project name**: the name you chose, e.g. `chess-reviewer-yahya`
   - **Root Directory**: `frontend`
   - Framework preset: **Vite** (detected automatically)
   - **Environment Variables**: add `VITE_API_URL` = `https://<API_DOMAIN>` (no slash at the end)
4. Click **Deploy**. When it's done, open your `<VERCEL_URL>` and review a sample game.

If you ever change `VITE_API_URL`, click **Redeploy** in Vercel, because it's built into the site.

---

## Everyday use

**Stop the server** (to save credits): Azure portal, open the VM, click **Stop**. Always use the portal; shutting down from inside the VM keeps billing you. While it's stopped, the website stays up and shows "The analysis server is asleep".

**Start it again**: click **Start**. Everything comes back by itself within 2–3 minutes.

**Deploy a new version**:
```bash
cd ~/chess-reviewer
git pull && git lfs pull
docker compose --env-file deploy/.env -f docker-compose.prod.yml up -d --build
```
Vercel redeploys the website automatically on every push to `main`.

**Approximate cost** (check the [Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/)):

| | per month |
|---|---|
| B2s running 24/7 | ~$30 |
| Disk + static IP (also charged while stopped) | ~$5–6 |
| Vercel | free |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Website says "server is asleep" but the VM is running | `curl https://<API_DOMAIN>/health` on your PC. If that fails, check ports 80/443 are open in the VM's **Networking** tab. |
| Browser console shows a **CORS** error | `CORS_ORIGINS` in `deploy/.env` must exactly match the site's address (`https://…vercel.app`, no slash). Then run the `up -d` command again. |
| HTTPS certificate error | `API_DOMAIN` must match the DNS label, and port 80 must be open (Let's Encrypt uses it). See `docker compose … logs caddy`. |
| Reviews stay "waiting in line" | `docker compose … logs -f worker`. If Stockfish is missing, run `git lfs pull` and the `up -d --build` command. |
| See what's running / memory use | `docker compose … ps` and `docker stats` |
| Read logs | `docker compose --env-file deploy/.env -f docker-compose.prod.yml logs -f gateway` (or `worker`, `kafka`, `caddy`) |

**CPU note:** B-series VMs run at full speed on saved-up "CPU credits" and slow down when those run out. A demo with occasional reviews stays well within them. If many games are analysed back to back, reviews get slower. Lowering `ENGINE_DEPTH` to 14 helps.
