/**
 * Minimal streaming SAX XML parser.
 * Designed for incremental feeding via write(chunk).
 * Does NOT build a DOM tree — emits events only.
 *
 * Supports: elements, attributes, text, CDATA, comments, processing instructions.
 * Does NOT validate against DTD/Schema.
 */
class StreamingSAXParser {
  constructor(handlers = {}) {
    this.handlers = handlers; // { onOpenTag, onCloseTag, onText, onCDATA, onComment, onError }
    this._buffer = '';
    this._state = 'TEXT';       // TEXT | TAG | CDATA | COMMENT | PI
    this._tagBuffer = '';
    this._textBuffer = '';
    this._cdataBuffer = '';
    this._commentBuffer = '';
    this._depth = 0;
    this._stack = [];           // stack of tag names for depth tracking
  }

  /** Feed a chunk of XML text. Can be called repeatedly. */
  write(chunk) {
    this._buffer += chunk;
    this._parse();
  }

  /** Signal end of input */
  end() {
    if (this._textBuffer) {
      this._emitText();
    }
    if (this._state !== 'TEXT') {
      this._error('Unexpected end of input in state: ' + this._state);
    }
  }

  // ── Internal parsing ─────────────────────────────────────────────

  _parse() {
    let i = 0;
    const buf = this._buffer;
    const len = buf.length;

    while (i < len) {
      const ch = buf[i];

      switch (this._state) {
        case 'TEXT':
          if (ch === '<') {
            this._emitText();
            // Determine what kind of tag we're entering
            const remaining = buf.substring(i);
            if (remaining.startsWith('<![CDATA[')) {
              this._state = 'CDATA';
              this._cdataBuffer = '';
              i += 9; // skip <![CDATA[
              continue;
            } else if (remaining.startsWith('<!--')) {
              this._state = 'COMMENT';
              this._commentBuffer = '';
              i += 4; // skip <!--
              continue;
            } else if (remaining.startsWith('<?')) {
              this._state = 'PI';
              this._tagBuffer = '';
              i += 2;
              continue;
            } else {
              this._state = 'TAG';
              this._tagBuffer = '';
              i++; // skip <
              continue;
            }
          } else {
            this._textBuffer += ch;
            i++;
          }
          break;

        case 'TAG':
          if (ch === '>') {
            this._processTag(this._tagBuffer);
            this._tagBuffer = '';
            this._state = 'TEXT';
            i++;
          } else {
            this._tagBuffer += ch;
            i++;
          }
          break;

        case 'CDATA':
          if (ch === ']' && buf.substring(i, i + 3) === ']]>') {
            this._emit('onCDATA', this._cdataBuffer);
            this._cdataBuffer = '';
            this._state = 'TEXT';
            i += 3;
          } else {
            this._cdataBuffer += ch;
            i++;
          }
          break;

        case 'COMMENT':
          if (ch === '-' && buf.substring(i, i + 3) === '-->') {
            this._emit('onComment', this._commentBuffer);
            this._commentBuffer = '';
            this._state = 'TEXT';
            i += 3;
          } else {
            this._commentBuffer += ch;
            i++;
          }
          break;

        case 'PI':
          if (ch === '?' && buf[i + 1] === '>') {
            // processing instruction — skip for now
            this._tagBuffer = '';
            this._state = 'TEXT';
            i += 2;
          } else {
            this._tagBuffer += ch;
            i++;
          }
          break;
      }
    }

    // Keep only unprocessed data in buffer
    // For TEXT state, everything is consumed character by character
    this._buffer = '';

    // If we're in the middle of CDATA/COMMENT/TAG, the partial content
    // is already in the respective buffers, so buffer is clear.
  }

  _emitText() {
    if (this._textBuffer) {
      // Decode basic XML entities
      const decoded = this._decodeEntities(this._textBuffer);
      this._emit('onText', decoded);
      this._textBuffer = '';
    }
  }

  _processTag(raw) {
    raw = raw.trim();
    if (!raw) return;

    // Self-closing: <tag ... />
    if (raw.endsWith('/')) {
      raw = raw.slice(0, -1).trim();
      const { name, attributes } = this._parseTagContent(raw);
      this._emit('onOpenTag', { name, attributes, selfClosing: true, depth: this._depth });
      this._emit('onCloseTag', { name, depth: this._depth });
      return;
    }

    // Closing tag: /tagname
    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim();
      this._depth = Math.max(0, this._depth - 1);
      this._stack.pop();
      this._emit('onCloseTag', { name, depth: this._depth });
      return;
    }

    // DOCTYPE and other declarations — skip
    if (raw.startsWith('!')) {
      return;
    }

    // Opening tag
    const { name, attributes } = this._parseTagContent(raw);
    this._emit('onOpenTag', { name, attributes, selfClosing: false, depth: this._depth });
    this._stack.push(name);
    this._depth++;
  }

  _parseTagContent(raw) {
    // Split tag name from attributes
    const spaceIdx = raw.search(/[\s\n\r]/);
    let name, attrString;
    if (spaceIdx === -1) {
      name = raw;
      attrString = '';
    } else {
      name = raw.substring(0, spaceIdx);
      attrString = raw.substring(spaceIdx + 1);
    }

    const attributes = {};
    if (attrString) {
      // Simple attribute parser: key="value" or key='value'
      const attrRegex = /([\w\-:.]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let match;
      while ((match = attrRegex.exec(attrString)) !== null) {
        attributes[match[1]] = this._decodeEntities(match[2] ?? match[3] ?? '');
      }
    }

    return { name, attributes };
  }

  _decodeEntities(text) {
    return text
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }

  _emit(handler, data) {
    if (this.handlers[handler]) {
      this.handlers[handler](data);
    }
  }

  _error(msg) {
    if (this.handlers.onError) {
      this.handlers.onError(new Error(msg));
    }
  }
}

// Export for Worker context
if (typeof self !== 'undefined') {
  self.StreamingSAXParser = StreamingSAXParser;
}
