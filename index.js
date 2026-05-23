const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const PAGE_ID = '368fc256055a809a94c0dbb8f7858b9b';
const NOTION_VERSION = '2022-06-28';

function notionHeaders() {
  return {
    'Authorization': `Bearer ${NOTION_TOKEN}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json'
  };
}

function extractText(richText) {
  if (!richText || !richText.length) return '';
  return richText.map(r => r.plain_text || '').join('');
}

async function fetchBlocks(blockId) {
  const res = await fetch(
    `https://api.notion.com/v1/blocks/${blockId}/children?page_size=100`,
    { headers: notionHeaders() }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.results || [];
}

// GET /api/page — returns all checkboxes and fields from Notion
app.get('/api/page', async (req, res) => {
  try {
    const blocks = await fetchBlocks(PAGE_ID);

    const checkboxes = [];
    const fields = [];

    for (const block of blocks) {
      if (block.type === 'to_do') {
        const label = extractText(block.to_do.rich_text);
        if (label) {
          checkboxes.push({
            id: block.id,
            label,
            checked: block.to_do.checked || false
          });
        }
      } else if (block.type === 'callout') {
        const context = extractText(block.callout.rich_text);
        if (block.has_children) {
          const children = await fetchBlocks(block.id);
          for (const child of children) {
            if (child.type === 'paragraph') {
              const text = extractText(child.paragraph.rich_text);
              const colonIdx = text.indexOf(':');
              if (colonIdx > 0) {
                const label = text.substring(0, colonIdx).trim();
                const value = text.substring(colonIdx + 1).trim();
                fields.push({
                  id: child.id,
                  label,
                  value,
                  context
                });
              }
            }
          }
        }
      }
    }

    res.json({ checkboxes, fields });
  } catch (e) {
    console.error('GET /api/page error:', e);
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/checkbox — toggle a checkbox block
app.patch('/api/checkbox', async (req, res) => {
  const { id, checked } = req.body;
  if (!id || checked === undefined) {
    return res.status(400).json({ error: 'id and checked are required' });
  }
  try {
    const r = await fetch(`https://api.notion.com/v1/blocks/${id}`, {
      method: 'PATCH',
      headers: notionHeaders(),
      body: JSON.stringify({ to_do: { checked } })
    });
    if (!r.ok) {
      const err = await r.text();
      throw new Error(`Notion error ${r.status}: ${err}`);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('PATCH /api/checkbox error:', e);
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/field — update a paragraph (field) block
app.patch('/api/field', async (req, res) => {
  const { id, label, value } = req.body;
  if (!id || !label) {
    return res.status(400).json({ error: 'id and label are required' });
  }
  try {
    const r = await fetch(`https://api.notion.com/v1/blocks/${id}`, {
      method: 'PATCH',
      headers: notionHeaders(),
      body: JSON.stringify({
        paragraph: {
          rich_text: [{ type: 'text', text: { content: `${label}: ${value || ''}` } }]
        }
      })
    });
    if (!r.ok) {
      const err = await r.text();
      throw new Error(`Notion error ${r.status}: ${err}`);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('PATCH /api/field error:', e);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Nada's Unit Checklist running on port ${PORT}`);
  if (!NOTION_TOKEN) {
    console.warn('WARNING: NOTION_TOKEN is not set!');
  }
});
