import { unpackFrame, packFrame } from './index.js';

const STATE_WAITING_FOR_FRAME = 0;
const STATE_RECEIVING_FRAME = 1;

class WebSocketTransport {
  constructor(config) {
    this._config = config;
  }

  async connect() {

    let onReady;
    let onError;
    const ready = new Promise((resolve, reject) => {
      onReady = resolve;
      onError = reject;
    });

    let WS;
    if (isNode()) {
      WS = (await import('ws')).WebSocket;
    }
    else {
      WS = WebSocket;
    }

    const c = this._config;
    const uri = `wss://${c.serverDomain}/waygate?token=${c.token}&termination-type=${c.terminationType}`;
    const ws = new WS(uri);
    this._ws = ws;
    ws.binaryType = 'arraybuffer';

    let state = STATE_WAITING_FOR_FRAME;
    let frame;

    ws.onopen = (evt) => {
      //console.log("WebSocket open");
    };

    let haveConfig = false;

    ws.onmessage = (evt) => {
      
      // first message is the tunnel config
      if (!haveConfig) {
        const dec = new TextDecoder('utf-8');
        const arr = new Uint8Array(evt.data);
        const tunConfig = JSON.parse(dec.decode(arr));
        haveConfig = true;
        onReady(tunConfig);
        return;
      }

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
      //console.log(evt);
    };

    ws.onerror = (evt) => {
      console.error(evt);
      onError(evt);
    };

    const tunConfig = await ready;

    return tunConfig;
  }

  onFrame(onFrameCb) {
    this.onFrameCb = onFrameCb;
  }

  writeFrame(frame) {
    const buf = packFrame(frame); 
    this._ws.send(buf);
  }
}

function isNode() {
  return (typeof process !== 'undefined' && process.release.name === 'node');
}

export {
  WebSocketTransport,
}
