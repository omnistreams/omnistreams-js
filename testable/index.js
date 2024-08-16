import { Connection } from '../connection.js';
import { printSendFrame, printRecvFrame } from '../frame.js';

const TEST_TYPE_CONSUME = 0;
const TEST_TYPE_ECHO = 1;
const TEST_TYPE_MIMIC = 2;

Deno.serve({ port: 3000 }, (req) => {

  if (req.headers.get("upgrade") != "websocket") {
    return new Response(null, { status: 501 });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);

  const transport = new WebSocketServerTransport(socket);

  const conn = new Connection({ transport, isServer: true });

  handleConn(conn);

  return response;
});

async function handleConn(conn) {
  for await (const stream of conn.incomingBidirectionalStreams) {
    handleStream(conn, stream);
  }
}

async function handleStream(conn, stream) {
  const reader = stream.readable.getReader();
  let { value, done } = await reader.read();

  const testType = value[0];

  switch (testType) {
    case TEST_TYPE_CONSUME: {
      while (true) {
        const res = await reader.read();
        if (res.done) {
          break;
        }
        else {
          //console.log(res.value.slice(-10));
        }
      }
      break;
    }
    case TEST_TYPE_ECHO: {
      const writer = stream.writable.getWriter();
      await writer.ready;
      await writer.write(value);

      while (true) {
        const res = await reader.read();
        if (res.done) {
          break;
        }

        await writer.write(res.value);
      }
      break;
    }
    case TEST_TYPE_MIMIC: {

      const resStream = await conn.open();
      const writer = resStream.writable.getWriter();
      await writer.ready;
      await writer.write(value);

      while (true) {
        const res = await reader.read();
        if (res.done) {
          break;
        }

        await writer.write(res.value);
      }

      break;
    }
    default:
      console.error("Unknown test type", testType);
      break;
  }
}

class WebSocketServerTransport {
  constructor(ws) {

    this._readyPromise = new Promise((resolve, reject) => {
      ws.addEventListener('open', (evt) => {
        resolve(evt);
      });
    });

    this._closedPromise = new Promise((resolve, reject) => {
      ws.addEventListener('close', (evt) => {
        resolve(evt);
      });
    });

    ws.addEventListener("message", (evt) => {
      this._onMessageCallback(new Uint8Array(evt.data));
    });

    ws.addEventListener("error", (evt) => {
      this._onErrorCallback(evt);
    });

    this._ws = ws;
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
}
