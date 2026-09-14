# 🛡️ EQ Gear Bot — Discord Gear Inventory & eqlwiki Card Renderer (Pre-Workorders Version)

> **Note:** This documentation reflects the version of EQ Gear Bot focusing exclusively on **Community Gear Inventory Management**, **Item Upgrade Tracking (`+1` to `+10`)**, and **eqlwiki Card Generation**, prior to the addition of guild tradeskills and work order boards.

A complete, modular Discord bot (discord.js v14) designed for EverQuest communities and guilds. It tracks donated and volunteer gear, handles item upgrade tiers (`+0` to `+10`), manages member gear claims, and renders high-resolution item card PNG images directly from [eqlwiki.com](https://eqlwiki.com) with real-time level sliders.

---

## ⚡ Slash Commands & Features

### 1. `/g-add [item_name]`
- **Live Autocomplete:** Queries the MediaWiki opensearch API on `eqlwiki.com` as you type, offering real-time suggestions.
- **Suffix Parsing:** Automatically parses and strips upgrade suffixes from `+1` to `+10`. If omitted, defaults to `+0`.
  - Example: `/g-add item_name: Spurned Initiate Robe +3` registers Base Item: `Spurned Initiate Robe` and Upgrade Level: `+3`.
- **Page Validation:** Validates that the base item page exists on `eqlwiki.com` and is not empty (`.noarticletext` check).
- **Contributor Tracking:** Automatically logs the contributor's Discord ID, display name, and timestamp.

### 2. `/g-stock [item_name] [quantity]`
- **Batch Drop Stacking:** Designed for stocking multiples of common un-upgraded gear drops, armor pieces, or materials (`x1` to `x1000`).

### 3. `/g10 [item_name]`
- **Quick Max Tier Viewer:** Directly inspect or render an item scaled to its maximum `+10` upgrade tier in a single command.

### 4. `/g-list`
- **Paginated Numbered Inventory:** Neatly lists stored items with 10 entries per page.
- **Dual-Dropdown Discord Interface:**
  - **Dropdown 1 (Item Selection):** Choose an item from the current page.
  - **Dropdown 2 (Action Menu):** Context-aware options dynamically based on item state and viewer identity:
    - `👁️ View Item Wiki Card`: Generates an ephemeral preview of the item card rendered at its stored upgrade level.
    - `✋ Claim Item`: Allows any guild member to claim an unassigned piece of gear.
    - `↩️ Withdraw Claim`: Displayed exclusively to the user who claimed the item, letting them return it to the community pool.
    - `🗑️ Remove Item`: Available to the original donor or authorized Guild Officers (`AUTHORIZED_ROLE_IDS` or Administrator).
- **Sequential ID Compaction:** Whenever an item is deleted from the database, remaining items are automatically re-indexed continuously from 1 to N without missing ID gaps.

### 5. `/g-card [item_name]`
- **Wiki Card Extraction:** Fetches `https://eqlwiki.com/wiki/<Item_Name>`, extracts `div.ils-item-wrapper`, injects eqlwiki CSS styles, and renders a crisp PNG image using `node-html-to-image` (Puppeteer/Chromium).
- **Interactive Level Slider:** Discord action row buttons (`◀ Lower Level`, `Level: +X`, `Higher Level ▶`) allow users to step through upgrade tiers (`+0` to `+10`) and re-render the card dynamically.

---

## 🗄️ Database Architecture (`db.js`)

Uses SQLite (`better-sqlite3`) for local, zero-maintenance, file-based persistence:

### Table: `gear_items`
```sql
CREATE TABLE IF NOT EXISTS gear_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  base_item_name TEXT NOT NULL,
  upgrade_level TEXT DEFAULT '+0',
  wiki_url TEXT NOT NULL,
  added_by_user_id TEXT NOT NULL,
  added_by_username TEXT NOT NULL,
  requested_by_user_id TEXT DEFAULT NULL,
  requested_by_username TEXT DEFAULT NULL,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

- **ID Compaction Logic:** The database helper includes a transaction-wrapped `compactInventoryIds()` routine that re-sequences `id` values and resets SQLite's internal sequence counter after deletions.

---

## 🔐 Authorization & Permissions

- **Donors:** Users can always remove items they personally donated.
- **Guild Officers & Admins:** Users holding any role listed in `AUTHORIZED_ROLE_IDS` or having the `Administrator` permission bitfield can remove any item.
- **Claims:** An item can only be claimed if currently unclaimed; once claimed, only the claimant or an officer can release or remove it.

---

## 🚀 Quick Setup & Installation

### 1. Discord Developer Portal Setup
1. Go to [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application** (e.g. `EQ Gear Bot`).
3. Under **Bot**:
   - Reset and copy your **Bot Token** (`DISCORD_TOKEN`).
   - Enable **Server Members Intent**.
4. Under **OAuth2 -> URL Generator**:
   - Scopes: `bot`, `applications.commands`.
   - Permissions: `Send Messages`, `Embed Links`, `Attach Files`, `Use Slash Commands`.
   - Use the generated invite URL to add the bot to your Discord server.

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```env
DISCORD_TOKEN=your_discord_bot_token_here
CLIENT_ID=your_discord_client_id_here
GUILD_ID=your_optional_testing_guild_id_here
AUTHORIZED_ROLE_IDS=123456789012345678,987654321098765432
```

### 3. Install Dependencies & Launch
```bash
cd eq-gear-bot
npm install
npm start
```

---

## 🐳 Docker Deployment

The project includes a multi-architecture `Dockerfile` based on `node:20-bullseye-slim` with all font packages and Chromium runtime dependencies required by Puppeteer:

```bash
# Build Docker image
docker build -t eq-gear-bot .

# Run with persistent database volume
docker run -d \
  --name eq-gear-bot \
  --env-file .env \
  -v $(pwd)/gear_inventory.db:/app/gear_inventory.db \
  eq-gear-bot
```
