/**
 * XML Processing Web Worker v1.2
 *
 * NEW: Captures raw XML samples for each unique tag (first N instances),
 *      reconstructed from SAX events. Available via 'get_samples' message.
 */

importScripts('sax-parser.js');

const CHUNK_SIZE_DEFAULT = 8 * 1024 * 1024;
const PROGRESS_INTERVAL = 500;
const MAX_TREE_CHILDREN = 500;
const MAX_SAMPLE_ELEMENTS = 200;
const MAX_SAMPLES_PER_TAG = 50;
const MAX_SAMPLE_XML_LENGTH = 32768;

let collectedSamples = {};

self.onmessage = async function (e) {
  const { type } = e.data;

  if (type === 'get_samples') {
    self.postMessage({
      type: 'samples',
      tagName: e.data.tagName,
      samples: collectedSamples[e.data.tagName] || [],
    });
    return;
  }

  if (type !== 'parse') return;

  const { file, chunkSize, query } = e.data;
  const size = file.size;
  const chunk = chunkSize || CHUNK_SIZE_DEFAULT;
  let bytesRead = 0;
  let lastProgressTime = 0;

  collectedSamples = {};

  const stats = {
    totalElements: 0,
    totalAttributes: 0,
    totalTextNodes: 0,
    totalComments: 0,
    totalCDATA: 0,
    maxDepth: 0,
    elementCounts: {},
    uniqueTags: new Set(),
    fileSize: size,
  };

  const rootNode = { name: '#root', children: [], count: 0 };
  const treeStack = [rootNode];

  // ── Element ordering: track first-seen depth for each tag ──────
  const elementFirstSeen = {};  // tagName → { order, depth }
  let elementSeenCounter = 0;

  // ── Sample capture state ──────────────────────────────────────
  const captureStack = [];
  const sampleCounts = {};

  function shouldCapture(tagName) {
    return (sampleCounts[tagName] || 0) < MAX_SAMPLES_PER_TAG;
  }

  function isCapturing() {
    return captureStack.length > 0;
  }

  function appendToCaptures(text) {
    for (let i = 0; i < captureStack.length; i++) {
      const ctx = captureStack[i];
      if (ctx.xmlLength < MAX_SAMPLE_XML_LENGTH) {
        ctx.xmlParts.push(text);
        ctx.xmlLength += text.length;
      }
    }
  }

  function finishCapture(closingName, closingDepth) {
    if (captureStack.length === 0) return;
    const top = captureStack[captureStack.length - 1];
    if (top.tagName === closingName && top.depth === closingDepth) {
      captureStack.pop();
      const xml = top.xmlParts.join('');
      if (!collectedSamples[closingName]) collectedSamples[closingName] = [];
      if (collectedSamples[closingName].length < MAX_SAMPLES_PER_TAG) {
        collectedSamples[closingName].push(xml);
      }
      sampleCounts[closingName] = (sampleCounts[closingName] || 0) + 1;
    }
  }

  // ── Query state ────────────────────────────────────────────────
  const matchedElements = [];
  const queryTagName = query?.tagName?.toLowerCase() || null;
  const queryAttrName = query?.attrName || null;
  const queryAttrValue = query?.attrValue || null;
  const queryTextContains = query?.textContains?.toLowerCase() || null;
  let currentElementForQuery = null;
  let capturingText = false;
  let capturedText = '';

  // ── Hint sample: capture a good element for the interactive tutorial ──
  // We want an element with 2+ attributes (ideal for showing tag/attr/value)
  let hintSample = null;     // { name, attributes } — best candidate so far
  let hintSampleScore = 0;   // prefer elements with more attrs, not xmlns-heavy

  // ── SAX handlers ───────────────────────────────────────────────
  const parser = new StreamingSAXParser({
    onOpenTag({ name, attributes, selfClosing, depth }) {
      stats.totalElements++;
      stats.totalAttributes += Object.keys(attributes).length;
      if (depth + 1 > stats.maxDepth) stats.maxDepth = depth + 1;
      stats.uniqueTags.add(name);
      stats.elementCounts[name] = (stats.elementCounts[name] || 0) + 1;

      // Track first appearance order and depth
      if (!(name in elementFirstSeen)) {
        elementFirstSeen[name] = { order: elementSeenCounter++, depth };
      }

      // Hint sample scoring: prefer elements with 2-5 real (non-xmlns) attrs
      if (hintSampleScore < 10) {
        const realAttrs = {};
        for (const [k, v] of Object.entries(attributes)) {
          if (!k.startsWith('xmlns')) realAttrs[k] = v;
        }
        const attrCount = Object.keys(realAttrs).length;
        let score = 0;
        if (attrCount >= 2 && attrCount <= 5) score = 5 + attrCount;
        else if (attrCount === 1) score = 3;
        if (score > hintSampleScore) {
          hintSampleScore = score;
          hintSample = { name, attributes: realAttrs, selfClosing };
        }
      }

      // Tree
      if (treeStack.length > 0) {
        const parent = treeStack[treeStack.length - 1];
        let childNode = parent.children.find(c => c.name === name);
        if (!childNode && parent.children.length < MAX_TREE_CHILDREN) {
          childNode = { name, children: [], count: 0 };
          parent.children.push(childNode);
        }
        if (childNode) {
          childNode.count++;
          if (!selfClosing) treeStack.push(childNode);
        } else if (!selfClosing) {
          treeStack.push({ name, children: [], count: 0, _placeholder: true });
        }
      }

      // ── Sample capture ──
      const attrStr = Object.entries(attributes)
        .map(([k, v]) => ` ${k}="${escXmlAttr(v)}"`)
        .join('');

      const needNewCapture = shouldCapture(name) &&
        !captureStack.some(c => c.tagName === name);

      if (needNewCapture) {
        captureStack.push({
          tagName: name,
          depth,
          xmlParts: [],
          xmlLength: 0,
        });
      }

      if (isCapturing()) {
        if (selfClosing) {
          appendToCaptures(`<${name}${attrStr}/>`);
        } else {
          appendToCaptures(`<${name}${attrStr}>`);
        }
      }

      if (selfClosing && needNewCapture) {
        finishCapture(name, depth);
      }

      // ── Query matching ──
      if (queryTagName || queryAttrName || queryAttrValue) {
        let match = true;
        if (queryTagName && name.toLowerCase() !== queryTagName) match = false;
        if (queryAttrName && queryAttrValue) {
          // Both name and value specified: exact match on specific attribute
          if (attributes[queryAttrName] !== queryAttrValue) match = false;
        } else if (queryAttrName && !queryAttrValue) {
          // Only attr name: element must have this attribute
          if (!(queryAttrName in attributes)) match = false;
        } else if (!queryAttrName && queryAttrValue) {
          // Only attr value: search across ALL attribute values
          const vals = Object.values(attributes);
          if (!vals.some(v => v === queryAttrValue)) match = false;
        }
        if (match) {
          currentElementForQuery = { name, attributes, depth, text: '' };
          if (queryTextContains) {
            capturingText = true;
            capturedText = '';
          } else if (matchedElements.length < MAX_SAMPLE_ELEMENTS) {
            matchedElements.push(currentElementForQuery);
            self.postMessage({ type: 'element', element: currentElementForQuery });
          }
        }
      } else if (queryTextContains) {
        currentElementForQuery = { name, attributes, depth, text: '' };
        capturingText = true;
        capturedText = '';
      }
    },

    onCloseTag({ name, depth }) {
      if (treeStack.length > 1) treeStack.pop();

      if (isCapturing()) {
        appendToCaptures(`</${name}>`);
        finishCapture(name, depth);
      }

      if (capturingText && currentElementForQuery && currentElementForQuery.name === name) {
        if (capturedText.toLowerCase().includes(queryTextContains)) {
          currentElementForQuery.text = capturedText.substring(0, 500);
          if (matchedElements.length < MAX_SAMPLE_ELEMENTS) {
            matchedElements.push(currentElementForQuery);
            self.postMessage({ type: 'element', element: currentElementForQuery });
          }
        }
        capturingText = false;
        capturedText = '';
        currentElementForQuery = null;
      }
    },

    onText(text) {
      stats.totalTextNodes++;
      if (isCapturing()) appendToCaptures(escXmlText(text));
      if (capturingText) capturedText += text;
    },

    onCDATA(data) {
      stats.totalCDATA++;
      if (isCapturing()) appendToCaptures(`<![CDATA[${data}]]>`);
      if (capturingText) capturedText += data;
    },

    onComment(text) {
      stats.totalComments++;
      if (isCapturing()) appendToCaptures(`<!--${text}-->`);
    },

    onError(err) {
      self.postMessage({ type: 'error', message: err.message });
    }
  });

  // ── Read file in chunks ────────────────────────────────────────
  const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });
  const startTime = performance.now();

  try {
    while (bytesRead < size) {
      const end = Math.min(bytesRead + chunk, size);
      const blob = file.slice(bytesRead, end);
      const arrayBuffer = await blob.arrayBuffer();
      const isLast = end >= size;
      const textChunk = decoder.decode(new Uint8Array(arrayBuffer), { stream: !isLast });

      parser.write(textChunk);
      bytesRead = end;

      const now = performance.now();
      if (now - lastProgressTime > PROGRESS_INTERVAL || isLast) {
        lastProgressTime = now;
        const percent = ((bytesRead / size) * 100).toFixed(1);
        self.postMessage({
          type: 'progress', bytesRead, totalBytes: size, percent: parseFloat(percent),
        });
      }
    }

    parser.end();

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);

    const finalStats = {
      ...stats,
      uniqueTags: [...stats.uniqueTags],
      topElements: Object.entries(stats.elementCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50),
      // Elements ordered by nesting depth, then by first appearance
      elementsByDepth: Object.entries(stats.elementCounts)
        .map(([name, count]) => ({
          name,
          count,
          depth: elementFirstSeen[name]?.depth ?? 0,
          order: elementFirstSeen[name]?.order ?? 0,
        }))
        .sort((a, b) => a.depth - b.depth || a.order - b.order),
    };

    self.postMessage({ type: 'structure', tree: sanitizeTree(rootNode) });

    const sampleInfo = {};
    for (const [tag, arr] of Object.entries(collectedSamples)) {
      sampleInfo[tag] = arr.length;
    }

    self.postMessage({
      type: 'done',
      stats: finalStats,
      matchCount: matchedElements.length,
      elapsed: parseFloat(elapsed),
      sampleInfo,
      hintSample,
    });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message || String(err) });
  }
};

function sanitizeTree(node, maxDepth = 6, d = 0) {
  if (d >= maxDepth) {
    return { name: node.name, count: node.count, children: node.children.length > 0 ? [{ name: '...', count: 0, children: [] }] : [] };
  }
  return {
    name: node.name, count: node.count,
    children: node.children.filter(c => !c._placeholder).slice(0, 30).map(c => sanitizeTree(c, maxDepth, d + 1))
  };
}

function escXmlAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escXmlText(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
