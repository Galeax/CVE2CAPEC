import json
import os
import requests
import yaml
from tqdm import tqdm

ATLAS_YAML_URL = "https://raw.githubusercontent.com/mitre-atlas/atlas-data/main/dist/ATLAS.yaml"
OUTPUT_FILE = "resources/atlas_db.json"
ATLAS_TECHNIQUE_URL = "https://atlas.mitre.org/techniques/{tid}"


def fetch_atlas():
    response = requests.get(ATLAS_YAML_URL, timeout=60)
    response.raise_for_status()
    return yaml.safe_load(response.text)


def build_reverse_index(atlas_data):
    index = {}
    matrices = atlas_data.get("matrices", []) or []
    techniques_seen = []
    for matrix in matrices:
        for technique in matrix.get("techniques", []) or []:
            if technique.get("object-type") != "technique":
                continue
            techniques_seen.append(technique)

    for technique in tqdm(techniques_seen, desc="Building ATLAS reverse index", unit="technique"):
        ref = technique.get("ATT&CK-reference") or {}
        attack_id = ref.get("id")
        if not attack_id or not attack_id.startswith("T"):
            continue
        entry = {
            "id": technique.get("id"),
            "name": technique.get("name"),
            "tactics": technique.get("tactics") or [],
            "url": ATLAS_TECHNIQUE_URL.format(tid=technique.get("id")),
        }
        index.setdefault(attack_id, [])
        if entry not in index[attack_id]:
            index[attack_id].append(entry)
    return index


def update_atlas_db():
    atlas_data = fetch_atlas()
    index = build_reverse_index(atlas_data)
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, "w") as f:
        json.dump(index, f, indent=2, sort_keys=True)
    print(f"[+] ATLAS DB written to {OUTPUT_FILE} (version {atlas_data.get('version')}, {len(index)} ATT&CK keys, {sum(len(v) for v in index.values())} ATLAS techniques)")


if __name__ == "__main__":
    update_atlas_db()
