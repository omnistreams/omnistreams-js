const DEFAULT_WINDOW_SIZE = 256*1024;
// TODO: Firefox and Deno both fail to notice if the chunk size is too big.
// The server side throws an error and closes the connection but the clients
// exit without any exceptions.
const MAX_CHUNK_SIZE = 64*1024;


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

    this._readable = new ReadableStream(
      {
        start(controller) {
          stream._readableController = controller;
        },

        pull(controller) {

          if (stream._queue.length > 0) {
            const chunk = stream._queue.shift()
            controller.enqueue(chunk);
            windowCallback(streamId, chunk.length);
          }

          if (stream._queue.length === 0) {
            const promise = new Promise((resolve, reject) => {
              stream._queueResolve = () => {
                resolve();
              };
            });
            return promise;
          }
        },

        cancel() {
          // TODO: should probably be doing something here...
          //console.log("TODO: reader cancel signal", stream._streamId);
          stream._readClosed = true;
        }, 
      },
      //new CountQueuingStrategy({ highWaterMark: 100 })
    ); 

    this._writable = new WritableStream({

      start(controller) {
        stream._writableController = controller;
      },

      async write(chunk, controller) {

        if (chunk.byteLength <= MAX_CHUNK_SIZE) {
          return stream._attemptSend(chunk);
        }
        else {
          const numChunks = chunk.byteLength / MAX_CHUNK_SIZE;

          for (let i = 0; i < numChunks; i++) {
            const offset = i*MAX_CHUNK_SIZE;
            const subchunk = chunk.slice(offset, offset+MAX_CHUNK_SIZE);
            await stream._attemptSend(subchunk);
          }
        }
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
    // Flush queue if necessary
    while (this._queue.length > 0) {
      const chunk = this._queue.shift();
      this._readableController.enqueue(chunk);
    }
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
      // TODO: there's probably a way to simplify our logic by combining this
      // with the promise below
      return new Promise((resolve, reject) => {
        reject();
      });
    }

    if (data.length <= this._windowSize) {
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

export {
  Stream,
};
