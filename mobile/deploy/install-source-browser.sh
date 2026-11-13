#!/bin/sh
# Run as root after installing Google Chrome stable, Xvfb and Python's venv package.
# This helper never accepts a Google password or changes the browser sandbox.
set -eu
APP="${1:-/srv/mare-music/app}"
test "$(id -u)" = 0
test -f "$APP/source_browser_daemon.py"
command -v google-chrome >/dev/null
command -v Xvfb >/dev/null
install -d -m 0755 /etc/opt/chrome/policies/managed
printf '%s\n' '{"PasswordManagerEnabled":false,"BrowserSignin":0,"SyncDisabled":true,"ExtensionInstallBlocklist":["*"]}' > /etc/opt/chrome/policies/managed/noise-source.json
getent group noise-source-control >/dev/null || groupadd --system noise-source-control
id noise-source >/dev/null 2>&1 || useradd --system --gid noise-source-control --home-dir /var/lib/noise-source --shell /usr/sbin/nologin noise-source
usermod -a -G noise-source-control mare-music
install -d -m 0755 /opt/noise-source
python3 -m venv /opt/noise-source/venv
/opt/noise-source/venv/bin/pip install --quiet 'websocket-client>=1.8,<2'
install -m 0644 "$APP/source_browser_daemon.py" /opt/noise-source/source_browser_daemon.py
install -m 0644 "$APP/deploy/noise-source-browser.service" /etc/systemd/system/noise-source-browser.service
install -d -m 0755 /etc/systemd/system/mare-music.service.d
printf '[Service]\nSupplementaryGroups=noise-source-control\n' > /etc/systemd/system/mare-music.service.d/source-browser.conf
systemctl daemon-reload
systemctl enable --now noise-source-browser
systemctl restart noise-source-browser
systemctl restart mare-music
