const FRAME_TYPE_RST = 0x00;
const FRAME_TYPE_DATA = 0x01;
const FRAME_TYPE_WNDINC = 0x02;
const FRAME_TYPE_GOAWAY = 0x03;
const FRAME_TYPE_MESSAGE = 0x04;

const HEADER_SIZE = 8;


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

function printSendFrame(f) {
  const ts = String(performance.now().toFixed(3));
  console.log(`OUT tim: ${ts} ${formatFrame(f)}`);
}

function printRecvFrame(f) {
  const ts = String(performance.now().toFixed(3));
  console.log(`IN  tim: ${ts} ${formatFrame(f)}`);
}

function formatFrame(f) {
  const fin = f.fin ? 1 : 0;
  const syn = f.syn ? 1 : 0;
  const win = String(f.windowIncrease ? f.windowIncrease : 'nil').padStart(5);
  let type;
  switch (f.type) {
    case FRAME_TYPE_DATA:
      type = 'DAT';
      break;
    case FRAME_TYPE_WNDINC:
      type = 'WND';
      break;
    case FRAME_TYPE_RST:
      type = 'RST';
      break;
    case FRAME_TYPE_GOAWAY:
      type = 'DIS';
      break;
    default:
      type = 'Unknown type';
      break;
  }

  let dat = 'nil';
  let len = 'nil'.padStart(5);
  if (f.data) {
    dat = `[${f.data.slice(0, 4)}...${f.data.slice(-4)}]`;
    len = String(f.data.length).padStart(5);
  }

  return `typ: ${type} sid: ${f.streamId} syn: ${syn} fin: ${fin} wnd: ${win} len: ${len} dat: ${dat}`;
}

export {
  packFrame,
  unpackFrame,
  printFrame,
  printSendFrame,
  printRecvFrame,
  FRAME_TYPE_RST,
  FRAME_TYPE_DATA,
  FRAME_TYPE_WNDINC,
  FRAME_TYPE_GOAWAY,
  FRAME_TYPE_MESSAGE,
};
