import React from 'react'
import { useCodeMirror } from 'use-codemirror'

import { StyledCodeMirrorEditor } from './CodeMirrorEditor.styles'

export function CodeMirrorEditor({
  className,
  style,
  ...options
}) {
  let codeMirror = useCodeMirror({
    ...options,
    config: {
      theme: 'demoboard-light',
      ...options.config,
    },
  })

  return (
    <StyledCodeMirrorEditor className={className} style={style}>
      <pre ref={codeMirror.ref} className={codeMirror.config.theme}>
        {options.value}
      </pre>
    </StyledCodeMirrorEditor>
  )
}
