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
3. **Home region: choose carefully — it can't be changed later.**
   Pick the one closest to you (e.g. *India South (Hyderabad)* or *India West (Mumbai)*).
4. Wait for the "account ready" email (minutes to a few hours).

## Part 2 — Create the VM (browser, one time)

1. Console → ☰ menu → **Compute → Instances → Create instance**.
2. Name: `wa-summarizer`.
3. **Image**: Ubuntu 24.04 (Canonical).
4. **Shape** (click *Change shape*):
   - Best: **Ampere → VM.Standard.A1.Flex**, 1 OCPU / 6 GB RAM (well inside the
     always-free budget of 4 OCPU / 24 GB).
   - If A1 shows **"Out of capacity"** (common in popular regions): either retry at a
     different hour (capacity frees up daily) or fall back to
     **VM.Standard.E2.1.Micro** (x86, 1 GB — still enough for this app).
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
- **`better-sqlite3` build errors** — `oracle-setup.sh` installs build-essential;
  re-run it, then `./deploy/deploy.sh` again (it compiles on the server via `npm ci`).
- **Logged out after moving state** — if WhatsApp rejected the moved session, delete
  `auth/` on the server and pair fresh (`pm2 logs` shows the QR).
- **Oracle reclaiming idle VMs** — Oracle may reclaim *idle* Always Free instances;
  this app's constant websocket + periodic work keeps CPU/network above idle
  thresholds in practice. If you ever get a reclamation email, just reply/click keep.
- **Scheduled digest at wrong hour** — timezone: `ssh ... "timedatectl"` and re-run
  setup with `TIMEZONE=`.
