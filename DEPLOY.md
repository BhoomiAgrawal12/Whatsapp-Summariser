# Deploying to Oracle Cloud (Always Free) — ₹0/month, 24/7

This runs the summarizer on a free Oracle Cloud VM so your laptop can be off.
Total time: ~30 minutes, most of it waiting on Oracle's signup.

> Everything server-side is automated by `deploy/oracle-setup.sh` (run once on the
> server) and `deploy/deploy.sh` (run from your laptop for every deploy/update).

---

## Part 1 — Oracle account (browser, one time)

1. Go to **https://www.oracle.com/cloud/free/** → *Start for free*.
2. Sign up. You'll need a **card for identity verification — it is not charged**
   (Always Free resources never bill; there's a temporary ~₹2 hold that reverses).
3. **Home region: choose carefully — it is permanent, and Always Free compute exists
   ONLY in your home region.** Subscribing to another region later does not give you a
   free VM there; the only way to change it is a new tenancy.
   **Recommended for India: *India South (Hyderabad)*.** Not for latency (negligible
   within India, and irrelevant to this app) but for capacity — *India West (Mumbai)* is
   one of the most oversubscribed regions for free Ampere A1 and frequently reports
   "out of host capacity" for weeks, which would leave you permanently stuck on a
   tenancy that can't launch the VM you want.
4. Wait for the "account ready" email (minutes to a few hours).

## Part 2 — Create the VM (browser, one time)

1. Console → ☰ menu → **Compute → Instances → Create instance**.
2. Name: `wa-summarizer`.
3. **Image**: Ubuntu 24.04 (Canonical).
4. **Shape** (click *Change shape*):
   - Best: **Ampere → VM.Standard.A1.Flex**, **1 OCPU / 6 GB RAM**. Oracle halved the
     Always Free Ampere allowance in 2026 to **2 OCPU / 12 GB** (from 4 / 24), so 1 OCPU
     / 6 GB is comfortably inside it — and a *smaller* request is far more likely to be
     granted when capacity is tight. Ask for 1 OCPU even though 2 is allowed.
   - If A1 shows **"Out of capacity"**: retry across different hours *and* availability
     domains for a day (capacity frees up continuously) before falling back to
     **VM.Standard.E2.1.Micro** (x86, 1 GB). On E2.1.Micro add swap first — 1 GB is
     tight for compiling `better-sqlite3`:
     ```bash
     sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
     sudo mkswap /swapfile && sudo swapon /swapfile
     echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
     ```
5. **SSH keys**: choose *Generate a key pair for me* → **download the private key**
   (or paste your existing `~/.ssh/id_ed25519.pub`).
6. Leave networking at defaults (a public IP is assigned). **Do not open any extra
   ports** — the app needs none inbound; the dashboard is reached via SSH tunnel.
7. Create, wait for state **Running**, note the **public IP**.

If you downloaded Oracle's key:
```bash
mv ~/Downloads/ssh-key-*.key ~/.ssh/oracle-wa.key && chmod 600 ~/.ssh/oracle-wa.key
echo -e "Host wa-server\n  HostName <SERVER-IP>\n  User ubuntu\n  IdentityFile ~/.ssh/oracle-wa.key" >> ~/.ssh/config
```
(Then use `wa-server` instead of the IP everywhere below.)

## Part 3 — Bootstrap the server (one time)

From your laptop, in the project folder:

```bash
scp deploy/oracle-setup.sh ubuntu@<SERVER-IP>:
ssh ubuntu@<SERVER-IP> "bash oracle-setup.sh"
```

Installs Node 22, build tools, pm2 (with boot autostart) and sets timezone to
Asia/Kolkata (override with `TIMEZONE=... bash oracle-setup.sh` — the `/schedule`
times use the server's local time).

## Part 4 — Deploy

**⚠️ First stop the local instance** (Ctrl-C / `npx pm2 stop wa-summarizer`).
The WhatsApp session in `auth/` must only ever run in ONE place — two processes
using the same session fight each other and corrupt it.

Then, if you already paired on the laptop, move everything (no re-pairing needed):

```bash
./deploy/deploy.sh <SERVER-IP> --with-state    # code + auth/ + data/ + .env
```

Fresh install instead (pair directly on the server):

```bash
./deploy/deploy.sh <SERVER-IP>
ssh ubuntu@<SERVER-IP> "pm2 logs wa-summarizer --lines 100"   # QR prints here — scan it
```

Done. Digests now arrive in your WhatsApp with the laptop off. **Test it:** send
`/help` to yourself — a reply means the server is live.

## Part 5 — Dashboard access (from laptop or phone)

The dashboard stays private on the server. Two options:

- **SSH tunnel (zero setup):**
  ```bash
  ssh -L 8790:localhost:8790 ubuntu@<SERVER-IP>
  ```
  …then open http://localhost:8790 while the tunnel is up.
- **Tailscale (nicer, free, works from your phone too):** install Tailscale on the
  server and your devices, then open `http://<server-tailscale-name>:8790` from
  anywhere. No ports exposed to the internet either way.

## Ongoing

| Task | Command (from laptop) |
|---|---|
| Update after code changes | `./deploy/deploy.sh <SERVER-IP>` |
| Logs | `ssh ubuntu@<SERVER-IP> "pm2 logs wa-summarizer"` |
| Status / restart | `ssh ... "pm2 status"` / `ssh ... "pm2 restart wa-summarizer"` |
| Back up DB + archive | `rsync -az ubuntu@<SERVER-IP>:wa-summarizer/data/ ./backup-data/` |

## Troubleshooting

- **"Out of capacity" creating A1** — retry later/other availability domain, or use
  E2.1.Micro. Some people script retries; usually a few attempts across a day works.
- **"Shape VM.Standard.E2.1.Micro is not valid for image ocid1.image..."** — the image
  and the shape are different CPU architectures. Picking an Ampere shape makes the
  console select the **aarch64 (ARM)** build of Ubuntu, and switching the shape to
  E2.1.Micro (x86) afterwards does *not* reset it. Fix: set the **shape first**, then
  click **Change image** and re-pick Ubuntu 24.04 — the console then offers the
  **x86_64** build. The rule is shape → image, never the other way round.
- **`better-sqlite3` build errors** — `oracle-setup.sh` installs build-essential;
  re-run it, then `./deploy/deploy.sh` again (it compiles on the server via `npm ci`).
- **Logged out after moving state** — if WhatsApp rejected the moved session, delete
  `auth/` on the server and pair fresh (`pm2 logs` shows the QR).
- **Oracle reclaiming idle VMs** — Oracle may reclaim *idle* Always Free instances;
  this app's constant websocket + periodic work keeps CPU/network above idle
  thresholds in practice. If you ever get a reclamation email, just reply/click keep.
- **Scheduled digest at wrong hour** — timezone: `ssh ... "timedatectl"` and re-run
  setup with `TIMEZONE=`.
