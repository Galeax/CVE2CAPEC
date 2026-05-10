"""
One-shot backfill: add the ATLAS field to every record in database/CVE-YYYY.jsonl.
Re-uses the same lookup logic as technique2atlas.py.
Run from the project root: python scripts/backfill_atlas.py
"""
import glob
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from tqdm import tqdm

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.chdir(ROOT)

from technique2atlas import process_single_cve, ATLAS_FILE


def backfill():
    with open(ATLAS_FILE, "r") as f:
        atlas_list = json.load(f)

    files = sorted(glob.glob("database/CVE-*.jsonl"))
    for path in files:
        cve_tech_data = {}
        with open(path, "r") as f:
            for line in f:
                cve_entry = json.loads(line.strip())
                cve_tech_data.update(cve_entry)
        if not cve_tech_data:
            continue

        with ThreadPoolExecutor() as executor:
            futures = {
                executor.submit(process_single_cve, cve, atlas_list, cve_tech_data): cve
                for cve in tqdm(cve_tech_data, desc=f"Backfilling ATLAS in {os.path.basename(path)}", unit="CVE")
            }
            for future in as_completed(futures):
                cve_tech_data[futures[future]]["ATLAS"] = future.result()

        with open(path, "w") as f:
            for cve, data in cve_tech_data.items():
                f.write(json.dumps({cve: data}) + "\n")


if __name__ == "__main__":
    backfill()
    print("[+] ATLAS backfill complete.")
