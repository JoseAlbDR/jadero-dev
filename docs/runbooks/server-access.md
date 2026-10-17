# Server access

How the owner reaches the server, how SSH is configured, how an access change is made safely and what to do when the normal path is broken. Background: ADR-027 "Firewall", ADR-049 (deploy mechanics B, manual action M-9), ADR-050 (the firewall restated, the snapshot rule) and the WP-8 explainer, D1 and D2.

Placeholders stand for values that stay out of this repo: `<server-ip>`, `<ssh-port>`, `<other-port>` (any port that is not 80, 443 or SSH), `<login-user>`, `<tailnet-host>` (the server's name on the tailnet), `<profile>` (the owner's SSH client profile for this host).

## 1. How access works

- **Hetzner Cloud Firewall**, attached to the server in the Hetzner console: inbound TCP 80 and 443 from anywhere, nothing else. It filters before a packet reaches the VM, so nothing on the host can open a hole in it. This matters because Docker publishes container ports with a NAT rule that sends the packet down the `FORWARD` chain, and ufw only filters `INPUT`: a published port is open whatever ufw says. The Cloud Firewall applies to every project on the host.
- **SSH only over Tailscale.** The server, the owner's machines and (from WP-9) an ephemeral CI runner join one tailnet. SSH reaches `sshd` through the `tailscale0` interface only. Tailscale needs no inbound port: it connects outwards.
- **ufw stays on** with its default incoming policy deny, and allows `<ssh-port>` only on `tailscale0`. It still protects host processes; it is not the control we rely on for containers.
- **Tailscale SSH stays off.** The deploy path of WP-8 step 3 relies on `authorized_keys` and its forced command, and Tailscale SSH does not read `authorized_keys`. All SSH is plain OpenSSH over the tailnet.
- **Key expiry is disabled for the server node** in the Tailscale admin console. Node keys expire after 180 days by default, and an expired server drops off the tailnet.

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

Example, the WP-8 perimeter: log Tailscale in and disable key expiry; add the ufw rule for `tailscale0` (`sudo ufw allow in on tailscale0 to any port <ssh-port> proto tcp`); prove `ssh <profile>` over the tailnet; check the Hetzner console; then attach the Cloud Firewall and remove the public SSH rule from ufw (`sudo ufw status numbered`, then `sudo ufw delete <n>`).

## 5. Break-glass

When the normal path is broken, in order:

**a. Hetzner web console.** In the Hetzner Cloud console, open the server page and start the Console. It is a local login with no network path, so neither the Cloud Firewall, ufw, Tailscale nor `sshd` stands in the way. Log in as `<login-user>` with its password (`PasswordAuthentication no` only affects SSH; the password is kept in the owner's password manager). Checked once during WP-8 step 2, on 2026-10-17.

**b. sshd or ufw broken.** From the console: fix the drop-in and run `sudo sshd -t` and `sudo systemctl reload ssh`, or fix the ufw rule. If SSH must come back at once, `sudo ufw allow <ssh-port>/tcp` temporarily (the Cloud Firewall still keeps it off the internet), and delete that rule once the tailnet path works again.

**c. Tailscale down or the node expired.** From the console: `sudo tailscale status`, then `sudo tailscale up` (or `sudo systemctl restart tailscaled`) and log the node in again; check key expiry is still disabled. If the tailnet cannot be fixed quickly, add a temporary inbound rule in the Cloud Firewall for TCP `<ssh-port>` limited to the owner's current public address (`<owner-ip>/32`), plus a temporary `sudo ufw allow <ssh-port>/tcp`. Remove both as soon as the tailnet path works.

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
ssh <profile> hostname                  # prints the server's host name
```

## 7. Rollback

Before a risky change (a release upgrade, a firewall or SSH change), the owner takes a Hetzner snapshot by hand. Only one snapshot is kept, and it is deleted once the change is verified (ADR-050). If a change cannot be fixed through section 5, restore the snapshot from the Hetzner console; anything written on the host after the snapshot is lost, including other projects' data, so this is the last option.
