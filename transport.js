class WebSocketClientTransport {
  constructor(uri) {
    this._connect(uri); 
  }

  get ready() {
    return this._readyPromise;
  }

  get closed() {
    return this._closedPromise;
  }

  send(msg) {
    this._ws.send(msg);
  }

  onMessage(callback) {
    this._onMessageCallback = callback;
  };

  onError(callback) {
    this._onErrorCallback = callback;
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

    ws.onmessage = async (evt) => {

      if (evt.data.byteLength === 0) {
        // TODO: figure out why we're receiving some 0-length messages
        return;
      }

      this._onMessageCallback(evt.data);
    };

    this._closedPromise = new Promise((resolve, reject) => {
      this._closeSuccess = resolve;
      this._closeError = reject;
    });

    ws.onclose = (evt) => {
      this._closeSuccess(evt);
    };

    ws.onerror = (evt) => {
      this._onErrorCallback(evt);

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
