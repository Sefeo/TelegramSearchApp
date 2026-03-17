import os
import sqlite3
import re
from datetime import datetime
from bs4 import BeautifulSoup
import json

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_NAME = os.path.join(BASE_DIR, "chat_history.db")

def setup_database():
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS messages 
                 (id INTEGER PRIMARY KEY AUTOINCREMENT, 
                  source_folder TEXT, file_name TEXT, 
                  sender TEXT, timestamp DATETIME, 
                  text_content TEXT, media_path TEXT, media_type TEXT,
                  tg_id TEXT, reply_to_tg_id TEXT, reply_to_id INTEGER,
                  is_pinned INTEGER DEFAULT 0,
                  waveform TEXT)''')
    
    # Performance indexes
    c.execute("CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_messages_media_type ON messages(media_type)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_messages_is_pinned ON messages(is_pinned)")
    
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

    c = conn.cursor()
    total = 0
    pinned_tg_ids = set()
    
    # Persistent state across messages in a single file
    last_timestamp = "1970-01-01 00:00:00"
    current_sender = "Unknown" 

    for file in files:
        file_path = os.path.join(folder_path, file)
        print(f"  Reading {file}...")
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            soup = BeautifulSoup(f.read(), 'html.parser')
            
            for msg in soup.find_all('div', class_=re.compile(r'message')):
                classes = msg.get('class', [])
                
                # --- 1. Date Extraction ---
                date_div = msg.find(lambda tag: tag.name == 'div' and tag.has_attr('title') and '20' in tag['title'])
                if date_div:
                    match = re.search(r'\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}', date_div['title'].strip())
                    if match:
                        try: 
                            last_timestamp = datetime.strptime(match.group(0), "%d.%m.%Y %H:%M:%S").strftime("%Y-%m-%d %H:%M:%S")
                        except: pass
                msg_date = last_timestamp

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
                        a_tag = reply_div.find('a', href=re.compile(r'go_to_message'))
                        if a_tag:
                            match = re.search(r'message\d+', a_tag['href'])
                            if match: reply_to_tg_id = match.group(0)

                    # Rich Text
                    text_content = ""
                    text_div = msg.find('div', class_='text')
                    if text_div: text_content = "".join([str(child) for child in text_div.contents]).strip()

                    media_path = None
                    media_type = None

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
                            # Separate text from the details span
                            details_span = ans.find('span', class_='details')
                            vote_info = details_span.text.strip() if details_span else "0"
                            
                            # Remove the span to get just the answer text
                            if details_span: details_span.extract()
                            ans_text = ans.text.strip().replace('-', '', 1).strip() # Remove leading dash
                            
                            is_chosen = "chosen" in vote_info
                            try:
                                count = int(re.search(r'(\d+)', vote_info).group(1))
                            except: count = 0
                            
                            options.append({"text": ans_text, "count": count, "chosen": is_chosen})
                        
                        media_type = 'poll'
                        # Store complex poll data as JSON string in text_content
                        text_content = json.dumps({"question": question, "type": poll_type, "total": total_count, "options": options})

                    elif location:
                        href = location['href']
                        # Try to extract coords from Google Maps link
                        coords = "Unknown Location"
                        match = re.search(r'q=([\d\.,-]+)', href)
                        if match: coords = match.group(1)
                        
                        media_type = 'location'
                        # Store Coords|Link
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
                        # Check for GIFs/Videos via links
                        media_links = msg.find_all('a', href=True)
                        for link in media_links:
                            href = link['href']
                            is_video_block = 'media_video' in link.get('class', [])
                            title_div = link.find('div', class_='title')
                            title_text = title_div.text.strip() if title_div else ""

                            if href.startswith('photos/'): media_type = 'photo'
                            elif href.startswith('voice_messages/'): media_type = 'voice'
                            elif href.startswith('round_video_messages/'): media_type = 'round_video'
                            elif href.startswith('files/'): media_type = 'file'
                            elif href.startswith('video_files/') or is_video_block:
                                # Distinguish GIF vs Video
                                if title_text == "Animation" or href.startswith('animated_stickers/') or href.startswith('animations/'):
                                    media_type = 'gif'
                                else:
                                    media_type = 'video'
                            
                            if media_type:
                                media_path = os.path.abspath(os.path.join(folder_path, href))
                                break 

                    c.execute("""INSERT INTO messages 
                                 (source_folder, file_name, sender, timestamp, text_content, 
                                  media_path, media_type, tg_id, reply_to_tg_id) 
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                              (folder_name, file, current_sender, msg_date, text_content, 
                               media_path, media_type, tg_id, reply_to_tg_id))
                    total += 1

                # --- 3. System Messages ---
                elif 'service' in classes:
                    body = msg.find('div', class_='body details')
                    if body:
                        text = body.text.strip()
                        
                        # Group photos change
                        userpic = msg.find('img', class_='userpic')
                        if userpic and userpic.has_attr('src'):
                            media_path = os.path.abspath(os.path.join(folder_path, userpic['src']))
                            media_type = 'service_photo'
                        # Ignore date pills
                        if not re.match(r'^\d{1,2} [A-Z][a-z]+ \d{4}$', text):
                            # Record Pinned IDs
                            if "pinned" in text:
                                a_tag = body.find('a', href=re.compile(r'go_to_message'))
                                if a_tag:
                                    match = re.search(r'message\d+', a_tag['href'])
                                    if match: pinned_tg_ids.add(match.group(0))

                            c.execute("""INSERT INTO messages 
                                         (source_folder, file_name, sender, timestamp, text_content, media_type) 
                                         VALUES (?, ?, ?, ?, ?, ?)""",
                                      (folder_name, file, "System", msg_date, text, 'service'))
                            total += 1

    # --- 4. Final Processing ---
    if pinned_tg_ids:
        placeholders = ','.join(['?'] * len(pinned_tg_ids))
        c.execute(f"UPDATE messages SET is_pinned = 1 WHERE tg_id IN ({placeholders})", list(pinned_tg_ids))

    conn.commit()
    return total

if __name__ == "__main__":
    # 1. Database Existence Check
    if os.path.exists(DB_NAME):
        conn = sqlite3.connect(DB_NAME)
        c = conn.cursor()
        try:
            c.execute("SELECT COUNT(*) FROM messages")
            count = c.fetchone()[0]
            if count > 0:
                print(f"\n[!] Error: Database already exists and contains {count} messages.")
                print("Please delete 'chat_history.db' if you want to rebuild, or move it to another folder.")
                conn.close()
                exit()
        except sqlite3.OperationalError:
            # Table might not exist yet, that's fine
            pass
        conn.close()

    # 2. Folder Input Loop
    print("\n--- Telegram Database Builder ---")
    print("Folders will be linked chronologically in the order you provide them.")
    target_folders = []
    
    # First mandatory folder
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
    db_connection = setup_database()
    total_indexed = 0
    
    for i, folder in enumerate(target_folders):
        folder_name = os.path.basename(folder) if i == 0 else f"Linked_{i}"
        total_indexed += parse_folder(db_connection, folder, folder_name)

    # 5. Final Processing
    print("\nLinking replies...")
    c = db_connection.cursor()
    c.execute('''UPDATE messages SET reply_to_id = (SELECT id FROM messages m2 WHERE m2.tg_id = messages.reply_to_tg_id) WHERE reply_to_tg_id IS NOT NULL''')
    db_connection.commit()
    
    # 6. Final Summary
    print(f"\nSuccess! Indexed {total_indexed} messages.")
    print("\n[!] IMPORTANT: Do NOT change the path of linked Telegram exported chats.")
    print("Some functions rely on these paths to extract media files (videos, stickers, voice messages).")
    
    db_connection.close()