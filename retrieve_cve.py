import requests
import json
from datetime import datetime, timezone, timedelta
from tqdm import tqdm
from re import match
import os
import time
import gzip
import ijson

# NVD JSON 2.0 data feeds (static files, far more reliable than the date-filtered API).
# https://nvd.nist.gov/vuln/data-feeds
FEED_BASE = "https://nvd.nist.gov/feeds/json/cve/2.0/"
# The "modified" feed contains every CVE added or modified within the previous 8 days.
MODIFIED_FEED = FEED_BASE + "nvdcve-2.0-modified.json.gz"
# Year feeds are used as a fallback when the gap to cover exceeds the modified feed window.
YEAR_FEED = FEED_BASE + "nvdcve-2.0-{year}.json.gz"
# Safety margin: the modified/recent feeds cover the previous 8 days. Fall back to the
# year feeds when we need to look further back than this.
FEED_WINDOW_DAYS = 7

UPDATE_FILE = "lastUpdate.txt"
CVE_FILE = "results/new_cves.jsonl"


def parse_feed_timestamp(value: str) -> datetime:
    """Parse an NVD feed 'lastModified' value (UTC, no offset) into an aware datetime."""
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def download_feed_with_retries(session, url, dest, retries=3, delay=5):
    for attempt in range(1, retries + 1):
        try:
            with session.get(url, stream=True, timeout=120) as response:
                if response.status_code == 200:
                    with open(dest, "wb") as f:
                        for chunk in response.iter_content(chunk_size=1 << 20):
                            f.write(chunk)
                    return dest
                elif 500 <= response.status_code < 600:
                    print(f"[-] Failed to download {url} (attempt {attempt}/{retries}) - Error:{response.status_code}. Retrying in {delay*attempt}s...")
                    time.sleep(delay * attempt)
                    continue
                else:
                    raise Exception(f"Failed to download {url} (status code: {response.status_code})")
        except requests.RequestException as e:
            print(f"[-] Failed to download {url} (attempt {attempt}/{retries}) - {e}. Retrying in {delay*attempt}s...")
            time.sleep(delay * attempt)
    raise Exception(f"Failed to download {url} after {retries} attempts")


def feeds_to_fetch(start_date: datetime, end_date: datetime):
    """Pick the smallest set of feeds covering [start_date, end_date]."""
    if end_date - start_date <= timedelta(days=FEED_WINDOW_DAYS):
        return [MODIFIED_FEED]
    # Larger gap (first run, or the job was down for a while): use the year feeds,
    # which contain the complete history per year.
    return [YEAR_FEED.format(year=year) for year in range(start_date.year, end_date.year + 1)]


def extract_cwes(cve: dict):
    """Extract primary CWE codes (falling back to secondary) for a single CVE entry."""
    cwe_list = []
    has_primary_cwe = False
    infos = cve.get("weaknesses", [])
    if not infos:
        return cwe_list
    for cwe in infos:
        if cwe.get("type", "") == "Primary":
            cwe_code = cwe.get("description", [])[0].get("value", "")
            if match(r"CWE-\d{1,4}", cwe_code):
                cwe_list.append(cwe_code.split("-")[1])
                has_primary_cwe = True
    if not has_primary_cwe:
        for cwe in infos:
            if cwe.get("type", "") == "Secondary":
                cwe_code = cwe.get("description", [])[0].get("value", "")
                if match(r"CWE-\d{1,4}", cwe_code):
                    cwe_list.append(cwe_code.split("-")[1])
    return cwe_list


def parse_cves(start_date: datetime, end_date: datetime):
    cve_data = {}
    session = requests.Session()

    feeds = feeds_to_fetch(start_date, end_date)
    if feeds == [MODIFIED_FEED]:
        print(f"[+] Gap <= {FEED_WINDOW_DAYS} days: using the 'modified' feed")
    else:
        print(f"[+] Gap > {FEED_WINDOW_DAYS} days: falling back to year feeds {[f.rsplit('-', 1)[-1] for f in feeds]}")

    print(f"[+] ijson backend: {ijson.backend}")

    os.makedirs("feeds_tmp", exist_ok=True)
    for feed_url in feeds:
        dest = os.path.join("feeds_tmp", os.path.basename(feed_url))
        download_feed_with_retries(session, feed_url, dest)
        with gzip.open(dest, "rb") as f:
            for cve_wrapper in tqdm(ijson.items(f, "vulnerabilities.item"), desc=f"Processing {os.path.basename(feed_url)}", unit="CVE"):
                cve = cve_wrapper.get("cve", {})
                last_modified = cve.get("lastModified")
                # Keep only CVEs modified since the last run (real delta), so the
                # downstream pipeline stays as light as it is today.
                if last_modified and parse_feed_timestamp(last_modified) < start_date:
                    continue
                cve_id = cve.get("id", "")
                if cve_id:
                    cve_data[cve_id] = {"CWE": extract_cwes(cve)}
        os.remove(dest)

    if not cve_data:
        print("[-] No new vulnerabilities found")
    return cve_data


def save_jsonl(cve_data, today_iso: str):
    os.makedirs(os.path.dirname(CVE_FILE), exist_ok=True)
    with open(CVE_FILE, 'w', encoding='utf-8') as f:
        for cve, data in cve_data.items():
            f.write(json.dumps({cve: data}) + "\n")

    with open(UPDATE_FILE, 'w', encoding='utf-8') as f:
        f.write(today_iso)


if __name__ == "__main__":
    today_dt = datetime.now(timezone.utc)

    try:
        with open(UPDATE_FILE, 'r') as f:
            last_update_raw = f.read().strip()
        last_update_dt = datetime.fromisoformat(last_update_raw)
        if last_update_dt.tzinfo is None:
            last_update_dt = last_update_dt.replace(tzinfo=timezone.utc)
    except Exception as e:
        print(f"[!] Failed to parse last update date: {e}. Using fallback date.")
        last_update_dt = datetime(2021, 1, 1, tzinfo=timezone.utc)

    cves_data = parse_cves(last_update_dt, today_dt)
    save_jsonl(cves_data, today_dt.isoformat())
