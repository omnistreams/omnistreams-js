class WebSocketClientTransport {
  constructor(uri) {
    this._connect(uri); 
  }

  get ready() {
    return this._readyPromise;
  }

  get readable() {
    return this._recvStream.readable;
  }

  get writable() {
    return this._sendStream.writable;
  }

  get closed() {
    return this._closedPromise;
  }

  close() {
    this._ws.close();
  }

  _connect(uri) {
    const parsedUri = new URL(uri);
    const scheme = parsedUri.protocol === 'https:' ? 'wss://' : 'ws://';
    const wsUri = `${scheme}${parsedUri.host}${parsedUri.pathname}${parsedUri.search}`;
    const ws = new WebSocket(wsUri); 

    ws.binaryType = 'arraybuffer';

    let onReady;
    let onConnectError;
    this._readyPromise = new Promise((resolve, reject) => {
      onReady = resolve;
      onConnectError = reject;
    });

    ws.onopen = (evt) => {
      onConnectError = null;
      onReady();
    };

    this._recvStream = new TransformStream();
    const recvWriter = this._recvStream.writable.getWriter();

    this._sendStream = new TransformStream();
    
    // TODO: seems pretty easy to leak this inline async functions. Maybe a
    // traditional EvenTarget design would be better?
    (async () => {
      for await (const chunk of this._sendStream.readable) {
        ws.send(chunk);
      }
    })();

    ws.onmessage = async (evt) => {

      if (evt.data.byteLength === 0) {
        // TODO: figure out why we're receiving some 0-length messages
        return;
      }

      await recvWriter;
      await recvWriter.write(new Uint8Array(evt.data));
    };

    this._closedPromise = new Promise((resolve, reject) => {
      this._closeSuccess = resolve;
      this._closeError = reject;
    });

    ws.onclose = (evt) => {
      this._closeSuccess(evt);
      recvWriter.close();
    };

    ws.onerror = (evt) => {
      if (onConnectError) {
        onConnectError(evt);
      }
      this._closeError(evt);
    };

    this._ws = ws;
  }
}

export {
  WebSocketClientTransport,
};
