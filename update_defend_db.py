import json
from tqdm import tqdm
import requests
import os

TECHNIQUES_FILE = 'resources/techniques_db.json'
DEFEND_SITE = 'https://d3fend.mitre.org/api/offensive-technique/attack/'

def load_techniques():
    try:
        with open(TECHNIQUES_FILE, 'r') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading the data: {str(e)}")
        return None


def update_defend_techniques():
    techniques = load_techniques()
    if techniques:
        file_path = f"resources/defend_db.jsonl"
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, 'w') as f:
            for technique_id in tqdm(techniques, desc="Updating D3FEND techniques", unit="technique"):
                defend = {technique_id: []}
                response = requests.get(f"{DEFEND_SITE}{technique_id}.json")
                if response.status_code == 200:
                    result = response.json()
                    for key in result.get("off_to_def").get("results").get("bindings"):
                        id = key.get("def_tech_id").get("value") if key.get("def_tech_id") else ""
                        tactic = key.get("def_tactic_label").get("value") if key.get("def_tactic_label") else ""
                        technique = key.get("def_tech_label").get("value") if key.get("def_tech_label") else ""
                        artifact = key.get("def_artifact_label").get("value") if key.get("def_artifact_label") else ""
                        entry = {"id": id, "tactic": tactic, "technique": technique, "artifact": artifact}
                        if id and tactic and technique and artifact and entry not in defend[technique_id]:
                            defend[technique_id].append(entry)
                f.write(json.dumps(defend) + '\n')
if __name__ == "__main__":
    update_defend_techniques()
    print("[+] D3FEND techniques updated successfully!")