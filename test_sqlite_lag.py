import sqlite3
import os

DB_NAME = "chat_history.db"

def test_lag():
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    
    # Check if statistics_cache exists
    c.execute("CREATE TABLE IF NOT EXISTS statistics_cache (cache_key TEXT PRIMARY KEY, cache_value TEXT, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)")
    
    # Check indexes
    print("Creating indexes...")
    c.execute("CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender)")
    
    # Test LAG
    try:
        query = """
        SELECT id, sender, timestamp,
               LAG(sender) OVER (ORDER BY timestamp ASC) as prev_sender,
               LAG(timestamp) OVER (ORDER BY timestamp ASC) as prev_timestamp
        FROM messages
        LIMIT 10
        """
        c.execute(query)
        rows = c.fetchall()
        print("LAG function works!")
        for r in rows:
            print(r)
    except Exception as e:
        print("Error with LAG:", e)

if __name__ == "__main__":
    test_lag()
