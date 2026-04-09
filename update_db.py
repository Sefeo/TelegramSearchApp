import os
import sqlite3
import re
from bs4 import BeautifulSoup, SoupStrainer
from tinytag import TinyTag
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "chat_history.db")

def update_database():
    if not os.path.exists(DB_PATH):
        print(f"Error: Database not found at {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # Step 1: Ensure duration column exists
    try:
        c.execute("ALTER TABLE messages ADD COLUMN duration INTEGER")
        conn.commit()
        print("Added 'duration' column to database.")
    except sqlite3.OperationalError:
        # Column already exists
        pass

    # Step 2: Discover source folders from media paths
    print("Discovering source folders...")
    c.execute("SELECT DISTINCT media_path FROM messages WHERE media_path IS NOT NULL")
    paths = c.fetchall()
    
    source_folders = set()
    for (p,) in paths:
        # Expected structure: .../ExportFolder/video_files/file.mp4
        # We need the ExportFolder
        if any(x in p for x in ['video_files', 'photos', 'voice_messages', 'round_video_messages', 'files', 'animations', 'animated_stickers']):
            folder = os.path.dirname(os.path.dirname(p))
            if os.path.exists(os.path.join(folder, "messages.html")):
                source_folders.add(folder)

    if not source_folders:
        print("No source folders found. Make sure the Telegram export folders are still in the same location.")
        return

    print("\nFolders found for update:")
    for f in source_folders:
        print(f" - {f}")
    
    confirm = input("\nProceed with update? (y/n): ")
    if confirm.lower() != 'y':
        print("Update cancelled.")
        return

    # Step 3: Iterate and update
    MSG_CLASS_RE = re.compile(r'message')
    parser = "html.parser"
    try:
        import lxml
        parser = "lxml"
    except ImportError:
        pass

    total_updated = 0

    for folder in source_folders:
        print(f"\nProcessing folder: {folder}")
        files = [f for f in os.listdir(folder) if f.startswith('messages') and f.endswith('.html')]
        
        # Sort files numerically
        def sort_key(filename):
            match = re.search(r'messages(\d+)\.html', filename)
            return int(match.group(1)) if match else 0
        files.sort(key=sort_key)

        for file in files:
            file_path = os.path.join(folder, file)
            print(f"  Reading {file}...")
            
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                strainer = SoupStrainer('div', class_=MSG_CLASS_RE)
                soup = BeautifulSoup(f.read(), parser, parse_only=strainer)
                
                for msg in soup.find_all('div', class_=MSG_CLASS_RE):
                    tg_id = msg.get('id')
                    if not tg_id:
                        continue

                    # Find media links
                    media_link = msg.find('a', href=True)
                    if not media_link:
                        continue

                    href = media_link['href']
                    title_div = msg.find('div', class_='title')
                    title_text = title_div.text.strip() if title_div else ""
                    status_div = media_link.find('div', class_='status')
                    status_text = status_div.text.strip() if status_div else ""

                    is_video_or_anim = 'media_video' in media_link.get('class', []) or href.startswith('video_files/')
                    
                    new_type = None
                    duration = None

                    if is_video_or_anim:
                        if "Animation" in title_text or "Animation" in status_text or href.startswith('animated_stickers/') or href.startswith('animations/'):
                            new_type = 'gif'
                        else:
                            new_type = 'video'
                        
                        # Extract duration
                        media_path = os.path.abspath(os.path.join(folder, href))
                        if os.path.exists(media_path):
                            try:
                                tag = TinyTag.get(media_path)
                                if tag.duration:
                                    duration = int(tag.duration)
                            except:
                                pass
                    
                    elif href.startswith('voice_messages/') or href.startswith('round_video_messages/'):
                        media_path = os.path.abspath(os.path.join(folder, href))
                        if os.path.exists(media_path):
                            try:
                                tag = TinyTag.get(media_path)
                                if tag.duration:
                                    duration = int(tag.duration)
                            except:
                                pass

                    # Update database for this message
                    if new_type and duration is not None:
                        c.execute("UPDATE messages SET media_type = ?, duration = ? WHERE tg_id = ? AND source_folder = ?", 
                                 (new_type, duration, tg_id, os.path.basename(folder)))
                    elif new_type:
                        c.execute("UPDATE messages SET media_type = ? WHERE tg_id = ? AND source_folder = ?", 
                                 (new_type, tg_id, os.path.basename(folder)))
                    elif duration is not None:
                        c.execute("UPDATE messages SET duration = ? WHERE tg_id = ? AND source_folder = ?", 
                                 (duration, tg_id, os.path.basename(folder)))
                    
                    total_updated += 1

            conn.commit()

    conn.close()
    print(f"\nUpdate complete! Re-processed {total_updated} media entries.")

if __name__ == "__main__":
    update_database()
