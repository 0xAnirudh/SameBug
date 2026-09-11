import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';

/** One component for both modes — the view page is the same editor, read-only. */
function languageExtension(language) {
  switch (language) {
    case 'javascript':
      return javascript();
    case 'typescript':
      return javascript({ typescript: true });
    case 'python':
      return python();
    case 'json':
      return json();
    default:
      return [];
  }
}

/**
 * Colours come from the page's CSS custom properties so the editor follows the
 * light/dark theme instead of shipping its own opinion.
 */
const theme = EditorView.theme({
  '&': { backgroundColor: 'var(--sunken)', color: 'var(--ink)' },
  '.cm-content': { caretColor: 'var(--accent)' },
  '.cm-gutters': {
    backgroundColor: 'var(--sunken)',
    color: 'var(--ink-mute)',
    border: 'none',
    borderRight: '1px solid var(--rule-soft)',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--ink-soft)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'var(--accent-soft)',
  },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
});

export function CodeMirror({ value, onChange, language = 'plaintext', readOnly = false, minHeight = 320 }) {
  const host = useRef(null);
  const view = useRef(null);
  const langCompartment = useRef(new Compartment());
  // Held in a ref so changing the handler never tears down the editor.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const state = EditorState.create({
      doc: value ?? '',
      extensions: [
        basicSetup,
        theme,
        EditorView.lineWrapping,
        langCompartment.current.of(languageExtension(language)),
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        EditorView.theme({ '.cm-content': { minHeight: `${minHeight}px` } }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
        }),
      ],
    });

    view.current = new EditorView({ state, parent: host.current });
    return () => view.current?.destroy();
    // Recreating on readOnly/minHeight change is fine; those never change in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, minHeight]);

  // A compartment lets the language swap without losing the document or cursor.
  useEffect(() => {
    view.current?.dispatch({
      effects: langCompartment.current.reconfigure(languageExtension(language)),
    });
  }, [language]);

  // Only push external values in — echoing our own edits back would fight the cursor.
  useEffect(() => {
    const current = view.current?.state.doc.toString();
    if (view.current && value !== undefined && value !== current) {
      view.current.dispatch({
        changes: { from: 0, to: view.current.state.doc.length, insert: value },
      });
    }
  }, [value]);

  return <div className="editor-wrap" ref={host} />;
}
