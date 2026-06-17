import sys
import json
import gzip
from concurrent.futures import ThreadPoolExecutor, as_completed
from tqdm import tqdm


TECHNIQUES_FILE = "resources/techniques_db.json"
DEFEND_FILE = "resources/defend_db.jsonl"
CVE_FILE = "results/new_cves.jsonl"


# Update the database with the new CVEs and save the results to a JSONL file
def save_jsonl(cve_tech_data):

    # Write the results to a JSONL file
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
        # Update the database with the new CVEs
        cve_db = load_db_jsonl(year)
        cve_db.update(cves)
        with gzip.open(f'database/CVE-{year}.jsonl.gz', 'wt', encoding='utf-8', compresslevel=6) as f:
            for cve, data in cve_db.items():
                f.write(json.dumps({cve: data}) + "\n")


# Load the database from a gzipped JSONL file
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


# Process CVE to extract the related CAPEC entries
def process_single_cve(cve, defend_list, cve_tech_data):
    defends = []
    for techniques in cve_tech_data[cve]["TECHNIQUES"]:
        lines = defend_list.get("T"+techniques, {})
        if lines:
            # Ajoute les dict de lines dans la liste
            for line in lines:
                defends.append(line)
    return defends


# Multithreading process to extract CAPEC entries for each CVE
def process_techniques(cve_tech_data, defend_list, cve_year):
    with ThreadPoolExecutor() as executor:
        futures = {executor.submit(process_single_cve, cve, defend_list, cve_tech_data): cve for cve in tqdm(cve_tech_data, desc=f"Processing TECHNIQUES to DEFEND for CVE-{cve_year}", unit="CVE")}
        for future in as_completed(futures):
            cve_result = future.result()
            cve_tech_data[futures[future]]["DEFEND"] = cve_result


if __name__ == "__main__":
    if len(sys.argv) == 2:
        file = sys.argv[1]
    else:
        file = CVE_FILE

    # Load the JSONL file
    cve_tech_data = {}
    with open(file, 'r') as f:
        for line in f:
            cve_entry = json.loads(line.strip())
            cve_tech_data.update(cve_entry)

    if cve_tech_data:

        defend_list = {}
        with open(DEFEND_FILE, 'r') as f:
            for line in f:
                defend_entry = json.loads(line.strip())
                defend_list.update(defend_entry)

        cve_year = list(cve_tech_data.keys())[0].split('-')[1]

        process_techniques(cve_tech_data, defend_list, cve_year)
        save_jsonl(cve_tech_data)
    else:
        print("[-]No new vulnerabilities found")
 