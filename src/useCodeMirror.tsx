/*
 * Copyright 2019 Seven Stripes Kabushiki Kaisha, MIT License
 *
 * Parts taken from react-codemirror2
 * Copyright 2019 Sal Niro, MIT License
 * https://github.com/scniro/react-codemirror2/blob/a633e7dd673ddf5bdb07e2ed664a03aa47159bfa/src/index.tsx
 */

/**
 * ## Controlled vs. uncontrolled
 *
 * This hook acts as a hybrid between a controlled and uncontrolled component;
 * it will copy through any configuration changes to the underlying CodeMirror
 * instance, but the it will still let the user make changes even if you don't
 * handle the events. This lets the editor immediately display changes, ensuring
 * there's minimal input delay.
 *
 * ## Docs
 *
 * CodeMirror stores undo history, current selection and cursor position in a
 * "Doc" object -- along with the actual text. If you're sharing the editor over
 * multiple different files, the hook needs to swap these doc objects objects
 * out as you change between files.
 *
 * To help keep track of this, the hook allows you to pass in a string to the
 * `doc` property with the current document's filename. The hook will create
 * store docs internally for each file.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react'

// CAUTION: do not add imports, or you'll break SSR. This is used for types,
// but real imports should be handled through the importCodeMirror() option.
import {} from 'codemirror'

// React currently throws a warning when using useLayoutEffect on the server.
// To get around it, we can conditionally useEffect on the server (no-op) and
// useLayoutEffect in the browser. We need useLayoutEffect because we want
// `connect` to perform sync updates to a ref to save the latest props after
// a render is actually committed to the DOM.
// https://gist.github.com/gaearon/e7d97cdf38a2907924ea12e4ebdf3c85#gistcomment-2911761
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect

export interface UseCodeMirrorOptions {
  autoCursor?: boolean // default: true
  autoScroll?: boolean // default: false
  cursor?: CodeMirror.Position
  doc?: CodeMirror.Doc
  docName?: string
  scroll?: SetScrollOptions
  selection?: { ranges: Array<SetSelectionOptions>; focus?: boolean }
  value: string

  config?: CodeMirror.EditorConfiguration

  onBlur?: () => void
  onChange?: (
    value: string,
    docName: string | undefined,
    changes: CodeMirror.EditorChange[],
    doc: CodeMirror.Doc,
  ) => void
  onCursor?: (data: CodeMirror.Position) => void
  onFocus?: () => void
  onGutterClick?: (lineNumber: number, gutter: string, event: Event) => void
  onScroll?: (scrollInfo: CodeMirror.ScrollInfo) => void
  onSelection?: (data: any) => void
  onViewportChange?: (start: number, end: number) => void

  // Only used on initial run
  importCodeMirror?: () => Promise<any>
  importCodeMirrorAddons?: () => Promise<any>
}

export interface SetScrollOptions {
  x?: number | null
  y?: number | null
}

export interface SetSelectionOptions {
  anchor: CodeMirror.Position
  head: CodeMirror.Position
}

export type CodeMirrorRefFunction = {
  bivarianceHack(instance: HTMLElement | null): void
}['bivarianceHack']

export interface ReactCodeMirror {
  config: CodeMirror.EditorConfiguration
  editor?: CodeMirror.Editor
  focus(): void
  ref: CodeMirrorRefFunction
}

export function useCodeMirror(
  unmemoizedOptions: UseCodeMirrorOptions,
): ReactCodeMirror {
  const config = useEditorConfiguration(
    unmemoizedOptions.config,
    unmemoizedOptions.docName,
  )
  const options = useMemo(
    () => ({
      ...unmemoizedOptions,
      config,
    }),
    [config, unmemoizedOptions],
  )

  const initialOptionsRef = useRef(options)
  const instanceRef = useRef<CodeMirrorInstance | null>(null)
  const externalRef = useRef<CodeMirrorRefFunction>()
  const nodePromiseRef = useRef<Promise<HTMLElement>>()
  if (!externalRef.current) {
    nodePromiseRef.current = new Promise(resolve => {
      externalRef.current = element => {
        if (element) {
          resolve(element)
        }
      }
    })
  }

  useIsomorphicLayoutEffect(() => {
    if (instanceRef.current) {
      instanceRef.current.update(options)
    } else {
      initialOptionsRef.current = options
    }
  })

  useEffect(() => {
    const importCodeMirror = options.importCodeMirror || defaultImportCodeMirror
    const importCodeMirrorAddons =
      options.importCodeMirrorAddons || (() => Promise.resolve())

    let isMounted = true
    Promise.all([
      nodePromiseRef.current!,
      importCodeMirror(),
      importCodeMirrorAddons(),
    ]).then(([node, CodeMirror]) => {
      if (isMounted) {
        instanceRef.current = new CodeMirrorInstance(
          CodeMirror,
          node,
          initialOptionsRef.current,
        )
      }
    })

    return () => {
      isMounted = false

      if (instanceRef.current) {
        instanceRef.current.dispose()
      }

      delete instanceRef.current
      delete externalRef.current
      delete nodePromiseRef.current
    }
    // eslint-disable-next-line
  }, [])

  const editor =
    (instanceRef.current && instanceRef.current.editor) || undefined

  return {
    config,
    editor,
    focus: useCallback(() => editor && editor.focus(), [editor]),
    ref: externalRef.current!,
  }
}

// ---

export interface CodeMirrorConstructor {
  new (
    callback: (host: HTMLElement) => void,
    options?: CodeMirror.EditorConfiguration,
  ): CodeMirror.Editor
  Doc: any
  defaults: any
}

interface PreservedOptions {
  cursor: CodeMirror.Position | null
}

interface EditorConfigurationWithMode extends CodeMirror.EditorConfiguration {
  mode: string
}

interface CodeMirrorInstanceOptions extends UseCodeMirrorOptions {
  config: EditorConfigurationWithMode
}

class CodeMirrorInstance {
  CodeMirror: CodeMirrorConstructor

  docs: { [pathname: string]: CodeMirror.Doc }
  editor: CodeMirror.Editor
  options: CodeMirrorInstanceOptions

  constructor(
    CodeMirror: CodeMirrorConstructor,
    placeholderNode: HTMLElement,
    options: CodeMirrorInstanceOptions,
  ) {
    this.CodeMirror = CodeMirror
    this.docs = {}
    this.options = options

    const editor = (this.editor = new CodeMirror(
      (editorNode: Node) =>
        placeholderNode.parentNode!.replaceChild(editorNode, placeholderNode),
      options.config,
    ))

    this.updateDocIfRequired()

    editor.on('blur', this.handleBlur)
    editor.on('changes', this.handleChanges)
    editor.on('scroll', this.handleScroll)
    editor.on('cursor', this.handleCursor)
    editor.on('focus', this.handleFocus)
    editor.on('gutterClick', this.handleGutterClick)
    editor.on('beforeSelectionChange', this.handleSelection)
    editor.on('viewportChange', this.handleViewportChange)
  }

  dispose() {
    // is there a lighter-weight way to remove the cm instance?
    if (this.editor) {
      // Need to swap out the old doc, otherwise it can't be used again on
      // future codemirror instances.
      this.editor.swapDoc(new this.CodeMirror.Doc(''))

      delete this.editor
      delete this.CodeMirror
    }
  }

  update(options: CodeMirrorInstanceOptions) {
    const oldOptions = options

    this.options = options

    // Switch out the doc if required
    const doc = this.updateDocIfRequired()

    const preserved: PreservedOptions = { cursor: null }

    if (!options.autoCursor && options.autoCursor !== undefined) {
      preserved.cursor = this.editor.getDoc().getCursor()
    }

    // If a new value has been set, and it differs from the editor's current
    // value, then set it in the editor.
    let didUpdateValue = false
    if (
      options.value !== undefined &&
      normalizeLineEndings(this.editor.getValue()) !==
        normalizeLineEndings(options.value) &&
      (!oldOptions || oldOptions.value !== options.value)
    ) {
      this.editor.setValue(options.value)
      didUpdateValue = true
    }

    // Update any editor config options that have changed
    const configKeys = Object.keys(
      this.options.config,
    ) as (keyof EditorConfigurationWithMode)[]
    const configDelta = configKeys.filter(
      key => this.editor.getOption(key) !== this.options.config[key],
    )
    configDelta.forEach(key => {
      this.editor.setOption(key, this.options.config[key])
    })

    // Update selection if required
    if (didUpdateValue && options.selection && options.selection.ranges) {
      doc.setSelections(options.selection.ranges)
      if (options.selection.focus) {
        this.editor.focus()
      }
    }

    // Update cursor position if required
    if (options.cursor) {
      if (this.editor.getOption('autofocus')) {
        this.editor.focus()
      }
      doc.setCursor(
        preserved.cursor || options.cursor,
        undefined,
        options.autoScroll ? undefined : { scroll: false },
      )
    }

    // Update scroll if required
    if (options.scroll) {
      this.editor.scrollTo(options.scroll.x, options.scroll.y)
    }
  }

  // Returns true if the doc was updated
  private updateDocIfRequired() {
    let {
      config: { mode },
      doc,
      docName,
      value,
    } = this.options
    if (!docName) {
      docName = ''
    }
    if (!doc) {
      doc = this.docs[docName]
      if (!doc) {
        doc = this.docs[docName] = new this.CodeMirror.Doc(value, mode)
      }
    }
    this.docs[docName] = doc!
    if (doc !== this.editor.getDoc()) {
      this.editor.swapDoc(doc!)
    }
    return doc!
  }

  private handleBlur = () => {
    if (this.options.onBlur) {
      this.options.onBlur()
    }
  }
  private handleChanges = (
    editor: CodeMirror.Editor,
    changes: CodeMirror.EditorChange[],
  ) => {
    // Ignore changes caused by this component
    if (changes.length === 1 && changes[0].origin === 'setValue') {
      return
    }
    if (!this.options.config.readOnly && this.options.onChange) {
      this.options.onChange(
        editor.getValue(),
        this.options.docName,
        changes,
        editor.getDoc(),
      )
    }
  }
  private handleCursor = (editor: CodeMirror.Editor) => {
    if (this.options.onCursor) {
      this.options.onCursor(editor.getDoc().getCursor())
    }
  }
  private handleFocus = () => {
    if (this.options.onFocus) {
      this.options.onFocus()
    }
  }
  private handleGutterClick = (
    editor: CodeMirror.Editor,
    lineNumber: number,
    gutter: string,
    event: Event,
  ) => {
    if (this.options.onGutterClick) {
      this.options.onGutterClick(lineNumber, gutter, event)
    }
  }
  private handleScroll = (editor: CodeMirror.Editor) => {
    if (this.options.onScroll) {
      this.options.onScroll(editor.getScrollInfo())
    }
  }
  private handleSelection = (editor: CodeMirror.Editor, data: any) => {
    if (this.options.onSelection) {
      this.options.onSelection(data)
    }
  }
  private handleViewportChange = (
    editor: CodeMirror.Editor,
    from: number,
    to: number,
  ) => {
    if (this.options.onViewportChange) {
      this.options.onViewportChange(from, to)
    }
  }
}

const modeAliases: { [name: string]: string } = {
  js: 'jsx',
  html: 'htmlmixed',
  md: 'markdown',
  mdx: 'markdown',
  scss: 'text/x-scss',
}

function defaultImportCodeMirror() {
  // CodeMirror crashes when loaded without a DOM, so let's avoid loading
  // it on the server.
  let codeMirrorPromise =
    typeof navigator === 'undefined'
      ? Promise.resolve([])
      : Promise.all([
          import('codemirror'),

          import('codemirror/mode/jsx/jsx'),
          import('codemirror/mode/css/css'),
          import('codemirror/mode/markdown/markdown'),
          import('codemirror/mode/htmlmixed/htmlmixed'),
          import('codemirror/keymap/sublime'),
          import('codemirror/addon/comment/comment'),
          import('codemirror/addon/edit/closebrackets'),
          import('codemirror/addon/edit/matchbrackets'),
          import('codemirror/addon/edit/matchtags'),
          import('codemirror/addon/fold/xml-fold'),
          import('codemirror/addon/scroll/simplescrollbars'),
          import('codemirror/addon/selection/active-line'),
        ])

  return codeMirrorPromise.then(([{ default: codeMirror }]) => codeMirror)
}

function getDefaultMode(docName?: string) {
  return docName && docName.split('.').reverse()[0]
}

const defaultMatchTagsConfig = { bothTags: true }
const defaultExtraKeysConfig = {
  Tab: (cm: CodeMirror.Editor) => {
    var spaces = Array(cm.getOption('indentUnit')! + 1).join(' ')
    cm.getDoc().replaceSelection(spaces)
  },
  'Cmd-/': (cm: CodeMirror.Editor) => {
    cm.getDoc()
      .listSelections()
      .forEach(() => {
        cm.toggleComment({ indent: true })
      })
  },
}
function useEditorConfiguration(
  { extraKeys, mode, ...rest }: CodeMirror.EditorConfiguration = {},
  docName?: string,
): EditorConfigurationWithMode {
  const extraKeysConfig = useMemo(
    () =>
      typeof extraKeys === 'string'
        ? extraKeys
        : {
            ...defaultExtraKeysConfig,
            ...extraKeys,
          },
    [extraKeys],
  )

  if (!mode) {
    mode = getDefaultMode(docName)
  }

  return useMemo(
    () => ({
      autoCloseBrackets: true,
      indentWithTabs: false,
      extraKeys: extraKeysConfig,
      keyMap: 'sublime',
      matchBrackets: true,
      matchTags: defaultMatchTagsConfig,
      mode: modeAliases[mode] || mode,
      scrollbarStyle: 'simple',
      smartIndent: false,
      styleActiveLine: true,
      tabSize: 2,
      ...rest,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [extraKeys, mode, ...Object.values(rest)],
  )
}

function normalizeLineEndings(str: string) {
  if (!str) return str
  return str.replace(/\r\n|\r/g, '\n')
}
