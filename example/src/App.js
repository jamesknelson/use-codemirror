import React from 'react';

import { CodeMirrorEditor } from './CodeMirrorEditor'

const testDoc = `
const element = document.createElement('h1')
element.innerHTML = \`
  Hello, world!<br />
\`.repeat(10)
document.getElementById('root').appendChild(element)
`

function App() {
  return (
      <CodeMirrorEditor
        docName="test.js"
        value={testDoc}
      />
  );
}

export default App;
