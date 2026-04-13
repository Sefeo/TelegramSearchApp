import os
import sqlite3
import re
import argparse
from datetime import datetime
from selectolax.lexbor import LexborHTMLParser
from tinytag import TinyTag
import json
import sys
import concurrent.futures
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
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

# Pre-compile regexes for performance optimization
DATE_RE = re.compile(r'\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}')
MESSAGE_ID_RE = re.compile(r'message\d+')
POLL_VOTE_RE = re.compile(r'(\d+)')
MAPS_COORD_RE = re.compile(r'q=([\d\.,-]+)')
SYS_DATE_PILL_RE = re.compile(r'^\d{1,2} [A-Z][a-z]+ \d{4}$')

def setup_database(db_path):
    db_dir = os.path.dirname(os.path.abspath(db_path))
    os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA synchronous=NORMAL")
    c.execute("PRAGMA cache_size=-128000")
    c.execute("PRAGMA temp_store=MEMORY")
    c.execute("PRAGMA mmap_size=268435456")
    c.execute('''CREATE TABLE IF NOT EXISTS messages 
                 (id INTEGER PRIMARY KEY AUTOINCREMENT, 
                  source_folder TEXT, file_name TEXT, 
                  sender TEXT, timestamp DATETIME, 
                  text_content TEXT, media_path TEXT, media_type TEXT,
                  tg_id TEXT, reply_to_tg_id TEXT, reply_to_id INTEGER,
                  forwarded_from TEXT, forwarded_date TEXT,
                  is_pinned INTEGER DEFAULT 0,
                  waveform TEXT, duration INTEGER,
                  reactions TEXT)''')
    c.execute("CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_messages_media_type ON messages(media_type)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_messages_is_pinned ON messages(is_pinned)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_messages_tg_id ON messages(tg_id)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_messages_reply_to_tg_id ON messages(reply_to_tg_id)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_messages_source_file ON messages(source_folder, file_name)")
    conn.commit()
    return conn

def get_inner_html(node):
    if not node: return ""
    return "".join([n.html if n.html else n.text() for n in node.iter(include_text=True)])

def get_name_text(node):
    """
    Extracts sender/forwarder names while excluding timestamp spans.
    Handles names inside <a> tags correctly.
    """
    if not node: return ""
    texts = []
    for n in node.iter(include_text=True):
        if n.tag == '-text':
            texts.append(n.text())
        else:
            # Skip only the date spans to prevent timestamps from being merged into names
            classes = (n.attributes.get('class') or '').split()
            if n.tag == 'span' and 'date' in classes:
                continue
            # Recursively get text for other child tags (like <a> for names)
            texts.append(n.text(deep=True))
    return "".join(texts).strip()

def parse_single_file(task):
    file_path, folder_path, folder_name, file_name = task
    normal_msgs_batch = []
    sys_msgs_batch = []
    pinned_tg_ids = set()
    last_timestamp = "1970-01-01 00:00:00"
    current_sender = "Unknown"

    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            content = f.read()
            parser = LexborHTMLParser(content)
            for msg in parser.css('div[class*="message"]'):
                classes = (msg.attributes.get('class', '') or '').split()
                date_node = msg.css_first('div[title*="20"]')
                if date_node:
                    title = date_node.attributes.get('title', '')
                    match = DATE_RE.search(title)
                    if match:
                        try: last_timestamp = datetime.strptime(match.group(0), "%d.%m.%Y %H:%M:%S").strftime("%Y-%m-%d %H:%M:%S")
                        except: pass
                msg_date = last_timestamp

                if 'default' in classes:
                    sender_node = msg.css_first('div.from_name')
                    if sender_node:
                        # Fixed: use get_name_text to exclude date spans from name
                        current_sender = get_name_text(sender_node)
                    
                    tg_id = msg.attributes.get('id')
                    reply_to_tg_id = None
                    reply_node = msg.css_first('div.reply_to')
                    if reply_node:
                        a_tag = reply_node.css_first('a')
                        if a_tag:
                            href = a_tag.attributes.get('href', '')
                            if 'go_to_message' in href:
                                match = MESSAGE_ID_RE.search(href)
                                if match: reply_to_tg_id = match.group(0)

                    forwarded_from = None
                    forwarded_date = None
                    fwd_node = msg.css_first('div.forwarded.body')
                    if fwd_node:
                        fwd_name_node = fwd_node.css_first('div.from_name')
                        if fwd_name_node:
                            # Fixed: use same logic for forwarded names
                            forwarded_from = get_name_text(fwd_name_node)
                            fwd_date_span = fwd_name_node.css_first('span.date')
                            if fwd_date_span:
                                forwarded_date = fwd_date_span.attributes.get('title') or fwd_date_span.text(strip=True)

                    text_content = ""
                    text_node = msg.css_first('div.text')
                    if text_node: text_content = get_inner_html(text_node).strip()

                    media_path = None
                    media_type = None
                    duration = None

                    contact_node = msg.css_first('div.media_contact')
                    call_node = msg.css_first('div.media_call')
                    sticker_node = msg.css_first('img.sticker')
                    poll_node = msg.css_first('div.media_poll')
                    location_node = msg.css_first('a.media_location')

                    if poll_node:
                        q_node = poll_node.css_first('div.question')
                        question = q_node.text(strip=True) if q_node else "Unknown"
                        t_node = poll_node.css_first('div.total')
                        total_count = t_node.text(strip=True) if t_node else "0"
                        options = []
                        for ans in poll_node.css('div.answer'):
                            details_node = ans.css_first('span.details')
                            vote_info = details_node.text(strip=True) if details_node else "0"
                            ans_text = ans.text(deep=False, strip=True).replace('-', '', 1).strip()
                            match = POLL_VOTE_RE.search(vote_info)
                            count = int(match.group(1)) if match else 0
                            options.append({"text": ans_text, "count": count, "chosen": "chosen" in vote_info})
                        media_type = 'poll'
                        text_content = json.dumps({"question": question, "total": total_count, "options": options})
                    elif location_node:
                        href = location_node.attributes.get('href', '')
                        coords = "Unknown"
                        match = MAPS_COORD_RE.search(href)
                        if match: coords = match.group(1)
                        media_type = 'location'
                        text_content = f"{coords}|{href}"
                    elif contact_node:
                        title_n = contact_node.css_first('div.title')
                        n = title_n.text(strip=True) if title_n else "Unknown"
                        status_p = contact_node.css_first('div.status')
                        p = status_p.text(strip=True) if status_p else ""
                        media_type = 'contact'
                        text_content = f"{n}|{p}"
                    elif call_node:
                        t = call_node.css_first('div.title').text(strip=True) if call_node.css_first('div.title') else "Call"
                        s = call_node.css_first('div.status').text(strip=True) if call_node.css_first('div.status') else ""
                        media_type = 'call'
                        text_content = f"{t}|{s}|{'success' in call_node.attributes.get('class', '').split()}"
                    elif sticker_node and 'src' in sticker_node.attributes:
                        media_path = os.path.abspath(os.path.join(folder_path, sticker_node.attributes['src']))
                        media_type = 'sticker'
                    else:
                        for link in msg.css('a[href]'):
                            href = html.unescape(link.attributes['href'])
                            classes = (link.attributes.get('class', '') or '').split()
                            title_node = link.css_first('div.title')
                            title_text = title_node.text(strip=True) if title_node else ""
                            status_node = link.css_first('div.status')
                            status_text = status_node.text(strip=True) if status_node else ""
                            if href.startswith('photos/'): media_type = 'photo'
                            elif href.startswith('voice_messages/'): media_type = 'voice'
                            elif href.startswith('round_video_messages/'): media_type = 'round_video'
                            elif href.startswith('files/'): media_type = 'file'
                            elif href.startswith('video_files/') or 'media_video' in classes or 'animated_wrap' in classes:
                                is_anim = ("Animation" in title_text or "Animation" in status_text or "GIF" in link.text(strip=True) or href.startswith(('animated_stickers/', 'animations/')) or any(kw in href.lower() for kw in ['sticker', 'anim', 'result.mp4']) or 'animated_wrap' in classes or link.css_first('div.gif_play') is not None)
                                media_type = 'gif' if is_anim and not href.startswith('round_video_messages/') else 'video'
                            if media_type:
                                media_path = os.path.abspath(os.path.join(folder_path, href))
                                break 
                    
                    reactions_json = None
                    reactions_node = msg.css_first('span.reactions')
                    if reactions_node:
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
                                
                            if count == 0 and not users: count = 1
                            reactions.append({"emoji": emoji_text, "path": emoji_path, "count": count, "users": users})
                        
                        if reactions:
                            reactions_json = json.dumps(reactions)

                    normal_msgs_batch.append((folder_name, file_name, current_sender, msg_date, text_content, media_path, media_type, tg_id, reply_to_tg_id, forwarded_from, forwarded_date, duration, reactions_json))

                elif 'service' in classes:
                    body_node = msg.css_first('div.body.details')
                    if body_node:
                        text = body_node.text(strip=True)
                        userpic_node = msg.css_first('img.userpic')
                        if userpic_node and 'src' in userpic_node.attributes:
                            media_path = os.path.abspath(os.path.join(folder_path, userpic_node.attributes['src']))
                            media_type = 'service_photo'
                        if not SYS_DATE_PILL_RE.match(text):
                            if " pinned " in text or text.strip().endswith(" pinned"):
                                a_tag = body_node.css_first('a')
                                if a_tag:
                                    href = a_tag.attributes.get('href', '')
                                    if 'go_to_message' in href:
                                        match = MESSAGE_ID_RE.search(href)
                                        if match: pinned_tg_ids.add(match.group(0))
                            sys_msgs_batch.append((folder_name, file_name, "System", msg_date, text, 'service', 'Forwarded Information'))
    except Exception as e: print(f"Error parsing {file_name}: {e}")
    return normal_msgs_batch, sys_msgs_batch, pinned_tg_ids, file_name

def duration_worker(media_info):
    m_path, m_type = media_info
    if not m_path or not os.path.exists(m_path): return None
    try:
        t = TinyTag.get(m_path)
        if t.duration: return max(1, int(round(t.duration)))
    except: pass
    if cv2 and m_type in ['video', 'round_video', 'gif']:
        try:
            cap = cv2.VideoCapture(m_path)
            if cap.isOpened():
                fps, frames = cap.get(cv2.CAP_PROP_FPS), cap.get(cv2.CAP_PROP_FRAME_COUNT)
                cap.release()
                if fps > 0: return max(1, int(round(frames / fps)))
        except: pass
    return None

def parse_folder(conn, folder_path, folder_name):
    print(f"\nScanning: {folder_path}"); files = [f for f in os.listdir(folder_path) if f.startswith('messages') and f.endswith('.html')]
    files.sort(key=lambda x: int(re.search(r'messages(\d+)\.html', x).group(1)) if re.search(r'messages(\d+)\.html', x) else 0)
    total = 0; pinned_ids = set(); c = conn.cursor(); cpu = min(len(files), os.cpu_count() or 4)
    tasks = [(os.path.join(folder_path, f), folder_path, folder_name, f) for f in files]
    print(f"  Pipelining {len(files)} files via {cpu} workers...")
    with ProcessPoolExecutor(max_workers=cpu) as p_pool, ThreadPoolExecutor(max_workers=12) as d_pool:
        futures = {p_pool.submit(parse_single_file, t): t for t in tasks}
        for f in concurrent.futures.as_completed(futures):
            norm, sys, p, fname = f.result(); pinned_ids.update(p)
            needs_dur = [i for i, m in enumerate(norm) if m[6] in ['video', 'gif', 'voice', 'round_video', 'audio']]
            if needs_dur:
                df = [d_pool.submit(duration_worker, (norm[i][5], norm[i][6])) for i in needs_dur]
                r = [list(m) for m in norm]
                for idx, res in zip(needs_dur, df): r[idx][11] = res.result()
                norm = [tuple(m) for m in r]
            if norm: c.executemany("INSERT INTO messages (source_folder, file_name, sender, timestamp, text_content, media_path, media_type, tg_id, reply_to_tg_id, forwarded_from, forwarded_date, duration, reactions) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", norm)
            if sys: c.executemany("INSERT INTO messages (source_folder, file_name, sender, timestamp, text_content, media_type, forwarded_from) VALUES (?,?,?,?,?,?,?)", sys)
            total += len(norm) + len(sys); print(f"    √ {fname} ({len(norm)+len(sys)})")
    c.execute("UPDATE messages SET reply_to_id = (SELECT id FROM messages m2 WHERE m2.tg_id = messages.reply_to_tg_id) WHERE source_folder = ? AND reply_to_tg_id IS NOT NULL AND reply_to_id IS NULL", (folder_name,))
    if pinned_ids:
        p_list = list(pinned_ids)
        for i in range(0, len(p_list), 900): c.execute(f"UPDATE messages SET is_pinned = 1 WHERE tg_id IN ({','.join(['?']*len(p_list[i:i+900]))})", p_list[i:i+900])
    conn.commit(); return total

def generate_thumbnail_worker(task):
    msg_id, media_path, thumb_dir = task
    if not media_path or not os.path.exists(media_path): return False
    out = os.path.join(thumb_dir, f"{msg_id}.jpg")
    if os.path.exists(out): return True
    try:
        cap = cv2.VideoCapture(media_path)
        if not cap.isOpened(): return False
        cap.set(cv2.CAP_PROP_POS_MSEC, 100); success, frame = cap.read()
        if not success: cap.set(cv2.CAP_PROP_POS_FRAMES, 0); success, frame = cap.read()
        if success: cv2.imwrite(out, frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
        cap.release(); return success
    except: return False

def generate_thumbnails(db_path):
    thumb_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "thumbnails"); os.makedirs(thumb_dir, exist_ok=True)
    conn = sqlite3.connect(db_path); rows = conn.execute("SELECT id, media_path FROM messages WHERE media_type IN ('video', 'round_video') AND media_path IS NOT NULL").fetchall(); conn.close()
    to_p = [r for r in rows if not os.path.exists(os.path.join(thumb_dir, f"{r[0]}.jpg"))]
    if not to_p: return
    print(f"\n[Thumbnailing] {len(to_p)} previews..."); tasks = [(r[0], r[1], thumb_dir) for r in to_p]
    with ThreadPoolExecutor(max_workers=min(os.cpu_count() or 4, 12)) as pool:
        f = {pool.submit(generate_thumbnail_worker, t): t for t in tasks}
        for i, _ in enumerate(concurrent.futures.as_completed(f)):
            if (i+1)%100==0 or (i+1)==len(tasks): print(f"      Progress: {i+1}/{len(tasks)} ({(i+1)/len(tasks)*100:.1f}%)")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(); parser.add_argument("--input"); parser.add_argument("--db", default=DEFAULT_DB_NAME); parser.add_argument("--reset", action="store_true"); parser.add_argument("--no-thumbnails", action="store_true"); args = parser.parse_args()
    if args.reset and os.path.exists(args.db): os.remove(args.db)
    if not args.reset and os.path.exists(args.db):
        conn = sqlite3.connect(args.db)
        try:
            if conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0] > 0: print("[!] DB exists. Use --reset."); sys.exit(1)
        except: pass
        finally: conn.close()
    target = []; 
    if args.input: 
        if os.path.exists(os.path.join(args.input, "messages.html")): target.append(args.input)
        else: sys.exit(1)
    else:
        while True:
            p = input("Path: ").strip().strip('"').strip("'")
            if not p and target: break
            if os.path.exists(os.path.join(p, "messages.html")): target.append(p); print(f"Added: {p}")
            if input("Add another? (y/n): ").lower() != 'y': break
    db = setup_database(args.db); total = 0; start = time.time()
    for i, f in enumerate(target): total += parse_folder(db, f, os.path.basename(f) if i == 0 else f"Linked_{i}")
    db.close(); print(f"\nSuccess! Indexed {total} in {time.time()-start:.2f}s.")
    if not args.no_thumbnails and cv2: generate_thumbnails(args.db)