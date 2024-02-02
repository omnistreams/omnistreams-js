import { buf2hex, unpackFrame, packFrame } from './muxado.js';

const STATE_WAITING_FOR_FRAME = 0;
const STATE_RECEIVING_FRAME = 1;

class WebSocketTransport {
  constructor(config) {
    const ws = new WebSocket(config.uri);
    this._ws = ws;
    ws.binaryType = 'arraybuffer';

    let state = STATE_WAITING_FOR_FRAME;
    let frame;

    ws.addEventListener("open", (evt) => {
      console.log(evt);
    });

    ws.addEventListener("message", (evt) => {
      //console.log("evt", evt, evt.data, evt.data.byteLength);

      if (evt.data.byteLength === 0) {
        // TODO: figure out why we're receiving some 0-length messages
        return;
      }

      switch (state) {
        case STATE_WAITING_FOR_FRAME:
          const frameArray = new Uint8Array(evt.data);
          frame = unpackFrame(frameArray);

          //console.log("frame", JSON.stringify(frame, null, 2));

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
    });

    ws.addEventListener("close", (evt) => {
      console.log(evt);
    });

    ws.addEventListener("error", (evt) => {
      console.log(evt);
    });
  }

  onFrame(onFrameCb) {
    this.onFrameCb = onFrameCb;
  }

  writeFrame(frame) {
    const buf = packFrame(frame); 
    this._ws.send(buf);
  }
}

export {
  WebSocketTransport,
}
