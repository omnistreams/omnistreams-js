import { packFrame, unpackFrame, printFrame } from './frame.js';
import { Stream } from './stream.js';
import { Connection } from './connection.js';

//const DATAGRAM_STREAM_ID = 0;

const STATE_WAITING_FOR_FRAME = 0;
const STATE_RECEIVING_FRAME = 1;


class WebTransport {
  constructor(uri) {

    this._closedPromise = new Promise((resolve, reject) => {
      this._closeSuccess = resolve;
      this._closeFail = reject;
    });

    this._readyPromise = new Promise(async (resolve, reject) => {

      this._conn = await connect({
        uri,
      });

      this._conn.onError((e) => {
        this._closeFail(e);
      });

      resolve();
    });
  }

  get ready() {
    return this._readyPromise;
  }

  get closed() {
    return this._closedPromise;
  }

  get incomingBidirectionalStreams() {
    return this._conn.incomingBidirectionalStreams;
  }

  createBidirectionalStream() {
    return this._conn.open();
  }

  close() {
    this._conn.close();
  }
}

async function connect(config) {
  const transport = new WebSocketTransport({
    uri: config.uri,
  });

  await transport.connect();

  return new Connection(Object.assign(config, { transport }));
}

class WebSocketTransport {
  constructor(config) {
    this._config = config;
  }

  async connect() {

    let onReady;
    let onConnectError;
    const ready = new Promise((resolve, reject) => {
      onReady = resolve;
      onConnectError = reject;
    });

    let WS;
    WS = WebSocket;
    //if (isNode()) {
    //  WS = (await import('ws')).WebSocket;
    //}
    //else {
    //  WS = WebSocket;
    //}

    const parsedUri = new URL(this._config.uri);
    const scheme = parsedUri.protocol === 'https:' ? 'wss://' : 'ws://';
    const uri = `${scheme}${parsedUri.host}${parsedUri.pathname}${parsedUri.search}`;
    const ws = new WS(uri);
    this._ws = ws;
    ws.binaryType = 'arraybuffer';

    let state = STATE_WAITING_FOR_FRAME;
    let frame;

    ws.onopen = (evt) => {
      onConnectError = null;
      onReady();
    };

    let haveConfig = false;

    ws.onmessage = (evt) => {
      
      if (evt.data.byteLength === 0) {
        // TODO: figure out why we're receiving some 0-length messages
        return;
      }

      switch (state) {
        case STATE_WAITING_FOR_FRAME:
          const frameArray = new Uint8Array(evt.data);
          frame = unpackFrame(frameArray);

          if (frame.bytesReceived < frame.length) {
            state = STATE_RECEIVING_FRAME;
          }
          else {
            delete frame.bytesReceived;
            this.onFrameCb(frame);
          }

          break;
        case STATE_RECEIVING_FRAME:
          const arr = new Uint8Array(evt.data);
          frame.data.set(arr, frame.bytesReceived);
          // TODO: make sure we're properly handling frames split across multiple websocket messages
          frame.bytesReceived += evt.data.length;

          if (frame.data.length === frame.length) {
            state = STATE_WAITING_FOR_FRAME;
            delete frame.bytesReceived;
            this.onFrameCb(frame);
          }

          break;
      }
    };

    ws.onclose = (evt) => {
      console.log("Connection closed");
    };

    ws.onerror = (evt) => {
      if (onConnectError) {
        onConnectError(evt);
      }
      if (this._errorCallback) {
        this._errorCallback(evt);
      }
    };

    return ready;
  }

  onFrame(onFrameCb) {
    this.onFrameCb = (frame) => {
      //console.log("Receive frame");
      //printFrame(frame);
      onFrameCb(frame);
    }
  }

  writeFrame(frame) {
    //console.log("Send frame");
    //printFrame(frame);
    const buf = packFrame(frame); 
    this._ws.send(buf);
  }

  close() {
    this._ws.close();
  }

  onError(callback) {
    this._errorCallback = callback;
  }
}


export default {
  connect,
  WebTransport,
};
