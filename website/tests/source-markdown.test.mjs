import assert from 'node:assert/strict';
import test from 'node:test';

import { renderSourceMarkdown } from '../source-markdown.js';
import { story } from '../story-data.js';

const escapeHtml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

class Node {
  constructor(tag = '') { this.tag = tag; this.children = []; this.value = ''; }
  append(...children) { this.children.push(...children); }
  set textContent(value) { this.children = []; this.value = String(value); }
  get textContent() { return this.value + this.children.map((child) => child.textContent).join(''); }
  get html() {
    const content = escapeHtml(this.value) + this.children.map((child) => child.html).join('');
    return this.tag ? `<${this.tag}>${content}</${this.tag}>` : content;
  }
}

const document = {
  createDocumentFragment: () => new Node(),
  createElement: (tag) => new Node(tag),
  createTextNode: (value) => { const node = new Node(); node.textContent = value; return node; },
};

test('renders fixture headings, emphasis, lists, and invoice table', () => {
  const delivery = renderSourceMarkdown(story.tr.sources.find(({ id }) => id === 'delivery').body, document);
  const invoice = renderSourceMarkdown(story.tr.sources.find(({ id }) => id === 'invoice').body, document);

  assert.match(delivery.html, /^<h2>Atlas Lojistik/);
  assert.match(delivery.html, /<ul><li>Deniz[^<]+<strong>6 saat<\/strong>/);
  assert.match(delivery.html, /<strong>18 saattir<\/strong>/);
  assert.match(invoice.html, /<table><thead><tr><th>Kalem<\/th>/);
  assert.match(invoice.html, /<tbody><tr><td>Aylık yazılım bakım hizmeti<\/td>/);
});

test('keeps HTML and link syntax inert instead of creating unsafe elements', () => {
  const fragment = renderSourceMarkdown('<img src=x onerror=alert(1)>\n\n[click](javascript:alert(1))\n\n**safe**', document);

  assert.match(fragment.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(fragment.html, /\[click\]\(javascript:alert\(1\)\)/);
  assert.doesNotMatch(fragment.html, /<(?:img|script|a)\b/);
  assert.match(fragment.html, /<strong>safe<\/strong>/);
});
