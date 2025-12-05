#!/bin/bash
# PHANTOM BOX IMAGE BUILDER
# Creates a flashable image for Raspberry Pi

set -e

VERSION="0.1.0"
IMAGE_NAME="phantombox-v${VERSION}"
WORK_DIR="/tmp/phantombox-build"
OUTPUT_DIR="./output"

echo "=========================================="
echo "  PHANTOM BOX IMAGE BUILDER"
echo "  Version: $VERSION"
echo "=========================================="

# Check dependencies
command -v wget >/dev/null 2>&1 || { echo "wget required"; exit 1; }
command -v qemu-arm-static >/dev/null 2>&1 || { echo "qemu-user-static required"; exit 1; }

# Download base image
BASE_IMAGE_URL="https://downloads.raspberrypi.com/raspios_lite_arm64/images/raspios_lite_arm64-2024-03-15/2024-03-15-raspios-bookworm-arm64-lite.img.xz"
BASE_IMAGE="raspios-lite.img"

echo "[1/6] Downloading base image..."
if [ ! -f "$BASE_IMAGE" ]; then
    wget -O "${BASE_IMAGE}.xz" "$BASE_IMAGE_URL"
    xz -d "${BASE_IMAGE}.xz"
fi

# Create work directory
echo "[2/6] Setting up work directory..."
mkdir -p "$WORK_DIR"
mkdir -p "$OUTPUT_DIR"
cp "$BASE_IMAGE" "$WORK_DIR/${IMAGE_NAME}.img"

# Resize image (add 1GB for agent + dashboard)
echo "[3/6] Resizing image..."
truncate -s +1G "$WORK_DIR/${IMAGE_NAME}.img"

# Mount image
echo "[4/6] Mounting image..."
LOOP_DEV=$(losetup -f --show -P "$WORK_DIR/${IMAGE_NAME}.img")
BOOT_PART="${LOOP_DEV}p1"
ROOT_PART="${LOOP_DEV}p2"

# Resize partition
e2fsck -f "$ROOT_PART"
resize2fs "$ROOT_PART"

# Mount partitions
mkdir -p "$WORK_DIR/mnt/boot"
mkdir -p "$WORK_DIR/mnt/root"
mount "$BOOT_PART" "$WORK_DIR/mnt/boot"
mount "$ROOT_PART" "$WORK_DIR/mnt/root"

# Copy setup files
echo "[5/6] Installing Phantom Box files..."
cp setup.sh "$WORK_DIR/mnt/root/home/pi/phantombox-setup.sh"
chmod +x "$WORK_DIR/mnt/root/home/pi/phantombox-setup.sh"

# Enable SSH
touch "$WORK_DIR/mnt/boot/ssh"

# Set default password (change on first boot)
# echo "pi:phantom" | chpasswd -R "$WORK_DIR/mnt/root"

# Add first-boot script
cat > "$WORK_DIR/mnt/root/etc/rc.local" << 'EOF'
#!/bin/bash
# First boot setup
if [ -f /home/pi/phantombox-setup.sh ]; then
    /home/pi/phantombox-setup.sh >> /var/log/phantombox-setup.log 2>&1
    mv /home/pi/phantombox-setup.sh /home/pi/phantombox-setup.sh.done
fi
exit 0
EOF
chmod +x "$WORK_DIR/mnt/root/etc/rc.local"

# Unmount
echo "[6/6] Finalizing image..."
sync
umount "$WORK_DIR/mnt/boot"
umount "$WORK_DIR/mnt/root"
losetup -d "$LOOP_DEV"

# Compress
gzip -c "$WORK_DIR/${IMAGE_NAME}.img" > "$OUTPUT_DIR/${IMAGE_NAME}.img.gz"

# Calculate checksum
sha256sum "$OUTPUT_DIR/${IMAGE_NAME}.img.gz" > "$OUTPUT_DIR/${IMAGE_NAME}.img.gz.sha256"

# Cleanup
rm -rf "$WORK_DIR"

echo ""
echo "=========================================="
echo "  BUILD COMPLETE!"
echo "=========================================="
echo ""
echo "Output: $OUTPUT_DIR/${IMAGE_NAME}.img.gz"
echo "SHA256: $(cat $OUTPUT_DIR/${IMAGE_NAME}.img.gz.sha256)"
echo ""
echo "Flash with: balena-etcher $OUTPUT_DIR/${IMAGE_NAME}.img.gz"

