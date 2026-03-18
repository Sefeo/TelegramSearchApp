# 📨 TelegramSearchApp

A **local-first** desktop tool for parsing Telegram exported chat archives (`.html` files) into a searchable SQLite database, with a built-in web server and browser UI for reading, searching, and analysing your conversations.

No cloud, no API keys, no Telegram account required at runtime — everything stays on your machine.

---

## ✨ Features

| Feature | Description |
|---|---|
| 📥 **Chat Parser** | Ingests Telegram's HTML export format and stores all messages, metadata, and media references into a local SQLite database |
| 💬 **Message Reader** | Scroll through your full chat history in a clean, chronological feed — just like a real chat interface |
| 🔍 **Extensive Search** | Full-text search across message content, sender names, and dates — with filters to narrow results precisely |
| 🖼️ **Shared Media Tab** | A dedicated gallery view of every photo, video, document, voice note, and sticker ever sent in the chat |
| 📊 **Statistics Dashboard** | Forensic-level visual analytics — circadian rhythms, consistency grids, media DNA, and deep chat dynamics |

---

## 🖥️ How It Works

```
Telegram Desktop
      │
      │  Export Chat  (Settings → Export Telegram Data)
      ▼
  /path/to/export/
  ├── messages.html        ← main archive
  ├── messages2.html       ← continuation files (if any)
  └── photos/, videos/ …  ← exported media

      │
      │  build_db.py  (one-time import step)
      ▼
  chat_history.db         ← local SQLite database

      │
      │  python run_ui.py     (starts local web server)
      ▼
  http://localhost:5000     ← open in your browser
```

---

## 📋 Requirements

### System

- **Python 3.9 or higher** (developed and tested on Python 3.12; 3.9 is the minimum due to use of standard type-hint generics such as `list[str]` and `dict[str, ...]` in built-in collections, and f-string improvements — Python 3.12 is recommended for best performance and compatibility)
- A modern web browser (Chrome, Firefox, Edge, Safari)
- Telegram Desktop (to produce the export) — **not required at runtime**

### Python Dependencies

All dependencies are listed in `requirements.txt`. Key libraries include:

| Library | Purpose |
|---|---|
| `Flask` | Local web server & API routes |
| `BeautifulSoup4` | Parsing Telegram's HTML export files |
| `lxml` | Fast HTML parser backend for BeautifulSoup (Recommended) |
| `Jinja2` | HTML templating for the UI (comes with Flask) |
| `Werkzeug` | WSGI utilities (comes with Flask) |

> **Note:** SQLite support is built into Python's standard library (`sqlite3`) — no separate database installation is needed.

---

## 🚀 Installation

### 1. Clone the repository

```bash
git clone https://github.com/Sefeo/TelegramSearchApp.git
cd TelegramSearchApp
```

### 2. Create and activate a virtual environment

**macOS / Linux:**
```bash
python3 -m venv venv
source venv/bin/activate
```

**Windows (Command Prompt):**
```cmd
python -m venv venv
venv\Scripts\activate.bat
```

**Windows (PowerShell):**
```powershell
python -m venv venv
venv\Scripts\Activate.ps1
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

---

## 📤 Exporting Your Chat from Telegram

Before using the app you need to export a chat from **Telegram Desktop**:

1. Open Telegram Desktop
2. Navigate to the chat or group you want to export
3. Click the **⋮ (three-dot menu)** in the top-right corner
4. Select **Export Chat History**
5. Choose the format **HTML** (not JSON — the parser expects HTML)
6. Select what media to include (photos, videos, documents, etc.)
7. Choose a destination folder and click **Export**

Telegram will produce a folder containing one or more `messages.html` / `messages2.html` files along with a `photos/`, `video_files/`, `voice_messages/` etc. subdirectories.

> **Tip:** For large chats Telegram splits the export into multiple numbered HTML files (`messages.html`, `messages2.html`, `messages3.html` …). The parser handles all of them automatically as long as they are in the same folder.

---

## ⚙️ Usage

### Step 1 — Parse the export into the database

Point the parser at the folder produced by Telegram Desktop:

```bash
python build_db.py --input /path/to/telegram/export/
```

The script will read all `messages*.html` files it finds, extract every message, and write everything into `chat_history.db` in the project directory.

For large chats this may take a few seconds to a minute — progress will be shown in the terminal. You only need to do this **once per export**.

Optional flags:

```
--input   PATH   Path to the Telegram export folder (required)
--db      PATH   Custom path/name for the output database file
                 (default: chat_history.db in current directory)
--reset          Drop and recreate the database before importing
                 (useful when re-importing an updated export)
```

### Step 2 — Start the web server

```bash
python run_ui.py
```

The server starts on **http://localhost:5000** by default. Open that URL in your browser.

Optional flags:

```
--host    HOST   Bind address (default: 127.0.0.1)
--port    PORT   Port number   (default: 5000)
--db      PATH   Path to the database file (default: chat_history.db)
--debug          Enable Flask debug mode (auto-reload on code changes)
```

---

## 🗂️ Project Structure

```
TelegramSearchApp/
├── build_db.py           # HTML → SQLite ingestion script
├── run_ui.py             # Flask web server & route definitions
├── requirements.txt      # Python dependencies
├── .gitignore            # Git exclusion rules
│
├── templates/            # Jinja2 HTML templates
│   └── index.html
│
├── static/               # CSS, JavaScript, icons
│   ├── css/
│   └── js/
│
└── chat_history.db       # Generated SQLite database (after parsing)
```

---

## 🔍 UI Overview

### 💬 Message Reader
Browse the entire chat history in a scrollable, chronological feed. Messages are rendered with sender names, timestamps, reply chains, and inline media thumbnails. Pagination keeps the view snappy even for very large chats.

### 🔍 Search
Full-text search across all message content. Supports:
- **Keyword search** — finds messages containing any or all of the supplied words
- **Sender filter** — limit results to messages from a specific person
- **Date range filter** — narrow down to a specific period

Results are highlighted and link back to the original message in its chronological context.

### 🖼️ Shared Media Tab
A visual gallery of every piece of media exchanged in the chat — photos, videos, documents, voice messages, stickers. Items are grouped by type and sorted by date. Clicking an item opens it full-size (or downloads it, for documents).

### 📊 Statistics Dashboard (Chat Pulse)
A forensic-level analytics suite to visualize the "pulse" of your conversation:

- **🌙 Circadian Rhythm**: Hour-by-hour activity breakdown (Radar chart) to see when the chat is most active.
- **📅 Weekly Activity**: Day-of-the-week distribution (Polar area chart) to identify busiest days.
- **🟩 Consistency Grid**: A GitHub-style activity heatmap showing every single day of the chat history.
- **🧬 Media DNA**: A percentage breakdown of chat composition (Text, Photos, Voice/Video, Stickers/GIFs).
- **⚡ Chat Dynamics**:
    - **Messages**: Top senders and their total message share.
    - **Icebreakers**: Who initiates the conversation after long periods of silence.
    - **Ghosting / Response Time**: Categorized reply speeds (from "Insta" to "Ghosted/Extended").
    - **Message Length**: Average character counts and record-breaking long reads.
    - **Burst Ratio**: Streaks of consecutive messages sent by the same person.
- **🔍 Fingerprints**: 
    - **Emoji Fingerprint**: Most used emojis and who uses them most.
    - **Sticker/GIF Fingerprint**: Ranked list of favorite stickers and shared GIFs.
- **🏷️ Signature Words**: A dynamic word cloud of unique phrases and most frequent vocabulary (excluding stop words).

---

## 🛠️ Troubleshooting

**`ModuleNotFoundError` on startup**
Make sure your virtual environment is activated and dependencies are installed:
```bash
source venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
```

**Parser finds no messages**
- Confirm the export format was set to **HTML**, not JSON.
- Check that the `--input` path points to the folder that *contains* `messages.html`, not to the file itself.
- The parser looks for files matching the pattern `messages*.html` — ensure the file names haven't been renamed.

**Media files not loading in the browser**
The app serves media from the original export folder. Make sure the `photos/`, `video_files/` etc. subdirectories are still present relative to where they were when you ran the parser, or re-run the parser pointing at the same folder.

**Database is empty / stats show 0**
Run the parser step first (`python build_db.py --input ...`) before starting the server. The server does not parse anything on its own.

**Port 5000 already in use**
```bash
python run_ui.py --port 5001
```

---

## 🔒 Privacy

All data stays entirely on your local machine. The app:
- Makes no network requests
- Does not require a Telegram account, token, or API key
- Does not send any telemetry
- Stores everything in a plain SQLite file you can inspect, back up, or delete at any time

---

## 🐍 Python Version Notes

| Python Version | Status |
|---|---|
| 3.12 | ✅ Fully tested (original development version) |
| 3.11 | ✅ Fully compatible |
| 3.10 | ✅ Compatible |
| 3.9  | ⚠️ Minimum supported — core features work; if you encounter issues, upgrade to 3.10+ |
| 3.8 and below | ❌ Not supported |

To check your Python version:
```bash
python --version
# or
python3 --version
```

---

## 📄 License

See [LICENSE](LICENSE) for details.

---

## 🤝 Contributing

Pull requests are welcome! If you find a bug or want to suggest a feature, please open an issue first so we can discuss it.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m 'Add my feature'`
4. Push to the branch: `git push origin feature/my-feature`
5. Open a Pull Request

---

*Made with ❤️ for everyone who wishes Telegram's built-in search was a little more powerful.*
