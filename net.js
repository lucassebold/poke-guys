// Cliente WebSocket mínimo (JSON). O protocolo está descrito em server.js.
export function openSocket(url, on) {
  const ws = new WebSocket(url);
  ws.onopen = () => on.open && on.open();
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } on.msg && on.msg(m); };
  ws.onclose = () => on.close && on.close();
  ws.onerror = () => {};
  return {
    send(o) { if (ws.readyState === 1) ws.send(JSON.stringify(o)); },
    close() { try { ws.close(); } catch { /* ignore */ } },
    get open() { return ws.readyState === 1; },
  };
}
