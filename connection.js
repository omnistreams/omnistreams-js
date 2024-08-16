import { Stream } from './stream.js';
import {
  FRAME_TYPE_DATA, FRAME_TYPE_WNDINC, FRAME_TYPE_RST, FRAME_TYPE_GOAWAY,
  FRAME_TYPE_MESSAGE, packFrame, unpackFrame, printSendFrame, printRecvFrame,
} from './frame.js';

//globalThis.OMNISTREAMS_DEBUG = true;

class Connection {
  constructor(opt) {

    this._nextStreamId = opt.isServer ? 2 : 1;
    this._streams = {};

    this._acceptPromise = new Promise((resolve, reject) => {
      this._acceptResolve = resolve;
    });

    const ts = new TransformStream();
    this._incomingStreams = ts.readable;
    const incomingWriter = ts.writable.getWriter();

    this._transport = opt.transport;

    this._transport.onError((e) => {
      if (this._errorCallback) {
        this._errorCallback(e);
      }
    });

    (async () => {
      await this._transport.closed;
      console.log("Connection closed");
    })();

    const writeCallback = (streamId, data) => {

      const stream = this._streams[streamId];

      const syn = stream.syn;
      if (stream.syn === true) {
        stream.syn = false;
      }

      this._writeFrame({
        //type: streamId === DATAGRAM_STREAM_ID ? FRAME_TYPE_MESSAGE : FRAME_TYPE_DATA,
        type: FRAME_TYPE_DATA,
        fin: false,
        syn: syn,
        streamId: streamId,
        data: data,
      });
    };
    this._writeCallback = writeCallback;

    const closeCallback = (streamId) => {

      //if (streamId === DATAGRAM_STREAM_ID) {
      //  throw new Error("Attempted to close datagram stream");
      //}

      this._writeFrame({
        type: FRAME_TYPE_DATA,
        fin: true,
        syn: false,
        streamId: streamId,
      });
    };
    this._closeCallback = closeCallback;

    const windowCallback = (streamId, windowIncrease) => {
      this._writeFrame({
        type: FRAME_TYPE_WNDINC,
        streamId,
        windowIncrease,
      });
    };
    this._windowCallback = windowCallback;

    this._transport.onMessage((msg) => {

      const frame = unpackFrame(new Uint8Array(msg));

      if (globalThis.OMNISTREAMS_DEBUG) {
        printRecvFrame(frame);
      }

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
            if (frame.data.length > 0) {
              stream._enqueueData(frame.data);
            }
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
          //console.log("FRAME_TYPE_RST", frame, frame.data);

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


    //this._datagramStream = new Stream(DATAGRAM_STREAM_ID, writeCallback, closeCallback, windowCallback);
    //this._streams[DATAGRAM_STREAM_ID] = this._datagramStream;
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

  //get datagrams() {
  //  return this._datagramStream;
  //}

  close() {
    this._transport.close();
  }

  onError(callback) {
    this._errorCallback = callback;
  }

  _writeFrame(frame) {
    if (globalThis.OMNISTREAMS_DEBUG) {
      printSendFrame(frame);
    }
    this._transport.send(packFrame(frame));
  }
}


export {
  Connection,
};
