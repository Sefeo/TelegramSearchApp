import sqlite3
import os
import json
import concurrent.futures
import time
from tqdm import tqdm
from selectolax.lexbor import LexborHTMLParser

DB_PATH = 'chat_history.db'

def process_file(args):
    folder_path, file_name = args
    full_path = os.path.join(folder_path, file_name)
    if not os.path.exists(full_path):
        return []
    
    try:
        with open(full_path, 'r', encoding='utf-8') as f:
            html = f.read()
    except Exception as e:
        return []

    parser = LexborHTMLParser(html)
    updates = []
    
    # We only care about default messages that have reactions
    for msg in parser.css('div.message.default'):
        reactions_node = msg.css_first('span.reactions')
        if not reactions_node:
            continue
            
        tg_id = msg.attributes.get('id')
        if not tg_id:
            continue
            
        reactions = []
        for reaction in reactions_node.css('span.reaction'):
            emoji_node = reaction.css_first('span.emoji')
            emoji_text = ""
            emoji_path = None
            
            if emoji_node:
                a_tag = emoji_node.css_first('a')
                if a_tag and 'href' in a_tag.attributes:
                    emoji_path = os.path.abspath(os.path.join(folder_path, a_tag.attributes['href']))
                emoji_text = emoji_node.text(strip=True)
                
            users = []
            userpics_node = reaction.css_first('span.userpics')
            if userpics_node:
                for initial_node in userpics_node.css('div.initials'):
                    t = initial_node.attributes.get('title')
                    if t: users.append(t)
                    
            count_node = reaction.css_first('span.count')
            count = len(users)
            if count_node:
                try: count = int(count_node.text(strip=True))
                except: pass
                
            if count == 0 and not users: 
                count = 1
                
            reactions.append({"emoji": emoji_text, "path": emoji_path, "count": count, "users": users})
            
        if reactions:
            reactions_json = json.dumps(reactions)
            updates.append((reactions_json, folder_path, file_name, tg_id))
            
    return updates

def main():
    if not os.path.exists(DB_PATH):
        print(f"Error: Database {DB_PATH} not found.")
        return

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    try:
        c.execute("ALTER TABLE messages ADD COLUMN reactions TEXT")
        conn.commit()
        print("✅ Added 'reactions' column to database.")
    except Exception:
        pass # Column likely exists

    print("Fetching distinct HTML files from DB...")
    c.execute("SELECT DISTINCT source_folder, file_name FROM messages WHERE source_folder IS NOT NULL AND file_name IS NOT NULL")
    files_to_process = c.fetchall()
    
    print(f"Found {len(files_to_process)} unique HTML files to scan for reactions.")
    
    total_updates = []
    start_time = time.time()
    
    print("Parsing HTML files asynchronously...")
    # Multiprocess worker pool
    with concurrent.futures.ProcessPoolExecutor() as executor:
        # TQDM progress bar for tracking
        results = list(tqdm(executor.map(process_file, files_to_process), total=len(files_to_process)))
        
    for res in results:
        total_updates.extend(res)

    print(f"\nParsing complete in {time.time() - start_time:.2f}s.")
    print(f"Found {len(total_updates)} messages with reactions to update.")
    
    if total_updates:
        print("Inserting into database (Batch Update)...")
        # Batch update logic
        c.execute("BEGIN TRANSACTION")
        # Using fast executemany for updates
        c.executemany("UPDATE messages SET reactions = ? WHERE source_folder = ? AND file_name = ? AND tg_id = ?", total_updates)
        conn.commit()
        print("✅ Database updated successfully.")
    else:
        print("No reactions found to update.")

    conn.close()

if __name__ == "__main__":
    main()
