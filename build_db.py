import os
import sqlite3
import re
import argparse
from datetime import datetime
from bs4 import BeautifulSoup, SoupStrainer
from tinytag import TinyTag
import json
import sys
import concurrent.futures
import time
import html

try:
    import cv2
except ImportError:
    cv2 = None

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB_NAME = os.path.join(BASE_DIR, "chat_history.db")

# Global database name that can be overridden
DB_PATH = DEFAULT_DB_NAME

def setup_database(db_path):
    # Ensure directory exists
    db_dir = os.path.dirname(os.path.abspath(db_path))
    os.makedirs(db_dir, exist_ok=True)
        
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS messages 
                 (id INTEGER PRIMARY KEY AUTOINCREMENT, 
                  source_folder TEXT, file_name TEXT, 
                  sender TEXT, timestamp DATETIME, 
                  text_content TEXT, media_path TEXT, media_type TEXT,
                  tg_id TEXT, reply_to_tg_id TEXT, reply_to_id INTEGER,
                  forwarded_from TEXT, forwarded_date TEXT,
                  is_pinned INTEGER DEFAULT 0,
                  waveform TEXT, duration INTEGER)''')
    
    # Performance indexes
    c.execute("CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_messages_media_type ON messages(media_type)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_messages_is_pinned ON messages(is_pinned)")
    
    # Critical indexes for reply linking performance
    c.execute("CREATE INDEX IF NOT EXISTS idx_messages_tg_id ON messages(tg_id)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_messages_reply_to_tg_id ON messages(reply_to_tg_id)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_messages_source_file ON messages(source_folder, file_name)")
    
    conn.commit()
    return conn

def parse_folder(conn, folder_path, folder_name):
    print(f"\nScanning folder: {folder_path}")
    if not os.path.exists(folder_path):
        print(f"Error: Folder '{folder_path}' does not exist!")
        return 0

    # Correct sorting for messages.html, messages2.html, ..., messages10.html
    def sort_key(filename):
        # Extract number from 'messagesN.html'
        match = re.search(r'messages(\d+)\.html', filename)
        if match:
            return int(match.group(1))
        # 'messages.html' comes first (0)
        return 0

    files = [f for f in os.listdir(folder_path) if f.startswith('messages') and f.endswith('.html')]
    files.sort(key=sort_key)

    # Check for lxml availability
    parser = "html.parser"
    try:
        import lxml
        parser = "lxml"
    except ImportError:
        pass

    c = conn.cursor()
    total = 0
    pinned_tg_ids = set()
    
    # Persistent state across messages in a single file
    last_timestamp = "1970-01-01 00:00:00"
    current_sender = "Unknown" 

    # Pre-compile regexes for performance optimization
    MSG_CLASS_RE = re.compile(r'message')
    DATE_RE = re.compile(r'\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}')
    GO_TO_MESSAGE_RE = re.compile(r'go_to_message')
    MESSAGE_ID_RE = re.compile(r'message\d+')
    POLL_VOTE_RE = re.compile(r'(\d+)')
    MAPS_COORD_RE = re.compile(r'q=([\d\.,-]+)')
    SYS_DATE_PILL_RE = re.compile(r'^\d{1,2} [A-Z][a-z]+ \d{4}$')

    for file in files:
        file_path = os.path.join(folder_path, file)
        print(f"  Reading {file} using {parser}...")
        
        # We will batch inserts per-file
        normal_msgs_batch = []
        sys_msgs_batch = []
        
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            # SoupStrainer optimizes initial parse by ignoring irrelevant nodes
            strainer = SoupStrainer('div', class_=MSG_CLASS_RE)
            soup = BeautifulSoup(f.read(), parser, parse_only=strainer)
            
            for msg in soup.find_all('div', class_=MSG_CLASS_RE):
                classes = msg.get('class', [])
                
                # --- 1. Date Extraction ---
                date_div = msg.find(lambda tag: tag.name == 'div' and tag.has_attr('title') and '20' in tag['title'])
                if date_div:
                    match = DATE_RE.search(date_div['title'].strip())
                    if match:
                        try: 
                            last_timestamp = datetime.strptime(match.group(0), "%d.%m.%Y %H:%M:%S").strftime("%Y-%m-%d %H:%M:%S")
                        except: pass
                msg_date = last_timestampEntry = last_timestamp

                # --- 2. Normal Messages ---
                if 'default' in classes:
                    # Sender Logic: Only update if explicitly present, otherwise reuse last one (for joined msgs)
                    sender_div = msg.find('div', class_='from_name')
                    if sender_div:
                        current_sender = sender_div.text.strip()
                    
                    # IDs for Replies
                    tg_id = msg.get('id')
                    reply_to_tg_id = None
                    reply_div = msg.find('div', class_='reply_to')
                    if reply_div:
                        a_tag = reply_div.find('a', href=GO_TO_MESSAGE_RE)
                        if a_tag:
                            match = MESSAGE_ID_RE.search(a_tag['href'])
                            if match: reply_to_tg_id = match.group(0)

                    # Forwarding Info
                    forwarded_from = None
                    forwarded_date = None
                    fwd_div = msg.find('div', class_='forwarded body')
                    if fwd_div:
                        fwd_name_div = fwd_div.find('div', class_='from_name')
                        if fwd_name_div:
                            # Extract name, avoiding text inside span tags
                            forwarded_from = "".join(fwd_name_div.find_all(string=True, recursive=False)).strip()
                            # Extract date from span
                            fwd_date_span = fwd_name_div.find('span', class_='date')
                            if fwd_date_span:
                                forwarded_date = fwd_date_span.get('title') or fwd_date_span.text.strip()

                    # Rich Text
                    text_content = ""
                    text_div = msg.find('div', class_='text')
                    if text_div: text_content = "".join([str(child) for child in text_div.contents]).strip()

                    media_path = None
                    media_type = None
                    duration = None

                    # Media Detection
                    contact = msg.find('div', class_='media_contact')
                    call = msg.find('div', class_='media_call')
                    sticker = msg.find('img', class_='sticker')
                    # GIF/Video logic
                    video_link = msg.find('a', class_='media_video')
                    poll = msg.find('div', class_='media_poll')
                    location = msg.find('a', class_='media_location')

                    if poll:
                        question = poll.find('div', class_='question').text.strip()
                        poll_type = poll.find('div', class_='details').text.strip()
                        total_count = poll.find('div', class_='total').text.strip()
                        
                        options = []
                        for ans in poll.find_all('div', class_='answer'):
                            details_span = ans.find('span', class_='details')
                            vote_info = details_span.text.strip() if details_span else "0"
                            
                            if details_span: details_span.extract()
                            ans_text = ans.text.strip().replace('-', '', 1).strip()
                            
                            is_chosen = "chosen" in vote_info
                            match = POLL_VOTE_RE.search(vote_info)
                            count = int(match.group(1)) if match else 0
                            
                            options.append({"text": ans_text, "count": count, "chosen": is_chosen})
                        
                        media_type = 'poll'
                        text_content = json.dumps({"question": question, "type": poll_type, "total": total_count, "options": options})

                    elif location:
                        href = location['href']
                        coords = "Unknown Location"
                        match = MAPS_COORD_RE.search(href)
                        if match: coords = match.group(1)
                        
                        media_type = 'location'
                        text_content = f"{coords}|{href}"
                    
                    elif contact:
                        n = contact.find('div', class_='title').text.strip() if contact.find('div', class_='title') else "Unknown"
                        p = contact.find('div', class_='status').text.strip() if contact.find('div', class_='status') else ""
                        media_type = 'contact'
                        text_content = f"{n}|{p}"
                    elif call:
                        t = call.find('div', class_='title').text.strip() if call.find('div', class_='title') else "Call"
                        s = call.find('div', class_='status').text.strip() if call.find('div', class_='status') else ""
                        succ = 'success' in call.get('class', [])
                        media_type = 'call'
                        text_content = f"{t}|{s}|{succ}"
                    elif sticker and sticker.has_attr('src'):
                        media_path = os.path.abspath(os.path.join(folder_path, sticker['src']))
                        media_type = 'sticker'
                    else:
                        media_links = msg.find_all('a', href=True)
                        for link in media_links:
                            # Use unescape to handle filenames with &apos;, etc.
                            href = html.unescape(link['href'])
                            is_video_block = 'media_video' in link.get('class', [])
                            title_div = link.find('div', class_='title')
                            title_text = title_div.text.strip() if title_div else ""
                            status_div = link.find('div', class_='status')
                            status_text = status_div.text.strip() if status_div else ""

                            if href.startswith('photos/'): media_type = 'photo'
                            elif href.startswith('voice_messages/'): media_type = 'voice'
                            elif href.startswith('round_video_messages/'): media_type = 'round_video'
                            elif href.startswith('files/'): media_type = 'file'
                            elif href.startswith('video_files/') or is_video_block or 'animated_wrap' in link.get('class', []):
                                # Synchronized heuristic from reclassify_media.py
                                is_anim = ("Animation" in title_text or 
                                           "Animation" in status_text or 
                                           "GIF" in link.text or
                                           href.startswith(('animated_stickers/', 'animations/')) or 
                                           any(kw in href.lower() for kw in ['sticker', 'anim', 'result.mp4']) or
                                           'animated_wrap' in link.get('class', []) or
                                           link.find('div', class_='gif_play'))
                                
                                # Round videos are never animations, even if they're in video_files accidentally
                                if is_anim and not href.startswith('round_video_messages/'):
                                    media_type = 'gif'
                                else:
                                    media_type = 'video'
                            
                            if media_type:
                                # Standardize path using normalized href
                                media_path = os.path.abspath(os.path.join(folder_path, href))
                                break 

                    normal_msgs_batch.append((folder_name, file, current_sender, msg_date, text_content, 
                                              media_path, media_type, tg_id, reply_to_tg_id, 
                                              forwarded_from, forwarded_date, duration))
                    total += 1

                # --- 3. System Messages ---
                elif 'service' in classes:
                    body = msg.find('div', class_='body details')
                    if body:
                        text = body.text.strip()
                        
                        userpic = msg.find('img', class_='userpic')
                        if userpic and userpic.has_attr('src'):
                            media_path = os.path.abspath(os.path.join(folder_path, userpic['src']))
                            media_type = 'service_photo'
                        
                        if not SYS_DATE_PILL_RE.match(text):
                            if "pinned" in text:
                                a_tag = body.find('a', href=GO_TO_MESSAGE_RE)
                                if a_tag:
                                    match = MESSAGE_ID_RE.search(a_tag['href'])
                                    if match: pinned_tg_ids.add(match.group(0))

                            sys_msgs_batch.append((folder_name, file, "System", msg_date, text, 'service', 'Forwarded Information'))
                            total += 1

        # Process batches with parallel duration extraction for speed
        def fetch_durations(items):
            # Only process if we have valid media types that support duration
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
                def get_dur(it):
                    # it is [..., media_path, media_type, ..., duration]
                    # duration is at index 11
                    m_path = it[5]
                    m_type = it[6]
                    if m_type in ['video', 'gif', 'voice', 'round_video', 'audio'] and m_path and os.path.exists(m_path):
                        # 1. Primary: TinyTag (Fastest)
                        try:
                            t = TinyTag.get(m_path)
                            if t.duration: return max(1, int(round(t.duration)))
                        except: pass
                        
                        # 2. Secondary: OpenCV (Robust fallback for broken/iPhone headers)
                        if cv2 and m_type in ['video', 'round_video', 'gif']:
                            try:
                                cap = cv2.VideoCapture(m_path)
                                if cap.isOpened():
                                    fps = cap.get(cv2.CAP_PROP_FPS)
                                    frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)
                                    cap.release()
                                    if fps > 0: return max(1, int(round(frames / fps)))
                            except: pass
                    return None
                
                durations = list(executor.map(get_dur, items))
                # Update items with extracted durations
                updated = []
                for i, d in enumerate(durations):
                    row = list(items[i])
                    row[11] = d # Update duration index
                    updated.append(tuple(row))
                return updated

        # Execute batched inserts
        if normal_msgs_batch:
            # Parallelize duration fetching for the batch
            normal_msgs_batch = fetch_durations(normal_msgs_batch)
            c.executemany("""INSERT INTO messages 
                             (source_folder, file_name, sender, timestamp, text_content, 
                              media_path, media_type, tg_id, reply_to_tg_id, 
                              forwarded_from, forwarded_date, duration) 
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", normal_msgs_batch)
        if sys_msgs_batch:
            c.executemany("""INSERT INTO messages 
                             (source_folder, file_name, sender, timestamp, text_content, media_type, forwarded_from) 
                             VALUES (?, ?, ?, ?, ?, ?, ?)""", sys_msgs_batch)

        # Link replies for this specific file
        c.execute('''UPDATE messages 
                     SET reply_to_id = (SELECT id FROM messages m2 WHERE m2.tg_id = messages.reply_to_tg_id) 
                     WHERE source_folder = ? AND file_name = ? AND reply_to_tg_id IS NOT NULL AND reply_to_id IS NULL''', 
                  (folder_name, file))
        conn.commit()

    # --- 4. Final Processing ---
    if pinned_tg_ids:
        placeholders = ','.join(['?'] * len(pinned_tg_ids))
        c.execute(f"UPDATE messages SET is_pinned = 1 WHERE tg_id IN ({placeholders})", list(pinned_tg_ids))

    conn.commit()
    return total

def generate_thumbnail_worker(task):
    """Helper for parallel thumbnail generation using OpenCV."""
    msg_id, media_path, thumb_dir = task
    if not media_path or not os.path.exists(media_path):
        return False
        
    output_path = os.path.join(thumb_dir, f"{msg_id}.jpg")
    if os.path.exists(output_path):
        return True

    try:
        cap = cv2.VideoCapture(media_path)
        if not cap.isOpened():
            return False
            
        # Try to seek to 100ms
        cap.set(cv2.CAP_PROP_POS_MSEC, 100) 
        success, frame = cap.read()
        
        if success:
            cv2.imwrite(output_path, frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
            cap.release()
            return True
        else:
            # Fallback to first frame
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            success, frame = cap.read()
            if success:
                cv2.imwrite(output_path, frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        
        cap.release()
        return success
    except:
        return False

def generate_thumbnails(db_path):
    """Orchestrates parallel thumbnail generation."""
    thumb_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "thumbnails")
    os.makedirs(thumb_dir, exist_ok=True)
    
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("SELECT id, media_path FROM messages WHERE media_type IN ('video', 'gif', 'round_video') AND media_path IS NOT NULL")
    rows = c.fetchall()
    conn.close()

    to_process = [(row[0], row[1], thumb_dir) for row in rows if not os.path.exists(os.path.join(thumb_dir, f"{row[0]}.jpg"))]
    total = len(to_process)
    
    if total == 0:
        print("\nAll thumbnails are already generated! ✨")
        return

    print(f"\n[6/6] Generating {total} video thumbnails using {os.cpu_count() or 4} parallel workers...")
    start_time = time.time()
    
    success_count = 0
    # Use ThreadPoolExecutor for video decoding
    workers = min(os.cpu_count() or 4, 12)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {executor.submit(generate_thumbnail_worker, task): task for task in to_process}
        for i, future in enumerate(concurrent.futures.as_completed(futures)):
            if future.result():
                success_count += 1
            if (i + 1) % 50 == 0 or (i + 1) == total:
                print(f"      Progress: {i+1}/{total} ({(i+1)/total*100:.1f}%)")

    print(f"Finished! Generated {success_count} thumbnails in {time.time() - start_time:.2f} seconds.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Telegram HTML Export to SQLite Database Builder")
    parser.add_argument("--input", help="Path to the Telegram export folder (contains messages.html)")
    parser.add_argument("--db", default=DEFAULT_DB_NAME, help=f"Custom path for the output database file (default: {DEFAULT_DB_NAME})")
    parser.add_argument("--reset", action="store_true", help="Drop and recreate the database before importing")
    parser.add_argument("--no-thumbnails", action="store_true", help="Skip generating video thumbnails")
    
    args = parser.parse_args()
    DB_PATH = args.db

    # 1. Reset Logic
    if args.reset and os.path.exists(DB_PATH):
        print(f"Resetting database: {DB_PATH}")
        try:
            os.remove(DB_PATH)
        except Exception as e:
            print(f"Error removing old database: {e}")
            sys.exit(1)

    # 2. Database Existence Check (if not resetting)
    if not args.reset and os.path.exists(DB_PATH):
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        try:
            c.execute("SELECT COUNT(*) FROM messages")
            count = c.fetchone()[0]
            if count > 0:
                print(f"\n[!] Error: Database already exists and contains {count} messages.")
                print(f"Path: {DB_PATH}")
                print("Please delete the file if you want to rebuild, or use the --reset flag.")
                conn.close()
                sys.exit(1)
        except sqlite3.OperationalError:
            # Table might not exist yet, that's fine
            pass
        conn.close()

    # 3. Folder Collection
    target_folders = []
    
    if args.input:
        # CLI Mode
        if os.path.exists(os.path.join(args.input, "messages.html")):
            target_folders.append(args.input)
        else:
            print(f"Error: Could not find 'messages.html' in {args.input}")
            sys.exit(1)
    else:
        # Interactive Mode
        print("\n--- Telegram Database Builder ---")
        print("Folders will be linked chronologically in the order you provide them.")
        
        example_path = r"C:\Users\Name\Downloads\Telegram Desktop\ChatExport_2024-03-17"
        print(f"\n1. Insert path to the FIRST Telegram Exported Chat folder (contains messages.html):")
        print(f"Example: {example_path}")
        
        while True:
            path = input("Path: ").strip().strip('"').strip("'")
            if not path:
                print("You must provide at least one folder path.")
                continue
                
            if os.path.exists(os.path.join(path, "messages.html")):
                target_folders.append(path)
                print(f"Added: {path}")
                break
            elif os.path.exists(os.path.join(path, "messages.json")):
                print("\n[!] Error: 'messages.json' found. JSON format is not currently supported. Please export as HTML.")
            else:
                print(f"\n[!] Error: Path is incorrect. Could not find 'messages.html' in {path}")
            print("Please try again.")

        # Subsequent optional folders
        while True:
            print(f"\nLink another folder? (Order matters for chronological continuity)")
            path = input("Path (or leave empty to proceed): ").strip().strip('"').strip("'")
            
            if not path:
                break

            if os.path.exists(os.path.join(path, "messages.html")):
                target_folders.append(path)
                print(f"Added: {path}")
            elif os.path.exists(os.path.join(path, "messages.json")):
                print("\n[!] Error: 'messages.json' found. JSON format is not supported. Skipping.")
            else:
                print(f"\n[!] Error: Path is incorrect. Could not find 'messages.html' in {path}. Skipping.")

    # 4. Build Process
    db_connection = setup_database(DB_PATH)
    total_indexed = 0
    
    for i, folder in enumerate(target_folders):
        folder_name = os.path.basename(folder) if i == 0 else f"Linked_{i}"
        total_indexed += parse_folder(db_connection, folder, folder_name)

    # 5. Final Summary
    print(f"\nSuccess! Indexed {total_indexed} messages.")
    print(f"Database saved to: {DB_PATH}")
    
    # 6. Optional Thumbnail Generation
    if not args.no_thumbnails and cv2:
        db_connection.close()  # Close connection to allow multi-threaded reading
        generate_thumbnails(DB_PATH)
    elif not cv2 and not args.no_thumbnails:
        print("\n[!] Note: 'opencv-python' is not installed. To generate fast video previews automatically, run: pip install opencv-python-headless")
    else:
        db_connection.close()

    print("\n[!] IMPORTANT: Do NOT change the path of linked Telegram exported chats.")
    print("Some functions rely on these paths to extract media files (videos, stickers, voice messages).")