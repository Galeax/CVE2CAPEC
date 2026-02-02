import requests
import os
from zipfile import ZipFile
import re
from xml.dom import minidom
import json


CWE_FILE = "http://cwe.mitre.org/data/xml/cwec_latest.xml.zip"
CWE_JSON_PATH = "resources/cwe_db.json"


# Download and extract CWE data
def download_cwe():
    response = requests.get(CWE_FILE)
    if response.status_code != 200:
        raise Exception("Failed to download CAPEC relation file")
    with open("cwec_latest.xml.zip", 'wb') as f:
        f.write(response.content)
    with ZipFile("cwec_latest.xml.zip", 'r') as zip_ref:
        zip_ref.extractall()
    os.remove("cwec_latest.xml.zip")
    file_name = re.search(r"cwec_v[\d\.]+\.xml", " ".join(os.listdir())).group()
    file = minidom.parse(file_name)
    os.remove(file_name)
    return file


# Format CWE data and save to JSON file
def format_cwe(cwe_list: minidom.Document):
    relations = cwe_list.getElementsByTagName("Weakness")
    results = {}
    for relation in relations:
        cwe_id = relation.getAttribute("ID")
        results[cwe_id] = {"ChildOf": set(), "RelatedAttackPatterns": set()}
        related_weaknesses = relation.getElementsByTagName("Related_Weaknesses")
        related_attack_patterns = relation.getElementsByTagName("Related_Attack_Patterns")
        
        if related_weaknesses:
            related_weaknesses = related_weaknesses[0].getElementsByTagName("Related_Weakness")
            for weakness in related_weaknesses:
                if weakness.getAttribute("Nature") == "ChildOf" and weakness.getAttribute("View_ID") == "1000":
                    results[cwe_id]["ChildOf"].add(weakness.getAttribute("CWE_ID"))
        else:
            results[cwe_id]["ChildOf"] = []

        if related_attack_patterns:
            related_attack_patterns = related_attack_patterns[0].getElementsByTagName("Related_Attack_Pattern")
            for attack_pattern in related_attack_patterns:
                results[cwe_id]["RelatedAttackPatterns"].add(attack_pattern.getAttribute("CAPEC_ID"))
        else:
            results[cwe_id]["RelatedAttackPatterns"] = []
    
    for cwe in results:
        results[cwe]["ChildOf"] = list(results[cwe]["ChildOf"])
        results[cwe]["RelatedAttackPatterns"] = list(results[cwe]["RelatedAttackPatterns"])
    
    with open(CWE_JSON_PATH, 'w') as f:
        f.write(json.dumps(results, indent=4))


if __name__ == "__main__":
    print("[!] Téléchargement des données CWE...")
    cwe_list = download_cwe()
    print("[!] Mise à jour des données CWE...")
    format_cwe(cwe_list)