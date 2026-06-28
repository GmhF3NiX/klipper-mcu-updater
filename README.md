# Klipper MCU Updater

Universal firmware update tool for Klipper 3D printers. Automatically detects MCUs, checks firmware versions, creates backups, and flashes firmware via Katapult bootloader.

> **DISCLAIMER: USE AT YOUR OWN RISK!**
> This tool flashes firmware to your 3D printer MCUs. Incorrect firmware can render your printer inoperable. The author assumes **NO responsibility** for any damage to hardware, software, or any other losses resulting from the use of this tool. By installing and using this tool, you acknowledge that you understand the risks involved and accept full responsibility.

## Features

- **Auto-Detection** - Scans CAN bus, USB devices, and Klipper config to find all MCUs
- **Version Check** - Compares MCU firmware version with Klipper host version
- **Backup** - Creates timestamped backups of config and MCU info before updates
- **Universal** - Works with any STM32-based board (Octopus, Spider, EBB, SHT, etc.)
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

# Update all MCUs
python3 ~/klipper-mcu-updater/klipper_mcu_updater.py update

# Update specific MCU
python3 ~/klipper-mcu-updater/klipper_mcu_updater.py update --target EBB

# Update without backup
python3 ~/klipper-mcu-updater/klipper_mcu_updater.py update --no-backup

# Create backup only
python3 ~/klipper-mcu-updater/klipper_mcu_updater.py backup
```

### Mainsail

After installation, these macro buttons appear in Mainsail:

| Button | Action |
|---|---|
| **MCU_SCAN** | Scan and display all MCUs with versions |
| **MCU_UPDATE_ALL** | Update all MCU firmware |
| **MCU_BACKUP** | Create configuration backup |

## How It Works

1. **Scan** - Parses `printer.cfg`, queries CAN bus via Katapult, reads `klippy.log` for MCU details (type, pins, bootloader offset, firmware version)
2. **Detect** - Identifies MCU architecture, CAN pins, bootloader offset, and communication method
3. **Build** - Generates correct Klipper `.config` and runs `make` for each MCU
4. **Flash** - Uses Katapult's `flash_can.py` to flash via CAN or USB
5. **Verify** - Restarts Klipper and confirms connectivity

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

## Contributing

Pull requests welcome! Areas that need work:

- [ ] RP2040 support (USB boot mode)
- [ ] Cartographer firmware auto-download
- [ ] Interactive mode with menus
- [ ] Moonraker component integration
- [ ] Automatic Katapult detection per MCU
- [ ] DFU fallback when Katapult is not available

## License

MIT License
