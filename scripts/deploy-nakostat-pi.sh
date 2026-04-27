#!/bin/bash

set -euo pipefail

# Check if argument is provided
if [ $# -ne 1 ]; then
    echo "Usage: $0 <pi-host> (e.g., pi@nakostat.local)"
    exit 1
fi

PI_HOST="$1"

echo "Deploying nakostat to $PI_HOST"

# Get the directory where this script is located (repo root)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO_ROOT="$( dirname "$SCRIPT_DIR" )"

# 1. Build binary
echo "Building binary..."
cd "$REPO_ROOT/embedded/pi/sensor-daemon"
cargo build --release --target aarch64-unknown-linux-gnu --features real-sensor
cd "$REPO_ROOT"

# 2. Copy binary to Pi
echo "Copying binary to Pi..."
scp "embedded/pi/sensor-daemon/target/aarch64-unknown-linux-gnu/release/nakostat" "$PI_HOST":/tmp/nakostat

# 3. Create user/group (idempotent)
echo "Creating nakostat user/group..."
ssh "$PI_HOST" "sudo useradd --system --user-group --home-dir /var/lib/nakostat --create-home nakostat 2>/dev/null || true"

# 4. Add nakostat to i2c group
echo "Adding nakostat user to i2c group..."
ssh "$PI_HOST" "sudo usermod -a -G i2c nakostat 2>/dev/null || true"

# 5. Create directories with proper permissions
echo "Creating directories..."
ssh "$PI_HOST" "sudo mkdir -p /etc/nakostat/certs /var/log/nakostat /opt/nakostat"
ssh "$PI_HOST" "sudo chown -R nakostat:nakostat /etc/nakostat /var/log/nakostat"
ssh "$PI_HOST" "sudo chmod 700 /etc/nakostat/certs 750 /var/log/nakostat"

# 6. Copy config template if it doesn't exist
echo "Copying config template..."
if [ -f "$REPO_ROOT/embedded/pi/sensor-daemon/config.toml.example" ]; then
    scp "$REPO_ROOT/embedded/pi/sensor-daemon/config.toml.example" "$PI_HOST":/tmp/nakostat.toml
    ssh "$PI_HOST" "sudo mkdir -p /etc/nakostat && sudo mv /tmp/nakostat.toml /etc/nakostat/nakostat.toml && sudo chown root:nakostat /etc/nakostat/nakostat.toml && sudo chmod 640 /etc/nakostat/nakostat.toml"
else
    echo "Warning: config.toml.example not found; you'll need to create /etc/nakostat/nakostat.toml manually"
fi

# 7. Copy systemd service file
echo "Copying systemd service file..."
scp "$REPO_ROOT/embedded/pi/sensor-daemon/nakostat.service" "$PI_HOST":/tmp/nakostat.service
ssh "$PI_HOST" "sudo mv /tmp/nakostat.service /etc/systemd/system/nakostat.service"

# 8. Install binary to final location
echo "Installing binary and reloading systemd..."
ssh "$PI_HOST" "sudo mv /tmp/nakostat /opt/nakostat/nakostat"
ssh "$PI_HOST" "sudo chmod +x /opt/nakostat/nakostat"
ssh "$PI_HOST" "sudo systemctl daemon-reload"
ssh "$PI_HOST" "sudo systemctl enable nakostat"

# 9. Prompt for AWS IoT cert and key paths
echo ""
echo "Please provide paths to your AWS IoT certificate and private key files:"
read -p "Certificate path: " CERT_PATH
read -p "Private key path: " KEY_PATH

echo "Copying AWS IoT certificates..."
scp "$CERT_PATH" "$PI_HOST":/tmp/certificate.pem.crt
scp "$KEY_PATH" "$PI_HOST":/tmp/private.pem.key
ssh "$PI_HOST" "sudo mv /tmp/certificate.pem.crt /etc/nakostat/certs/"
ssh "$PI_HOST" "sudo mv /tmp/private.pem.key /etc/nakostat/certs/"
ssh "$PI_HOST" "sudo chown -R nakostat:nakostat /etc/nakostat/certs"
ssh "$PI_HOST" "sudo chmod 600 /etc/nakostat/certs/*"

# 10. Start service and verify
echo "Starting nakostat service..."
ssh "$PI_HOST" "sudo systemctl start nakostat"

echo ""
echo "Deployment complete!"
echo "To verify the deployment, run:"
echo "  ssh $PI_HOST 'sudo journalctl -u nakostat -f' (to see live logs)"
echo "  ssh $PI_HOST 'tail -f /var/log/nakostat/nakostat.log' (to see application logs)"
echo "  ssh $PI_HOST 'sudo systemctl status nakostat' (to check service status)"
