#!/usr/bin/env python3
"""
Klipper MCU Updater - Universal firmware update tool for Klipper 3D printers.
by GmhF3NiX - https://github.com/GmhF3NiX/klipper-mcu-updater

DISCLAIMER:
    USE AT YOUR OWN RISK! This tool flashes firmware to your 3D printer MCUs.
    Incorrect firmware can render your printer inoperable. The author assumes
    NO responsibility for any damage to hardware, software, or any other
    losses resulting from the use of this tool.

Automatically detects MCUs, checks firmware versions, builds and flashes
firmware via Katapult bootloader.

Requirements:
    - Klipper installed at ~/klipper
    - Katapult installed at ~/katapult
    - Katapult bootloader on all target MCUs
    - Python 3.7+

Usage:
    python3 klipper_mcu_updater.py scan          # Scan and show all MCUs
    python3 klipper_mcu_updater.py update         # Update all MCUs
    python3 klipper_mcu_updater.py update mcu     # Update main MCU only
    python3 klipper_mcu_updater.py update ebb     # Update specific MCU
    python3 klipper_mcu_updater.py backup         # Backup current configs
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional


KLIPPER_DIR = Path.home() / "klipper"
KATAPULT_DIR = Path.home() / "katapult"
PRINTER_DATA = Path.home() / "printer_data"
CONFIG_DIR = PRINTER_DATA / "config"
BACKUP_DIR = PRINTER_DATA / "config_backups"
MOONRAKER_URL = "http://localhost:7125"

COLORS = {
    "red": "\033[0;31m",
    "green": "\033[0;32m",
    "yellow": "\033[1;33m",
    "blue": "\033[0;34m",
    "cyan": "\033[0;36m",
    "bold": "\033[1m",
    "reset": "\033[0m",
}

# Known STM32 MCU configs for Klipper menuconfig
MCU_CONFIGS = {
    "stm32f103xx": {
        "arch": "CONFIG_MACH_STM32=y",
        "mcu": "CONFIG_MACH_STM32F103=y",
        "clock_options": ["8M", "12M", "internal"],
    },
    "stm32f401xx": {
        "arch": "CONFIG_MACH_STM32=y",
        "mcu": "CONFIG_MACH_STM32F401=y",
        "clock_options": ["8M", "12M", "25M"],
    },
    "stm32f405xx": {
        "arch": "CONFIG_MACH_STM32=y",
        "mcu": "CONFIG_MACH_STM32F405=y",
        "clock_options": ["8M", "12M"],
    },
    "stm32f407xx": {
        "arch": "CONFIG_MACH_STM32=y",
        "mcu": "CONFIG_MACH_STM32F407=y",
        "clock_options": ["8M", "12M"],
    },
    "stm32f429xx": {
        "arch": "CONFIG_MACH_STM32=y",
        "mcu": "CONFIG_MACH_STM32F429=y",
        "clock_options": ["8M", "12M", "25M"],
    },
    "stm32f446xx": {
        "arch": "CONFIG_MACH_STM32=y",
        "mcu": "CONFIG_MACH_STM32F446=y",
        "clock_options": ["8M", "12M"],
    },
    "stm32g0b1xx": {
        "arch": "CONFIG_MACH_STM32=y",
        "mcu": "CONFIG_MACH_STM32G0B1=y",
        "clock_options": ["8M"],
    },
    "stm32h723xx": {
        "arch": "CONFIG_MACH_STM32=y",
        "mcu": "CONFIG_MACH_STM32H723=y",
        "clock_options": ["25M"],
    },
    "stm32h743xx": {
        "arch": "CONFIG_MACH_STM32=y",
        "mcu": "CONFIG_MACH_STM32H743=y",
        "clock_options": ["8M", "25M"],
    },
    "rp2040": {
        "arch": "CONFIG_MACH_RPXXXX=y",
        "mcu": "CONFIG_MACH_RP2040=y",
        "clock_options": ["12M"],
    },
}

# CAN pin mappings
CAN_PIN_CONFIGS = {
    "PA11_PA12": "CONFIG_STM32_CANBUS_PA11_PA12=y",
    "PB0_PB1": "CONFIG_STM32_MMENU_CANBUS_PB0_PB1=y",
    "PB8_PB9": "CONFIG_STM32_MMENU_CANBUS_PB8_PB9=y",
    "PB12_PB13": "CONFIG_STM32_MMENU_CANBUS_PB12_PB13=y",
    "PD0_PD1": "CONFIG_STM32_CMENU_CANBUS_PD0_PD1=y",
    "PB5_PB6": "CONFIG_STM32_MMENU_CANBUS_PB5_PB6=y",
}

# USB-CAN bridge configs
USBCAN_CONFIGS = {
    "PA11_PA12": "CONFIG_STM32_USBCANBUS_PA11_PA12=y",
}

# Bootloader offset configs
BOOTLOADER_OFFSETS = {
    0x2000: "CONFIG_STM32_FLASH_START_2000=y",   # 8KiB
    0x5000: "CONFIG_STM32_FLASH_START_5000=y",   # 20KiB
    0x7000: "CONFIG_STM32_FLASH_START_7000=y",   # 28KiB
    0x8000: "CONFIG_STM32_FLASH_START_8000=y",   # 32KiB
    0x8800: "CONFIG_STM32_FLASH_START_8800=y",   # 34KiB
    0x10000: "CONFIG_STM32_FLASH_START_10000=y", # 64KiB
    0x20000: "CONFIG_STM32_FLASH_START_20000=y", # 128KiB
}


def cprint(msg: str, color: str = "reset"):
    print(f"{COLORS.get(color, '')}{msg}{COLORS['reset']}")


def run_cmd(cmd: str, timeout: int = 120, capture: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, shell=True, capture_output=capture,
        text=True, timeout=timeout
    )


@dataclass
class MCUInfo:
    name: str
    uuid: Optional[str] = None
    mcu_type: Optional[str] = None
    firmware_version: Optional[str] = None
    connection_type: str = "can"  # can, usb, serial, linux
    serial_path: Optional[str] = None
    can_interface: str = "can0"
    can_speed: int = 1000000
    can_pins: Optional[str] = None
    usb_pins: Optional[str] = None
    is_canbridge: bool = False
    bootloader_offset: int = 0
    clock_ref: str = "8M"
    application_start: Optional[int] = None
    is_linux_mcu: bool = False
    config_section: Optional[str] = None
    extra_configs: list = field(default_factory=list)
    has_katapult: bool = False
    katapult_status: str = "unknown"  # unknown, installed, missing, not_needed
    can_application: Optional[str] = None  # Klipper, Katapult


class KlipperMCUUpdater:
    def __init__(self):
        self.mcus: list[MCUInfo] = []
        self.klipper_version = self._get_klipper_version()

    def _get_klipper_version(self) -> str:
        result = run_cmd(f"cd {KLIPPER_DIR} && git describe --tags --always --dirty")
        return result.stdout.strip() if result.returncode == 0 else "unknown"

    # ========== SCANNING ==========

    def scan_all(self) -> list[MCUInfo]:
        cprint("\n=== Scanning for Klipper MCUs ===\n", "bold")
        self.mcus = []

        self._scan_printer_config()
        self._scan_can_bus()
        self._scan_usb_devices()
        self._scan_klippy_log()

        return self.mcus

    def _scan_printer_config(self):
        cprint("[1/4] Parsing printer configuration...", "cyan")
        config_file = CONFIG_DIR / "printer.cfg"
        if not config_file.exists():
            cprint("  printer.cfg not found!", "red")
            return

        content = config_file.read_text()

        # Find all [include] files and parse them too
        all_content = content
        for match in re.finditer(r'\[include\s+(.+?)\]', content):
            include_path = CONFIG_DIR / match.group(1)
            if include_path.exists():
                all_content += "\n" + include_path.read_text()

        # Find all MCU sections (handle inline comments after ])
        mcu_pattern = re.compile(
            r'\[mcu\s*(\w*)\][^\n]*\n((?:(?!\[).)*)',
            re.DOTALL
        )

        for match in mcu_pattern.finditer(all_content):
            name = match.group(1) or "mcu"
            section = match.group(2)

            mcu = MCUInfo(name=name, config_section=f"[mcu {name}]" if name != "mcu" else "[mcu]")

            # Parse connection info
            uuid_match = re.search(r'^canbus_uuid:\s*(\w+)', section, re.MULTILINE)
            serial_match = re.search(r'^serial:\s*(.+)', section, re.MULTILINE)

            if uuid_match:
                mcu.uuid = uuid_match.group(1)
                mcu.connection_type = "can"
            elif serial_match:
                serial_path = serial_match.group(1).strip()
                mcu.serial_path = serial_path
                if "/tmp/klipper_host_mcu" in serial_path:
                    mcu.connection_type = "linux"
                    mcu.is_linux_mcu = True
                else:
                    mcu.connection_type = "usb"

            canbus_if = re.search(r'^canbus_interface:\s*(\w+)', section, re.MULTILINE)
            if canbus_if:
                mcu.can_interface = canbus_if.group(1)

            self.mcus.append(mcu)
            cprint(f"  Found MCU '{name}' ({mcu.connection_type})", "green")

        # Find Cartographer/Scanner sections (not [mcu] but has its own MCU)
        carto_pattern = re.compile(
            r'\[(cartographer|scanner|beacon|idm)\]\s*\n((?:(?!\[).)*)',
            re.DOTALL
        )
        for match in carto_pattern.finditer(all_content):
            section_type = match.group(1)
            section = match.group(2)

            mcu_ref = re.search(r'^mcu:\s*(\w+)', section, re.MULTILINE)
            if not mcu_ref:
                continue

            mcu_name = mcu_ref.group(1)
            # Check if this MCU name already exists (as [mcu cartographer])
            existing = None
            for m in self.mcus:
                if m.name == mcu_name:
                    existing = m
                    break

            if existing:
                # Mark existing MCU as cartographer type
                existing.mcu_type = "cartographer"
                existing.config_section = f"[{section_type}]"
                cprint(f"  Found Cartographer/Scanner '{mcu_name}' (linked to [mcu {mcu_name}])", "green")
            else:
                # Cartographer has its own canbus_uuid in the section
                uuid_match = re.search(r'^canbus_uuid:\s*(\w+)', section, re.MULTILINE)
                serial_match = re.search(r'^serial:\s*(.+)', section, re.MULTILINE)

                mcu = MCUInfo(
                    name=mcu_name,
                    config_section=f"[{section_type}]",
                    mcu_type="cartographer",
                )

                if uuid_match:
                    mcu.uuid = uuid_match.group(1)
                    mcu.connection_type = "can"
                elif serial_match:
                    mcu.serial_path = serial_match.group(1).strip()
                    mcu.connection_type = "usb"

                self.mcus.append(mcu)
                cprint(f"  Found Cartographer/Scanner '{mcu_name}' ({mcu.connection_type})", "green")

    def _scan_can_bus(self):
        cprint("[2/4] Scanning CAN bus...", "cyan")

        # Check if can0 exists
        result = run_cmd("ip -d link show can0 2>/dev/null")
        if result.returncode != 0:
            cprint("  No CAN interface found", "yellow")
            return

        # Get CAN bitrate
        bitrate_match = re.search(r'bitrate\s+(\d+)', result.stdout)
        can_speed = int(bitrate_match.group(1)) if bitrate_match else 1000000

        # Query CAN devices via Katapult
        flash_can = KATAPULT_DIR / "scripts" / "flash_can.py"
        if flash_can.exists():
            result = run_cmd(f"python3 {flash_can} -i can0 -q 2>&1")
            if result.returncode == 0:
                for match in re.finditer(
                    r'Detected UUID:\s*(\w+),\s*Application:\s*(\w+)',
                    result.stdout
                ):
                    uuid = match.group(1)
                    app = match.group(2)
                    # Update existing MCU info or add new
                    existing = self._find_mcu_by_uuid(uuid)
                    if existing:
                        existing.can_speed = can_speed
                        existing.can_application = app
                        existing.has_katapult = True
                        existing.katapult_status = "installed"
                        cprint(f"  CAN device {uuid} -> {existing.name} ({app}, Katapult: YES)", "green")
                    else:
                        mcu = MCUInfo(
                            name=f"unknown_{uuid[:8]}",
                            uuid=uuid,
                            can_speed=can_speed,
                            can_application=app,
                            has_katapult=True,
                            katapult_status="installed",
                        )
                        self.mcus.append(mcu)
                        cprint(f"  CAN device {uuid} (unmatched, {app}, Katapult: YES)", "yellow")

    def _scan_usb_devices(self):
        cprint("[3/4] Scanning USB devices...", "cyan")
        result = run_cmd("ls /dev/serial/by-id/ 2>/dev/null")
        if result.returncode == 0 and result.stdout.strip():
            for line in result.stdout.strip().split("\n"):
                cprint(f"  USB serial: {line.strip()}", "green")

        # Check for CAN adapter
        result = run_cmd("lsusb 2>/dev/null | grep -i 'can\\|1d50'")
        if result.returncode == 0:
            for line in result.stdout.strip().split("\n"):
                if line.strip():
                    cprint(f"  USB: {line.strip()}", "green")

    def _scan_klippy_log(self):
        cprint("[4/4] Reading Klipper log for MCU details...", "cyan")
        log_file = PRINTER_DATA / "logs" / "klippy.log"
        if not log_file.exists():
            cprint("  klippy.log not found", "yellow")
            return

        # Read log as binary to handle mixed encoding
        try:
            log_content = log_file.read_bytes().decode("utf-8", errors="replace")
        except Exception:
            cprint("  Could not read klippy.log", "red")
            return

        # Find MCU config blocks
        for mcu in self.mcus:
            if mcu.is_linux_mcu:
                mcu.mcu_type = "linux"
                mcu.katapult_status = "not_needed"
                continue

            if mcu.mcu_type in ("cartographer", "beacon", "idm"):
                # Probe firmware version from log
                probe_ver = re.compile(
                    r"mcu_version\s*=\s*("
                    r"CARTOGRAPHER\s*[\d.]+|"
                    r"BEACON\s*[\d.]+|"
                    r"IDM\s*[\d.]+"
                    r")"
                )
                for match in probe_ver.finditer(log_content):
                    mcu.firmware_version = match.group(1)
                # CAN probes use Katapult
                if mcu.connection_type == "can":
                    mcu.has_katapult = True
                    mcu.katapult_status = "installed"
                continue

            # Find MCU type from config line
            mcu_config_pattern = re.compile(
                rf"MCU '{re.escape(mcu.name)}' config:.*?MCU=(\w+)"
            )
            for match in mcu_config_pattern.finditer(log_content):
                mcu.mcu_type = match.group(1)

            # Find CAN bridge status
            bridge_pattern = re.compile(
                rf"MCU '{re.escape(mcu.name)}' config:.*?CANBUS_BRIDGE=1"
            )
            if bridge_pattern.search(log_content):
                mcu.is_canbridge = True

            # Find CAN pins from RESERVE_PINS_CAN
            can_pins_pattern = re.compile(
                rf"MCU '{re.escape(mcu.name)}' config:.*?RESERVE_PINS_CAN=([A-Z0-9,]+)"
            )
            match = can_pins_pattern.search(log_content)
            if match:
                mcu.can_pins = match.group(1).replace(",", "_")

            # Find USB pins
            usb_pins_pattern = re.compile(
                rf"MCU '{re.escape(mcu.name)}' config:.*?RESERVE_PINS_USB=([A-Z0-9,]+)"
            )
            match = usb_pins_pattern.search(log_content)
            if match:
                mcu.usb_pins = match.group(1).replace(",", "_")

            # Find bootloader offset from Katapult connection
            app_start_pattern = re.compile(
                rf"Application Start:\s*(0x[0-9a-fA-F]+)"
            )
            for match in app_start_pattern.finditer(log_content):
                mcu.application_start = int(match.group(1), 16)
                mcu.bootloader_offset = mcu.application_start - 0x08000000

        # Detect Katapult from log evidence
        for mcu in self.mcus:
            if mcu.katapult_status != "unknown":
                continue
            # If MCU has a bootloader offset, Katapult is likely installed
            if mcu.bootloader_offset and mcu.bootloader_offset > 0:
                mcu.has_katapult = True
                mcu.katapult_status = "installed"
            # If MCU communicates via CAN and Klipper is running, Katapult must be there
            # (CAN devices need Katapult to be flashed in the first place)
            elif mcu.connection_type == "can" and mcu.uuid:
                # Check log for Katapult evidence
                katapult_evidence = re.search(
                    rf"Katapult Connected.*?MCU type:\s*{re.escape(mcu.mcu_type or '')}",
                    log_content, re.DOTALL
                )
                if katapult_evidence:
                    mcu.has_katapult = True
                    mcu.katapult_status = "installed"
                elif mcu.mcu_type:
                    # CAN devices generally require Katapult for OTA updates
                    mcu.has_katapult = True
                    mcu.katapult_status = "installed"

        # Query Moonraker for live MCU versions
        self._query_moonraker_versions()

    def _query_moonraker_versions(self):
        cprint("  Querying Moonraker for live MCU versions...", "cyan")
        try:
            import urllib.request
            url = f"{MOONRAKER_URL}/printer/objects/query?configfile"
            req = urllib.request.Request(url, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode())

            # Also query MCU info directly
            url2 = f"{MOONRAKER_URL}/printer/info"
            req2 = urllib.request.Request(url2, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req2, timeout=5) as resp2:
                info = json.loads(resp2.read().decode())

            if info.get("result", {}).get("state") != "ready":
                cprint("  Klipper not ready, skipping live version query", "yellow")
                return

            # Query each MCU's version via object query
            mcu_names = [m.name for m in self.mcus if not m.is_linux_mcu]
            for mcu in self.mcus:
                query_name = "mcu" if mcu.name == "mcu" else f"mcu {mcu.name}"
                try:
                    url3 = f"{MOONRAKER_URL}/printer/objects/query?{query_name.replace(' ', '%20')}"
                    req3 = urllib.request.Request(url3, headers={"Accept": "application/json"})
                    with urllib.request.urlopen(req3, timeout=5) as resp3:
                        mcu_data = json.loads(resp3.read().decode())

                    status = mcu_data.get("result", {}).get("status", {})
                    mcu_info = status.get(query_name, {})
                    mcu_version = mcu_info.get("mcu_version", "")
                    mcu_build = mcu_info.get("mcu_build_versions", "")

                    if mcu_version:
                        mcu.firmware_version = mcu_version
                        cprint(f"  {mcu.name}: {mcu_version}", "green")
                    elif mcu.is_linux_mcu:
                        mcu.firmware_version = self.klipper_version
                except Exception:
                    pass

        except Exception as e:
            cprint(f"  Moonraker query failed: {e}", "yellow")
            cprint("  Falling back to log-based version detection", "yellow")

    def _find_mcu_by_uuid(self, uuid: str) -> Optional[MCUInfo]:
        for mcu in self.mcus:
            if mcu.uuid == uuid:
                return mcu
        return None

    # ========== KATAPULT CHECK ==========

    def check_katapult_all(self) -> bool:
        cprint("\n=== Checking Katapult Bootloader Status ===\n", "bold")

        all_ready = True
        mcus_without_katapult = []

        for mcu in self.mcus:
            if mcu.is_linux_mcu:
                mcu.katapult_status = "not_needed"
                cprint(f"  {mcu.name}: Linux MCU (Katapult not needed)", "green")
                continue

            if mcu.has_katapult:
                cprint(f"  {mcu.name}: Katapult INSTALLED (App: {mcu.can_application})", "green")
                continue

            # Try to detect Katapult via bootloader jump test
            if mcu.uuid and mcu.connection_type == "can":
                detected = self._test_katapult_can(mcu)
                if detected:
                    mcu.has_katapult = True
                    mcu.katapult_status = "installed"
                    cprint(f"  {mcu.name}: Katapult INSTALLED (verified via jump test)", "green")
                    continue

            mcu.katapult_status = "missing"
            mcus_without_katapult.append(mcu)
            cprint(f"  {mcu.name}: Katapult NOT FOUND", "red")
            all_ready = False

        if not all_ready:
            cprint(f"\n  {len(mcus_without_katapult)} MCU(s) without Katapult:", "red")
            for mcu in mcus_without_katapult:
                cprint(f"    - {mcu.name} ({mcu.mcu_type or 'unknown'})", "red")

            cprint("\n  Katapult bootloader is REQUIRED for firmware updates.", "yellow")
            cprint("  Without Katapult, MCUs cannot be flashed over CAN/USB.", "yellow")
            cprint("  Katapult must be flashed via DFU mode (physical button).\n", "yellow")

            response = input("  Would you like to install Katapult on these MCUs? (yes/no): ").strip().lower()
            if response in ("yes", "y"):
                for mcu in mcus_without_katapult:
                    success = self.install_katapult(mcu)
                    if not success:
                        cprint(f"  Failed to install Katapult on {mcu.name}", "red")
                        cprint("  Update aborted.", "red")
                        return False
                return True
            else:
                cprint("\n  Update aborted. Katapult is required on all target MCUs.", "red")
                return False

        cprint("\n  All MCUs have Katapult bootloader. Ready to update!", "green")
        return True

    def _test_katapult_can(self, mcu: MCUInfo) -> bool:
        flash_can = KATAPULT_DIR / "scripts" / "flash_can.py"
        if not flash_can.exists():
            return False

        result = run_cmd(
            f"python3 {flash_can} -i {mcu.can_interface} -q 2>&1",
            timeout=10
        )
        if result.returncode == 0 and mcu.uuid and mcu.uuid in (result.stdout or ""):
            return True
        return False

    def install_katapult(self, mcu: MCUInfo) -> bool:
        cprint(f"\n{'=' * 50}", "bold")
        cprint(f"  Installing Katapult on: {mcu.name}", "bold")
        cprint(f"{'=' * 50}", "bold")

        if not mcu.mcu_type or mcu.mcu_type not in MCU_CONFIGS:
            cprint(f"  Unknown MCU type: {mcu.mcu_type}. Cannot build Katapult.", "red")
            return False

        # Build Katapult
        cprint("\n  Building Katapult bootloader...", "yellow")
        mcu_cfg = MCU_CONFIGS[mcu.mcu_type]
        config_lines = [
            "CONFIG_LOW_LEVEL_OPTIONS=y",
            mcu_cfg["arch"],
            mcu_cfg["mcu"],
            f"CONFIG_STM32_CLOCK_REF_{mcu.clock_ref}=y",
        ]

        # CAN communication for Katapult
        if mcu.can_pins and mcu.can_pins in CAN_PIN_CONFIGS:
            config_lines.append(CAN_PIN_CONFIGS[mcu.can_pins])
        if mcu.can_speed:
            config_lines.append(f"CONFIG_CANBUS_FREQUENCY={mcu.can_speed}")
        config_lines.append("CONFIG_CANBUS_FILTER=y")

        # Bootloader offset (8KiB default for most boards)
        if mcu.bootloader_offset and mcu.bootloader_offset in BOOTLOADER_OFFSETS:
            config_lines.append(BOOTLOADER_OFFSETS[mcu.bootloader_offset])
        else:
            config_lines.append("CONFIG_STM32_FLASH_START_2000=y")

        config_content = "\n".join(config_lines) + "\n"
        katapult_config = KATAPULT_DIR / ".config"
        katapult_config.write_text(config_content)

        cmds = [
            f"cd {KATAPULT_DIR} && make olddefconfig 2>&1 | tail -1",
            f"cd {KATAPULT_DIR} && make clean 2>&1 > /dev/null",
            f"cd {KATAPULT_DIR} && make -j$(nproc) 2>&1 | tail -3",
        ]

        for cmd in cmds:
            result = run_cmd(cmd, timeout=180)
            if result.returncode != 0:
                cprint(f"  Katapult build failed: {result.stderr}", "red")
                return False

        cprint("  Katapult built successfully", "green")

        # Flash via DFU
        cprint("\n  Katapult must be flashed via DFU mode.", "yellow")
        cprint("  Please put the MCU in DFU mode now:", "yellow")
        cprint(f"    1. Hold the BOOT button on '{mcu.name}'", "cyan")
        cprint(f"    2. Press and release the RESET button", "cyan")
        cprint(f"    3. Wait 5 seconds, then release BOOT", "cyan")
        cprint("")

        response = input("  Press ENTER when the MCU is in DFU mode (or 'skip' to skip): ").strip().lower()
        if response == "skip":
            cprint("  Skipped.", "yellow")
            return False

        # Check for DFU device
        result = run_cmd("lsusb | grep '0483:df11'")
        if result.returncode != 0 or "0483:df11" not in (result.stdout or ""):
            cprint("  No DFU device detected (0483:df11)!", "red")
            cprint("  Make sure the MCU is in DFU mode and try again.", "yellow")
            return False

        cprint("  DFU device detected!", "green")

        # Flash with dfu-util
        katapult_bin = KATAPULT_DIR / "out" / "katapult.bin"
        cmd = (
            f"sudo dfu-util -a 0 -d 0483:df11 "
            f"--dfuse-address 0x08000000:force:mass-erase:leave "
            f"-D {katapult_bin} 2>&1"
        )
        result = run_cmd(cmd, timeout=60)

        if "File downloaded successfully" in (result.stdout or ""):
            cprint("  Katapult flashed successfully!", "green")
            mcu.has_katapult = True
            mcu.katapult_status = "installed"

            cprint("\n  Please now:", "yellow")
            cprint("    1. Remove the BOOT jumper (if set)", "cyan")
            cprint("    2. Set the CAN/USB mode jumper correctly", "cyan")
            cprint("    3. Power cycle the board", "cyan")

            input("  Press ENTER when done: ")

            # Verify on CAN bus
            time.sleep(3)
            result = run_cmd(
                f"python3 {KATAPULT_DIR}/scripts/flash_can.py -i can0 -q 2>&1",
                timeout=10
            )
            if "Katapult" in (result.stdout or ""):
                cprint("  Katapult verified on CAN bus!", "green")
                return True
            else:
                cprint("  Could not verify Katapult on CAN bus.", "yellow")
                cprint("  Check wiring and jumpers, then try again.", "yellow")
                return False
        else:
            cprint(f"  DFU flash failed: {result.stdout}", "red")
            return False

    # ========== DISPLAY ==========

    def display_scan_results(self):
        cprint("\n" + "=" * 60, "bold")
        cprint(" Detected MCUs", "bold")
        cprint("=" * 60, "bold")

        for mcu in self.mcus:
            cprint(f"\n  [{mcu.name}]", "cyan")
            cprint(f"    MCU Type:        {mcu.mcu_type or 'unknown'}")
            cprint(f"    Connection:      {mcu.connection_type}")
            if mcu.uuid:
                cprint(f"    CAN UUID:        {mcu.uuid}")
            if mcu.serial_path:
                cprint(f"    Serial:          {mcu.serial_path}")
            if mcu.is_canbridge:
                cprint(f"    CAN Bridge:      Yes", "yellow")
            if mcu.can_pins:
                cprint(f"    CAN Pins:        {mcu.can_pins}")
            if mcu.can_speed:
                cprint(f"    CAN Speed:       {mcu.can_speed}")
            if mcu.bootloader_offset:
                cprint(f"    Boot Offset:     0x{mcu.bootloader_offset:X} ({mcu.bootloader_offset // 1024}KiB)")
            cprint(f"    FW Version:      {mcu.firmware_version or 'unknown'}")
            cprint(f"    Klipper Host:    {self.klipper_version}")

            # Katapult status
            if mcu.katapult_status == "installed":
                cprint(f"    Katapult:        INSTALLED", "green")
            elif mcu.katapult_status == "not_needed":
                cprint(f"    Katapult:        Not needed (Linux)", "green")
            elif mcu.katapult_status == "missing":
                cprint(f"    Katapult:        MISSING", "red")
            else:
                cprint(f"    Katapult:        Unknown")

            if mcu.firmware_version and self.klipper_version != "unknown":
                if mcu.firmware_version in self.klipper_version:
                    cprint(f"    Status:          UP TO DATE", "green")
                else:
                    cprint(f"    Status:          NEEDS UPDATE", "red")

        cprint("\n" + "=" * 60 + "\n", "bold")

    # ========== BACKUP & RESTORE ==========

    def create_backup(self) -> str:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_path = BACKUP_DIR / f"backup_{timestamp}"
        backup_path.mkdir(parents=True, exist_ok=True)

        cprint(f"\nCreating backup at {backup_path}...", "yellow")

        # Backup config files
        config_backup = backup_path / "config"
        if CONFIG_DIR.exists():
            shutil.copytree(CONFIG_DIR, config_backup, dirs_exist_ok=True)
            cprint("  Config files backed up", "green")

        # Backup current .config from klipper
        klipper_config = KLIPPER_DIR / ".config"
        if klipper_config.exists():
            shutil.copy2(klipper_config, backup_path / "klipper_dotconfig")
            cprint("  Klipper build config backed up", "green")

        # Save Klipper git commit hash for exact version restore
        result = run_cmd(f"cd {KLIPPER_DIR} && git rev-parse HEAD")
        klipper_commit = result.stdout.strip() if result.returncode == 0 else "unknown"

        # Save MCU info with all details needed for restore
        mcu_info_file = backup_path / "mcu_info.json"
        mcu_data = {
            "backup_timestamp": timestamp,
            "klipper_version": self.klipper_version,
            "klipper_commit": klipper_commit,
            "mcus": []
        }
        for mcu in self.mcus:
            mcu_entry = {
                "name": mcu.name,
                "uuid": mcu.uuid,
                "mcu_type": mcu.mcu_type,
                "firmware_version": mcu.firmware_version,
                "connection_type": mcu.connection_type,
                "serial_path": mcu.serial_path,
                "can_interface": mcu.can_interface,
                "can_speed": mcu.can_speed,
                "can_pins": mcu.can_pins,
                "usb_pins": mcu.usb_pins,
                "is_canbridge": mcu.is_canbridge,
                "is_linux_mcu": mcu.is_linux_mcu,
                "bootloader_offset": mcu.bootloader_offset,
                "clock_ref": mcu.clock_ref,
                "has_katapult": mcu.has_katapult,
            }
            # Generate and save the klipper .config for this MCU
            try:
                if not mcu.is_linux_mcu and mcu.mcu_type and mcu.mcu_type != "cartographer":
                    config_lines = self._generate_klipper_config(mcu)
                    mcu_entry["klipper_build_config"] = config_lines
                elif mcu.is_linux_mcu:
                    mcu_entry["klipper_build_config"] = ["CONFIG_LOW_LEVEL_OPTIONS=y", "CONFIG_MACH_LINUX=y"]
            except ValueError:
                pass
            mcu_data["mcus"].append(mcu_entry)

        mcu_info_file.write_text(json.dumps(mcu_data, indent=2))
        cprint("  MCU info + build configs saved", "green")
        cprint(f"  Klipper commit: {klipper_commit[:12]}", "green")

        # Save latest backup path for quick restore
        latest_file = BACKUP_DIR / "latest"
        latest_file.write_text(str(backup_path))

        cprint(f"  Backup complete: {backup_path}", "green")
        return str(backup_path)

    def list_backups(self):
        cprint("\n=== Available Backups ===\n", "bold")
        if not BACKUP_DIR.exists():
            cprint("  No backups found.", "yellow")
            return

        backups = sorted(BACKUP_DIR.glob("backup_*"), reverse=True)
        if not backups:
            cprint("  No backups found.", "yellow")
            return

        for i, bp in enumerate(backups):
            info_file = bp / "mcu_info.json"
            if info_file.exists():
                try:
                    data = json.loads(info_file.read_text())
                    version = data.get("klipper_version", "unknown")
                    ts = data.get("backup_timestamp", bp.name)
                    mcu_count = len(data.get("mcus", []))
                    marker = " <-- latest" if i == 0 else ""
                    cprint(f"  [{i+1}] {bp.name}  |  Klipper: {version}  |  {mcu_count} MCUs{marker}", "green" if i == 0 else "reset")
                except Exception:
                    cprint(f"  [{i+1}] {bp.name}  |  (info unavailable)", "yellow")
            else:
                cprint(f"  [{i+1}] {bp.name}  |  (no mcu_info.json)", "yellow")
        cprint("")

    def restore(self, backup_name: Optional[str] = None):
        cprint("\n" + "=" * 50, "bold")
        cprint(" RESTORE from Backup", "bold")
        cprint("=" * 50, "bold")

        # Find backup to restore
        if backup_name:
            backup_path = BACKUP_DIR / backup_name
            if not backup_path.exists():
                # Try with backup_ prefix
                backup_path = BACKUP_DIR / f"backup_{backup_name}"
        else:
            # Use latest backup
            latest_file = BACKUP_DIR / "latest"
            if latest_file.exists():
                backup_path = Path(latest_file.read_text().strip())
            else:
                # Find most recent
                backups = sorted(BACKUP_DIR.glob("backup_*"), reverse=True)
                if not backups:
                    cprint("  No backups found!", "red")
                    return False
                backup_path = backups[0]

        if not backup_path.exists():
            cprint(f"  Backup not found: {backup_path}", "red")
            return False

        info_file = backup_path / "mcu_info.json"
        if not info_file.exists():
            cprint(f"  mcu_info.json not found in backup!", "red")
            return False

        data = json.loads(info_file.read_text())
        klipper_commit = data.get("klipper_commit", "unknown")
        klipper_version = data.get("klipper_version", "unknown")
        mcus = data.get("mcus", [])

        cprint(f"\n  Backup: {backup_path.name}", "cyan")
        cprint(f"  Klipper version: {klipper_version}", "cyan")
        cprint(f"  Klipper commit: {klipper_commit[:12]}", "cyan")
        cprint(f"  MCUs in backup: {len(mcus)}", "cyan")

        for mcu_data in mcus:
            cprint(f"    - {mcu_data['name']} ({mcu_data.get('mcu_type', '?')}) fw: {mcu_data.get('firmware_version', '?')}", "cyan")

        cprint(f"\n  This will:", "yellow")
        cprint(f"    1. Restore printer config files", "yellow")
        cprint(f"    2. Checkout Klipper to commit {klipper_commit[:12]}", "yellow")
        cprint(f"    3. Rebuild and reflash ALL MCU firmware", "yellow")
        cprint(f"    4. Restart Klipper", "yellow")
        cprint(f"\n  WARNING: This will overwrite current configs and firmware!", "red")

        response = input("\n  Proceed with restore? (yes/no): ").strip().lower()
        if response not in ("yes", "y"):
            cprint("  Restore cancelled.", "yellow")
            return False

        # Step 1: Stop Klipper
        self.stop_klipper()

        # Step 2: Restore config files
        config_backup = backup_path / "config"
        if config_backup.exists():
            cprint("\n  Restoring config files...", "yellow")
            # Remove current configs and restore from backup
            for item in CONFIG_DIR.iterdir():
                if item.is_file() and item.suffix == '.cfg':
                    item.unlink()
            for item in config_backup.iterdir():
                if item.is_file() and item.suffix == '.cfg':
                    shutil.copy2(item, CONFIG_DIR / item.name)
            cprint("  Config files restored", "green")

        # Step 3: Checkout Klipper to backup version
        if klipper_commit and klipper_commit != "unknown":
            cprint(f"\n  Checking out Klipper to {klipper_commit[:12]}...", "yellow")
            result = run_cmd(f"cd {KLIPPER_DIR} && git checkout {klipper_commit}")
            if result.returncode == 0:
                cprint("  Klipper version restored", "green")
            else:
                cprint(f"  Warning: Could not checkout Klipper commit: {result.stderr}", "yellow")
                cprint("  Continuing with current Klipper version...", "yellow")

        # Step 4: Rebuild and reflash each MCU
        success_count = 0
        fail_count = 0

        for mcu_data in mcus:
            name = mcu_data["name"]
            mcu_type = mcu_data.get("mcu_type")
            build_config = mcu_data.get("klipper_build_config")
            is_linux = mcu_data.get("is_linux_mcu", False)

            if mcu_type == "cartographer":
                cprint(f"\n  Skipping {name} (Cartographer uses pre-built firmware)", "yellow")
                continue

            if not build_config:
                cprint(f"\n  Skipping {name} (no build config in backup)", "yellow")
                continue

            cprint(f"\n  Rebuilding firmware for '{name}' ({mcu_type})...", "yellow")

            # Write build config
            config_content = "\n".join(build_config) + "\n"
            (KLIPPER_DIR / ".config").write_text(config_content)

            # Build
            cmds = [
                f"cd {KLIPPER_DIR} && make olddefconfig 2>&1 | tail -1",
                f"cd {KLIPPER_DIR} && make clean 2>&1 > /dev/null",
                f"cd {KLIPPER_DIR} && make -j$(nproc) 2>&1 | tail -3",
            ]
            build_ok = True
            for cmd in cmds:
                result = run_cmd(cmd, timeout=180)
                if result.returncode != 0:
                    cprint(f"  Build failed for {name}: {result.stderr}", "red")
                    build_ok = False
                    break

            if not build_ok:
                fail_count += 1
                continue

            # Flash
            if is_linux:
                result = run_cmd(f"cd {KLIPPER_DIR} && sudo make flash 2>&1", timeout=60)
                if "Installing" in (result.stdout or ""):
                    cprint(f"  {name} restored", "green")
                    success_count += 1
                else:
                    cprint(f"  {name} flash failed", "red")
                    fail_count += 1
            elif mcu_data.get("uuid"):
                flash_script = KATAPULT_DIR / "scripts" / "flash_can.py"
                can_if = mcu_data.get("can_interface", "can0")
                uuid = mcu_data["uuid"]
                firmware = KLIPPER_DIR / "out" / "klipper.bin"

                result = run_cmd(
                    f"python3 {flash_script} -i {can_if} -u {uuid} -f {firmware}",
                    timeout=120
                )
                if "Programming Complete" in (result.stdout or ""):
                    cprint(f"  {name} restored", "green")
                    success_count += 1
                else:
                    cprint(f"  {name} flash failed", "red")
                    fail_count += 1

                # Restart CAN if bridge MCU
                if mcu_data.get("is_canbridge"):
                    self.restart_can_interface(can_if)

        # Step 5: Start Klipper
        self.start_klipper()

        # Summary
        cprint(f"\n" + "=" * 50, "bold")
        cprint(f" Restore Summary", "bold")
        cprint(f"=" * 50, "bold")
        cprint(f"  Config files: RESTORED", "green")
        cprint(f"  Klipper version: {klipper_version}", "green")
        cprint(f"  MCUs restored: {success_count}", "green")
        if fail_count:
            cprint(f"  MCUs failed: {fail_count}", "red")
        cprint("")
        return fail_count == 0

    # ========== BUILDING ==========

    def _generate_klipper_config(self, mcu: MCUInfo) -> list[str]:
        if mcu.is_linux_mcu:
            return [
                "CONFIG_LOW_LEVEL_OPTIONS=y",
                "CONFIG_MACH_LINUX=y",
            ]

        if mcu.mcu_type not in MCU_CONFIGS:
            raise ValueError(f"Unknown MCU type: {mcu.mcu_type}")

        mcu_cfg = MCU_CONFIGS[mcu.mcu_type]
        lines = [
            "CONFIG_LOW_LEVEL_OPTIONS=y",
            mcu_cfg["arch"],
            mcu_cfg["mcu"],
            f"CONFIG_STM32_CLOCK_REF_{mcu.clock_ref}=y",
        ]

        # Bootloader offset
        if mcu.bootloader_offset and mcu.bootloader_offset in BOOTLOADER_OFFSETS:
            lines.append(BOOTLOADER_OFFSETS[mcu.bootloader_offset])

        # Communication interface
        if mcu.is_canbridge and mcu.usb_pins:
            usb_key = mcu.usb_pins
            if usb_key in USBCAN_CONFIGS:
                lines.append(USBCAN_CONFIGS[usb_key])

        if mcu.can_pins:
            can_key = mcu.can_pins
            if can_key in CAN_PIN_CONFIGS:
                lines.append(CAN_PIN_CONFIGS[can_key])
            # For non-bridge CAN-only devices, use the MMENU variant
            for key, value in CAN_PIN_CONFIGS.items():
                if can_key == key:
                    lines.append(value)
                    break

        if mcu.can_speed:
            lines.append(f"CONFIG_CANBUS_FREQUENCY={mcu.can_speed}")

        return list(dict.fromkeys(lines))  # Remove duplicates

    def build_firmware(self, mcu: MCUInfo) -> bool:
        cprint(f"\nBuilding firmware for '{mcu.name}' ({mcu.mcu_type})...", "yellow")

        if mcu.mcu_type not in MCU_CONFIGS and not mcu.is_linux_mcu:
            cprint(f"  Unknown MCU type: {mcu.mcu_type}", "red")
            return False

        try:
            config_lines = self._generate_klipper_config(mcu)
        except ValueError as e:
            cprint(f"  {e}", "red")
            return False

        # Write .config
        config_content = "\n".join(config_lines) + "\n"
        config_path = KLIPPER_DIR / ".config"
        config_path.write_text(config_content)

        # Build
        cmds = [
            f"cd {KLIPPER_DIR} && make olddefconfig 2>&1 | tail -1",
            f"cd {KLIPPER_DIR} && make clean 2>&1 > /dev/null",
            f"cd {KLIPPER_DIR} && make -j$(nproc) 2>&1 | tail -3",
        ]

        for cmd in cmds:
            result = run_cmd(cmd, timeout=180)
            if result.returncode != 0:
                cprint(f"  Build failed: {result.stderr}", "red")
                return False

        cprint(f"  Build successful", "green")
        return True

    # ========== FLASHING ==========

    def flash_mcu(self, mcu: MCUInfo) -> bool:
        cprint(f"\nFlashing '{mcu.name}'...", "yellow")

        if mcu.is_linux_mcu:
            return self._flash_linux_mcu()
        elif mcu.connection_type == "can" and mcu.uuid:
            return self._flash_via_katapult_can(mcu)
        elif mcu.connection_type == "usb" and mcu.serial_path:
            return self._flash_via_katapult_usb(mcu)
        else:
            cprint(f"  No supported flash method for {mcu.name}", "red")
            return False

    def _flash_linux_mcu(self) -> bool:
        # Try without sudo first (if user has permissions), then with sudo
        result = run_cmd(f"cd {KLIPPER_DIR} && sudo -n make flash 2>&1", timeout=60)
        if "Installing" in (result.stdout or ""):
            cprint("  RPi MCU flashed", "green")
            return True
        # Fallback: copy binary directly
        result = run_cmd(
            f"cd {KLIPPER_DIR} && sudo cp out/klipper.elf /usr/local/bin/klipper_mcu 2>&1",
            timeout=30
        )
        if result.returncode == 0:
            run_cmd("sudo systemctl restart klipper_mcu 2>/dev/null")
            cprint("  RPi MCU flashed (direct copy)", "green")
            return True
        cprint(f"  RPi MCU flash failed (sudo may need NOPASSWD)", "red")
        cprint(f"  Fix: add 'pi ALL=(ALL) NOPASSWD: ALL' to /etc/sudoers", "yellow")
        return False

    def _flash_via_katapult_can(self, mcu: MCUInfo) -> bool:
        flash_script = KATAPULT_DIR / "scripts" / "flash_can.py"
        firmware = KLIPPER_DIR / "out" / "klipper.bin"

        if not flash_script.exists():
            cprint("  flash_can.py not found!", "red")
            return False

        cmd = (
            f"python3 {flash_script} -i {mcu.can_interface} "
            f"-u {mcu.uuid} -f {firmware}"
        )
        result = run_cmd(cmd, timeout=120)

        if "Programming Complete" in (result.stdout or ""):
            cprint(f"  {mcu.name} flashed via CAN", "green")
            return True

        cprint(f"  Flash failed: {result.stdout}\n{result.stderr}", "red")
        return False

    def _flash_via_katapult_usb(self, mcu: MCUInfo) -> bool:
        flash_script = KATAPULT_DIR / "scripts" / "flash_can.py"
        firmware = KLIPPER_DIR / "out" / "klipper.bin"

        cmd = f"python3 {flash_script} -d {mcu.serial_path} -f {firmware}"
        result = run_cmd(cmd, timeout=120)

        if "Programming Complete" in (result.stdout or ""):
            cprint(f"  {mcu.name} flashed via USB", "green")
            return True

        cprint(f"  Flash failed", "red")
        return False

    # ========== UPDATE WORKFLOW ==========

    def stop_klipper(self):
        cprint("\nStopping Klipper...", "yellow")
        run_cmd("sudo systemctl stop klipper", timeout=10)
        time.sleep(2)
        cprint("  Klipper stopped", "green")

    def start_klipper(self):
        cprint("\nStarting Klipper...", "yellow")
        run_cmd("sudo systemctl start klipper", timeout=10)
        time.sleep(5)
        cprint("  Klipper started", "green")

    def restart_can_interface(self, interface: str = "can0"):
        cprint(f"  Restarting {interface}...", "yellow")
        run_cmd(f"sudo ip link set {interface} down 2>/dev/null")
        time.sleep(1)
        run_cmd(f"sudo ip link set {interface} up type can bitrate 1000000 2>/dev/null")
        time.sleep(3)

    def update_mcu(self, mcu: MCUInfo, backup: bool = True) -> bool:
        cprint(f"\n{'=' * 50}", "bold")
        cprint(f" Updating: {mcu.name} ({mcu.mcu_type})", "bold")
        cprint(f"{'=' * 50}", "bold")

        # Probes with pre-built firmware (Cartographer, Beacon, IDM)
        if mcu.mcu_type in ("cartographer", "beacon", "idm"):
            return self._update_probe(mcu)

        if not self.build_firmware(mcu):
            return False

        if mcu.is_canbridge:
            self.stop_klipper()

        success = self.flash_mcu(mcu)

        if mcu.is_canbridge:
            self.restart_can_interface(mcu.can_interface)
            time.sleep(3)

        return success

    def _update_probe(self, mcu: MCUInfo) -> bool:
        probe_type = mcu.mcu_type or "unknown"
        # Known probe firmware repos
        probe_repos = {
            "cartographer": Path.home() / "cartographer-klipper",
            "beacon": Path.home() / "beacon-klipper",
            "idm": Path.home() / "idm-klipper",
        }

        repo_dir = probe_repos.get(probe_type)
        if not repo_dir or not repo_dir.exists():
            cprint(f"  {probe_type} firmware repo not found at ~/{probe_type}-klipper", "red")
            cprint(f"  Clone it first, then retry.", "yellow")
            return False

        # Update the repo first
        cprint(f"  Updating {probe_type}-klipper repo...", "yellow")
        run_cmd(f"cd {repo_dir} && git pull 2>&1", timeout=30)

        # Find the right firmware binary based on CAN speed
        can_speed = mcu.can_speed or 1000000
        speed_str = str(can_speed)
        probe_upper = probe_type.upper()

        # Search for matching firmware (check multiple common paths)
        result = run_cmd(
            f"find {repo_dir}/firmware -iname '*CAN*{speed_str}*8kib*' -name '*.bin' 2>/dev/null"
        )

        firmware = None
        if result.returncode == 0 and result.stdout.strip():
            # Pick the newest/most relevant firmware
            candidates = result.stdout.strip().split("\n")
            # Prefer "survey" or latest version
            for c in candidates:
                if "survey" in c.lower() or "latest" in c.lower():
                    firmware = Path(c.strip())
                    break
            if not firmware:
                firmware = Path(candidates[0].strip())

        if not firmware or not firmware.exists():
            cprint(f"  No {probe_type} firmware found for CAN speed {speed_str}", "red")
            # List available firmware
            result = run_cmd(f"find {repo_dir}/firmware -name '*.bin' 2>/dev/null | head -10")
            if result.stdout:
                cprint("  Available firmware files:", "yellow")
                for line in result.stdout.strip().split("\n"):
                    cprint(f"    {Path(line.strip()).name}", "yellow")
            return False

        cprint(f"  Firmware: {firmware.name}", "green")

        if not mcu.uuid:
            cprint(f"  No CAN UUID for {probe_type}!", "red")
            return False

        # Flash via Katapult
        flash_script = KATAPULT_DIR / "scripts" / "flash_can.py"
        cmd = (
            f"python3 {flash_script} -i {mcu.can_interface} "
            f"-u {mcu.uuid} -f {firmware}"
        )
        result = run_cmd(cmd, timeout=120)

        if "Programming Complete" in (result.stdout or ""):
            cprint(f"  {probe_type} flashed", "green")
            return True

        cprint(f"  {probe_type} flash failed: {result.stdout}", "red")
        return False

    def update_all(self, backup: bool = True):
        cprint("\n" + "=" * 50, "bold")
        cprint(" !!!  PLEASE WAIT  -  DO NOT TURN OFF  !!!", "red")
        cprint(" Updating ALL MCU firmware...", "bold")
        cprint(" This may take several minutes.", "bold")
        cprint(" Klipper will restart automatically when done.", "bold")
        cprint("=" * 50, "bold")

        if not self.check_katapult_all():
            return

        # Backup is ALWAYS created before update for rollback safety
        cprint("\n  Creating mandatory backup before update...", "yellow")
        cprint("  (Use 'restore' command to rollback if anything goes wrong)\n", "yellow")
        self.create_backup()

        # Sort: Linux MCU first, then CAN bridge, then others
        sorted_mcus = sorted(self.mcus, key=lambda m: (
            0 if m.is_linux_mcu else (1 if m.is_canbridge else 2)
        ))

        self.stop_klipper()

        results = {}
        for mcu in sorted_mcus:
            if mcu.mcu_type and mcu.mcu_type != "unknown":
                success = self.update_mcu(mcu, backup=False)
                results[mcu.name] = success
                if mcu.is_canbridge:
                    self.restart_can_interface()
            else:
                cprint(f"\n  Skipping {mcu.name}: unknown MCU type", "yellow")
                results[mcu.name] = None

        self.start_klipper()

        # Summary
        cprint("\n" + "=" * 50, "bold")
        cprint(" Update Summary", "bold")
        cprint("=" * 50, "bold")
        for name, success in results.items():
            if success is True:
                cprint(f"  {name}: OK", "green")
            elif success is False:
                cprint(f"  {name}: FAILED", "red")
            else:
                cprint(f"  {name}: SKIPPED", "yellow")
        cprint("")

    def update_single(self, target_name: str, backup: bool = True):
        mcu = None
        for m in self.mcus:
            if m.name.lower() == target_name.lower():
                mcu = m
                break

        if not mcu:
            cprint(f"MCU '{target_name}' not found. Available:", "red")
            for m in self.mcus:
                cprint(f"  - {m.name}")
            return

        # Check Katapult for this specific MCU
        if not mcu.is_linux_mcu and not mcu.has_katapult:
            cprint(f"\n  {mcu.name}: Katapult bootloader NOT detected!", "red")
            cprint("  Katapult is required for firmware updates.", "yellow")
            response = input("  Install Katapult now? (yes/no): ").strip().lower()
            if response in ("yes", "y"):
                if not self.install_katapult(mcu):
                    cprint("  Update aborted.", "red")
                    return
            else:
                cprint("  Update aborted.", "red")
                return

        if backup:
            self.create_backup()

        need_klipper_restart = not mcu.is_linux_mcu
        if need_klipper_restart:
            self.stop_klipper()

        success = self.update_mcu(mcu, backup=False)

        if mcu.is_canbridge:
            self.restart_can_interface()

        if need_klipper_restart:
            self.start_klipper()

        if success:
            cprint(f"\n{mcu.name} updated successfully!", "green")
        else:
            cprint(f"\n{mcu.name} update FAILED!", "red")


def main():
    parser = argparse.ArgumentParser(
        description="Klipper MCU Firmware Updater",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s scan                    Show all detected MCUs
  %(prog)s update                  Update all MCUs
  %(prog)s update --target mcu     Update main MCU only
  %(prog)s update --target EBB     Update EBB board only
  %(prog)s backup                  Create config backup only
  %(prog)s list-backups            List available backups
  %(prog)s restore                 Restore from latest backup
  %(prog)s restore --backup NAME   Restore from specific backup
        """
    )

    subparsers = parser.add_subparsers(dest="command", help="Command to execute")

    # scan
    subparsers.add_parser("scan", help="Scan and display all MCUs")

    # update
    update_parser = subparsers.add_parser("update", help="Update MCU firmware")
    update_parser.add_argument("--target", "-t", help="Specific MCU to update (by name)")
    update_parser.add_argument("--no-backup", action="store_true", help="Skip backup")

    # backup
    subparsers.add_parser("backup", help="Create configuration backup")

    # restore
    restore_parser = subparsers.add_parser("restore", help="Restore from backup (rollback)")
    restore_parser.add_argument("--backup", "-b", help="Specific backup name (default: latest)")

    # list-backups
    subparsers.add_parser("list-backups", help="List available backups")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    # Check prerequisites
    if not KLIPPER_DIR.exists():
        cprint("Klipper not found at ~/klipper", "red")
        sys.exit(1)

    if not KATAPULT_DIR.exists():
        cprint("Katapult not found at ~/katapult", "red")
        cprint("Katapult bootloader is required on all target MCUs.", "yellow")
        sys.exit(1)

    updater = KlipperMCUUpdater()
    updater.scan_all()

    if args.command == "scan":
        updater.display_scan_results()

    elif args.command == "backup":
        updater.create_backup()

    elif args.command == "list-backups":
        updater.list_backups()

    elif args.command == "restore":
        updater.restore(backup_name=args.backup if hasattr(args, 'backup') else None)

    elif args.command == "update":
        if not updater.mcus:
            cprint("No MCUs found!", "red")
            sys.exit(1)

        updater.display_scan_results()

        if args.target:
            updater.update_single(args.target, backup=not args.no_backup)
        else:
            updater.update_all(backup=not args.no_backup)


if __name__ == "__main__":
    main()
