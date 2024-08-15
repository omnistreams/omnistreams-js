const FRAME_TYPE_RST = 0x00;
const FRAME_TYPE_DATA = 0x01;
const FRAME_TYPE_WNDINC = 0x02;
const FRAME_TYPE_GOAWAY = 0x03;
const FRAME_TYPE_MESSAGE = 0x04;

const HEADER_SIZE = 8;

const STATE_WAITING_FOR_FRAME = 0;
const STATE_RECEIVING_FRAME = 1;

class Framer {
  constructor(config) {
    this._config = config;
  }

  async connect() {

    const transport = this._config.transport;
    this._transport = transport;

    await transport.ready;

    let state = STATE_WAITING_FOR_FRAME;
    let frame;

    transport.onMessage((message) => {

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

    (async () => {
      try {
        await transport.closed;
        console.log("Connection closed");
      }
      catch (evt) {
        console.error(evt);
        if (onConnectError) {
          onConnectError(evt);
        }
        if (this._errorCallback) {
          this._errorCallback(evt);
        }
      }
    })();
  }

  onFrame(onFrameCb) {
    this.onFrameCb = (frame) => {
      //console.log("Receive frame");
      //printFrame(frame);
      onFrameCb(frame);
    }
  }

  writeFrame(frame) {
    //console.log("Send frame");
    //printFrame(frame);
    const buf = packFrame(frame); 
    this._transport.send(buf);
  }

  close() {
    this._transport.close();
  }

  onError(callback) {
    this._errorCallback = callback;
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
  const buf = new Uint8Array(HEADER_SIZE + length);
  buf[0] = length >> 16;
  buf[1] = length >> 8;
  buf[2] = length;
  buf[3] = (f.type << 4) | flags;
  buf[4] = frame.streamId >> 24;
  buf[5] = frame.streamId >> 16;
  buf[6] = frame.streamId >> 8;
  buf[7] = frame.streamId;

  if (frame.data !== undefined) {
    buf.set(frame.data, HEADER_SIZE);
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

  const data = frameArray.slice(HEADER_SIZE);
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

function printFrame(f) {

  console.log("frame: {");

  let frameTypeStr;
  switch (f.type) {
    case FRAME_TYPE_DATA:
      frameTypeStr = 'FRAME_TYPE_DATA';
      console.log(`  type: ${frameTypeStr},`);
      console.log(`  streamId: ${f.streamId},`);
      console.log(`  fin: ${f.fin ? 1 : 0},`);
      console.log(`  syn: ${f.syn ? 1 : 0},`);
      if (f.data) {
        console.log(`  data: [ ${f.data.slice(0, 10)} ... ${f.data.slice(-10)} ],`);
      }
      console.log(`  length: ${f.length},`);
      break;
    case FRAME_TYPE_WNDINC:
      frameTypeStr = 'FRAME_TYPE_WNDINC';
      console.log(`  type: ${frameTypeStr},`);
      console.log(`  streamId: ${f.streamId},`);
      console.log(`  windowIncrease: ${f.windowIncrease},`);
      break;
    case FRAME_TYPE_RST:
      frameTypeStr = 'FRAME_TYPE_RST';
      console.log(`  type: ${frameTypeStr},`);
      console.log(`  streamId: ${f.streamId},`);
      break;
    default:
      frameTypeStr = "Unknown frame type";
      break;
  }
  console.log("}");
}

export {
  Framer,
  packFrame,
  unpackFrame,
  printFrame,
  FRAME_TYPE_RST,
  FRAME_TYPE_DATA,
  FRAME_TYPE_WNDINC,
  FRAME_TYPE_GOAWAY,
  FRAME_TYPE_MESSAGE,
};
