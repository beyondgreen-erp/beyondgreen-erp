#!/usr/bin/env python3
"""
beyondGREEN machine poller.

Reads a production counter from a PLC over Modbus TCP and posts it to the ERP.

Two rules this program will not break:

  1. It only ever reads. It uses Modbus function code 3 (read holding registers)
     or 4 (read input registers) and nothing else. There is no code path here
     that writes to the PLC, and none should ever be added. A write to the wrong
     register on a running machine moves a servo.

  2. It makes outbound connections only. The PLC is never exposed to the
     internet; this box sits on the plant network, reaches the PLC inwards and
     the ERP outwards, and listens on nothing.

Run it on a small always-on box on the plant VLAN (a Raspberry Pi is plenty).

    pip install pymodbus requests
    python3 poller.py /etc/beyondgreen/poller.json

Config file:

    {
      "erp_url":        "https://erp.byndgrn.com/api/machines/readings",
      "token":          "the value of MACHINE_INGEST_TOKEN",
      "machine_code":   "WRP-SFK",
      "plc_host":       "192.168.1.88",
      "plc_port":       502,
      "unit_id":        1,
      "register":       0,
      "register_type":  "holding",
      "word_count":     2,
      "word_order":     "high_first",
      "signed":         false,
      "poll_seconds":   60,
      "spool_path":     "/var/lib/beyondgreen/spool.jsonl"
    }

"register" is the address the machine builder gives us for the production
count. Everything else above can stay as it is. If the number that comes back
is wildly wrong but becomes right when the two 16-bit words are swapped, change
"word_order" to "low_first" rather than editing this file.
"""

import json
import os
import sys
import time
from datetime import datetime, timezone

import requests
from pymodbus.client import ModbusTcpClient

MAX_SPOOL_LINES = 20000   # about two weeks at one sample a minute


def log(msg):
    print(datetime.now(timezone.utc).isoformat(timespec="seconds") + "  " + msg, flush=True)


def load_config(path):
    with open(path) as f:
        cfg = json.load(f)
    for key in ("erp_url", "token", "machine_code", "plc_host", "register"):
        if key not in cfg:
            raise SystemExit("Config is missing " + key)
    cfg.setdefault("plc_port", 502)
    cfg.setdefault("unit_id", 1)
    cfg.setdefault("register_type", "holding")
    cfg.setdefault("word_count", 2)
    cfg.setdefault("word_order", "high_first")
    cfg.setdefault("signed", False)
    cfg.setdefault("poll_seconds", 60)
    cfg.setdefault("spool_path", "/var/lib/beyondgreen/spool.jsonl")
    if cfg["register_type"] not in ("holding", "input"):
        raise SystemExit('register_type must be "holding" or "input"')
    if cfg["word_count"] not in (1, 2):
        raise SystemExit("word_count must be 1 or 2")
    return cfg


def read_counter(client, cfg):
    """Read the production counter. Read-only: function code 3 or 4, nothing else."""
    kwargs = {"address": int(cfg["register"]), "count": int(cfg["word_count"]), "slave": int(cfg["unit_id"])}
    rr = (client.read_holding_registers(**kwargs)
          if cfg["register_type"] == "holding"
          else client.read_input_registers(**kwargs))
    if rr is None or rr.isError():
        raise IOError("Modbus read failed: " + str(rr))
    regs = list(rr.registers)
    if len(regs) == 1:
        value = regs[0]
        width = 16
    else:
        hi, lo = (regs[0], regs[1]) if cfg["word_order"] == "high_first" else (regs[1], regs[0])
        value = (hi << 16) | lo
        width = 32
    if cfg["signed"] and value >= (1 << (width - 1)):
        value -= (1 << width)
    return value, regs


def spool(path, payload):
    """Hold a reading on disk when the ERP cannot be reached. The machine itself has no
    storage card, so if this box drops a reading the count is gone for good."""
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a") as f:
            f.write(json.dumps(payload) + "\n")
        with open(path) as f:
            lines = f.readlines()
        if len(lines) > MAX_SPOOL_LINES:
            with open(path, "w") as f:
                f.writelines(lines[-MAX_SPOOL_LINES:])
    except Exception as e:
        log("Could not write to the spool file: " + str(e))


def drain_spool(path, cfg, session):
    if not os.path.exists(path):
        return
    try:
        with open(path) as f:
            lines = [l for l in f.read().splitlines() if l.strip()]
    except Exception as e:
        log("Could not read the spool file: " + str(e))
        return
    if not lines:
        return
    batch = [json.loads(l) for l in lines[:500]]
    if post(cfg, session, batch):
        rest = lines[len(batch):]
        with open(path, "w") as f:
            f.write("\n".join(rest) + ("\n" if rest else ""))
        log("Sent " + str(len(batch)) + " held reading(s) from the spool.")


def post(cfg, session, readings):
    body = {"machine_code": cfg["machine_code"], "readings": readings}
    try:
        r = session.post(
            cfg["erp_url"],
            json=body,
            headers={"x-machine-token": cfg["token"]},
            timeout=20,
        )
    except Exception as e:
        log("ERP unreachable: " + str(e))
        return False
    if r.status_code >= 400:
        log("ERP refused the reading (" + str(r.status_code) + "): " + r.text[:300])
        # A 4xx will not fix itself on a retry, so do not hold it forever.
        return 400 <= r.status_code < 500
    return True


def main():
    if len(sys.argv) < 2:
        raise SystemExit("Usage: poller.py /path/to/poller.json")
    cfg = load_config(sys.argv[1])
    session = requests.Session()
    client = ModbusTcpClient(cfg["plc_host"], port=int(cfg["plc_port"]), timeout=5)

    log("Polling " + cfg["plc_host"] + ":" + str(cfg["plc_port"]) +
        " register " + str(cfg["register"]) + " (" + cfg["register_type"] + ") " +
        "every " + str(cfg["poll_seconds"]) + "s for " + cfg["machine_code"])

    while True:
        started = time.time()
        try:
            if not client.connected:
                client.connect()
            value, regs = read_counter(client, cfg)
            reading = {
                "recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "counter_total": value,
                "raw": {"registers": regs},
                "source": "modbus-tcp",
            }
            drain_spool(cfg["spool_path"], cfg, session)
            if not post(cfg, session, [reading]):
                spool(cfg["spool_path"], reading)
        except Exception as e:
            log("Read failed: " + str(e))
            try:
                client.close()
            except Exception:
                pass
        sleep_for = cfg["poll_seconds"] - (time.time() - started)
        if sleep_for > 0:
            time.sleep(sleep_for)


if __name__ == "__main__":
    main()
