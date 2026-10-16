function cells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function appendInline(parent, value, document) {
  const pattern = /\*\*(.+?)\*\*/g;
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    parent.append(document.createTextNode(value.slice(cursor, match.index)));
    const strong = document.createElement('strong');
    strong.textContent = match[1];
    parent.append(strong);
    cursor = match.index + match[0].length;
  }
  parent.append(document.createTextNode(value.slice(cursor)));
}

// shortcut: Only bundled fixture Markdown is supported; use a full parser if sources become user-authored.
export function renderSourceMarkdown(body, document) {
  const fragment = document.createDocumentFragment();
  const lines = body.split(/\r?\n/);

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      const element = document.createElement(`h${Math.min(heading[1].length + 1, 6)}`);
      appendInline(element, heading[2], document);
      fragment.append(element);
      index += 1;
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && cells(lines[index + 1]).every((cell) => /^:?-{3,}:?$/.test(cell))) {
      const headers = cells(line);
      const table = document.createElement('table');
      const headRow = document.createElement('tr');
      const head = document.createElement('thead');
      const bodyElement = document.createElement('tbody');
      for (const value of headers) {
        const cell = document.createElement('th');
        appendInline(cell, value, document);
        headRow.append(cell);
      }
      head.append(headRow);
      table.append(head, bodyElement);
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        const row = document.createElement('tr');
        const values = cells(lines[index]);
        for (let column = 0; column < headers.length; column += 1) {
          const cell = document.createElement('td');
          appendInline(cell, values[column] ?? '', document);
          row.append(cell);
        }
        bodyElement.append(row);
        index += 1;
      }
      fragment.append(table);
      continue;
    }

    const item = line.match(/^\s*[-*+]\s+(.+)$/);
    if (item) {
      const list = document.createElement('ul');
      while (index < lines.length) {
        const next = lines[index].match(/^\s*[-*+]\s+(.+)$/);
        if (!next) break;
        const listItem = document.createElement('li');
        appendInline(listItem, next[1], document);
        list.append(listItem);
        index += 1;
      }
      fragment.append(list);
      continue;
    }

    const paragraph = document.createElement('p');
    appendInline(paragraph, line, document);
    fragment.append(paragraph);
    index += 1;
  }

  return fragment;
}
