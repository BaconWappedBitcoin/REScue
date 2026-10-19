/**
 * tableTools (RES tableTools, US6): click a column heading of a table in a post or comment to sort
 * by it; click again to reverse. Only tables Reddit renders in light DOM inside an item body are
 * touched. Ported in spirit from RES lib/modules/tableTools.js (GPL-3.0, the RES contributors,
 * commit 4defffc); the code is new.
 */
import { hint } from '../../core/hints';
import { defineModule } from '../../core/types';
import { bodyTables, inItemBody } from '../../model/access';
import { SORT_ASC, SORT_DESC, sortByColumn } from './tableSort';

const STYLE_ID = 'rescue-table-tools';
const SORTABLE = 'rescue-sortable';
const STYLE = [
  `table.${SORTABLE} th{cursor:pointer}`,
  `table.${SORTABLE} th.${SORT_ASC}::after{content:" \\25B2";font-size:.8em}`,
  `table.${SORTABLE} th.${SORT_DESC}::after{content:" \\25BC";font-size:.8em}`,
].join('\n');

let onClick: ((e: MouseEvent) => void) | null = null;

export const tableTools = defineModule({
  id: 'tableTools',
  resId: 'tableTools',
  category: 'comments',
  title: 'Table tools',
  description:
    'Click a column heading of a table in a post or comment to sort by that column; click again to reverse the order. Numbers sort as numbers.',
  enabledByDefault: true,
  options: {},

  init() {
    document.getElementById(STYLE_ID)?.remove();
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE;
    document.head.appendChild(style);
    onClick = (e) => {
      const th = e.target instanceof Element ? e.target.closest('th') : null;
      const table = th?.closest('table');
      if (!th || !table || !inItemBody(table)) return;
      if (sortByColumn(th)) table.classList.add(SORTABLE);
    };
    document.addEventListener('click', onClick);
  },

  onItems(batch) {
    // Mark the tables up front so their headings already look clickable.
    for (const item of [...batch.posts, ...batch.comments])
      for (const table of bodyTables(item.source)) {
        table.classList.add(SORTABLE);
        for (const th of table.querySelectorAll('th')) if (!th.title) th.title = hint.tableHeader;
      }
  },

  dispose() {
    if (onClick) document.removeEventListener('click', onClick);
    onClick = null;
    document.getElementById(STYLE_ID)?.remove();
  },
});
