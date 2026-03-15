<p align="center">
  <img src="icons/icon128.png" width="80" alt="XML Stream Parser icon">
</p>

<h1 align="center">XML Stream Parser</h1>

<p align="center">
  <strong>Stream-parse XML files up to 2 GB in your browser.<br>No frozen tabs. No RAM explosions. No drama.</strong>
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/xml-stream-parser/lippinogapmkocmbfdpkdlnbolimkloa">
    <img src="https://img.shields.io/chrome-web-store/v/lippinogapmkocmbfdpkdlnbolimkloa?label=Chrome%20Web%20Store&color=38bdf8&style=flat-square" alt="Chrome Web Store version">
  </a>
  <a href="https://chromewebstore.google.com/detail/xml-stream-parser/lippinogapmkocmbfdpkdlnbolimkloa">
    <img src="https://img.shields.io/chrome-web-store/users/lippinogapmkocmbfdpkdlnbolimkloa?label=Users&color=34d399&style=flat-square" alt="Chrome Web Store users">
  </a>
  <a href="https://chromewebstore.google.com/detail/xml-stream-parser/lippinogapmkocmbfdpkdlnbolimkloa">
    <img src="https://img.shields.io/chrome-web-store/rating/lippinogapmkocmbfdpkdlnbolimkloa?label=Rating&color=fbbf24&style=flat-square" alt="Chrome Web Store rating">
  </a>
  <img src="https://img.shields.io/badge/Dependencies-0-38bdf8?style=flat-square" alt="Zero dependencies">
  <img src="https://img.shields.io/badge/Size-45KB-34d399?style=flat-square" alt="45KB total">
  <img src="https://img.shields.io/badge/License-MIT-94a3b8?style=flat-square" alt="MIT License">
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/xml-stream-parser/lippinogapmkocmbfdpkdlnbolimkloa"><strong>Install from Chrome Web Store →</strong></a>
</p>

---

<!-- Replace with your actual demo GIF/video -->
<p align="center">
  <img src="demo.gif" width="720" alt="XML Stream Parser parsing a 2.15 GB file in 55 seconds">
</p>

<p align="center"><em>2.15 GB XML · 55 seconds · ~20 MB RAM</em></p>

---

## The Problem

Your XML file is 500 MB. Or 1 GB. Or 2 GB.

- **Notepad++** — freezes, then crashes
- **Browser tab** — runs out of RAM, tab dies
- **Excel** — shows 65,536 rows and gives up
- **Online XML viewers** — "file too large to upload"
- **DOMParser** — builds an in-memory tree 3–10x the file size

Every existing tool tries to load the entire file into memory. A 500 MB XML file becomes a 4 GB DOM tree. Your browser doesn't have 4 GB to spare.

## The Solution

XML Stream Parser **never loads the full file**. It reads in 16 MB chunks, processes each through a SAX parser, and discards the chunk. Memory stays at ~20 MB whether your file is 2 KB or 2 GB.

```
File (2.15 GB)
  ↓ File.slice() — 16 MB chunk
  ↓ TextDecoder({ stream: true }) — correct UTF-8 across boundaries
  ↓ SAX Parser — events, no tree
  ↓ Results — stats, search matches, code samples
  ↓ next chunk...
```

All of this runs in a **Web Worker** — the UI thread stays free, your browser stays responsive.

## Features

### 📊 Instant Statistics
Parse millions of elements in seconds. See total elements, unique tags, attribute count, text nodes, max nesting depth, and file size — computed in a single streaming pass.

### 🔍 Powerful Search
Filter by tag name, attribute name, attribute value, or text content. Combine any filters. Results appear **in real-time** as the file is being parsed.

| Field | Example | What it finds |
|-------|---------|---------------|
| Tag name | `GuestCount` | All `<GuestCount>` elements |
| Attribute name | `CurrencyCode` | Elements with a `CurrencyCode` attribute |
| Attribute value | `EUR` | Elements where any attribute = `"EUR"` |
| Text contains | `error` | Elements with "error" in their text content |

### 🗂️ Element Explorer
Every unique tag listed by nesting depth — see the full document hierarchy at a glance. Click any element to preview its actual XML code with syntax highlighting. Browse through up to 50 samples per tag with **◀ ▶** navigation.

### 💡 XML Anatomy Guide
The extension picks a representative element from your file and generates an interactive color-coded breakdown:

```xml
<HotelReservationID ResID_Type="14" ResID_Value="466125828" ResID_Source="6206"/>
 ^^^^^^^^^^^^^^^^^^^  ^^^^^^^^^^^  ^^^^                     ^^^^^^^^^^^^  ^^^^^^
 tag name (pink)      attr name    attr value (green)       attr name     attr value
                      (purple)                              (purple)      (green)
```

Hover over any part for a tooltip. Great for non-dev users who receive XML exports.

### 🌍 5 Languages
English · Русский · Deutsch · Español · Français — auto-detected from your browser.

### 🔒 Privacy
- **100% local** — your files never leave your browser
- **Zero tracking** — no analytics, no telemetry, no data collection
- **Minimal permissions** — `storage` only (for language preference)

## Benchmarks

Tested on MacBook Pro M1, Chrome 131:

| File | Size | Elements | Tags | Parse Time | Throughput | RAM |
|------|------|----------|------|------------|------------|-----|
| Hotel reservations | 2.15 GB | 2.4M | 42 | 55s | ~40 MB/s | ~20 MB |
| Product catalog | 890 MB | 1.1M | 38 | 22s | ~40 MB/s | ~18 MB |
| API response log | 450 MB | 6.2M | 15 | 12s | ~38 MB/s | ~16 MB |
| SOAP envelope | 4.5 KB | 47 | 28 | <1ms | — | ~8 MB |

> RAM usage is **constant** regardless of file size. A 2 GB file uses the same memory as a 2 KB file.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Main Thread (popup.js)                                  │
│                                                         │
│  File.slice()  ──→  postMessage(chunk)  ──→  Worker     │
│                                                         │
│  ←──  progress, stats, samples, structure               │
│                                                         │
│  UI: progress bar, stats grid, element list,            │
│      search results, code preview overlay               │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│ Web Worker (xml-worker.js)                              │
│                                                         │
│  TextDecoder({ stream: true })                          │
│       ↓                                                 │
│  SAX Parser (sax-parser.js)                             │
│       ↓                                                 │
│  Events: onOpenTag, onCloseTag, onText, onCDATA         │
│       ↓                                                 │
│  Collectors:                                            │
│    · Stats (counts, depth, unique tags)                 │
│    · Tree structure (lightweight, first N children)     │
│    · Search matches (tag/attr/value/text filters)       │
│    · XML samples (reconstructed from SAX events)        │
│    · Hint sample (best element for anatomy guide)       │
└─────────────────────────────────────────────────────────┘
```

### Key Implementation Details

**Chunk boundary handling**: `TextDecoder` with `{ stream: true }` buffers incomplete multi-byte UTF-8 sequences across chunks. Without this, you get garbled characters every ~16 MB.

**SAX parser** (`sax-parser.js`, ~200 lines): Custom streaming parser that handles `parser.write(chunk)` for incremental feeding. Supports elements, attributes, CDATA, comments, processing instructions, and XML entity decoding. Does not build a tree — fires events only.

**Sample capture**: During parsing, the worker reconstructs raw XML for each element from SAX events and stores up to 50 samples per tag. Samples are kept in worker memory and served on demand via `postMessage` — the file is not re-read.

**Element ordering**: Tags are tracked by first-seen depth and appearance order, then displayed sorted by nesting depth for an intuitive document overview.

## Project Structure

```
xml-extension/
├── manifest.json          # Chrome extension manifest (MV3)
├── background.js          # Service worker: tab management, messaging
├── popup.html             # Main UI (opens in a dedicated tab)
├── popup.js               # UI controller, i18n, modals, preview
├── sax-parser.js          # Streaming SAX parser (~200 lines)
├── xml-worker.js          # Web Worker: chunked reading + parsing
├── lang/                  # Translation files
│   ├── en.json
│   ├── ru.json
│   ├── de.json
│   ├── es.json
│   └── fr.json
└── icons/
    ├── icon48.png
    └── icon128.png
```

**Zero dependencies.** Total size: **~45 KB**.

## Install

### From Chrome Web Store (recommended)

[**→ Install XML Stream Parser**](https://chromewebstore.google.com/detail/xml-stream-parser/lippinogapmkocmbfdpkdlnbolimkloa)

### From source

```bash
git clone https://github.com/Annaword7/xmlsteamparser.git
```

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `xml-extension` folder
4. Click the extension icon in your toolbar

## Generate Test Files

Need a large XML file to test with?

```bash
python3 gen_2gb_xml.py
```

This generates a ~2 GB file with realistic hotel reservation data (OTA/SOAP structure). Adjust `TARGET_SIZE_GB` at the top of the script for smaller files.

## Supported Formats

Any well-formed XML including:

SOAP · OTA · RSS · Atom · SVG · XSLT · XSD · KML · GPX · plist · XBRL · HL7 · UBL · DOCX internals · Android XML · Spring/Maven configs · custom schemas

## Contributing

Found a bug? Have an edge-case XML that breaks things? [Open an issue](https://github.com/Annaword7/xmlsteamparser/issues) or submit a PR.

Areas where help is welcome:
- Additional languages
- XSLT/XPath query support
- Export search results to CSV
- Performance optimization for files > 2 GB

## Support the Project

If XML Stream Parser saves you time:

- ⭐ [**Rate it on Chrome Web Store**](https://chromewebstore.google.com/detail/xml-stream-parser/lippinogapmkocmbfdpkdlnbolimkloa) — helps other developers find it
- 🐛 [**Report bugs**](https://github.com/Annaword7/xmlsteamparser/issues) — helps make it better
- ☕ **Support development** — donate button inside the extension

## License

MIT — do whatever you want. Life is short.

---

<p align="center">
  <sub>Built with streaming chunks and zero DOM trees.</sub>
</p>

