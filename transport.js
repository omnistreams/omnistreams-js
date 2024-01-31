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
      console.log(evt);

      switch (state) {
        case STATE_WAITING_FOR_FRAME:
          const frameArray = new Uint8Array(evt.data);
          frame = unpackFrame(frameArray);

          if (frame.bytesReceived !== undefined && frame.bytesReceived < frame.length) {
            state = STATE_RECEIVING_FRAME;
          }

          break;
        case STATE_RECEIVING_FRAME:
          const arr = new Uint8Array(evt.data);
          frame.data.set(arr, frame.bytesReceived);

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
    console.log("writeFrame", frame);

    const buf = packFrame(frame); 

    console.log(buf);

    this._ws.send(buf);
  }
}

export {
  WebSocketTransport,
}
