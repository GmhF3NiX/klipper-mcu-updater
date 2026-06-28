#!/bin/bash
# Klipper MCU Updater - Installation Script

INSTALL_DIR="$HOME/klipper-mcu-updater"
SCRIPT_URL="https://raw.githubusercontent.com/GmhF3NiX/klipper-mcu-updater/main/klipper_mcu_updater.py"

clear
echo ""
echo "============================================"
echo " Klipper MCU Updater - Installer"
echo " by GmhF3NiX"
echo "============================================"
echo ""
echo "============================================"
echo "              DISCLAIMER"
echo "============================================"
echo ""
echo " This tool flashes firmware to your 3D"
echo " printer MCUs. Incorrect firmware can"
echo " render your printer inoperable."
echo ""
echo " USE AT YOUR OWN RISK!"
echo ""
echo " The author assumes NO responsibility"
echo " for any damage to hardware, software,"
echo " or any other losses resulting from the"
echo " use of this tool."
echo ""
echo " By continuing, you acknowledge that:"
echo "  - You understand the risks involved"
echo "  - You accept full responsibility"
echo "  - Katapult bootloader must be installed"
echo "    on all target MCUs"
echo "  - You will NOT run this during a print"
echo ""
echo "============================================"
echo ""

read -p "Do you accept these terms and want to continue? (yes/no): " ACCEPT

if [ "$ACCEPT" != "yes" ] && [ "$ACCEPT" != "y" ]; then
    echo ""
    echo "Installation cancelled."
    exit 0
fi

echo ""

# Check prerequisites
echo "Checking prerequisites..."
if [ ! -d "$HOME/klipper" ]; then
    echo "ERROR: Klipper not found at ~/klipper"
    exit 1
fi
echo "  Klipper: OK"

if [ ! -d "$HOME/katapult" ]; then
    echo "ERROR: Katapult not found at ~/katapult"
    echo "Katapult bootloader is required. Install it first."
    exit 1
fi
echo "  Katapult: OK"

if [ ! -d "$HOME/printer_data/config" ]; then
    echo "ERROR: Printer data config directory not found"
    exit 1
fi
echo "  Printer data: OK"
echo ""

# Create safety backup before any changes
echo "============================================"
echo "  Creating Safety Backup"
echo "============================================"
echo ""
echo "  Backing up current config before installation..."
BACKUP_DIR="$HOME/printer_data/config_backups/pre_install_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"
cp -r "$HOME/printer_data/config/"*.cfg "$BACKUP_DIR/" 2>/dev/null
echo "  Backup saved to: $BACKUP_DIR"
echo "  If anything goes wrong, restore with:"
echo "    cp $BACKUP_DIR/*.cfg ~/printer_data/config/"
echo ""

# Ask about Mainsail macro buttons
echo "============================================"
echo "  Mainsail Integration"
echo "============================================"
echo ""
echo "Would you like to install Mainsail macro"
echo "buttons for one-click updates from the"
echo "web interface?"
echo ""
echo "This will:"
echo "  - Install gcode_shell_command extension"
echo "  - Create mcu_updater.cfg with macros"
echo "  - You need to add [include mcu_updater.cfg]"
echo "    to your printer.cfg"
echo ""

read -p "Install Mainsail macros? (yes/no): " INSTALL_MACROS
echo ""

# Install gcode_shell_command extension if macros wanted
if [ "$INSTALL_MACROS" = "yes" ] || [ "$INSTALL_MACROS" = "y" ]; then
    if [ ! -f "$HOME/klipper/klippy/extras/gcode_shell_command.py" ]; then
        echo "Installing gcode_shell_command extension..."
        curl -s -o "$HOME/klipper/klippy/extras/gcode_shell_command.py" \
            "https://raw.githubusercontent.com/dw-0/kiauh/refs/heads/master/kiauh/extensions/gcode_shell_cmd/assets/gcode_shell_command.py"
        if [ $? -eq 0 ] && [ -s "$HOME/klipper/klippy/extras/gcode_shell_command.py" ]; then
            echo "  gcode_shell_command extension installed"
        else
            echo "  WARNING: Could not download gcode_shell_command extension"
            echo "  Mainsail macros may not work without it"
        fi
    else
        echo "  gcode_shell_command already installed"
    fi
fi

# Create install directory
mkdir -p "$INSTALL_DIR"

# Download or copy main script
if [ -f "klipper_mcu_updater.py" ]; then
    cp klipper_mcu_updater.py "$INSTALL_DIR/" 2>/dev/null || true
    echo "Main script copied"
else
    echo "Downloading klipper_mcu_updater.py..."
    curl -s -o "$INSTALL_DIR/klipper_mcu_updater.py" "$SCRIPT_URL"
    if [ ! -s "$INSTALL_DIR/klipper_mcu_updater.py" ]; then
        echo "ERROR: Download failed!"
        exit 1
    fi
    echo "  Downloaded"
fi
chmod +x "$INSTALL_DIR/klipper_mcu_updater.py"

# Create wrapper scripts
cat > "$INSTALL_DIR/scan.sh" << 'EOF'
#!/bin/bash
python3 $INSTALL_DIR/klipper_mcu_updater.py scan
EOF

cat > "$INSTALL_DIR/update_all.sh" << 'EOF'
#!/bin/bash
python3 $INSTALL_DIR/klipper_mcu_updater.py update
EOF

cat > "$INSTALL_DIR/backup.sh" << 'EOF'
#!/bin/bash
python3 $INSTALL_DIR/klipper_mcu_updater.py backup
EOF

chmod +x "$INSTALL_DIR"/*.sh

# Create Mainsail macros if wanted
if [ "$INSTALL_MACROS" = "yes" ] || [ "$INSTALL_MACROS" = "y" ]; then
    cat > "$HOME/printer_data/config/mcu_updater.cfg" << MACROS
# Klipper MCU Updater - Mainsail Macros
# https://github.com/GmhF3NiX/klipper-mcu-updater
#
# DISCLAIMER: Use at your own risk. The author assumes no
# responsibility for any damage to hardware or software.

[gcode_shell_command mcu_scan]
command: python3 ${INSTALL_DIR}/klipper_mcu_updater.py scan
timeout: 30.
verbose: True

[gcode_shell_command mcu_backup]
command: python3 ${INSTALL_DIR}/klipper_mcu_updater.py backup
timeout: 60.
verbose: True

[gcode_macro MCU_SCAN]
description: Scan all connected MCUs and show firmware versions
gcode:
    RUN_SHELL_COMMAND CMD=mcu_scan

[gcode_macro MCU_BACKUP]
description: Backup current printer configuration
gcode:
    RUN_SHELL_COMMAND CMD=mcu_backup
MACROS
    echo "Mainsail macros created: ~/printer_data/config/mcu_updater.cfg"

    # Auto-add include to printer.cfg if not already there
    if ! grep -q "include mcu_updater.cfg" "$HOME/printer_data/config/printer.cfg" 2>/dev/null; then
        sed -i '1a [include mcu_updater.cfg]' "$HOME/printer_data/config/printer.cfg"
        echo "  [include mcu_updater.cfg] added to printer.cfg"
    else
        echo "  [include mcu_updater.cfg] already in printer.cfg"
    fi
else
    echo "Mainsail macros skipped"
fi

echo ""
echo "============================================"
echo " Installation complete!"
echo "============================================"
echo ""
echo " Files installed to: $INSTALL_DIR"
echo ""
echo " CLI usage:"
echo "   python3 $INSTALL_DIR/klipper_mcu_updater.py scan"
echo "   python3 $INSTALL_DIR/klipper_mcu_updater.py update"
echo "   python3 $INSTALL_DIR/klipper_mcu_updater.py update --target EBB"
echo "   python3 $INSTALL_DIR/klipper_mcu_updater.py backup"
echo ""

if [ "$INSTALL_MACROS" = "yes" ] || [ "$INSTALL_MACROS" = "y" ]; then
    echo " Mainsail setup:"
    echo "   1. Add to printer.cfg:  [include mcu_updater.cfg]"
    echo "   2. Restart Klipper"
    echo "   3. Macro buttons: MCU_SCAN / MCU_BACKUP"
    echo ""
fi

echo " REMINDER: Use at your own risk!"
echo " The author assumes no responsibility for"
echo " any damage to hardware or software."
echo ""
echo "============================================"
echo ""

# Run initial scan
echo ""
echo "Running initial MCU scan..."
echo ""
python3 "$INSTALL_DIR/klipper_mcu_updater.py" scan
