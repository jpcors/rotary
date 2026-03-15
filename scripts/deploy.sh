#!/bin/bash
set -euo pipefail

# Load env for PI_HOST
if [ -f .env ]; then
  source .env
fi

PI_HOST="${PI_HOST:-pi@pi.local}"
REMOTE_AGI="/usr/share/asterisk/agi-bin/rotary"
REMOTE_ASTERISK="/etc/asterisk"

echo "=== Building TypeScript ==="
npm run build

echo "=== Deploying to ${PI_HOST} ==="

# Create remote directory and temp staging area
ssh "$PI_HOST" "sudo mkdir -p ${REMOTE_AGI} && mkdir -p /tmp/rotary-deploy"

# Copy application files
scp -r dist package.json package-lock.json .env "$PI_HOST:/tmp/rotary-deploy/"
ssh "$PI_HOST" "sudo cp -r /tmp/rotary-deploy/* ${REMOTE_AGI}/ && rm -rf /tmp/rotary-deploy"

# Backup and copy Asterisk configs
ssh "$PI_HOST" "
  for f in pjsip.conf extensions.conf modules.conf; do
    if [ -f ${REMOTE_ASTERISK}/\$f ] && [ ! -f ${REMOTE_ASTERISK}/\$f.bak ]; then
      sudo cp ${REMOTE_ASTERISK}/\$f ${REMOTE_ASTERISK}/\$f.bak
    fi
  done
"
scp asterisk/*.conf "$PI_HOST:/tmp/"
ssh "$PI_HOST" "sudo mv /tmp/pjsip.conf /tmp/extensions.conf /tmp/modules.conf ${REMOTE_ASTERISK}/"

# Install dependencies and set permissions
ssh "$PI_HOST" "
  cd ${REMOTE_AGI}
  sudo npm install --omit=dev
  sudo chown -R asterisk:asterisk ${REMOTE_AGI}
  sudo chmod +x ${REMOTE_AGI}/dist/main.js
  sudo chmod 600 ${REMOTE_AGI}/.env
"

echo "=== Restarting Asterisk ==="
ssh "$PI_HOST" "sudo systemctl restart asterisk"

echo "=== Deploy complete ==="
echo "Verify with: ssh ${PI_HOST} 'sudo asterisk -rx \"pjsip show contacts\"'"
