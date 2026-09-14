# 🛡️ EQ Legends Gear Bot — Discord Gear Inventory & eqlwiki Card Renderer

A complete, modular Discord bot (discord.js v14) designed for EverQuest Legends communities to track volunteer gear inventory, upgrade suffixes (`+1` to `+10`), and render high-resolution item cards directly from [eqlwiki.com](https://eqlwiki.com) with interactive level sliders.

---

## ⚡ Features

- **/g-add [item_name] [upgrade_level]**:
  - Live MediaWiki opensearch autocomplete directly against eqlwiki.com.
  - Automatic upgrade suffix parsing (`+0` to `+10`).
  - Strict wiki page validation (rejects invalid/missing pages).
  - Automatically records submitter details (`added_by_user_id`, `added_by_username`) and timestamp in SQLite.
- **/g-stock [item_name] [quantity]**:
  - Designed for stocking stackable items (`x1` to `x1000`).
- **/g-list**:
  - **Paginated Numbered Inventory:** Neatly lists stored items with 10 entries per page.
  - **Dual-Dropdown Discord Interface:**
    - **Dropdown 1 (Item Selection):** Choose an item from the current page.
    - **Dropdown 2 (Action Menu):** Context-aware options dynamically based on item state and viewer identity:
      - `👁️ View Item Wiki Card`: Generates an ephemeral preview of the item card rendered at its stored upgrade level.
      - `✋ Claim Item`: Allows any guild member to claim an unassigned piece of gear.
      - `↩️ Withdraw Claim`: Displayed exclusively to the user who claimed the item, letting them return it to the community pool.
      - `🗑️ Remove Item`: Available to the original donor or authorized Guild Officers (`AUTHORIZED_ROLE_IDS` or Administrator).
  - **Sequential ID Compaction:** Whenever an item is deleted from the database, remaining items are automatically re-indexed continuously from 1 to N without missing ID gaps.
- **/g-card [item_name]**:
  - Scrapes `div.ils-item-wrapper` and renders clean PNG card with eqlwiki stylesheet.
  - Interactive slider buttons (`◀ Lower Level`, `Level: +X`, `Higher Level ▶`) to adjust the upgrade tier in real-time.
- **/g10 [item_name]**:
  - Display card for an item at its +10 upgrade level, for quick reference.

---

## 🚀 Quick Setup

### 1. Discord Developer Portal Configuration
1. Go to [Discord Developer Portal](https://discord.com/developers/applications).
2. Click **New Application** and give it a name (e.g., `EQ Gear Bot`).
3. Under **Bot**:
   - Reset/Copy your **Token** (`DISCORD_TOKEN`).
   - Enable **Server Members Intent** (optional) and **Message Content Intent** if needed.
4. Under **OAuth2 -> URL Generator**:
   - Select scopes: `bot` and `applications.commands`.
   - Bot permissions: `Send Messages`, `Embed Links`, `Attach Files`, `Use Slash Commands`.
   - Copy the generated URL to invite the bot to your Discord server.

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and fill in your credentials:

```env
DISCORD_TOKEN=MTE...your_bot_token_here
CLIENT_ID=123456789012345678
GUILD_ID=123456789012345678   # Optional: set for instant slash command registration during testing
AUTHORIZED_ROLE_IDS=987654321098765432,123456789012345678  # Roles allowed to delete items
```
  #### 2.5 Configure Guild Branding
  1. Open commands/gList.js in a text editor, and browse to line 35.
  2. Change YOUR_GUILD_BRANDING_HERE to your desired list title.


### 3. Install & Run Locally
```bash
npm install
npm start
```

---

## 🐳 Cloud Deployment

### Docker / Railway / Fly.io
Use the included `Dockerfile`, which installs Chromium and all necessary Linux graphic libraries for `node-html-to-image`:
```bash
docker build -t eq-gear-bot .
docker run --env-file .env eq-gear-bot
```
