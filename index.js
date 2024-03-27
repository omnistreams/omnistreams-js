const FRAME_TYPE_RST = 0x00;
const FRAME_TYPE_DATA = 0x01;
const FRAME_TYPE_WNDINC = 0x02;
const FRAME_TYPE_GOAWAY = 0x03;
const FRAME_TYPE_MESSAGE = 0x04;

const DATAGRAM_STREAM_ID = 0;

const STATE_WAITING_FOR_FRAME = 0;
const STATE_RECEIVING_FRAME = 1;

const MUXADO_HEADER_SIZE = 8;

const DEFAULT_WINDOW_SIZE = 256*1024;


class WebTransport {
  constructor(uri) {
    this._readyPromise = new Promise(async (resolve, reject) => {

      const parsedUri = new URL(uri);

      this._conn = await connect({
        serverDomain: parsedUri.host,
        token: "",
      });

      resolve();
    });
  }

  get ready() {
    return this._readyPromise;
  }

  get incomingBidirectionalStreams() {
    return this._incomingStreams;
  }

  async createBidirectionalStream() {
    const stream = this._conn.open();
    return stream;
  }
}

async function connect(config) {
  const transport = new WebSocketTransport({
    serverDomain: config.serverDomain,
    token: config.token,
    terminationType: 'server',
  });

  await transport.connect();

  return new Client(Object.assign(config, { transport }));
}

class Client {
  constructor(config) {

    this._nextStreamId = 1;
    this._streams = {};

    this._acceptPromise = new Promise((resolve, reject) => {
      this._acceptResolve = resolve;
    });

    const ts = new TransformStream();
    this._incomingStreams = ts.readable;
    const incomingWriter = ts.writable.getWriter();

    this._transport = config.transport;

    const writeCallback = (streamId, data) => {

      const stream = this._streams[streamId];

      const syn = stream.syn;
      if (stream.syn === true) {
        stream.syn = false;
      }

      this._transport.writeFrame({
        type: streamId === DATAGRAM_STREAM_ID ? FRAME_TYPE_MESSAGE : FRAME_TYPE_DATA,
        fin: false,
        syn: syn,
        streamId: streamId,
        data: data,
      });
    };
    this._writeCallback = writeCallback;

    const closeCallback = (streamId) => {

      if (streamId === DATAGRAM_STREAM_ID) {
        throw new Error("Attempted to close datagram stream");
      }

      this._transport.writeFrame({
        type: FRAME_TYPE_DATA,
        fin: true,
        syn: false,
        streamId: streamId,
      });
    };
    this._closeCallback = closeCallback;

    const windowCallback = (streamId, windowIncrease) => {
      this._transport.writeFrame({
        type: FRAME_TYPE_WNDINC,
        streamId,
        windowIncrease,
      });
    };
    this._windowCallback = windowCallback;

    this._transport.onFrame((frame) => {

      let stream;

      switch (frame.type) {
        case FRAME_TYPE_MESSAGE:
        // fallthrough
        // TODO: need to be sending back WNDINC when data is received
        case FRAME_TYPE_DATA:

          //console.log("FRAME_TYPE_DATA", frame);

          if (frame.syn) {

            const stream = new Stream(frame.streamId, writeCallback, closeCallback, windowCallback);
            stream.syn = false;
            this._streams[frame.streamId] = stream;

            // TODO: this can probably get overwritten before being awaited
            this._acceptResolve(stream);
            this._acceptPromise = new Promise((resolve, reject) => {
              this._acceptResolve = resolve;
            });

            // TODO: is it safe for this to be async?
            (async () => {
              await incomingWriter.write(stream);
            })();
          }

          stream = this._streams[frame.streamId];

          if (frame.data.length > 0) {
            stream._enqueueData(frame.data);
          }

          if (frame.fin) {
            stream.closeRead();
          }

          break;
        case FRAME_TYPE_WNDINC:
          //console.log("FRAME_TYPE_WNDINC", frame, frame.data);
          if (this._streams[frame.streamId]) {
            stream = this._streams[frame.streamId];
            stream._windowIncrease(frame.windowIncrease);
          }
          else {
            console.error("WNDINC received for unknown stream: ", frame);
          }
          break;
        case FRAME_TYPE_RST:
          console.log("FRAME_TYPE_RST", frame, frame.data);

          stream = this._streams[frame.streamId];
          if (stream) {
            stream._reset(frame.errorCode);
          }

          // TODO: figure out proper way to delete streams
          //delete this._streams[frame.streamId];

          break;
        case FRAME_TYPE_GOAWAY:
          const dec = new TextDecoder('utf8');
          console.log("FRAME_TYPE_GOAWAY", frame, dec.decode(frame.data));
          break;
        default:
          console.log("Unknown frame type", frame);
          break;
      }
    });


    this._datagramStream = new Stream(DATAGRAM_STREAM_ID, writeCallback, closeCallback, windowCallback);
    this._streams[DATAGRAM_STREAM_ID] = this._datagramStream;
  }

  open() {
    const streamId = this._nextStreamId;
    this._nextStreamId += 2;

    const stream = new Stream(streamId, this._writeCallback, this._closeCallback, this._windowCallback);

    this._streams[streamId] = stream;

    return stream;
  }

  async accept() {
    return this._acceptPromise;
  }

  get incomingBidirectionalStreams() {
    return this._incomingStreams;
  }

  get datagrams() {
    return this._datagramStream;
  }
}

class Stream {
  constructor(streamId, writeCallback, closeCallback, windowCallback) {
    this.syn = true;
    this._streamId = streamId;
    this._writeCallback = writeCallback;
    this._closeCallback = closeCallback;
    this._windowSize = DEFAULT_WINDOW_SIZE;

    this._readClosed = false;
    this._readableController = null;
    this._writableController = null;
    this._onWindowIncreaseCallback = null;

    this._queue = [];

    const stream = this;

    this._readable = new ReadableStream({
      start(controller) {
        stream._readableController = controller;
      },

      pull(controller) {

        if (stream._queue.length === 0) {
          return new Promise((resolve, reject) => {
            stream._queueResolve = resolve;
          });
        }
        else {
          const chunk = stream._queue.shift()
          controller.enqueue(chunk);
          windowCallback(streamId, chunk.length);
        }
      },

      cancel() {
        // TODO: should probably be doing something here...
        //console.log("TODO: reader cancel signal", stream._streamId);
        stream._readClosed = true;
      }
    }); 

    this._writable = new WritableStream({

      start(controller) {
        stream._writableController = controller;
      },

      write(chunk, controller) {
        return stream._attemptSend(chunk);
      },

      close() {
        stream._closeCallback(stream._streamId);
      }
    },
    //new ByteLengthQueuingStrategy({
    //  highWaterMark: 256*1024
    //})
    );
  }

  get readable() {
    return this._readable;
  }

  get writable() {
    return this._writable;
  }

  _enqueueData(data) {
    this._queue.push(data);
    if (this._queueResolve) {
      this._queueResolve();
      this._queueResolve = null;
    }
  }

  _windowIncrease(windowIncrease) {

    this._windowSize += windowIncrease;
    if (this._windowResolve) {
      this._windowResolve();
    }

    if (this._onWindowIncreaseCallback) {
      this._onWindowIncreaseCallback(windowIncrease);
    }
  }

  closeRead() {
    if (!this._readClosed) {
      this._readClosed = true;
      return this._readableController.close();
    }
  }

  _reset(errorCode) {
    this._done = true;

    this.closeRead();

    if (this._writeReject) {
      this._writeReject(new Error("Stream reset"));
    }
  }

  async _attemptSend(data) {
    if (this._done) {
      return;
    }

    if (data.length < this._windowSize) {
      this._writeCallback(this._streamId, data);
      this._windowSize -= data.length;
      this._windowResolve = null;
    }
    else {
      await new Promise((resolve, reject) => {
        this._windowResolve = resolve;
        this._writeReject = reject;
      });

      return this._attemptSend(data);
    }
  }
}


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
    WS = WebSocket;
    //if (isNode()) {
    //  WS = (await import('ws')).WebSocket;
    //}
    //else {
    //  WS = WebSocket;
    //}

    const c = this._config;
    const uri = `wss://${c.serverDomain}/waygate?token=${c.token}&termination-type=${c.terminationType}`;
    const ws = new WS(uri);
    this._ws = ws;
    ws.binaryType = 'arraybuffer';

    let state = STATE_WAITING_FOR_FRAME;
    let frame;

    ws.onopen = (evt) => {
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
      //console.log(evt);
    };

    ws.onerror = (evt) => {
      console.error(evt);
      onError(evt);
    };
  }

  onFrame(onFrameCb) {
    this.onFrameCb = (frame) => {
      //console.log("Receive frame", frame);
      onFrameCb(frame);
    }
  }

  writeFrame(frame) {
    //console.log("Send frame", frame);
    const buf = packFrame(frame); 
    this._ws.send(buf);
  }
}

function packFrame(frame) {

  let length = 0;

  if (frame.type === FRAME_TYPE_WNDINC) {
    length = 4;
  }

  if (frame.data !== undefined) {
    length = frame.data.length;
  }

  const synBit = frame.syn === true ? 1 : 0;
  const finBit = frame.fin === true ? 1 : 0;
  const flags = (synBit << 1) | finBit;

  const f = frame;
  const buf = new Uint8Array(MUXADO_HEADER_SIZE + length);
  buf[0] = length >> 16;
  buf[1] = length >> 8;
  buf[2] = length;
  buf[3] = (f.type << 4) | flags;
  buf[4] = frame.streamId >> 24;
  buf[5] = frame.streamId >> 16;
  buf[6] = frame.streamId >> 8;
  buf[7] = frame.streamId;

  if (frame.data !== undefined) {
    buf.set(frame.data, MUXADO_HEADER_SIZE);
  }

  switch (frame.type) {
    case FRAME_TYPE_WNDINC: {
      buf[8] = f.windowIncrease >> 24;
      buf[9] = f.windowIncrease >> 16;
      buf[10] = f.windowIncrease >> 8;
      buf[11] = f.windowIncrease;
      break;
    }
  }

  return buf;
}

function unpackFrame(frameArray) {
  const fa = frameArray;
  const length = (fa[0] << 16) | (fa[1] << 8) | (fa[2]);
  const type = (fa[3] & 0b11110000) >> 4;
  const flags = (fa[3] & 0b00001111);
  const fin = (flags & 0b0001) !== 0;
  const syn = (flags & 0b0010) !== 0;
  const streamId = (fa[4] << 24) | (fa[5] << 16) | (fa[6] << 8) | fa[7];

  const frame = {
    length,
    type,
    fin,
    syn,
    streamId,
    bytesReceived: 0,
  };

  const data = frameArray.slice(MUXADO_HEADER_SIZE);
  frame.data = new Uint8Array(length);
  frame.data.set(data, 0);
  frame.bytesReceived = data.length;

  switch (frame.type) {
    case FRAME_TYPE_WNDINC:
      frame.windowIncrease = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
      break;
    case FRAME_TYPE_RST:
      frame.errorCode = unpackUint32(data);
      break;
  }

  return frame;
}

function unpackUint32(data) {
  return (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
}

//function isNode() {
//  return (typeof process !== 'undefined' && process.release.name === 'node');
//}

export {
  connect,
  WebTransport,
};
