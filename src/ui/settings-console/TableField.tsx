/**
 * Table option editor (filters, tags, toggles). An edit that fails the spec's validateRow is
 * rejected at input: an inline error is shown and nothing is saved. Adding a blank row is always
 * allowed; incomplete rows are ignored by the module that reads them.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { hint, label } from '../../core/hints';
import type { OptionSpec } from '../../core/types';

type TableSpec = Extract<OptionSpec, { type: 'table' }>;
type Row = Record<string, unknown>;

interface Props {
  spec: TableSpec;
  value: Row[];
  onChange(rows: Row[]): void;
  common: Record<string, string>;
}

const val = (e: Event) => e.currentTarget as unknown as HTMLInputElement & HTMLSelectElement;

interface CellProps {
  type: 'text' | 'color';
  col: string;
  title: string;
  value: string;
  /** Returns true when the edit was accepted (so the draft can give way to the saved value). */
  commit(v: string): boolean;
}

/**
 * A text cell commits on change (blur) but keeps what the reader typed in a local draft until then,
 * so a re-render caused by saving ANOTHER cell never overwrites text that has not blurred yet. A
 * rejected edit keeps its draft next to the error message.
 */
function TextCell({ type, col, title, value, commit }: CellProps) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type={type}
      data-col={col}
      data-rescue-input=""
      aria-label={title}
      value={draft ?? value}
      onInput={(e) => setDraft(val(e).value)}
      onChange={(e) => {
        const v = val(e).value;
        if (commit(v)) setDraft(null);
        else setDraft(v);
      }}
    />
  );
}

export function TableField({ spec, value: rows, onChange, common }: Props) {
  const [error, setError] = useState<{ row: number; message: string } | null>(null);
  // The newest rows, including edits not yet echoed back by the parent: two cells committed in
  // quick succession must build on each other, not on the stale render.
  const latest = useRef(rows);
  latest.current = rows;
  // A stable key per row, so a cell's unsaved draft travels with its row when rows are reordered.
  const nextId = useRef(0);
  const ids = useRef<number[]>([]);
  while (ids.current.length < rows.length) ids.current.push(nextId.current++);
  ids.current.length = rows.length;
  const dragFrom = useRef<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [focusMove, setFocusMove] = useState<{
    row: number;
    action: 'drag' | 'move-up' | 'move-down';
  } | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusMove) return;
    const tr = root.current?.querySelectorAll('tbody tr')[focusMove.row];
    const btn =
      tr?.querySelector<HTMLButtonElement>(`button[data-action=${focusMove.action}]`) ?? null;
    (btn && !btn.disabled
      ? btn
      : tr?.querySelector<HTMLButtonElement>('button[data-action^=move]:not(:disabled)')
    )?.focus();
    setFocusMove(null);
  }, [focusMove]);

  /** Move the row at `from` so it ends up at index `to` (the cell drafts move with it). */
  const move = (from: number, to: number) => {
    const cur = latest.current;
    if (from === to || to < 0 || to >= cur.length || from < 0 || from >= cur.length) return;
    const out = [...cur];
    const [row] = out.splice(from, 1);
    out.splice(to, 0, row!);
    const order = [...ids.current];
    const [id] = order.splice(from, 1);
    order.splice(to, 0, id!);
    ids.current = order;
    setError(null);
    latest.current = out;
    onChange(out);
  };

  const blank = (): Row =>
    Object.fromEntries(
      spec.columns.map((c) => [
        c.key,
        c.default ??
          (c.type === 'boolean' ? false : c.type === 'enum' ? (c.values?.[0] ?? '') : ''),
      ]),
    );

  const setCell = (i: number, key: string, v: unknown): boolean => {
    const cur = latest.current;
    const next = { ...cur[i], [key]: v };
    const problem = spec.validateRow?.(next) ?? null;
    if (problem) {
      setError({ row: i, message: problem });
      return false;
    }
    setError(null);
    const out = cur.map((r, j) => (j === i ? next : r));
    latest.current = out;
    onChange(out);
    return true;
  };

  return (
    <div class="table-field" ref={root}>
      <table {...common} class="rescue-table">
        <thead>
          <tr>
            {spec.columns.map((c) => (
              <th scope="col">{c.title}</th>
            ))}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={ids.current[i]}
              class={`${error?.row === i ? 'invalid' : ''} ${dropAt === i ? 'drop-target' : ''}`}
              onDragOver={(e) => {
                if (dragFrom.current === null) return;
                e.preventDefault();
                setDropAt(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragFrom.current;
                dragFrom.current = null;
                setDropAt(null);
                if (from !== null) move(from, i);
              }}
            >
              {spec.columns.map((c) => (
                <td>
                  {c.type === 'boolean' ? (
                    <input
                      type="checkbox"
                      data-col={c.key}
                      aria-label={c.title}
                      checked={!!r[c.key]}
                      onChange={(e) => setCell(i, c.key, val(e).checked)}
                    />
                  ) : c.type === 'enum' ? (
                    <select
                      data-col={c.key}
                      aria-label={c.title}
                      value={String(r[c.key] ?? '')}
                      onChange={(e) => setCell(i, c.key, val(e).value)}
                    >
                      {(c.values ?? []).map((v) => (
                        <option value={v}>{v}</option>
                      ))}
                    </select>
                  ) : (
                    <TextCell
                      type={c.type === 'color' ? 'color' : 'text'}
                      col={c.key}
                      title={c.title}
                      value={String(r[c.key] ?? '')}
                      commit={(v) => setCell(i, c.key, v)}
                    />
                  )}
                </td>
              ))}
              <td class="row-tools">
                <button
                  type="button"
                  class="drag-handle"
                  data-action="drag"
                  draggable
                  aria-label={`Move row ${i + 1}: drag, or press Alt+Up or Alt+Down`}
                  title={hint.rowDrag(i + 1)}
                  onDragStart={(e) => {
                    dragFrom.current = i;
                    if (e.dataTransfer) {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', String(i));
                    }
                  }}
                  onDragEnd={() => {
                    dragFrom.current = null;
                    setDropAt(null);
                  }}
                  onKeyDown={(e) => {
                    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                    e.preventDefault();
                    const dir = e.key === 'ArrowUp' ? 'up' : 'down';
                    move(i, dir === 'up' ? i - 1 : i + 1);
                    setFocusMove({ row: dir === 'up' ? i - 1 : i + 1, action: 'drag' });
                  }}
                >
                  {label.drag}
                </button>
                <button
                  type="button"
                  data-action="move-up"
                  aria-label={`Move row ${i + 1} up`}
                  title={hint.rowUp(i + 1)}
                  disabled={i === 0}
                  onClick={() => {
                    move(i, i - 1);
                    setFocusMove({ row: i - 1, action: 'move-up' });
                  }}
                >
                  {label.up}
                </button>
                <button
                  type="button"
                  data-action="move-down"
                  aria-label={`Move row ${i + 1} down`}
                  title={hint.rowDown(i + 1)}
                  disabled={i === rows.length - 1}
                  onClick={() => {
                    move(i, i + 1);
                    setFocusMove({ row: i + 1, action: 'move-down' });
                  }}
                >
                  {label.down}
                </button>
                <button
                  type="button"
                  data-action="remove"
                  aria-label="Remove row"
                  title={hint.rowRemove(i + 1)}
                  onClick={() => {
                    setError(null);
                    ids.current = ids.current.filter((_, j) => j !== i);
                    onChange(rows.filter((_, j) => j !== i));
                  }}
                >
                  {label.remove}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={spec.columns.length + 1}>
              <button
                type="button"
                data-action="add"
                title={hint.rowAdd}
                onClick={() => onChange([...rows, blank()])}
              >
                + add
              </button>
            </td>
          </tr>
        </tfoot>
      </table>
      {error && (
        <p class="field-error" role="alert">
          Row {error.row + 1}: {error.message} Not saved.
        </p>
      )}
    </div>
  );
}
