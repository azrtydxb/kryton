import React, { useRef, useEffect, useCallback } from "react";
import { StyleSheet } from "react-native";
import WebView, { WebViewMessageEvent } from "react-native-webview";

export interface EditorBridgeProps {
  content: string;
  darkMode: boolean;
  onContentChange: (content: string) => void;
  onSave: () => void;
}

function buildEditorHTML(darkMode: boolean): string {
  const bg = darkMode ? "#0d1117" : "#ffffff";
  const fg = darkMode ? "#e2e8f0" : "#1a1a1a";
  const border = darkMode ? "#374151" : "#d1d5db";

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    height: 100%;
    background: ${bg};
    color: ${fg};
  }
  #editor {
    display: block;
    width: 100%;
    min-height: 100vh;
    padding: 16px;
    background: ${bg};
    color: ${fg};
    font-family: 'Courier New', Courier, monospace;
    font-size: 15px;
    line-height: 1.6;
    border: none;
    outline: none;
    resize: none;
    caret-color: #7c3aed;
    border-top: 1px solid ${border};
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  #editor::placeholder {
    color: #64748b;
  }
</style>
</head>
<body>
<textarea id="editor" placeholder="Start writing…" spellcheck="true"></textarea>
<script>
  var editor = document.getElementById('editor');
  var saveTimer = null;

  function postMessage(data) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(data));
    }
  }

  editor.addEventListener('input', function() {
    postMessage({ type: 'contentChanged', content: editor.value });
  });

  // Auto-grow
  editor.addEventListener('input', function() {
    editor.style.height = 'auto';
    editor.style.height = editor.scrollHeight + 'px';
  });

  // Listen for messages from React Native
  document.addEventListener('message', function(event) {
    try {
      var msg = JSON.parse(event.data);
      if (msg.type === 'setContent') {
        editor.value = msg.content;
        editor.style.height = 'auto';
        editor.style.height = editor.scrollHeight + 'px';
      }
    } catch(e) {}
  });

  window.addEventListener('message', function(event) {
    try {
      var msg = JSON.parse(event.data);
      if (msg.type === 'setContent') {
        editor.value = msg.content;
        editor.style.height = 'auto';
        editor.style.height = editor.scrollHeight + 'px';
      }
    } catch(e) {}
  });
</script>
</body>
</html>`;
}

export default function EditorBridge({
  content,
  darkMode,
  onContentChange,
  onSave,
}: EditorBridgeProps) {
  const webViewRef = useRef<WebView>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInitializedRef = useRef(false);

  // Inject initial content once the WebView is ready
  const injectedJavaScript = `
    (function() {
      var editor = document.getElementById('editor');
      if (editor) {
        editor.value = ${JSON.stringify(content)};
        editor.style.height = 'auto';
        editor.style.height = editor.scrollHeight + 'px';
      }
      true;
    })();
  `;

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const data = JSON.parse(event.nativeEvent.data);
        if (data.type === "contentChanged") {
          onContentChange(data.content);

          // Debounce save: 2 seconds after last change
          if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
          }
          saveTimerRef.current = setTimeout(() => {
            onSave();
          }, 2000);
        }
      } catch {
        // ignore malformed messages
      }
    },
    [onContentChange, onSave]
  );

  // When content prop changes externally, push it into the editor
  useEffect(() => {
    if (!isInitializedRef.current) return;
    webViewRef.current?.injectJavaScript(`
      (function() {
        var editor = document.getElementById('editor');
        if (editor && editor.value !== ${JSON.stringify(content)}) {
          editor.value = ${JSON.stringify(content)};
          editor.style.height = 'auto';
          editor.style.height = editor.scrollHeight + 'px';
        }
        true;
      })();
    `);
  }, [content]);

  return (
    <WebView
      ref={webViewRef}
      source={{ html: buildEditorHTML(darkMode) }}
      style={styles.webview}
      injectedJavaScript={injectedJavaScript}
      onMessage={handleMessage}
      scrollEnabled={true}
      keyboardDisplayRequiresUserAction={false}
      onLoadEnd={() => {
        isInitializedRef.current = true;
      }}
      javaScriptEnabled={true}
      domStorageEnabled={true}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  webview: {
    flex: 1,
    backgroundColor: "#0d1117",
  },
});
