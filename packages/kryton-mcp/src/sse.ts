/**
 * Minimal SSE (text/event-stream) parser. Streamable HTTP MCP uses SSE
 * framing both for the GET notifications channel and for POST responses
 * when the server elects to stream multiple messages in reply.
 *
 * Spec: https://html.spec.whatwg.org/multipage/server-sent-events.html
 * We only consume the `event:` + `data:` fields — `id:` and `retry:` are
 * recognised but ignored (the MCP transport doesn't lean on them).
 */

export interface SseEvent {
  event: string;
  data: string;
  id?: string;
}

/** Stateful line-based decoder. Feed `push(chunk)` and read events from
 *  the returned array; flush() emits any final event without a trailing
 *  blank line. */
export class SseDecoder {
  private buffer = "";
  private eventName = "";
  private dataLines: string[] = [];
  private lastId: string | undefined;

  push(chunk: string): SseEvent[] {
    this.buffer += chunk;
    const out: SseEvent[] = [];
    let idx: number;
    // SSE dispatches on each line; a blank line ends an event.
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      let line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      const ev = this.handleLine(line);
      if (ev) out.push(ev);
    }
    return out;
  }

  /** Force-emit any pending event (used when the underlying stream
   *  closes without a final blank-line delimiter). */
  flush(): SseEvent | null {
    if (this.dataLines.length === 0 && this.eventName === "") return null;
    return this.dispatch();
  }

  private handleLine(line: string): SseEvent | null {
    if (line === "") {
      // Empty line → dispatch.
      if (this.dataLines.length === 0 && this.eventName === "") return null;
      return this.dispatch();
    }
    if (line.startsWith(":")) {
      // Comment, ignore.
      return null;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "event":
        this.eventName = value;
        break;
      case "data":
        this.dataLines.push(value);
        break;
      case "id":
        this.lastId = value;
        break;
      case "retry":
        // ignored
        break;
      default:
        // Unknown field — ignore per spec.
        break;
    }
    return null;
  }

  private dispatch(): SseEvent {
    const ev: SseEvent = {
      event: this.eventName === "" ? "message" : this.eventName,
      data: this.dataLines.join("\n"),
      id: this.lastId,
    };
    this.eventName = "";
    this.dataLines = [];
    return ev;
  }
}
