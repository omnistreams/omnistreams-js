import { Framer, packFrame, unpackFrame, printFrame } from './frame.js';
import { Stream } from './stream.js';
import { Connection } from './connection.js';
import { WebSocketClientTransport } from './transport.js';

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
  const transport = new WebSocketClientTransport(config.uri);
  await transport.ready;

  const framer = new Framer({
    transport,
  });

  await framer.connect();

  return new Connection(Object.assign(config, { framer }));
}


export default {
  connect,
  WebTransport,
};
