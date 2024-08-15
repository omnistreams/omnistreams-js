import { packFrame, unpackFrame, printFrame } from './frame.js';
import { Stream } from './stream.js';
import { Connection } from './connection.js';
import { WebSocketClientTransport } from './transport.js';

const STATE_WAITING_FOR_FRAME = 0;
const STATE_RECEIVING_FRAME = 1;

//const DATAGRAM_STREAM_ID = 0;

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
  let transport = new WebSocketClientTransport(config.uri);
  await transport.ready;

  //transport = new MuxadoTransportWrapper(transport);

  return new Connection({
    transport,
  });
}

// Since muxado is designed to work with TCP streams, which we're simulating
// using WebSockets, frames might arrive split across multiple websocket
// frames. This wrapper combines them together as necessary.
class MuxadoTransportWrapper {
  constructor(transport) {

    this._transport = transport;

    let state = STATE_WAITING_FOR_FRAME;
    let frame;

    this._transport.onMessage((message) => {

      const evt = {
        data: message,
      };

      switch (state) {
        case STATE_WAITING_FOR_FRAME:
          const frameArray = new Uint8Array(evt.data);
          frame = unpackFrame(frameArray);

          if (frame.bytesReceived < frame.length) {
            state = STATE_RECEIVING_FRAME;
          }
          else {
            delete frame.bytesReceived;
            this._onMessageCallback(frameArray);
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
            this._onMessageCallback(packFrame(frame));
          }

          break;
      }
    });
  }

  get ready() {
    return this._transport.ready;
  }

  get closed() {
    return this._transport.closed;
  }

  send(msg) {
    this._transport.send(msg);
  }

  onMessage(callback) {
    this._onMessageCallback = callback;
  }

  onError(callback) {
    this._errorCallback = callback;
  }

  close() {
    this._transport.close();
  }
}


export default {
  connect,
  WebTransport,
};
