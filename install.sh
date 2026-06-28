#!/bin/bash
# Klipper MCU Updater - Installation Script

set -e

INSTALL_DIR="$HOME/klipper-mcu-updater"
SCRIPT_URL="https://raw.githubusercontent.com/GmhF3NiX/klipper-mcu-updater/main/klipper_mcu_updater.py"

echo "============================================"
echo " Klipper MCU Updater - Installer"
echo "============================================"
echo ""

# Check prerequisites
if [ ! -d "$HOME/klipper" ]; then
    echo "ERROR: Klipper not found at ~/klipper"
    exit 1
fi

if [ ! -d "$HOME/katapult" ]; then
    echo "ERROR: Katapult not found at ~/katapult"
    echo "Katapult bootloader is required. Install it first."
    exit 1
fi

# Install gcode_shell_command extension if not present
if [ ! -f "$HOME/klipper/klippy/extras/gcode_shell_command.py" ]; then
    echo "Installing gcode_shell_command extension..."
    curl -s -o "$HOME/klipper/klippy/extras/gcode_shell_command.py" \
        "https://raw.githubusercontent.com/dw-0/kiauh/refs/heads/master/kiauh/extensions/gcode_shell_cmd/assets/gcode_shell_command.py"
    echo "  Done"
fi

# Create install directory
mkdir -p "$INSTALL_DIR"

# Download or copy main script
if [ -f "klipper_mcu_updater.py" ]; then
    cp klipper_mcu_updater.py "$INSTALL_DIR/"
else
    echo "Downloading klipper_mcu_updater.py..."
    curl -s -o "$INSTALL_DIR/klipper_mcu_updater.py" "$SCRIPT_URL"
fi
chmod +x "$INSTALL_DIR/klipper_mcu_updater.py"

# Create wrapper scripts
cat > "$INSTALL_DIR/scan.sh" << 'EOF'
#!/bin/bash
python3 ~/klipper-mcu-updater/klipper_mcu_updater.py scan
EOF

cat > "$INSTALL_DIR/update_all.sh" << 'EOF'
#!/bin/bash
python3 ~/klipper-mcu-updater/klipper_mcu_updater.py update
EOF

cat > "$INSTALL_DIR/backup.sh" << 'EOF'
#!/bin/bash
python3 ~/klipper-mcu-updater/klipper_mcu_updater.py backup
EOF

chmod +x "$INSTALL_DIR"/*.sh

# Create Klipper macro config
cat > "$HOME/printer_data/config/mcu_updater.cfg" << 'MACROS'
# Klipper MCU Updater - Mainsail Macros
# https://github.com/GmhF3NiX/klipper-mcu-updater

[gcode_shell_command mcu_scan]
command: python3 ~/klipper-mcu-updater/klipper_mcu_updater.py scan
timeout: 30.
verbose: True

[gcode_shell_command mcu_update_all]
command: python3 ~/klipper-mcu-updater/klipper_mcu_updater.py update
timeout: 600.
verbose: True

[gcode_shell_command mcu_backup]
command: python3 ~/klipper-mcu-updater/klipper_mcu_updater.py backup
timeout: 60.
verbose: True

[gcode_macro MCU_SCAN]
description: Scan all connected MCUs and show firmware versions
gcode:
    RUN_SHELL_COMMAND CMD=mcu_scan

[gcode_macro MCU_UPDATE_ALL]
description: Update firmware on ALL MCUs (requires Katapult)
gcode:
    RUN_SHELL_COMMAND CMD=mcu_update_all

[gcode_macro MCU_BACKUP]
description: Backup current printer configuration
gcode:
    RUN_SHELL_COMMAND CMD=mcu_backup
MACROS

echo ""
echo "============================================"
echo " Installation complete!"
echo "============================================"
echo ""
echo "Files installed to: $INSTALL_DIR"
echo "Macro config: ~/printer_data/config/mcu_updater.cfg"
echo ""
echo "Next steps:"
echo "  1. Add to printer.cfg:  [include mcu_updater.cfg]"
echo "  2. Restart Klipper"
echo "  3. Use Mainsail macros or CLI:"
echo ""
echo "     CLI:"
echo "       python3 ~/klipper-mcu-updater/klipper_mcu_updater.py scan"
echo "       python3 ~/klipper-mcu-updater/klipper_mcu_updater.py update"
echo "       python3 ~/klipper-mcu-updater/klipper_mcu_updater.py update --target EBB"
echo ""
echo "     Mainsail: MCU_SCAN / MCU_UPDATE_ALL / MCU_BACKUP"
echo ""
