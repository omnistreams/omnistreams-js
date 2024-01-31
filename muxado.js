import { WebSocketTransport } from './transport.js';

const FRAME_TYPE_DATA = 0x01;

const MUXADO_HEADER_SIZE = 8;

class Client {
  constructor(config) {

    this._nextStreamId = 1;
    this._streams = {};

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
      console.log("transport.onFrame");
      console.log(frame);

      switch (frame.type) {
        case FRAME_TYPE_DATA:
          if (frame.syn) {
            const stream = new Stream(frame.streamId, writeCallback);
            stream.syn = false;
            this._streams[frame.streamId] = stream;
            this._acceptCallback(stream);
          }

          const stream = this._streams[frame.streamId];

          if (frame.data.length > 0) {
            stream.emitData(frame.data);
          }

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

  onAccept(callback) {
    this._acceptCallback = callback;
  }
}

class Stream {
  constructor(streamId, writeCallback) {
    this.syn = true;
    this._streamId = streamId;
    this._writeCallback = writeCallback;
  }

  emitData(data) {
    this._onDataCallback(data);
  }

  onData(callback) {
    this._onDataCallback = callback;
  }

  write(data) {
    this._writeCallback(this._streamId, data);
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
  };

  switch (type) {
    case FRAME_TYPE_DATA:
      frame.data = new Uint8Array(length);
      const data = frameArray.slice(8);
      frame.data.set(data, 0);
      frame.bytesReceived = data.length;
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

function buf2hex(buffer) { // buffer is an ArrayBuffer
  return [...new Uint8Array(buffer)]
      .map(x => x.toString(16).padStart(2, '0'))
      .join('');
}

export {
  Client,
  buf2hex,
  packFrame,
  unpackFrame,
};
