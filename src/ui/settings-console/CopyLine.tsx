/** A settings-console line with text to copy: the label, the text (selectable), and a Copy button. */
import { useRef, useState } from 'preact/hooks';

export function CopyLine({ label, text }: { label: string; text: string }) {
  const ref = useRef<HTMLElement>(null);
  const [state, setState] = useState<'idle' | 'copied' | 'select'>('idle');
  const selectText = () => {
    const el = ref.current;
    const sel = el ? window.getSelection() : null;
    if (el && sel) sel.selectAllChildren(el);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      // No clipboard access here: select the text so Ctrl+C copies it.
      selectText();
      setState('select');
    }
  };
  return (
    <span class="copy-line">
      {label}{' '}
      <code ref={ref} class="copy-text" data-copy-text="">
        {text}
      </code>{' '}
      <button
        type="button"
        class="copy-btn"
        title="REScue: copy this to the clipboard"
        onClick={() => void copy()}
      >
        {state === 'copied' ? 'Copied' : 'Copy'}
      </button>
      {state === 'select' && <span class="copy-hint"> Selected: press Ctrl+C to copy.</span>}
    </span>
  );
}
