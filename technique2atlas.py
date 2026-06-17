import sys
import json
import gzip
from concurrent.futures import ThreadPoolExecutor, as_completed
from tqdm import tqdm


ATLAS_FILE = "resources/atlas_db.json"
CVE_FILE = "results/new_cves.jsonl"


def save_jsonl(cve_tech_data):
    with open(CVE_FILE, 'w') as f:
        for cve, data in cve_tech_data.items():
            f.write(json.dumps({cve: data}) + "\n")

    new_cves = {}

    for cve, data in cve_tech_data.items():
        year = cve.split('-')[1]
        if year not in new_cves:
            new_cves[year] = {}
        new_cves[year][cve] = data

    for year, cves in new_cves.items():
        cve_db = load_db_jsonl(year)
        cve_db.update(cves)
        with gzip.open(f'database/CVE-{year}.jsonl.gz', 'wt', encoding='utf-8', compresslevel=6) as f:
            for cve, data in cve_db.items():
                f.write(json.dumps({cve: data}) + "\n")


def load_db_jsonl(cve_year):
    cve_db = {}
    try:
        with gzip.open(f'database/CVE-{cve_year}.jsonl.gz', 'rt', encoding='utf-8') as f:
            for line in f:
                cve_entry = json.loads(line.strip())
                cve_db.update(cve_entry)
    except FileNotFoundError:
        cve_db = {}
    return cve_db


def process_single_cve(cve, atlas_list, cve_tech_data):
    atlas_entries = []
    seen = set()
    for technique in cve_tech_data[cve].get("TECHNIQUES", []):
        entries = atlas_list.get("T" + technique, [])
        for entry in entries:
            key = entry.get("id")
            if key and key not in seen:
                seen.add(key)
                atlas_entries.append(entry)
    return atlas_entries


def process_techniques(cve_tech_data, atlas_list, cve_year):
    with ThreadPoolExecutor() as executor:
        futures = {executor.submit(process_single_cve, cve, atlas_list, cve_tech_data): cve for cve in tqdm(cve_tech_data, desc=f"Processing TECHNIQUES to ATLAS for CVE-{cve_year}", unit="CVE")}
        for future in as_completed(futures):
            cve_result = future.result()
            cve_tech_data[futures[future]]["ATLAS"] = cve_result


if __name__ == "__main__":
    if len(sys.argv) == 2:
        file = sys.argv[1]
    else:
        file = CVE_FILE

    cve_tech_data = {}
    with open(file, 'r') as f:
        for line in f:
            cve_entry = json.loads(line.strip())
            cve_tech_data.update(cve_entry)

    if cve_tech_data:
        with open(ATLAS_FILE, 'r') as f:
            atlas_list = json.load(f)

        cve_year = list(cve_tech_data.keys())[0].split('-')[1]

        process_techniques(cve_tech_data, atlas_list, cve_year)
        save_jsonl(cve_tech_data)
    else:
        print("[-]No new vulnerabilities found")
