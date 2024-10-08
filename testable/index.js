import { Connection } from '../connection.js';
import { detectRuntime, RUNTIME_NODE, RUNTIME_DENO, RUNTIME_BUN } from '../runtime.js';
import { printSendFrame, printRecvFrame } from '../frame.js';
import {
  TEST_TYPE_SIZE, TEST_ID_SIZE, TEST_TYPE_CONSUME, TEST_TYPE_ECHO,
  TEST_TYPE_MIMIC, TEST_TYPE_SEND
} from '../tester/index.js';

const PORT = 3000;

const runtime = detectRuntime();

if (runtime === RUNTIME_NODE) {

  console.log("node");

  const { WebSocketServer } = await import('ws');
  const http = await import('http');

  //import fs from 'fs';
  //fs.unlinkSync('/tmp/omnistreams.socket');

  const server = http.createServer();

  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    const transport = new WebSocketServerTransport(ws);
    const conn = new Connection({ transport, isServer: true });
    handleConn(conn);
  });

  server.listen(PORT);
  //server.listen('/tmp/omnistreams.socket');

}
else if (runtime === RUNTIME_DENO) {

  console.log("deno");

  Deno.serve({ port: PORT }, (req) => {

    if (req.headers.get("upgrade") != "websocket") {
      return new Response(null, { status: 501 });
    }

    const { socket, response } = Deno.upgradeWebSocket(req);

    const transport = new WebSocketServerTransport(socket);

    const conn = new Connection({ transport, isServer: true });

    handleConn(conn);

    return response;
  });
}
else if (runtime === RUNTIME_BUN) {
  console.log("bun");

  const transports = {};

  Bun.serve({
    fetch(req, server) {
      if (server.upgrade(req)) {
        return;
      }
      return new Response("Upgrade failed", { status: 500 });
    },
    websocket: {
      open(ws) {

        const sendFunc = (msg) => {
          ws.send(msg);
        };

        const transport = new BunWebSocketServerTransport(sendFunc);
        transports[ws] = transport;

        const conn = new Connection({ transport, isServer: true });

        handleConn(conn);
      },
      message(ws, message) {
        const t = transports[ws];
        t.passMessage(message);
      },
      error(ws, error) {
        const t = transports[ws];
        t.passError(error);
      },
    },
  });
}

async function handleConn(conn) {

  console.log("Starting test");

  for await (const stream of conn.incomingBidirectionalStreams) {
    handleStream(conn, stream);
  }
}

async function handleStream(conn, stream) {
  const reader = stream.readable.getReader();
  // TODO: keep receiving until we're sure we have the full test header
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
    case TEST_TYPE_SEND: {

      const dv = new DataView(value.buffer);
      const size = dv.getUint32(TEST_TYPE_SIZE + TEST_ID_SIZE, false);

      const chunkSize = 1*1024*1024;

      const writer = stream.writable.getWriter();

      if (size < chunkSize) {
        const chunk = new Uint8Array(size);
        await writer.ready;
        await writer.write(chunk);
      }
      else {
        const chunk = new Uint8Array(chunkSize);
        const nChunks = Math.ceil(size / chunkSize);

        for (let i = 0; i < nChunks; i++) {
          await writer.ready;
          await writer.write(chunk);
        }
      }

      break;
    }
    default:
      console.error("Unknown test type", testType);
      break;
  }
}

class BunWebSocketServerTransport {
  constructor(sendFunc) {
    this._sendFunc = sendFunc;
  }

  passMessage(msg) {
    this._onMessageCallback(msg)
  }

  passError(err) {
    this._onErrorCallback(err)
  }

  send(msg) {
    this._sendFunc(msg);
  }

  onMessage(callback) {
    this._onMessageCallback = callback;
  };

  onError(callback) {
    this._onErrorCallback = callback;
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
