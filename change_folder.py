import os
import sqlite3
import sys

def main():
    db_path = 'chat_history.db'
    if not os.path.exists(db_path):
        print(f"Error: Database file '{db_path}' not found.")
        sys.exit(1)

    try:
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
    except sqlite3.Error as e:
        print(f"Error connecting to database: {e}")
        sys.exit(1)

    try:
        c.execute("SELECT id, media_path FROM messages WHERE media_path IS NOT NULL AND media_path != ''")
        rows = c.fetchall()
    except sqlite3.Error as e:
        print(f"Database query error: {e}")
        sys.exit(1)

    if not rows:
        print("Error: No media paths found in the database. It might be empty or have no media.")
        sys.exit(1)

    print(f"Found {len(rows)} media paths in the database.")

    # Extract unique base folders (Telegram exports always have media 1 level deep in a subfolder)
    base_folders = set()
    for row in rows:
        path = row[1]
        dir_path = os.path.dirname(path)
        base_dir = os.path.dirname(dir_path)
        base_folders.add(base_dir)

    print(f"Detected {len(base_folders)} unique base folder(s).")

    updates_to_make = []

    for base_folder in base_folders:
        print(f"\n--------------------------------------------------")
        print(f"Current base folder: {base_folder}")
        print(f"--------------------------------------------------")
        new_folder = input("Enter new folder path (leave empty to skip): ").strip().strip('"').strip("'")
        
        if not new_folder:
            print("Skipping...")
            continue
            
        if not os.path.exists(new_folder) or not os.path.isdir(new_folder):
            print(f"Error: The new folder '{new_folder}' does not exist or is not a directory.")
            print("Skipping this folder...")
            continue
            
        count = 0
        for row in rows:
            old_path = row[1]
            row_dir = os.path.dirname(old_path)
            row_base = os.path.dirname(row_dir)
            
            # Using os.path.normcase for robust Windows path comparison
            if os.path.normcase(row_base) == os.path.normcase(base_folder):
                try:
                    rel_path = os.path.relpath(old_path, base_folder)
                    new_path = os.path.join(new_folder, rel_path)
                    new_path = os.path.normpath(new_path)
                    
                    updates_to_make.append((new_path, row[0]))
                    count += 1
                except ValueError:
                    # Occurs if paths are on different drives on Windows and we can't get relpath
                    # Should not normally happen since we compute relpath against its own parent
                    pass
                    
        print(f"Prepared {count} file paths for update.")

    if updates_to_make:
        print("\nApplying updates to the database...")
        try:
            c.executemany("UPDATE messages SET media_path = ? WHERE id = ?", updates_to_make)
            conn.commit()
            print(f"Success! {len(updates_to_make)} paths have been updated in the database.")
        except sqlite3.Error as e:
            print(f"Error updating database: {e}")
            sys.exit(1)
    else:
        print("\nNo changes were made.")
        
    conn.close()

if __name__ == '__main__':
    main()
