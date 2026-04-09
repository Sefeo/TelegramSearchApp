import sqlite3
import os
import re
import html
import concurrent.futures

DB_PATH = 'chat_history.db'

def scan_html_for_animations(file_path):
    """Uses high-speed regex to find animations in HTML files."""
    found_hrefs = []
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            # 1. Look for hrefs in animated_wrap containers
            p1 = re.compile(r'class="[^"]*animated_wrap[^"]*"[^>]+href="([^"]+)"', re.IGNORECASE)
            for match in p1.finditer(content):
                # HTML unescape handles &apos; -> '
                decoded_href = html.unescape(match.group(1))
                found_hrefs.append(decoded_href.replace('/', '\\').lower())
            
            # 2. Look for gif_play div marker
            p2 = re.compile(r'href="([^"]+)"[^>]*>[\s\S]{0,1000}class="gif_play"', re.IGNORECASE)
            for match in p2.finditer(content):
                decoded_href = html.unescape(match.group(1))
                found_hrefs.append(decoded_href.replace('/', '\\').lower())
                
    except Exception:
        pass 
    
    return list(set(found_hrefs))

def main():
    if not os.path.exists(DB_PATH):
        print(f"Error: Database {DB_PATH} not found.")
        return

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    print("[1/3] Mapping Database entries...")
    c.execute("SELECT id, media_path FROM messages WHERE media_type = 'video' AND media_path IS NOT NULL")
    db_videos = c.fetchall()
    
    path_map = {}
    source_roots = set()
    
    for vid_id, full_path in db_videos:
        # Index everything by normalized suffix
        lower_path = full_path.lower()
        for marker in ['video_files\\', 'animations\\', 'animated_stickers\\', 'round_video_messages\\']:
            if marker in lower_path:
                suffix = marker + lower_path.split(marker)[1]
                if suffix not in path_map: path_map[suffix] = []
                path_map[suffix].append(vid_id)
                
                # Auto-discover the root directory from the actual DB paths
                root = full_path[:lower_path.find(marker)]
                if os.path.isdir(root):
                    source_roots.add(root)
                break

    if not source_roots:
        print("      Critical Error: Could not find any active media folders on disk.")
        print("      Check if the D: drive is plugged in and paths match the database.")
        conn.close()
        return

    print(f"      Found {len(source_roots)} active root directories to scan.")
    for r in source_roots:
        print(f"      - {r}")

    print("\n[2/3] Scouting HTML files...")
    html_files = []
    for root_dir in source_roots:
        for root, dirs, files in os.walk(root_dir):
            for f in files:
                if f.startswith('messages') and f.endswith('.html'):
                    html_files.append(os.path.join(root, f))

    print(f"      Found {len(html_files)} target HTML files. Processing...")

    all_matched_ids = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as executor:
        futures = {executor.submit(scan_html_for_animations, f): f for f in html_files}
        for future in concurrent.futures.as_completed(futures):
            hrefs = future.result()
            for h in hrefs:
                if h in path_map:
                    all_matched_ids.extend(path_map[h])

    if all_matched_ids:
        unique_ids = list(set(all_matched_ids))
        print(f"\n[3/3] Found {len(unique_ids)} items confirmed as Animations. Updating...")
        c.executemany("UPDATE messages SET media_type = 'gif' WHERE id = ?", [(i,) for i in unique_ids])
        conn.commit()
    else:
        print("\n[3/3] No additional Animations found.")

    conn.close()
    print("\nReclassification complete.")

if __name__ == "__main__":
    main()
