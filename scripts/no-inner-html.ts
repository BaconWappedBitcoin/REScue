import type { Plugin } from 'vite';

/**
 * Store review (AMO) rejects add-ons that assign to innerHTML. REScue never does, but Preact's
 * renderer carries `dangerouslySetInnerHTML` support, which REScue never uses. This removes it from
 * Preact's build and fails the build if any innerHTML / outerHTML assignment reaches the output.
 */
const PREACT = /[\\/]preact[\\/]dist[\\/]preact\.module\.js$/;
const SET_HTML = /\((\w+)\.innerHTML=\w+\.__html\)/g;
const CLEAR_HTML = /(\w+)\.innerHTML=""/g;
const ANY_ASSIGN = /\.(?:inner|outer)HTML\s*(?:\+=|=(?!=))/;

export function noInnerHtml(): Plugin {
  return {
    name: 'rescue-no-inner-html',
    enforce: 'pre',
    transform(code, id) {
      if (!PREACT.test(id)) return null;
      const out = code.replace(SET_HTML, '(void 0)').replace(CLEAR_HTML, '$1.textContent=""');
      if (out === code) this.error('Preact changed: its innerHTML code was not found to remove');
      return { code: out, map: null };
    },
    generateBundle(_options, bundle) {
      for (const [name, chunk] of Object.entries(bundle)) {
        if (chunk.type === 'chunk' && ANY_ASSIGN.test(chunk.code))
          this.error(`${name} assigns to innerHTML/outerHTML`);
      }
    },
  };
}
