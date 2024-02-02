import { WebSocketTransport } from './transport.js';

const FRAME_TYPE_RST = 0x00;
const FRAME_TYPE_DATA = 0x01;
const FRAME_TYPE_WNDINC = 0x02;
const FRAME_TYPE_GOAWAY = 0x03;

const MUXADO_HEADER_SIZE = 8;

const DEFAULT_WINDOW_SIZE = 256*1024;

class Client {
  constructor(config) {

    this._nextStreamId = 1;
    this._streams = {};

    this._acceptPromise = new Promise((resolve, reject) => {
      this._acceptResolve = resolve;
    });

    this._transport = new WebSocketTransport({
      uri: `wss://${config.serverDomain}?domain=test2.anderspitman.net&termination-type=server`,
      token: "yolo",
    });

    const writeCallback = (streamId, data) => {

      const stream = this._streams[streamId];

      const syn = stream.syn;
      if (stream.syn === true) {
        stream.syn = false;
      }

      this._transport.writeFrame({
        type: FRAME_TYPE_DATA,
        fin: false,
        syn: syn,
        streamId: streamId,
        data: data,
      });
    };

    this._transport.onFrame((frame) => {

      let stream;

      switch (frame.type) {
        case FRAME_TYPE_DATA:
          console.log("FRAME_TYPE_DATA", frame);
          if (frame.syn) {

            const stream = new Stream(frame.streamId, writeCallback);
            stream.syn = false;
            this._streams[frame.streamId] = stream;

            // TODO: this can probably get overwritten before being awaited
            this._acceptResolve(stream);
            this._acceptPromise = new Promise((resolve, reject) => {
              this._acceptResolve = resolve;
            });
            if (this._acceptCallback) {
              this._acceptCallback(stream);
            }
          }

          stream = this._streams[frame.streamId];

          if (frame.data.length > 0) {
            stream._enqueueData(frame.data);
          }

          break;
        case FRAME_TYPE_WNDINC:
          stream = this._streams[frame.streamId];
          stream._windowIncrease(frame.windowIncrease);
          break;
        case FRAME_TYPE_RST:
          console.log("FRAME_TYPE_RST", frame, frame.data);

          stream = this._streams[frame.streamId];
          if (stream) {
            stream._reset(frame.errorCode);
          }

          delete this._streams[frame.streamId];

          break;
        case FRAME_TYPE_GOAWAY:
          console.log("FRAME_TYPE_GOAWAY", frame.data);
          break;
      }
    });
  }

  open() {
    const streamId = this._nextStreamId;
    this._nextStreamId += 2;

    const stream = new Stream(frame.streamId, this._transport);

    this._streams[streamId] = stream;

    return stream;
  }

  async accept() {
    return this._acceptPromise;
  }
}

class Stream {
  constructor(streamId, writeCallback) {
    this.syn = true;
    this._streamId = streamId;
    this._writeCallback = writeCallback;
    this._windowSize = DEFAULT_WINDOW_SIZE;

    const stream = this;

    this._readable = new ReadableStream({
      start(controller) {
        stream._readableController = controller;
        stream._enqueue = (data) => {
          controller.enqueue(data);
        };
      },

      close() {
        console.log("reader close signal");
      }
    });

    const attemptSend = async (stream, data) => {
      if (stream._done) {
        return;
      }

      if (data.length < stream._windowSize) {
        stream._writeCallback(stream._streamId, data);
        stream._windowSize -= data.length;
        stream._windowResolve = null;
      }
      else {
        await new Promise((resolve, reject) => {
          stream._windowResolve = resolve;
          stream._writeReject = reject;
        });

        return attemptSend(stream, data);
      }
    }

    this._writable = new WritableStream({

      start(controller) {
        stream._writableController = controller;
      },

      write(chunk, controller) {
        return attemptSend(stream, chunk);
      },

      close() {
        console.log("writer close signal");
      }
    },
    //new ByteLengthQueuingStrategy({
    //  highWaterMark: 256*1024
    //})
    );
  }

  getReadableStream() {
    return this._readable;
  }

  getWritableStream() {
    return this._writable;
  }

  _enqueueData(data) {
    this._enqueue(data);
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

  _reset(errorCode) {
    this._done = true;
    this._readableController.close();

    if (this._writeReject) {
      this._writeReject();
    }
  }
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

function packFrame(frame) {
  const length = frame.data.length;

  const synBit = frame.syn === true ? 1 : 0;
  const finBit = frame.fin === true ? 1 : 0;
  const flags = (synBit << 1) | finBit;

  const f = frame;
  const buf = new Uint8Array(MUXADO_HEADER_SIZE + frame.data.length);
  buf[0] = length >> 16;
  buf[1] = length >> 8;
  buf[2] = length;
  buf[3] = (f.type << 4) | flags;
  buf[4] = frame.streamId >> 24;
  buf[5] = frame.streamId >> 16;
  buf[6] = frame.streamId >> 8;
  buf[7] = frame.streamId;

  buf.set(frame.data, MUXADO_HEADER_SIZE);

  return buf;
}

function unpackUint32(data) {
  return (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
}

export {
  Client,
  packFrame,
  unpackFrame,
};
