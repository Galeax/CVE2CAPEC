"""Build the lightweight CVE -> CWE index used by the web interface (docs/).

The full yearly databases embed CAPEC, techniques, D3FEND and ATLAS data for
every CVE (hundreds of MB once decompressed). The web page only needs the CWE
list per CVE, everything else is derived client-side from resources/*.json.

Output: docs/data/cwe/CVE-<year>.txt, one "CVE-ID<TAB>cwe,cwe,..." line per CVE.

Usage:
    python build_web_index.py           # years present in results/new_cves.jsonl
    python build_web_index.py --all     # every database/CVE-*.jsonl.gz
    python build_web_index.py 2024 2025 # specific years
"""
import glob
import gzip
import json
import os
import re
import sys

DB_DIR = "database"
OUT_DIR = "docs/data/cwe"
NEW_CVES_FILE = "results/new_cves.jsonl"


def years_from_new_cves():
    years = set()
    if not os.path.exists(NEW_CVES_FILE):
        return years
    with open(NEW_CVES_FILE, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                for cve in json.loads(line):
                    years.add(cve.split("-")[1])
    return years


def build_year(year):
    source = os.path.join(DB_DIR, f"CVE-{year}.jsonl.gz")
    if not os.path.exists(source):
        print(f"[-] Missing {source}, skipped")
        return

    rows = []
    with gzip.open(source, "rt", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            for cve, data in json.loads(line).items():
                rows.append(f"{cve}\t{','.join(data.get('CWE') or [])}")

    rows.sort()
    target = os.path.join(OUT_DIR, f"CVE-{year}.txt")
    with open(target, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(rows) + "\n")
    print(f"[+] {target}: {len(rows)} CVEs")


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    args = sys.argv[1:]
    if "--all" in args:
        years = {re.search(r"CVE-(\d{4})", p).group(1) for p in glob.glob(os.path.join(DB_DIR, "CVE-*.jsonl.gz"))}
    elif args:
        years = set(args)
    else:
        years = years_from_new_cves()

    if not years:
        print("[-] No year to build")
    for year in sorted(years):
        build_year(year)
