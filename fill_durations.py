import os
import sqlite3
import concurrent.futures
from tinytag import TinyTag
import time

# Use the default DB path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "chat_history.db")

try:
    import cv2
except ImportError:
    cv2 = None

def get_duration(path):
    if not path or not os.path.exists(path):
        return None
        
    # 1. Primary: TinyTag (Fastest)
    try:
        tag = TinyTag.get(path)
        if tag.duration:
            return max(1, int(round(tag.duration)))
    except:
        pass
        
    # 2. Secondary: OpenCV (Robust fallback for broken/iPhone headers)
    if cv2:
        try:
            cap = cv2.VideoCapture(path)
            if cap.isOpened():
                fps = cap.get(cv2.CAP_PROP_FPS)
                frame_count = cap.get(cv2.CAP_PROP_FRAME_COUNT)
                cap.release()
                if fps > 0:
                    return max(1, int(round(frame_count / fps)))
        except:
            pass
            
    return None

def process_batch(batch):
    results = []
    for msg_id, path in batch:
        duration = get_duration(path)
        if duration is not None:
            results.append((duration, msg_id))
    return results

def main():
    if not os.path.exists(DB_PATH):
        print(f"Error: Database not found at {DB_PATH}")
        return

    start_time = time.time()
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # Identify all media entries that could have a duration but are missing it
    # We include video, gif, voice, and round_video
    print("[1/3] Querying database for missing durations...")
    c.execute("""
        SELECT id, media_path 
        FROM messages 
        WHERE media_type IN ('video', 'gif', 'voice', 'round_video', 'audio') 
          AND duration IS NULL 
          AND media_path IS NOT NULL
    """)
    rows = c.fetchall()
    
    if not rows:
        print("Success: All media entries already have durations populated.")
        conn.close()
        return

    total = len(rows)
    print(f"[2/3] Found {total} entries to process. Using parallel workers for speed...")
    
    # Split into chunks for parallel processing
    chunk_size = 100
    chunks = [rows[i:i + chunk_size] for i in range(0, len(rows), chunk_size)]
    
    all_updates = []
    processed_count = 0
    
    # Use ThreadPoolExecutor for I/O bound header reading
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        future_to_chunk = {executor.submit(process_batch, chunk): chunk for chunk in chunks}
        
        for future in concurrent.futures.as_completed(future_to_chunk):
            chunk_results = future.result()
            all_updates.extend(chunk_results)
            processed_count += len(future_to_chunk[future])
            
            # Progress indicator
            if processed_count % 500 == 0 or processed_count == total:
                print(f"      Progress: {processed_count}/{total} ({(processed_count/total)*100:.1f}%)")

    # Final DB Update
    if all_updates:
        print(f"[3/3] Found {len(all_updates)} valid durations. Applying batch update to database...")
        c.executemany("UPDATE messages SET duration = ? WHERE id = ?", all_updates)
        conn.commit()
    else:
        print("[3/3] No new durations could be extracted (files might be missing or corrupted).")
    
    conn.close()
    elapsed = time.time() - start_time
    print(f"\nFinished! Processed {total} entries in {elapsed:.2f} seconds.")
    print("The Videos tab should now be significantly smoother.")

if __name__ == "__main__":
    main()
