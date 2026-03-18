from __future__ import annotations
from flask import Flask, request, jsonify, render_template, send_file
import sqlite3
import os
import re
import platform
import subprocess
import random
import webbrowser
import gzip
import io
import json
import traceback
import argparse
from datetime import datetime
from threading import Timer
from typing import Any, Optional, Union, Dict, List, Set, Tuple, cast

# Setup paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB_NAME = os.path.join(BASE_DIR, "chat_history.db")

# This will be overridden by argparse if provided
DB_NAME = DEFAULT_DB_NAME

app = Flask(__name__, static_folder=os.path.join(BASE_DIR, "static"), static_url_path='/static')

# In-memory cache for pulse_raw (invalidated on server restart)
_pulse_raw_cache = None

@app.after_request
def gzip_response(response):
    """Compress JSON responses with gzip if the client supports it."""
    if (
        response.content_type
        and 'application/json' in response.content_type
        and response.status_code == 200
        and 'gzip' in request.headers.get('Accept-Encoding', '')
        and len(response.get_data()) > 1024  # Only compress if > 1KB
    ):
        buf = io.BytesIO()
        with gzip.GzipFile(fileobj=buf, mode='wb', compresslevel=6) as gz:
            gz.write(response.get_data())
        response.set_data(buf.getvalue())
        response.headers['Content-Encoding'] = 'gzip'
        response.headers['Content-Length'] = len(response.get_data())
    return response

def dict_factory(cursor, row):
    d = {}
    for idx, col in enumerate(cursor.description):
        d[col[0]] = row[idx]
    return d
   
def clean_sender_name(name):
    # This removes the " DD.MM.YYYY HH:MM:SS" from the end of the string
    return re.sub(r'\s+\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}:\d{2}$', '', name)
 
@app.route('/')
def home():
    return render_template('index.html')

@app.route('/media')
def serve_media():
    path = request.args.get('path')
    if path and os.path.exists(path):
        return send_file(path)
    return "File not found", 404

@app.route('/api/messages', methods=['GET'])
def get_messages():
    before_id = request.args.get('before_id', type=int)
    after_id = request.args.get('after_id', type=int)
    around_id = request.args.get('around_id', type=int)
    limit = 100
    
    # We define a helper to do the join AFTER filtering, which is magnitudes faster
    def get_joined_query(where_clause, order_clause, limit_clause):
        return f'''
            SELECT m.*, 
                   r.sender as reply_sender, 
                   r.text_content as reply_text, 
                   r.media_type as reply_media_type, 
                   r.media_path as reply_media_path 
            FROM (
                SELECT * FROM messages 
                {where_clause} 
                {order_clause} 
                {limit_clause}
            ) m
            LEFT JOIN messages r ON m.reply_to_id = r.id
        '''

    try:
        conn = sqlite3.connect(DB_NAME)
        conn.row_factory = dict_factory
        c = conn.cursor()

        if around_id:
            # Context Jump: Find message by ID, then get surrounding messages based on TIME
            c.execute("SELECT timestamp FROM messages WHERE id=?", (around_id,))
            row = c.fetchone()
            if row:
                ts = row['timestamp']
                query_before = get_joined_query("WHERE timestamp <= ?", "ORDER BY timestamp DESC", "LIMIT 25")
                query_after = get_joined_query("WHERE timestamp > ?", "ORDER BY timestamp ASC", "LIMIT 25")
                c.execute(f'''
                    SELECT * FROM ({query_before})
                    UNION 
                    SELECT * FROM ({query_after})
                    ORDER BY timestamp ASC
                ''', (ts, ts))
                results = c.fetchall()
            else:
                results = []

        elif before_id is not None:
            # Scroll UP: Get older messages based on timestamp of current top message
            c.execute("SELECT timestamp FROM messages WHERE id=?", (before_id,))
            row = c.fetchone()
            if row:
                ts = row['timestamp']
                c.execute(get_joined_query("WHERE timestamp < ?", "ORDER BY timestamp DESC", "LIMIT ?"), (ts, limit))
                # Use Any cast to bypass broken type checker slicing support for list
                results = cast(Any, c.fetchall())[::-1] 
            else:
                results = []

        elif after_id is not None:
            # Scroll DOWN: Get newer messages based on timestamp of current bottom message
            c.execute("SELECT timestamp FROM messages WHERE id=?", (after_id,))
            row = c.fetchone()
            if row:
                ts = row['timestamp']
                c.execute(get_joined_query("WHERE timestamp > ?", "ORDER BY timestamp ASC", "LIMIT ?"), (ts, limit))
                results = c.fetchall()
            else:
                results = []

        else:
            # Initial Load: Get the very latest messages
            c.execute(get_joined_query("", "ORDER BY timestamp DESC", "LIMIT ?"), (limit,))
            results = cast(Any, c.fetchall())[::-1]

        conn.close()
        return jsonify(results)
    except Exception as e:
        print(e)
        return jsonify({"error": str(e)}), 500

@app.route('/api/jump_date', methods=['GET'])
def jump_date():
    date_str = request.args.get('date', '').strip()
    try:
        conn = sqlite3.connect(DB_NAME)
        conn.row_factory = dict_factory
        c = conn.cursor()
        # Find the first message that happened on or after 00:00 of that day
        c.execute("SELECT id FROM messages WHERE timestamp >= ? ORDER BY timestamp ASC LIMIT 1", (date_str + " 00:00:00",))
        row = c.fetchone()
        conn.close()
        if row:
            return jsonify({"id": row['id']})
        return jsonify({"error": "No messages found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500
        
@app.route('/api/senders', methods=['GET'])
def get_senders():
    try:
        conn = sqlite3.connect(DB_NAME)
        c = conn.cursor()
        c.execute("SELECT sender FROM messages WHERE sender IS NOT NULL AND sender != ''")
        rows = c.fetchall()
        conn.close()
        
        counts = {}
        for row in rows:
            original_name = row[0]
            # Strip the timestamp to group the same person together
            cleaned = clean_sender_name(original_name)
            if cleaned == 'System': continue
            counts[cleaned] = counts.get(cleaned, 0) + 1
            
        # Sort by message count in descending order (main talkers go to top)
        sorted_senders = sorted(counts.items(), key=lambda x: x[1], reverse=True)
        
        # Return as a list of dictionaries
        return jsonify([{"name": k, "count": v} for k, v in sorted_senders])
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/search', methods=['GET'])
def search():
    keyword = request.args.get('q', '').strip()
    sender_param = request.args.get('sender', '').strip()
    start_date = request.args.get('start', '').strip()
    end_date = request.args.get('end', '').strip()
    
    base_where = "WHERE 1=1"
    params = []

    if keyword:
        base_where += " AND text_content LIKE ?"
        params.append(f"%{keyword}%")
    
    if sender_param:
        senders = [s.strip() for s in sender_param.split(',')]
        sender_clauses = []
        for s in senders:
            # Match EXACT name OR name followed by a space (to catch the ones with timestamps)
            sender_clauses.append("(sender = ? OR sender LIKE ?)")
            params.extend([s, f"{s} %"])
        
        base_where += " AND (" + " OR ".join(sender_clauses) + ")"

    if start_date:
        base_where += " AND timestamp >= ?"
        params.append(start_date + " 00:00:00")
    if end_date:
        base_where += " AND timestamp <= ?"
        params.append(end_date + " 23:59:59")

    query = f'''
        SELECT m.*, 
               r.sender as reply_sender, 
               r.text_content as reply_text, 
               r.media_type as reply_media_type, 
               r.media_path as reply_media_path 
        FROM (
            SELECT * FROM messages 
            {base_where}
            ORDER BY timestamp DESC LIMIT 200
        ) m 
        LEFT JOIN messages r ON m.reply_to_id = r.id
        ORDER BY m.timestamp DESC
    '''

    try:
        conn = sqlite3.connect(DB_NAME)
        conn.row_factory = dict_factory
        c = conn.cursor()
        c.execute(query, params)
        results = c.fetchall()
        conn.close()
        return jsonify(results)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
        
@app.route('/api/open_file', methods=['POST'])
def open_file():
    data = request.json
    path = data.get('path')
    if not path or not os.path.exists(path):
        return jsonify({"error": "File not found"}), 404
    
    abs_path = os.path.abspath(path)
    
    try:
        if platform.system() == "Windows":
            # Opens Explorer and highlights the specific file
            subprocess.run(['explorer', '/select,', abs_path])
        elif platform.system() == "Darwin": 
            # macOS: Opens Finder and highlights the file
            subprocess.run(['open', '-R', abs_path])
        else: 
            # Linux: Opens the directory containing the file
            subprocess.run(['xdg-open', os.path.dirname(abs_path)])
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500  
        
        
def format_size(size):
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size < 1024: return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"

@app.route('/api/media_stats', methods=['GET'])
def media_stats():
    try:
        conn = sqlite3.connect(DB_NAME)
        c = conn.cursor()
        c.execute("SELECT media_type, COUNT(*) FROM messages WHERE media_type IS NOT NULL GROUP BY media_type")
        types = dict(c.fetchall())
        
        c.execute("SELECT COUNT(*) FROM messages WHERE text_content LIKE '%http%'")
        links_count = c.fetchone()[0]
        conn.close()
        
        return jsonify({
            "photo": types.get('photo', 0),
            "video": types.get('video', 0),
            "file": types.get('file', 0) + types.get('audio', 0),
            "voice": types.get('voice', 0) + types.get('round_video', 0),
            "gif": types.get('gif', 0),
            "link": links_count
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/media_list', methods=['GET'])
def media_list():
    mtype = request.args.get('type', 'photo')
    before_id = request.args.get('before_id', type=int)
    
    try:
        conn = sqlite3.connect(DB_NAME)
        conn.row_factory = dict_factory
        c = conn.cursor()
        
        query = "SELECT * FROM messages WHERE "
        params =[]
        
        if mtype == 'link':
            query += "text_content LIKE '%http%'"
        elif mtype == 'voice':
            query += "media_type IN ('voice', 'round_video')"
        elif mtype == 'file':
            query += "(media_type IN ('file', 'audio') OR media_path LIKE '%.mp3')"
        else:
            query += "media_type = ?"
            params.append(mtype)
            
        if before_id:
            query += " AND timestamp < (SELECT timestamp FROM messages WHERE id=?)"
            params.append(before_id)
            
        # Limit to 50 items per scroll chunk
        query += " ORDER BY timestamp DESC LIMIT 50"
        
        c.execute(query, params)
        results = c.fetchall()
        conn.close()
        
        if mtype == 'file':
            for r in results:
                if r['media_path'] and os.path.exists(r['media_path']):
                    r['file_size'] = format_size(os.path.getsize(r['media_path']))
                else:
                    r['file_size'] = "Unknown"
        return jsonify(results)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
        
@app.route('/api/save_waveform', methods=['POST'])
def save_waveform():
    data = request.json
    msg_id = data.get('id')
    waveform = data.get('waveform')
    if not msg_id or not waveform:
        return jsonify({"error": "Missing data"}), 400
    try:
        conn = sqlite3.connect(DB_NAME)
        c = conn.cursor()
        c.execute("UPDATE messages SET waveform = ? WHERE id = ?", (waveform, msg_id))
        conn.commit()
        conn.close()
        return jsonify({"success": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

def upgrade_db():
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    try:
        c.execute("ALTER TABLE messages ADD COLUMN waveform TEXT")
        print("[DB] Upgraded database: Added 'waveform' column.")
    except Exception:
        pass # Column already exists
        
    try:
        c.execute("CREATE TABLE IF NOT EXISTS statistics_cache (cache_key TEXT PRIMARY KEY, cache_value TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)")
        c.execute("CREATE TABLE IF NOT EXISTS media_sizes_cache (media_path TEXT PRIMARY KEY, size INTEGER)")
        
        c.execute("CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_messages_media_type ON messages(media_type)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_messages_is_pinned ON messages(is_pinned)")
        print("[DB] Upgraded database: Ensured performance indexes and cache tables exist.")
        
        # Pre-populate media sizes cache for stickers and GIFs
        c.execute("SELECT id, media_path FROM messages WHERE media_type IN ('sticker', 'gif') AND media_path IS NOT NULL")
        media_rows = c.fetchall()
        
        # Check existing cache
        c.execute("SELECT media_path FROM media_sizes_cache")
        cached_paths = set(row[0] for row in c.fetchall())
        
        inserts = []
        for msg_id, path_raw in media_rows:
            path: str = cast(str, path_raw)
            if path not in cached_paths:
                if os.path.exists(path):
                    try:
                        size = os.path.getsize(path)
                        inserts.append((path, size))
                    except:
                        pass
        
        if inserts:
            print(f"[DB] Caching {len(inserts)} media file sizes...")
            c.executemany("INSERT OR IGNORE INTO media_sizes_cache (media_path, size) VALUES (?, ?)", inserts)
            print("[DB] Media sizing complete.")
            
    except Exception as e:
        print(f"[DB] Index/Cache creation error: {e}")
        
    conn.commit()
    conn.close()
        
@app.route('/api/missing_waveforms', methods=['GET'])
def missing_waveforms():
    force = request.args.get('force') == 'true'
    try:
        conn = sqlite3.connect(DB_NAME)
        conn.row_factory = dict_factory
        c = conn.cursor()
        
        query = "SELECT id, media_path FROM messages WHERE (media_type = 'voice' OR media_path LIKE '%.mp3')"
        
        # If NOT forcing, only get the ones missing a waveform
        if not force:
            query += " AND waveform IS NULL"
            
        c.execute(query)
        results = c.fetchall()
        conn.close()
        return jsonify(results)
    except Exception as e:
        return jsonify({"error": str(e)}), 500
        
AVATAR_DIR = os.path.join(BASE_DIR, "static", "avatars")
if not os.path.exists(AVATAR_DIR):
    os.makedirs(AVATAR_DIR)

def get_color_for_name(name):
    colors = ['#e17076', '#7bc862', '#65aadd', '#a695e7', '#ee7aae', '#6ec9cb', '#faa774']
    # Use hash so the color is consistent for the same user
    return colors[abs(hash(name)) % len(colors)]

@app.route('/avatar/<sender>')
def get_avatar(sender: str):
    # 1. Clean filename properly for Windows/all OS
    # Replace anything that's not alphanumeric, space, dot, comma, dash, underscore
    safe_sender: str = re.sub(r'[^\w\s\.,-]', '_', sender).strip()
    if not safe_sender:
        safe_sender = "unknown"
    
    # 2. Check for existing custom images
    for ext in ['.jpg', '.jpeg', '.png', '.webp', '.svg']:
        full_path: str = os.path.join(AVATAR_DIR, f"{safe_sender}{ext}")
        if os.path.exists(full_path):
            return send_file(full_path)
            
    # 3. If missing, generate a default SVG and save it
    initial = sender[0].upper() if (sender and len(sender) > 0) else "?"
    color = get_color_for_name(sender)
    
    svg_content = f'''
    <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
      <rect width="100" height="100" fill="{color}" rx="50" />
      <text x="50" y="55" font-family="Arial, sans-serif" font-size="50" fill="white" text-anchor="middle" dominant-baseline="middle">{initial}</text>
    </svg>
    '''
    
    svg_path = os.path.join(AVATAR_DIR, safe_sender + ".svg")
    try:
        with open(svg_path, "w", encoding="utf-8") as f:
            f.write(svg_content)
    except Exception as e:
        print(f"Failed to save avatar SVG for {sender}: {e}")
        
    return send_file(svg_path) if os.path.exists(svg_path) else "Error", 200
    
@app.route('/api/pinned', methods=['GET'])
def get_pinned():
    try:
        conn = sqlite3.connect(DB_NAME)
        conn.row_factory = dict_factory
        c = conn.cursor()
        # Fetch all pinned messages in chronological order
        c.execute('''SELECT id, sender, text_content, media_type, media_path, timestamp 
                     FROM messages WHERE is_pinned = 1 ORDER BY timestamp ASC''')
        results = c.fetchall()
        conn.close()
        return jsonify(results)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/api/pulse_raw', methods=['GET'])
def pulse_raw():
    """Return all messages with minimal columns for client-side pulse stats aggregation.
    Uses in-memory cache so subsequent requests skip the DB query entirely."""
    global _pulse_raw_cache
    
    if _pulse_raw_cache is not None:
        return jsonify(_pulse_raw_cache)
    
    try:
        conn = sqlite3.connect(DB_NAME)
        c = conn.cursor()
        
        # Get min/max dates first
        c.execute("SELECT MIN(timestamp), MAX(timestamp) FROM messages WHERE strftime('%Y', timestamp) > '1990'")
        min_ts, max_ts = c.fetchone()
        
        # Fetch all messages with only needed columns and join with size cache for stickers/gifs
        query = '''
            SELECT m.id, m.sender, m.timestamp, m.media_type, m.text_content, m.media_path, c.size 
            FROM messages m
            LEFT JOIN media_sizes_cache c ON m.media_path = c.media_path
            WHERE m.sender IS NOT NULL AND m.sender != ''
        '''
        c.execute(query)
        rows = c.fetchall()
        conn.close()
        
        # Pre-clean sender names server-side and build compact records
        messages = []
        for msg_id, sender, ts, media_type, text_content, media_path, size in rows:
            cleaned = clean_sender_name(sender) if sender else "Unknown"
            if cleaned == 'System':
                continue
            item = {
                'i': msg_id,         # id
                's': cleaned,         # sender (cleaned)
                't': ts[:19] if ts else None,              # timestamp
                'm': media_type,      # media_type (can be None)
                'x': text_content,    # text_content (can be None)
                'p': media_path       # media_path (can be None)
            }
            if size is not None:
                item['z'] = size      # Exact file size for exact matching
            messages.append(item)
        
        result = {'messages': messages}
        if min_ts and max_ts:
            result['min_date'] = min_ts[:10]
            result['max_date'] = max_ts[:10]
        
        # Cache in memory for subsequent requests
        _pulse_raw_cache = result
        
        return jsonify(result)
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/api/pulse_stats', methods=['GET'])
def pulse_stats():
    start_date = request.args.get('start_date', '').strip()
    end_date = request.args.get('end_date', '').strip()
    sender = request.args.get('sender', '').strip()
    
    base_where = "WHERE 1=1"
    params = []
    
    if start_date:
        base_where += " AND timestamp >= ?"
        params.append(start_date + " 00:00:00")
        
    if end_date:
        base_where += " AND timestamp <= ?"
        params.append(end_date + " 23:59:59")
        
    valid_senders: Optional[Set[str]] = None
    if sender and sender != 'all':
        senders = [s.strip() for s in sender.split(',')]
        sender_clauses = []
        for s in senders:
            sender_clauses.append("(sender = ? OR sender LIKE ?)")
            params.extend([s, f"{s} %"])
        
        base_where += " AND (" + " OR ".join(sender_clauses) + ")"
        valid_senders = set(senders)
        
    v_senders: Any = valid_senders
    stats: Dict[str, Any] = {
        'years': [],
        'min_date': None,
        'max_date': None,
        'circadian': {},
        'consistency': {},
        'media_dna': {},
        'sender_battle': [],
        'emojis': [],
        'words': [],
        'stickers': [],
        'gifs': []
    }
    try:
        conn = sqlite3.connect(DB_NAME)
        c = conn.cursor()
        
        # 1. Available Years (Ignore 1970 parsing failures)
        c.execute("SELECT MIN(strftime('%Y', timestamp)), MAX(strftime('%Y', timestamp)), MIN(timestamp), MAX(timestamp) FROM messages WHERE strftime('%Y', timestamp) > '1990'")
        min_y, max_y, min_ts, max_ts = c.fetchone()
        stats['years'] = [str(y) for y in range(int(min_y or 2015), int(max_y or datetime.now().year) + 1)] if min_y and max_y else []
        if min_ts and max_ts:
            stats['min_date'] = min_ts[:10]
            stats['max_date'] = max_ts[:10]
        
        # 2. Circadian Rhythm
        c.execute(f"SELECT strftime('%H', timestamp) as h, sender, COUNT(*) FROM messages {base_where} GROUP BY h, sender", params)
        hours = {str(i).zfill(2): {'total': 0, 'senders': {}} for i in range(24)}
        for row in c.fetchall():
            if not row[0]: continue
            h, s_raw, cnt = row[0], row[1], row[2]
            cleaned_s = clean_sender_name(s_raw) if s_raw else "Unknown"
            if cleaned_s == 'System': continue
            if v_senders is not None and cleaned_s not in v_senders: continue # type: ignore
            # Update circadian stats for this hour
            h_data = hours[h]
            h_data['total'] += cnt
            h_senders = h_data['senders']
            if isinstance(h_senders, dict):
                h_senders[cleaned_s] = h_senders.get(cleaned_s, 0) + cnt
        stats['circadian'] = hours
        
        # 3. Consistency Grid
        c.execute(f"SELECT date(timestamp) as d, COUNT(*) FROM messages {base_where} GROUP BY d", params)
        stats['consistency'] = dict(c.fetchall())
        
        # 4. Media DNA
        c.execute(f"SELECT media_type, sender, COUNT(*) FROM messages {base_where} AND media_type IS NOT NULL GROUP BY media_type, sender", params)
        media_counts: Dict[str, Any] = {'text': {'total': 0, 'senders': {}}}
        for row in c.fetchall():
            mtype, s_raw, cnt = row[0], row[1], row[2]
            cleaned_s = clean_sender_name(s_raw) if s_raw else "Unknown"
            if cleaned_s == 'System': continue
            if v_senders is not None and cleaned_s not in v_senders: continue # type: ignore
            if mtype not in media_counts: media_counts[mtype] = {'total': 0, 'senders': {}}
            m_data = media_counts[mtype]
            m_data['total'] += cnt
            m_senders = m_data['senders']
            if isinstance(m_senders, dict):
                m_senders[cleaned_s] = m_senders.get(cleaned_s, 0) + cnt
            
        c.execute(f"SELECT sender, COUNT(*) FROM messages {base_where} AND media_type IS NULL AND text_content IS NOT NULL AND text_content != '' GROUP BY sender", params)
        t_data = media_counts['text']
        for row in c.fetchall():
            s_raw, cnt = row[0], row[1]
            cleaned_s = clean_sender_name(s_raw) if s_raw else "Unknown"
            if cleaned_s == 'System': continue
            if v_senders is not None and cleaned_s not in v_senders: continue # type: ignore
            
            t_data['total'] += cnt
            t_senders = t_data['senders']
            if isinstance(t_senders, dict):
                t_senders[cleaned_s] = t_senders.get(cleaned_s, 0) + cnt
            
        stats['media_dna'] = media_counts
        
        # 5. Sender Battle
        c.execute(f"SELECT sender, COUNT(*) FROM messages {base_where} GROUP BY sender", params)
        sender_counts_raw = c.fetchall()
        sender_counts = {}
        for s, cnt in sender_counts_raw:
            cleaned = clean_sender_name(s) if s else "Unknown"
            if cleaned == 'System': continue
            if v_senders is not None and cleaned not in v_senders: continue # type: ignore
            sender_counts[cleaned] = sender_counts.get(cleaned, 0) + cnt
        stats['sender_battle'] = [{'name': k, 'count': v} for k, v in sorted(sender_counts.items(), key=lambda x:x[1], reverse=True)]
        
        # 6. Emojis and Words (Process all text to ensure consistent counts)
        c.execute(f"SELECT text_content, sender FROM messages {base_where} AND text_content IS NOT NULL AND text_content != ''", params)
        texts_data = [(row[0], row[1]) for row in c.fetchall() if row[0]]
        
        all_text = " ".join([t[0] for t in texts_data])
        
        # Regex for most standard emojis
        emoji_pattern = re.compile("[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF\U0001F680-\U0001F6FF\U0001F1E0-\U0001F1FF\U00002600-\U000026FF\U00002700-\U000027BF\U0001F900-\U0001F9FF\U0001FA70-\U0001FAFF]")
        
        v_emoji_map: Any = {}
        for text, s in texts_data:
            cleaned_s = clean_sender_name(s) if s else "Unknown"
            if cleaned_s == 'System': continue
            if v_senders is not None and cleaned_s not in v_senders: continue # type: ignore
            found_emojis = emoji_pattern.findall(text)
            for e in found_emojis:
                if e not in v_emoji_map:
                    v_emoji_map[e] = {'total': 0, 'senders': {}} # type: ignore
                
                e_data = v_emoji_map[e] # type: ignore
                e_data['total'] += 1
                e_senders = e_data['senders']
                if isinstance(e_senders, dict):
                    e_senders[cleaned_s] = e_senders.get(cleaned_s, 0) + 1
                
        sorted_emoji_items = sorted(v_emoji_map.items(), key=lambda x: int(x[1].get('total', 0)) if isinstance(x[1], dict) else 0, reverse=True)
        top_emojis = sorted_emoji_items[:10]  # type: ignore
        stats['emojis'] = [{'emoji': k, 'count': v['total'], 'senders': v['senders']} for k, v in top_emojis]
        
        # Find words >= 4 chars, ignoring links
        text_no_links = re.sub(r'http\S+|www\.\S+|<.*?>', '', all_text.lower())
        word_pattern = re.compile(r'\b[a-zA-Zа-яА-ЯіїєґІЇЄҐ]{4,}\b')
        words: List[Tuple[str, str]] = []
        for text, s in texts_data:
            cleaned_s = clean_sender_name(s) if s else "Unknown"
            if cleaned_s == 'System': continue
            if v_senders is not None and cleaned_s not in v_senders: continue # type: ignore
            clean_text = re.sub(r'http\S+|www\.\S+|<.*?>', '', text.lower())
            found_words = word_pattern.findall(clean_text)
            for w in found_words:
                words.append((cast(str, w), cleaned_s))
                
        stop_words = {'that', 'this', 'with', 'from', 'your', 'have', 'they', 'will', 'what', 'there', 'would', 'about', 'which', 'when', 'make', 'like', 'time', 'just', 'know', 'take', 'person', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'other', 'than', 'then', 'look', 'only', 'come', 'over', 'think', 'also', 'back', 'after', 'even', 'want', 'because', 'these', 'give', 'most', 'меня', 'тебя', 'тебе', 'мне', 'что', 'как', 'это', 'все', 'так', 'его', 'только', 'было', 'чтобы', 'если', 'уже', 'или', 'нет', 'еще', 'даже', 'быть', 'когда', 'нас', 'для', 'вот', 'вам', 'мы', 'ты', 'вы', 'он', 'она', 'они', 'оно', 'вас', 'их', 'нам', 'им', 'мной', 'тобой', 'нами', 'вами', 'ими', 'href'}
        
        v_word_counts: Any = {}
        for w, s in words:
            if w in stop_words or len(w) > 20: continue
            if w not in v_word_counts:
                v_word_counts[w] = {'total': 0, 'senders': {}}
                
            w_data = v_word_counts[w]
            if isinstance(w_data, dict):
                w_data['total'] = int(w_data.get('total', 0)) + 1
                w_senders = w_data.get('senders')
                if isinstance(w_senders, dict):
                    w_senders[s] = w_senders.get(s, 0) + 1
            
        # Fix: Split sorting and slicing to resolve indexing error
        sorted_word_items = sorted(v_word_counts.items(), key=lambda x: int(x[1].get('total', 0)) if isinstance(x[1], dict) else 0, reverse=True)
        top_words = sorted_word_items[:15]  # type: ignore
        stats['words'] = [{'word': k, 'count': v['total'], 'senders': v['senders']} for k, v in top_words]
        
        # 7. Sticker and GIF Fingerprints
        c.execute(f"SELECT id, media_path, sender FROM messages {base_where} AND media_type = 'sticker' AND media_path IS NOT NULL", params)
        sticker_rows = c.fetchall()
        
        # Check cache explicitly in Python since pulse_stats doesn't join with media_sizes_cache
        c.execute("SELECT media_path, size FROM media_sizes_cache")
        size_cache = {row[0]: row[1] for row in c.fetchall()}
        
        sticker_counts: Dict[int, Any] = {}
        for msg_id, path, s in sticker_rows:
            if not path: continue
            
            size = size_cache.get(path)
            if size is None:
                if not os.path.exists(path): continue
                try:
                    size = os.path.getsize(path)
                    # Opportunistically add to cache
                    c.execute("INSERT OR IGNORE INTO media_sizes_cache (media_path, size) VALUES (?, ?)", (path, size))
                    size_cache[path] = size
                except:
                    continue
                    
            cleaned_s = clean_sender_name(s) if s else "Unknown"
            if cleaned_s == 'System': continue
            if v_senders is not None and cleaned_s not in v_senders: continue # type: ignore
            if size not in sticker_counts:
                sticker_counts[size] = {'total': 0, 'senders': {}, 'path': path}
            
            s_data = sticker_counts[size]
            if isinstance(s_data, dict):
                s_data['total'] = int(s_data.get('total', 0)) + 1
                s_senders = s_data.get('senders')
                if isinstance(s_senders, dict):
                    s_senders[cleaned_s] = s_senders.get(cleaned_s, 0) + 1
            
        sorted_sticker_items = sorted(sticker_counts.values(), key=lambda x: int(x.get('total', 0)) if isinstance(x, dict) else 0, reverse=True)
        top_stickers = sorted_sticker_items[:10]  # type: ignore
        stats['stickers'] = []
        for v in top_stickers:
            name = os.path.basename(v['path'])
            stats['stickers'].append({'path': '/media?path=' + v['path'], 'name': name, 'count': v['total'], 'senders': v['senders']})
        
        c.execute(f"SELECT id, media_path, sender FROM messages {base_where} AND media_type = 'gif' AND media_path IS NOT NULL", params)
        gif_rows = c.fetchall()
        
        gif_counts: Dict[int, Any] = {}
        for msg_id, path, s in gif_rows:
            if not path: continue
            
            size = size_cache.get(path)
            if size is None:
                if not os.path.exists(path): continue
                try:
                    size = os.path.getsize(path)
                    c.execute("INSERT OR IGNORE INTO media_sizes_cache (media_path, size) VALUES (?, ?)", (path, size))
                    size_cache[path] = size
                except:
                    continue
                    
            cleaned_s = clean_sender_name(s) if s else "Unknown"
            if cleaned_s == 'System': continue
            if v_senders is not None and cleaned_s not in v_senders: continue # type: ignore
            if size not in gif_counts:
                gif_counts[size] = {'total': 0, 'senders': {}, 'path': path}
            
            g_data = gif_counts[size]
            if isinstance(g_data, dict):
                g_data['total'] = int(g_data.get('total', 0)) + 1
                g_senders = g_data.get('senders')
                if isinstance(g_senders, dict):
                    g_senders[cleaned_s] = g_senders.get(cleaned_s, 0) + 1
            
        sorted_gif_items = sorted(gif_counts.values(), key=lambda x: int(x.get('total', 0)) if isinstance(x, dict) else 0, reverse=True)
        top_gifs = sorted_gif_items[:10]  # type: ignore
        stats['gifs'] = []
        for v in top_gifs:
            name = os.path.basename(v['path'])
            stats['gifs'].append({'path': '/media?path=' + v['path'], 'name': name, 'count': v['total'], 'senders': v['senders']})
        
        conn.commit()
        conn.close()
        return jsonify(stats)
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.route('/api/chat_dynamics', methods=['GET'])
def chat_dynamics():
    start_date = request.args.get('start_date', '').strip()
    end_date = request.args.get('end_date', '').strip()
    sender_param = request.args.get('senders', '').strip()
    icebreaker_gap = request.args.get('icebreaker_gap', type=int, default=8)
    ghosting_gap = request.args.get('ghosting_gap', type=float, default=4.0)
    
    # Validation logic to standardize cache keys
    if not 1 <= icebreaker_gap <= 24: icebreaker_gap = 8
    if not 1 <= ghosting_gap <= 24: ghosting_gap = 4.0
    
    # v10 Caching Strategy
    master_key = f"master_v10_{start_date}_{end_date}"
    slider_key = f"dyn_v10_{start_date}_{end_date}_ice{icebreaker_gap}_ghs{ghosting_gap}"
    
    valid_senders: Optional[Set[str]] = None
    if sender_param and sender_param != 'all':
        valid_senders = set([s.strip() for s in sender_param.split(',')])

    analytics: Optional[Dict[str, Any]] = None
    try:
        conn = sqlite3.connect(DB_NAME)
        c = conn.cursor()
        
        # 1. Try Slider Cache (Exact match)
        c.execute("SELECT cache_value FROM statistics_cache WHERE cache_key = ?", (slider_key,))
        row = c.fetchone()
        
        if row:
            raw_data = json.loads(row[0])
        else:
            # 2. Try Master Cache (Date match)
            c.execute("SELECT cache_value FROM statistics_cache WHERE cache_key = ?", (master_key,))
            m_row = c.fetchone()
            
            if m_row:
                analytics = json.loads(m_row[0])
            
            if not analytics:
                # 3. Cache miss - do the heavy lifting
                base_where = "WHERE sender IS NOT NULL AND sender != '' AND sender != 'System' AND sender NOT LIKE '%System%'"
                params = []
                
                if start_date:
                    base_where += " AND timestamp >= ?"
                    params.append(start_date + " 00:00:00")
                if end_date:
                    base_where += " AND timestamp <= ?"
                    params.append(end_date + " 23:59:59")
                    
                query = f'''
                    SELECT 
                        sender, 
                        timestamp,
                        text_content,
                        LAG(sender) OVER (ORDER BY timestamp ASC) as prev_sender,
                        LAG(timestamp) OVER (ORDER BY timestamp ASC) as prev_timestamp
                    FROM messages 
                    {base_where}
                '''
                
                c.execute(query, params)
                rows = c.fetchall()
                
                analytics = {}
                current_burst_sender: Optional[str] = None
                current_burst_len = 0
                current_burst_start_time = None
                
                for s_raw, ts, txt, prev_sender, prev_ts in rows:
                    sender = clean_sender_name(s_raw) if s_raw else "Unknown"
                    if sender == 'System': continue
                    
                    prev_cleaned = clean_sender_name(prev_sender) if prev_sender else None
                    
                    if sender not in analytics:
                        analytics[sender] = {
                            'msgs': 0, 'icebreaker_records': [], 'ghosted_records': [], 
                            'char_lengths': [], 'max_msg': {'len': 0, 'text': '', 'date': ''},
                            'burst_seqs': [], 'burst_freq': {str(k): 0 for k in range(2, 11)}, 'burst_record': {'len': 0, 'date': ''}
                        }
                    
                    s_data = analytics[sender]
                    s_data['msgs'] += 1
                    
                    # Length Analysis
                    if txt and isinstance(txt, str) and txt.strip():
                        clean_txt: str = re.sub(r'<[^>]+>', '', txt)
                        clean_txt = re.sub(r'http\S+|www\.\S+', '', clean_txt).strip()
                        txt_len: int = len(clean_txt)
                        if txt_len > 0:
                            s_data['char_lengths'].append(txt_len)
                            max_msg: Dict[str, Any] = s_data['max_msg']
                            if isinstance(max_msg, dict) and txt_len > max_msg['len']:
                                s_data['max_msg'] = {'len': txt_len, 'text': cast(Any, clean_txt)[:25] + ('...' if len(clean_txt) > 25 else ''), 'date': ts}
                    
                    if prev_ts:
                        t_curr = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S")
                        t_prev = datetime.strptime(prev_ts, "%Y-%m-%d %H:%M:%S")
                        delta_seconds = (t_curr - t_prev).total_seconds()
                        delta_hours = delta_seconds / 3600.0
                        
                        s_data['icebreaker_records'].append(delta_hours)
                        if sender != prev_cleaned and prev_cleaned is not None:
                            s_data['ghosted_records'].append(delta_seconds)
                    
                    # Burst Analysis
                    if sender == current_burst_sender:
                        current_burst_len += 1
                    else:
                        if current_burst_sender is not None and current_burst_sender in analytics and current_burst_len > 1:
                            prev_s_data = analytics[current_burst_sender]
                            prev_s_data['burst_seqs'].append(current_burst_len)
                            freq_key = str(min(current_burst_len, 10))
                            prev_s_data['burst_freq'][freq_key] += 1
                            if current_burst_len > prev_s_data['burst_record']['len']:
                                prev_s_data['burst_record'] = {'len': current_burst_len, 'date': current_burst_start_time}
                        current_burst_sender = sender
                        current_burst_len = 1
                        current_burst_start_time = ts
                        
                if current_burst_sender is not None and current_burst_sender in analytics and current_burst_len > 1:
                    last_s_data = analytics[current_burst_sender]
                    last_s_data['burst_seqs'].append(current_burst_len)
                    freq_key = str(min(current_burst_len, 10))
                    last_s_data['burst_freq'][freq_key] += 1
                    if current_burst_len > last_s_data['burst_record']['len']:
                        last_s_data['burst_record'] = {'len': current_burst_len, 'date': current_burst_start_time}
                
                c.execute("INSERT OR REPLACE INTO statistics_cache (cache_key, cache_value) VALUES (?, ?)", 
                          (master_key, json.dumps(analytics)))
                conn.commit()

            # Final Post-processing
            final_data = {}
            g_gap_float = float(ghosting_gap)
            i_gap_int = int(icebreaker_gap)
            gap_threshold_s = g_gap_float * 3600

            if analytics is not None:
                # Type safe iteration over the analytics dictionary
                analytics_map = cast(Dict[str, Dict[str, Any]], analytics)
                for sender, d_raw in analytics_map.items():
                    d = cast(Dict[str, Any], d_raw)
                    if d.get('msgs', 0) == 0: continue
                    
                    # Resolve icebreaker records
                    i_records = cast(List[int], d.get('icebreaker_records', []))
                    ice_count: int = sum(1 for h in i_records if h >= i_gap_int)
                    
                    ghost_stats: Dict[str, int] = {'insta': 0, 'active': 0, 'delayed': 0, 'ghosted': 0, 'extended': 0}
                    g_records = cast(List[float], d.get('ghosted_records', []))
                    for gap_sex in g_records:
                        if gap_sex < 30: ghost_stats['insta'] += 1
                        elif gap_sex < 300: ghost_stats['active'] += 1
                        elif gap_sex < 3600: ghost_stats['delayed'] += 1
                        else:
                            if g_gap_float > 1.05:
                                if gap_sex < gap_threshold_s: ghost_stats['ghosted'] += 1
                                else: ghost_stats['extended'] += 1
                            else:
                                ghost_stats['ghosted'] += 1
                                
                    total_responses: int = len(g_records)
                    ghost_stats_with_pct: Dict[str, Dict[str, Any]] = {}
                    for k, count in ghost_stats.items():
                        ghost_stats_with_pct[k] = {
                            'count': count,
                            'pct': float(int((count / total_responses) * 10000) / 100.0) if total_responses > 0 else 0.0
                        }
                    
                    c_lengths = cast(List[int], d.get('char_lengths', []))
                    avg_len: float = float(int(sum(c_lengths) / len(c_lengths) * 10) / 10.0) if c_lengths else 0.0
                    
                    b_seqs = cast(List[int], d.get('burst_seqs', []))
                    total_burst_msgs: int = sum(b_seqs)
                    avg_burst: float = float(int(total_burst_msgs / len(b_seqs) * 10) / 10.0) if b_seqs else 1.0
                    burst_ratio: float = float(int((total_burst_msgs / int(d.get('msgs', 1))) * 1000) / 10.0) if int(d.get('msgs', 0)) > 0 else 0.0
                    
                    final_data[sender] = {
                        'msgs': d.get('msgs', 0),
                        'icebreakers': ice_count,
                        'ghost_stats': ghost_stats_with_pct,
                        'total_ghost_records': total_responses,
                        'avg_length': avg_len,
                        'max_msg': d.get('max_msg'),
                        'burst_ratio': burst_ratio,
                        'avg_burst': avg_burst,
                        'burst_record': d.get('burst_record'),
                        'burst_freq': d.get('burst_freq')
                    }
                
            raw_data = final_data
            c.execute("INSERT OR REPLACE INTO statistics_cache (cache_key, cache_value) VALUES (?, ?)", 
                      (slider_key, json.dumps(raw_data)))
            conn.commit()
            
        conn.close()
        
        if valid_senders:
            filtered_data = {k: v for k, v in raw_data.items() if k in valid_senders}
        else:
            filtered_data = raw_data
            
        return jsonify(filtered_data)
        
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
        
def open_browser(port: int = 5000):
      webbrowser.open_new(f"http://127.0.0.1:{port}")

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Telegram Search App Web UI")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=5000, help="Port number (default: 5000)")
    parser.add_argument("--db", default=DEFAULT_DB_NAME, help=f"Path to the database file (default: {DEFAULT_DB_NAME})")
    parser.add_argument("--debug", action="store_true", help="Enable Flask debug mode")
    
    args = parser.parse_args()
    DB_NAME = args.db
    
    upgrade_db()
    
    if not os.environ.get("WERKZEUG_RUN_MAIN"):
        print("\n[SERVER] Launching browser...")
        Timer(0.5, open_browser, [args.port]).start()
        
    print(f"\n[SERVER] Serving UI from: {BASE_DIR}")
    print(f"[SERVER] Database: {DB_NAME}")
    print(f"Open your browser to: http://{args.host}:{args.port}\n")
    app.run(host=args.host, port=args.port, debug=args.debug)
