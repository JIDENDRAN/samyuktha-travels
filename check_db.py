import sqlite3
import os

DB = "database.db"

def check_db():
    if not os.path.exists(DB):
        print(f"Error: {DB} does not exist")
        return
    
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = cur.fetchall()
    print(f"Tables in {DB}: {[t[0] for t in tables]}")
    conn.close()

if __name__ == "__main__":
    check_db()
