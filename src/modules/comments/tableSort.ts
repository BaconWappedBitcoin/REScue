/**
 * Click-to-sort for markdown tables (RES tableTools, US6). Ported from RES lib/utils/Table.js
 * sortByColumn (GPL-3.0, the RES contributors, commit 4defffc): the first click sorts a column
 * ascending, the next reverses it, a different column starts again ascending. Cells compare as
 * numbers when both are numbers, else by text with numeric-aware collation.
 */

export const SORT_ASC = 'sort-asc';
export const SORT_DESC = 'sort-desc';

const cellsOf = (row: Element): Element[] =>
  [...row.children].filter((c) => /^(td|th)$/i.test(c.tagName));

const rowsOf = (section: Element): Element[] =>
  [...section.children].filter((c) => /^tr$/i.test(c.tagName));

const textOf = (row: Element, index: number): string =>
  (cellsOf(row)[index]?.textContent ?? '').trim();

function compareCells(a: string, b: string): number {
  const na = Number(a.replace(/[,\s%$]/g, ''));
  const nb = Number(b.replace(/[,\s%$]/g, ''));
  if (a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b, undefined, { numeric: true });
}

/** The rows that sort: the body's rows, or every row below the header row when there is no tbody. */
function bodyRows(table: Element, headerRow: Element): Element[] {
  const tbody = [...table.children].find((c) => /^tbody$/i.test(c.tagName));
  if (tbody) return rowsOf(tbody);
  return rowsOf(table).filter((r) => r !== headerRow);
}

/** Sort `table` by the column of header cell `th`. Returns false when it is not a header cell. */
export function sortByColumn(th: Element): boolean {
  const table = th.closest('table');
  const headerRow = th.parentElement;
  if (!table || !headerRow || !/^tr$/i.test(headerRow.tagName)) return false;
  const rows = bodyRows(table, headerRow);
  if (!rows.length) return false;
  const reverse = th.classList.contains(SORT_ASC) || th.classList.contains(SORT_DESC);
  const index = cellsOf(headerRow).indexOf(th);

  if (reverse) rows.reverse();
  else rows.sort((a, b) => compareCells(textOf(a, index), textOf(b, index)));
  const parent = rows[0]!.parentElement!;
  for (const r of rows) parent.appendChild(r);

  if (reverse) {
    th.classList.toggle(SORT_ASC);
    th.classList.toggle(SORT_DESC);
  } else {
    for (const prev of table.querySelectorAll(`.${SORT_ASC}, .${SORT_DESC}`))
      prev.classList.remove(SORT_ASC, SORT_DESC);
    th.classList.add(SORT_ASC);
  }
  return true;
}
