import sqlite3
import re
import os

DB_PATH = 'chat_history.db'

def fix_emoji_links():
    if not os.path.exists(DB_PATH):
        print(f"Error: {DB_PATH} not found.")
        return

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    print("Mapping source_folders to their absolute paths...")
    c.execute("SELECT source_folder, media_path FROM messages WHERE media_path IS NOT NULL")
    
    folder_map = {}
    for source_folder, media_path in c.fetchall():
        if source_folder and media_path and source_folder not in folder_map:
            parts = media_path.replace('/', '\\').split('\\')
            try:
                idx = len(parts) - 1 - parts[::-1].index(source_folder)
                base_path = '\\'.join(parts[:idx+1])
                folder_map[source_folder] = base_path
            except ValueError:
                pass
                
    print(f"Found absolute paths for {len(folder_map)} folders.")
    
    print("Finding messages with standalone media links in text_content...")
    c.execute("SELECT id, source_folder, text_content FROM messages WHERE media_type IS NULL AND (text_content LIKE '%stickers/%' OR text_content LIKE '%stickers\\%' OR text_content LIKE '%video_files/%' OR text_content LIKE '%video_files\\%' OR text_content LIKE '%animations/%' OR text_content LIKE '%animations\\%' OR text_content LIKE '%animated_stickers/%' OR text_content LIKE '%animated_stickers\\%')")
    
    messages = c.fetchall()
    updates = []
    
    link_pattern = re.compile(r'<a([^>]*)href=["\']([^"\']+)["\']([^>]*)>')
    
    for row_id, source_folder, text_content in messages:
        if source_folder not in folder_map:
            continue
            
        base_path = folder_map[source_folder]
        plain_text = re.sub(r'<[^>]+>', '', text_content).strip()
        
        # If it's standalone (mostly just emoji chars inside A tags)
        if len(plain_text) <= 5:
            match = link_pattern.search(text_content)
            if match:
                href = match.group(2)
                
                # Check media type
                media_type = 'video'
                if 'stickers/' in href or 'stickers\\' in href: media_type = 'sticker'
                elif 'animations/' in href or 'animations\\' in href or 'video_files/' in href or 'video_files\\' in href or 'animated_stickers/' in href or 'animated_stickers\\' in href: media_type = 'gif'
                
                if media_type:
                    if href.startswith('http') or ':\\' in href or ':/' in href:
                        abs_path = href # Already patched by previous run
                    else:
                        clean_href = href.replace('/', '\\')
                        abs_path = os.path.join(base_path, clean_href)
                        
                    updates.append((media_type, abs_path, row_id))

            
    print(f"Updating {len(updates)} messages with standalone media classifications...")
    if updates:
        c.execute("BEGIN TRANSACTION")
        c.executemany("UPDATE messages SET media_type = ?, media_path = ? WHERE id = ?", updates)
        conn.commit()
        print("Success!")
    else:
        print("No messages needed updating.")

        
if __name__ == "__main__":
    fix_emoji_links()
