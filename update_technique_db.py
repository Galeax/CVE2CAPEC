import json
import pandas as panda

TECHNIQUES_ENTERPRISE_FILE_URL = "https://attack.mitre.org/docs/attack-excel-files/v18.1/enterprise-attack/enterprise-attack-v18.1-techniques.xlsx"
ENTERPRISE_XSLX_CASE = 9
TECHNIQUES_MOBILE_FILE_URL = "https://attack.mitre.org/docs/attack-excel-files/v18.1/mobile-attack/mobile-attack-v18.1-techniques.xlsx"
MOBILE_XSLX_CASE = 10
TECHNIQUES_ICS_FILE_URL = "https://attack.mitre.org/docs/attack-excel-files/v18.1/ics-attack/ics-attack-v18.1-techniques.xlsx"
ICS_XSLX_CASE = 9
TECHNIQUES_FILE = "resources/techniques_db.json"

# Download the techniques data
def download_techniques(base_url, case):
    try:
        data = panda.read_excel(base_url)
        result = {}
        for i in range(0, len(data)):
            result[data.iloc[i, 0]] = data.iloc[i, case].split(", ")
        return result
    except Exception as e:
        print(f"Error downloading the data: {str(e)}")
        return None


# Save the techniques data to a JSON file
def save_json(data):
    with open(TECHNIQUES_FILE, 'w') as f:
        json.dump(data, f, indent=4)
    

if __name__ == "__main__":
    print("[!] Downloading techniques data...")
    techniques_data = download_techniques(TECHNIQUES_ENTERPRISE_FILE_URL, ENTERPRISE_XSLX_CASE)
    techniques_data.update(download_techniques(TECHNIQUES_MOBILE_FILE_URL, MOBILE_XSLX_CASE))
    techniques_data.update(download_techniques(TECHNIQUES_ICS_FILE_URL, ICS_XSLX_CASE))
    if techniques_data:
        print("[!] Saving techniques data...")
        save_json(techniques_data)
