# Server access

How the owner reaches the server, how SSH is configured, how an access change is made safely and what to do when the normal path is broken. Background: ADR-027 "Firewall", ADR-049 (deploy mechanics B, manual action M-9), ADR-050 (the firewall restated, the snapshot rule) and the WP-8 explainer, D1 and D2.

Placeholders stand for values that stay out of this repo: `<server-ip>`, `<ssh-port>`, `<other-port>` (any port that is not 80, 443 or SSH), `<login-user>`, `<tailnet-host>` (the server's name on the tailnet), `<profile>` (the owner's SSH client profile for this host), `<owner-login>` (the owner's Tailscale login).

## 1. How access works

- **Hetzner Cloud Firewall**, attached to the server in the Hetzner console: inbound TCP 80 and 443 from anywhere, nothing else. It filters before a packet reaches the VM, so nothing on the host can open a hole in it. This matters because Docker publishes container ports with a NAT rule that sends the packet down the `FORWARD` chain, and ufw only filters `INPUT`: a published port is open whatever ufw says. The Cloud Firewall applies to every project on the host.
- **SSH only over Tailscale.** The server, the owner's machines and (from WP-9) an ephemeral CI runner join one tailnet. SSH reaches `sshd` through the `tailscale0` interface only. Tailscale needs no inbound port: it connects outwards.
- **The Tailscale policy is the control for tailnet traffic** (section 1a). Tailscale enforces it on the server before a packet reaches the kernel's chains, so it covers host processes and Docker-published ports alike.
- **ufw stays on** with its default incoming policy deny. It protects host processes from the public interface only. `tailscaled` adds its own `ts-input` chain at the top of `INPUT`, before ufw's chains, and that chain accepts everything arriving on `tailscale0`; a ufw rule on `tailscale0` is therefore never evaluated. The rule allowing `<ssh-port>` on `tailscale0` stays as harmless, but it is not the control.
- **Tailscale SSH stays off.** The deploy path of WP-8 step 3 relies on `authorized_keys` and its forced command, and Tailscale SSH does not read `authorized_keys`. All SSH is plain OpenSSH over the tailnet.
- **Key expiry is disabled for the server node** in the Tailscale admin console. Node keys expire after 180 days by default, and an expired server drops off the tailnet. Tagged nodes have key expiry disabled by default.

### 1a. Tailscale policy

The policy file lives in the Tailscale admin console (Access controls). Its shape, with placeholders:

```jsonc
{
  "tagOwners": {
    "tag:server": ["autogroup:admin"]
  },
  "grants": [
    // Tailnet members reach the server's SSH port, nothing else on it.
    { "src": ["autogroup:member"], "dst": ["tag:server"], "ip": ["tcp:<ssh-port>"] },
    // Each member's own devices reach each other.
    { "src": ["autogroup:member"], "dst": ["autogroup:self"], "ip": ["*"] }
  ],
  "tests": [
    {
      "src": "<owner-login>",
      "accept": ["tag:server:<ssh-port>"],
      "deny": ["tag:server:<other-port>", "tag:server:443"]
    }
  ]
}
```

- **Tags.** The server node carries `tag:server`. A tagged node is owned by the tag, not by a user, and only an admin may apply the tag.
- **Tests.** Tailscale refuses to save a policy that breaks a test, so a change that would open another port to the server, or cut the owner's SSH, is rejected at save time (policy as code with tests).
- **Make before break.** Save the policy first: the untagged server is still reachable through `autogroup:self`. Then tag the server node and check SSH from a second terminal.
- **WP-9** adds a grant from `tag:ci` to `tag:server` on `tcp:<ssh-port>`, with a test for it.

## 2. Normal login

The SSH client profile on the owner's machine points at the tailnet host name, not the public address:

```
Host <profile>
  HostName <tailnet-host>
  User <login-user>
  Port <ssh-port>
```

Then:

```
ssh <profile>
```

If it hangs, check that the machine is on the tailnet (`tailscale status`) before anything else.

### 2a. Admin screens over a tunnel

Postgres and RabbitMQ's AMQP port publish nothing: no tool on the owner's machine can reach them, by design (ADR-050, compensating controls). For a database console, run it inside the container on the server:

```
docker exec -it jadero-ops-postgres-1 psql -U postgres
```

The three admin screens of the ops stack bind to `127.0.0.1` on the server only (`infra/compose/compose.ops.yml`, Q2 B). Only Uptime Kuma's public status page is reachable from outside, through nginx. Reach the rest with SSH local forwards, which carry each local port to the same port on the server's loopback:

| Screen | Local and server port |
|---|---|
| RabbitMQ management | 15673 |
| Umami | 3100 |
| Uptime Kuma | 3101 |

One command opens all three and stays in the foreground until Ctrl+C:

```
ssh -N -L 15673:127.0.0.1:15673 -L 3100:127.0.0.1:3100 -L 3101:127.0.0.1:3101 <profile>
```

Then open `http://localhost:15673`, `http://localhost:3100` or `http://localhost:3101`. The logins are in 1Password.

To avoid typing the forwards, add a second profile next to `<profile>` with the same host settings:

```
Host <profile>-admin
  HostName <tailnet-host>
  User <login-user>
  Port <ssh-port>
  LocalForward 15673 127.0.0.1:15673
  LocalForward 3100 127.0.0.1:3100
  LocalForward 3101 127.0.0.1:3101
```

and run `ssh -N <profile>-admin`. When a local port is already taken, change only the first number of that forward. The tunnel rides the same Tailscale connection as SSH, so it works next to another VPN as long as that VPN does not route the tailnet range (`100.64.0.0/10`).

## 3. sshd settings

The settings that matter live in a drop-in, `/etc/ssh/sshd_config.d/00-jadero.conf`:

```
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
AllowUsers <login-user> deploy
```

Add any other user to `AllowUsers` only after the owner confirms it needs SSH.

Why a drop-in named `00-`: the main `sshd_config` includes `sshd_config.d/*.conf` at its top, and for each keyword sshd keeps the **first** value it reads. `00-jadero.conf` sorts before `50-cloud-init.conf`, so our values win over cloud-init's and over the main file. For the same reason, reading a file never proves the setting in force; only `sshd -T` does.

Ubuntu 26.04 starts sshd through socket activation (`ssh.socket`). The settings above take effect with a reload. A change to `Port` or `ListenAddress` goes through the socket instead: `sudo systemctl daemon-reload` and `sudo systemctl restart ssh.socket`.

Change procedure:

1. Keep the current SSH session open for the whole procedure.
2. Edit the drop-in: `sudoedit /etc/ssh/sshd_config.d/00-jadero.conf`.
3. Check the syntax: `sudo sshd -t` (no output means it parses).
4. Apply: `sudo systemctl reload ssh`.
5. In a second terminal, open a new connection: `ssh <profile>`. Only when it works, close anything.
6. Check the effective values:

   ```
   sudo sshd -T | grep -E '^(port|passwordauthentication|kbdinteractiveauthentication|permitrootlogin|allowusers) '
   ```

   Expected: `passwordauthentication no`, `kbdinteractiveauthentication no`, `permitrootlogin no`, `allowusers` listing the users above, and `port <ssh-port>`.

If step 3 or 5 fails, undo the edit from the session still open and reload again.

## 4. Make before break

The order for any access change (SSH, Tailscale, ufw, the Cloud Firewall):

1. Open the new path.
2. Prove it from a second terminal while the old session stays open.
3. Check the break-glass path (section 5) still works.
4. Only then close the old path.

Example, the WP-8 perimeter: log Tailscale in and disable key expiry; save the Tailscale policy (section 1a), then tag the server node; add the ufw rule for `tailscale0` (`sudo ufw allow in on tailscale0 to any port <ssh-port> proto tcp`); prove `ssh <profile>` over the tailnet; check the Hetzner console; then attach the Cloud Firewall and remove the public SSH rule from ufw (`sudo ufw status numbered`, then `sudo ufw delete <n>`).

## 5. Break-glass

When the normal path is broken, in order:

**a. Hetzner web console.** In the Hetzner Cloud console, open the server page and start the Console. It is a local login with no network path, so neither the Cloud Firewall, ufw, Tailscale nor `sshd` stands in the way. Log in as `<login-user>` with its password (`PasswordAuthentication no` only affects SSH; the password is kept in the owner's password manager). Checked once during WP-8 step 2, on 2026-10-17.

**b. sshd or ufw broken.** From the console: fix the drop-in and run `sudo sshd -t` and `sudo systemctl reload ssh`, or fix the ufw rule. If SSH must come back at once, `sudo ufw allow <ssh-port>/tcp` temporarily (the Cloud Firewall still keeps it off the internet), and delete that rule once the tailnet path works again.

**c. Tailscale down or the node expired.** From the console: `sudo tailscale status`, then `sudo tailscale up` (or `sudo systemctl restart tailscaled`) and log the node in again; check key expiry is still disabled. If the tailnet cannot be fixed quickly, add a temporary inbound rule in the Cloud Firewall for TCP `<ssh-port>` limited to the owner's current public address (`<owner-ip>/32`), plus a temporary `sudo ufw allow <ssh-port>/tcp`. Remove both as soon as the tailnet path works.

**c2. A Tailscale policy cut SSH.** The policy lives in Tailscale's admin console, not on the server, so the fix needs neither the server nor the console login: in the Tailscale admin console, open Access controls, restore the last working version from the policy history (or fix the grant) and save. Then check `ssh <profile>` from a second terminal.

**d. Hetzner rescue system, last resort.** When the system does not boot or the console login fails: in the Hetzner console, enable the rescue system with the owner's SSH key and reboot the server. Rescue listens for root SSH on port 22, so add a temporary Cloud Firewall rule for TCP 22 limited to `<owner-ip>/32`. Then `ssh root@<server-ip>`, find the root partition with `lsblk`, `mount <root-partition> /mnt`, fix the files under `/mnt` (for example `/mnt/etc/ssh/sshd_config.d/00-jadero.conf`), `umount /mnt` and reboot. Rescue is active for one boot only. Remove the temporary firewall rule afterwards.

## 6. Verification

After any perimeter change (WP-8 Trace 1, step 4).

From a machine **not** on the tailnet:

```
nc -vz -w 5 <server-ip> <ssh-port>      # times out
nc -vz -w 5 <server-ip> <other-port>    # times out
curl -sI https://<a site on the host>   # answers, 80 and 443 stay open
```

`nc -vz` only opens a TCP connection; it reads nothing from the service behind the port.

From a machine on the tailnet:

```
ssh <profile> hostname                       # prints the server's host name
nc -vz -w 5 <tailnet-host> <ssh-port>        # succeeds
nc -vz -w 5 <tailnet-host> <other-port>      # times out
```

The last line proves the Tailscale policy, not ufw: without the policy, any port listening on all interfaces, or published by Docker, answers over the tailnet (section 1). A Docker-published port answers on the `100.x` address too, because Docker's NAT rule matches any host address.

## 7. Rollback

Before a risky change (a release upgrade, a firewall or SSH change), the owner takes a Hetzner snapshot by hand. Only one snapshot is kept, and it is deleted once the change is verified (ADR-050). If a change cannot be fixed through section 5, restore the snapshot from the Hetzner console; anything written on the host after the snapshot is lost, including other projects' data, so this is the last option.

## 8. The deploy user

WP-9's deploy job reaches the server as `deploy`, a user that can do one thing: run `deploy.sh` with a validated environment, service and version (WP-8 D3, ADR-049 restating ADR-048's deploy mechanics). Its key sits in GitHub's secrets, so a leaked key must not mean a leaked server.

- **No password, not in `docker` or `sudo`.** The `docker` group is root-equivalent: anyone in it can start a container that mounts `/`.
- **One key per environment, each with a forced command bound to it** (WP-9 D2). Whatever the client asks for, `sshd` runs `/srv/jadero/bin/deploy-entry staging` for the staging key and `/srv/jadero/bin/deploy-entry prod` for production's. The client's words arrive only as the `SSH_ORIGINAL_COMMAND` variable. The wrapper accepts exactly `deploy <env> <service> <version>` and `rollback <env> <service>` (`staging` or `prod`; `api`, `agent` or `web`; a semver version without `v`), and only when `<env>` is the key line's (`refused reason=env-mismatch` otherwise, `no-binding` for a key line without one). It refuses anything else with exit 1, logs one line per call under the tag `jadero-deploy` (the values when accepted, a fixed reason when refused, never the raw input) and calls `sudo -n /srv/jadero/bin/deploy.sh deploy <env> <service> <version>` (or `rollback <env> <service>`), with standard input passed through: the registry user and token, and for production the expected digest.
- **One sudo rule.** It names `deploy.sh` and nothing else. A sudoers rule with no arguments allows any arguments, so `deploy.sh` checks them again.
- **`deploy.sh` is the deploy state machine** (WP-9 D1): one deploy per environment at a time (a `flock` on `/srv/jadero/<env>/deploy.lock`, in the root-owned state folder; exit 75 when busy), a journal line per state in `/srv/jadero/<env>/deploy.log`, `versions.env` and `previous.env` beside it, the release's files in `releases/<service>-<version>/`. `redeploy <env> <service>` (the current version with fresh secrets) runs only from the owner's root shell; `deploy-entry` does not accept it and `deploy.sh` refuses it when `SUDO_USER` is `deploy`. The procedures arrive in `docs/runbooks/deploy.md` (WP-9 step 6).

Sources: `infra/scripts/deploy-entry` and `infra/scripts/deploy.sh`, tested by `scripts/deploy-entry.test.mjs` and `scripts/deploy.test.mjs`.

### The key line

`/home/deploy/.ssh/authorized_keys` holds one line per environment (WP-9 step 5 replaces WP-8's single test key, whose line has no environment and is refused with `no-binding` from WP-9 on):

```
restrict,from="100.64.0.0/10,fd7a:115c:a1e0::/48",command="/srv/jadero/bin/deploy-entry staging" <staging-public-key>
restrict,from="100.64.0.0/10,fd7a:115c:a1e0::/48",command="/srv/jadero/bin/deploy-entry prod" <prod-public-key>
```

- `restrict` turns off port, agent and X11 forwarding and the terminal.
- `from="100.64.0.0/10,fd7a:115c:a1e0::/48"` accepts the key only from tailnet addresses, IPv4 and IPv6 (Tailscale gives every node one of each, and a client may pick either).
- `command=` is the forced command, with the one environment this key may act on.

### Why the user needs a real login shell

`sshd` runs a forced command through the user's login shell, as `<shell> -c "<command>"`. With `/usr/sbin/nologin` the shell prints "This account is currently not available" and the wrapper never runs. So `deploy` gets `/bin/bash`. This gives no extra power: the only string that shell runs is the fixed `command=` from the key line, never the client's words, and the user has no password and no other key.

### Set it up (owner, on the server)

Copy the scripts from the laptop, then install them root-owned. The folder and the scripts must not be writable by anyone but root: whoever can change `deploy.sh` runs code as root through the sudo rule.

```
scp infra/scripts/deploy-entry infra/scripts/deploy.sh <profile>:~/
ssh <profile>
sudo install -d -o root -g root -m 755 /srv/jadero /srv/jadero/bin
sudo install -o root -g root -m 755 ~/deploy-entry ~/deploy.sh /srv/jadero/bin/
rm ~/deploy-entry ~/deploy.sh
```

Create the user. `useradd` leaves the password locked; the `.ssh` folder and the key file are owned by root, so even a bug in the wrapper could not let the key holder add a key.

```
sudo useradd --create-home --shell /bin/bash deploy
sudo passwd --status deploy                 # expect "deploy L ...": locked
id deploy                                   # expect only the deploy group
sudo install -d -o root -g root -m 755 /home/deploy/.ssh
sudoedit /home/deploy/.ssh/authorized_keys  # the key line above
sudo chown root:root /home/deploy/.ssh/authorized_keys
sudo chmod 644 /home/deploy/.ssh/authorized_keys
```

Add the sudo rule with `visudo`, which refuses to save a file that does not parse:

```
sudo visudo -f /etc/sudoers.d/jadero-deploy
```

with the single line

```
deploy ALL=(root) NOPASSWD: /srv/jadero/bin/deploy.sh
```

then:

```
sudo chmod 440 /etc/sudoers.d/jadero-deploy
sudo visudo -c                              # every sudoers file parses
sudo -l -U deploy                           # lists only /srv/jadero/bin/deploy.sh
```

`deploy` is already in `AllowUsers` (section 3).

### Test it (WP-8 Trace 1, step 5)

On the laptop, a throwaway key until WP-9 replaces it with the CI key:

```
ssh-keygen -t ed25519 -f ~/.ssh/jadero-deploy-test -N '' -C jadero-deploy-test
```

Put its public half in the key line above. Then, from the laptop on the tailnet:

```
ssh -i ~/.ssh/jadero-deploy-test -o IdentitiesOnly=yes -p <ssh-port> deploy@<tailnet-host> deploy staging api 0.4.1
# would deploy api 0.4.1 to staging

ssh -i ~/.ssh/jadero-deploy-test -o IdentitiesOnly=yes -p <ssh-port> deploy@<tailnet-host> bash
# refused: expected "deploy <env> <service> <version>"    (exit 1)

ssh -i ~/.ssh/jadero-deploy-test -o IdentitiesOnly=yes -p <ssh-port> deploy@<tailnet-host> 'deploy staging api 0.4.1; id'
# refused: expected "deploy <env> <service> <version>"    (exit 1)
```

Port forwarding is off. In one terminal:

```
ssh -N -i ~/.ssh/jadero-deploy-test -o IdentitiesOnly=yes -p <ssh-port> -L 15432:127.0.0.1:5432 deploy@<tailnet-host>
```

and in a second, `nc -vz 127.0.0.1 15432`: the first terminal prints `open failed: administratively prohibited`.

On the server, the log:

```
journalctl -t jadero-deploy -n 5
# ... accepted env=staging service=api version=0.4.1
# ... refused reason=word-count
# ... refused reason=bad-characters
```

If a key that should work gets `Permission denied (publickey)`: check the client address is a tailnet one (the `from=` pattern), the ownership and modes of `/home/deploy`, `.ssh` and `authorized_keys` (`sshd` refuses files writable by others), and `sudo journalctl -u ssh -n 20`.

### Revoke the key

1. Remove its line from `/home/deploy/.ssh/authorized_keys` (`sudoedit`). `sshd` reads the file on every connection, so the key stops working at once.
2. End any session still open: `sudo pkill -u deploy`.
3. To take the deploy path away completely, also remove the sudo rule: `sudo rm /etc/sudoers.d/jadero-deploy`.
4. Delete the throwaway key on the laptop once WP-9's CI key is in place: `rm ~/.ssh/jadero-deploy-test ~/.ssh/jadero-deploy-test.pub`.
