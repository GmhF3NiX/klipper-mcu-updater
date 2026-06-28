<p align="center">
  <img src="logo.svg" alt="Klipper MCU Updater" width="300">
</p>

<h1 align="center">Klipper MCU Updater</h1>

<p align="center">
  Universal firmware update tool for Klipper 3D printers.<br>
  Automatically detects MCUs, checks firmware versions, creates backups, and flashes firmware via Katapult bootloader.
</p>

<p align="center">
  <a href="https://paypal.me/GmhF3NiX"><img src="https://img.shields.io/badge/Donate-PayPal-blue.svg" alt="Donate PayPal"></a>
  <a href="https://tiktok.com/@rapidr3d"><img src="https://img.shields.io/badge/TikTok-@rapidr3d-black.svg" alt="TikTok"></a>
  <a href="#license"><img src="https://img.shields.io/badge/License-Proprietary-red.svg" alt="License"></a>
</p>

> **DISCLAIMER: USE AT YOUR OWN RISK!**
> This tool flashes firmware to your 3D printer MCUs. Incorrect firmware can render your printer inoperable. The author assumes **NO responsibility** for any damage to hardware, software, or any other losses resulting from the use of this tool. By installing and using this tool, you acknowledge that you understand the risks involved and accept full responsibility.

## Scan Output Example

```
=== Scanning for Klipper MCUs ===

[1/4] Parsing printer configuration...
  Found MCU 'mcu' (can)
  Found MCU 'rpi' (linux)
  Found MCU 'EBB' (can)
  Found MCU 'cartographer' (can)
  Found Cartographer/Scanner 'cartographer' (linked to [mcu cartographer])
[2/4] Scanning CAN bus...
[3/4] Scanning USB devices...
  USB: Bus 001 Device 004: ID 1d50:606f OpenMoko, Inc. Geschwister Schneider CAN adapter
[4/4] Reading Klipper log for MCU details...
  Querying Moonraker for live MCU versions...
  mcu: v0.13.0-700-gd6ea62542
  rpi: v0.13.0-700-gd6ea62542
  EBB: v0.13.0-700-gd6ea62542
  cartographer: CARTOGRAPHER 5.1.0

============================================================
 Detected MCUs
============================================================

  [mcu]
    MCU Type:        stm32f429xx
    Connection:      can
    CAN UUID:        f622be57a636
    CAN Bridge:      Yes
    CAN Pins:        PD0_PD1
    CAN Speed:       1000000
    FW Version:      v0.13.0-700-gd6ea62542
    Klipper Host:    v0.13.0-700-gd6ea62542
    Katapult:        INSTALLED
    Status:          UP TO DATE

  [rpi]
    MCU Type:        linux
    Connection:      linux
    Serial:          /tmp/klipper_host_mcu
    CAN Speed:       1000000
    FW Version:      v0.13.0-700-gd6ea62542
    Klipper Host:    v0.13.0-700-gd6ea62542
    Katapult:        Not needed (Linux)
    Status:          UP TO DATE

  [EBB]
    MCU Type:        stm32g0b1xx
    Connection:      can
    CAN UUID:        1d9bcd48ca42
    CAN Pins:        PB12_PB13
    CAN Speed:       1000000
    FW Version:      v0.13.0-700-gd6ea62542
    Klipper Host:    v0.13.0-700-gd6ea62542
    Katapult:        INSTALLED
    Status:          UP TO DATE

  [cartographer]
    MCU Type:        cartographer
    Connection:      can
    CAN UUID:        4a9bf65fd881
    CAN Speed:       1000000
    FW Version:      CARTOGRAPHER 5.1.0
    Klipper Host:    v0.13.0-700-gd6ea62542
    Katapult:        INSTALLED
    Status:          NEEDS UPDATE

============================================================
```

## Installation Example

```
============================================
 Klipper MCU Updater - Installer
 by GmhF3NiX
============================================

============================================
              DISCLAIMER
============================================

 This tool flashes firmware to your 3D
 printer MCUs. Incorrect firmware can
 render your printer inoperable.

 USE AT YOUR OWN RISK!

 The author assumes NO responsibility
 for any damage to hardware, software,
 or any other losses resulting from the
 use of this tool.

 By continuing, you acknowledge that:
  - You understand the risks involved
  - You accept full responsibility
  - Katapult bootloader must be installed
    on all target MCUs
  - You will NOT run this during a print

============================================

Do you accept these terms and want to continue? (yes/no): yes

Checking prerequisites...
  Klipper: OK
  Katapult: OK
  Printer data: OK

============================================
  Mainsail Integration
============================================

Would you like to install Mainsail macro
buttons for one-click updates from the
web interface?

This will:
  - Install gcode_shell_command extension
  - Create mcu_updater.cfg with macros
  - You need to add [include mcu_updater.cfg]
    to your printer.cfg

Install Mainsail macros? (yes/no): yes

  gcode_shell_command already installed
Main script copied
Mainsail macros created: ~/printer_data/config/mcu_updater.cfg

============================================
 Installation complete!
============================================

 Files installed to: /home/pi/klipper-mcu-updater

 CLI usage:
   python3 ~/klipper-mcu-updater/klipper_mcu_updater.py scan
   python3 ~/klipper-mcu-updater/klipper_mcu_updater.py update
   python3 ~/klipper-mcu-updater/klipper_mcu_updater.py update --target EBB
   python3 ~/klipper-mcu-updater/klipper_mcu_updater.py backup

 Mainsail setup:
   1. Add to printer.cfg:  [include mcu_updater.cfg]
   2. Restart Klipper
   3. Macro buttons: MCU_SCAN / MCU_UPDATE_ALL / MCU_BACKUP

 REMINDER: Use at your own risk!
 The author assumes no responsibility for
 any damage to hardware or software.

============================================
```

## Features

- **Auto-Detection** - Scans CAN bus, USB devices, and Klipper config to find all MCUs
- **Version Check** - Compares MCU firmware version with Klipper host version
- **Mandatory Backup** - Automatic backup before every update (cannot be skipped)
- **Rollback/Restore** - If anything breaks, restore configs + Klipper version + all MCU firmware with one command
- **Katapult Check** - Verifies Katapult bootloader is installed, offers to flash it if missing
- **Universal** - Works with any STM32-based board (Octopus, Spider, EBB, SHT, etc.)
- **Cartographer/Scanner Support** - Detects and updates Cartographer probes
- **Mainsail Integration** - Macro buttons for one-click updates from the web UI
- **Selective Updates** - Update all MCUs at once or pick individual targets

## Requirements

- Klipper installed (`~/klipper`)
- **Katapult bootloader** on all target MCUs (`~/katapult`)
- Python 3.7+
- Supported MCU architectures: STM32, RP2040, Linux (RPi)

## Supported Boards

Any board running Klipper with Katapult bootloader, including:

| Category | Boards |
|---|---|
| Mainboards | BTT Octopus, Octopus Pro, Spider, Manta, SKR |
| Toolheads | BTT EBB36/42, SHT36/42, Mellow Fly SB2040 |
| Probes | Cartographer, Beacon (pre-built firmware) |
| Host MCU | Raspberry Pi, CB1, Orange Pi |

## Installation

```bash
# Clone the repository
git clone https://github.com/GmhF3NiX/klipper-mcu-updater.git

# Run installer
cd klipper-mcu-updater
bash install.sh
```

Or one-liner:
```bash
curl -s https://raw.githubusercontent.com/GmhF3NiX/klipper-mcu-updater/main/install.sh | bash
```

## Usage

### CLI

```bash
# Scan all MCUs
python3 ~/klipper-mcu-updater/klipper_mcu_updater.py scan

# Update all MCUs (automatic backup is created first)
python3 ~/klipper-mcu-updater/klipper_mcu_updater.py update

# Update specific MCU
python3 ~/klipper-mcu-updater/klipper_mcu_updater.py update --target EBB

# Create backup only
python3 ~/klipper-mcu-updater/klipper_mcu_updater.py backup

# List available backups
python3 ~/klipper-mcu-updater/klipper_mcu_updater.py list-backups

# Restore from latest backup (rollback)
python3 ~/klipper-mcu-updater/klipper_mcu_updater.py restore

# Restore from specific backup
python3 ~/klipper-mcu-updater/klipper_mcu_updater.py restore --backup backup_20260628_012345
```

### Mainsail

After installation, these macro buttons appear in Mainsail:

| Button | Action |
|---|---|
| **MCU_SCAN** | Scan and display all MCUs with versions |
| **MCU_BACKUP** | Create configuration backup |

> **Note:** Firmware updates are **only available via SSH terminal**, not from Mainsail. The update process stops and restarts Klipper, which cannot be done reliably from within Mainsail. Use:
> ```bash
> python3 ~/klipper-mcu-updater/klipper_mcu_updater.py update
> ```

## How It Works

1. **Scan** - Parses `printer.cfg`, queries CAN bus via Katapult, reads `klippy.log` for MCU details (type, pins, bootloader offset, firmware version)
2. **Detect** - Identifies MCU architecture, CAN pins, bootloader offset, and communication method
3. **Build** - Generates correct Klipper `.config` and runs `make` for each MCU
4. **Flash** - Uses Katapult's `flash_can.py` to flash via CAN or USB
5. **Verify** - Restarts Klipper and confirms connectivity

## Rollback / Restore

Every update automatically creates a full backup **before** any changes are made. If anything goes wrong:

```bash
# Restore everything to the state before the last update
python3 ~/klipper-mcu-updater/klipper_mcu_updater.py restore
```

The restore process will:
1. Restore all printer config files (printer.cfg, scanner.cfg, macros.cfg, etc.)
2. Checkout the exact Klipper version (git commit) from before the update
3. Rebuild firmware for each MCU with the original build configs
4. Reflash all MCUs via Katapult
5. Restart Klipper

You can also list and choose from older backups:
```bash
# Show all available backups
python3 ~/klipper-mcu-updater/klipper_mcu_updater.py list-backups

# Restore from a specific backup
python3 ~/klipper-mcu-updater/klipper_mcu_updater.py restore --backup backup_20260628_012345
```

## Important Notes

- **Katapult is required** on all target MCUs. Without Katapult, firmware cannot be flashed over CAN/USB.
- The tool stops Klipper before flashing and restarts it after.
- **Do NOT run during a print!**
- CAN bridge MCUs (e.g., Octopus in USB-CAN bridge mode) are handled specially - CAN interface is restarted after flashing.
- Cartographer/Beacon probes use pre-built firmware from their repos, not custom Klipper builds.

## Project Structure

```
klipper-mcu-updater/
├── klipper_mcu_updater.py   # Main script
├── install.sh               # Installer
└── README.md                # This file
```

## Support & Donate

If you find this tool useful, consider supporting the project:

- **PayPal:** [paypal.me/GmhF3NiX](https://paypal.me/GmhF3NiX)
- **TikTok:** [@rapidr3d](https://tiktok.com/@rapidr3d)

## Contributing

Pull requests welcome! Areas that need work:

- [x] Automatic Katapult detection per MCU
- [x] Cartographer/Scanner probe support
- [ ] RP2040 support (USB boot mode)
- [ ] Cartographer firmware auto-download
- [ ] Interactive mode with menus
- [ ] Moonraker component integration
- [ ] DFU fallback when Katapult is not available

## License

Copyright (c) 2026 GmhF3NiX. All rights reserved.

This software is provided as-is for personal use. You may use and install this tool on your own 3D printers. **Modification, redistribution, or commercial use of this code is not permitted without explicit written permission from the author.**

Use at your own risk. The author assumes no responsibility for any damage to hardware or software.
