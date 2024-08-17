import omnistreams from '../index.js';

const TestTypeConsume = 0;
const TestTypeEcho = 1;
const TestTypeMimic = 2;

const TimeoutMs = 1000;

const WINDOW_SIZE = 256*1024;

const TEST_TYPE_SIZE = 1;
const TEST_ID_SIZE = 4;
const TEST_HEADER_SIZE = TEST_TYPE_SIZE + TEST_ID_SIZE;

async function run(serverUri, concurrent, useWebTransport) {

  let conn;
  // TODO: turn connection initiation into a test
  if (useWebTransport) {
    console.log("Initiating WebTransport test");
    conn = new WebTransport(serverUri);
  }
  else {
    console.log("Initiating omnistreams test");
    conn = new omnistreams.WebTransport(serverUri);
  }
  (async () => {
    try {
      await conn.closed;
    }
    catch (e) {
      console.error("Connection closed", e);
    }
  })();

  await conn.ready;
  const streamReader = new StreamReader(conn.incomingBidirectionalStreams);

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const dataHalfWindow = new Uint8Array(WINDOW_SIZE / 2);
  initArray(dataHalfWindow);
  const dataOneWindow = new Uint8Array(1*WINDOW_SIZE);
  initArray(dataOneWindow);
  const dataTwoWindow = new Uint8Array(2*WINDOW_SIZE);
  initArray(dataTwoWindow);

  const bigData = new Uint8Array(10*1024*1024);
  initArray(bigData);

  const testQueue = [];
  let nextTestId = 100;

  test('Basic consume', () => {
    return consumeTest(conn, enc.encode("Hi there"));
  });

  test(`Consume 1/2 window size`, () => {
    return consumeTest(conn, dataHalfWindow);
  });

  test(`Consume 1x window size`, () => {
    return consumeTest(conn, dataOneWindow);
  });

  test(`Consume 2x window size`, () => {
    return consumeTest(conn, dataTwoWindow);
  });

  test('Large consume', () => {
    return consumeTest(conn, bigData);
  });

  test('Basic echo', () => {
    return echoTest(conn, enc.encode("Hi there"));
  });

  test(`Echo 1/2 window size`, () => {
    return echoTest(conn, dataHalfWindow);
  });

  test(`Echo 1x window size`, () => {
    return echoTest(conn, dataOneWindow);
  });

  test(`Echo 2x window size`, () => {
    return echoTest(conn, dataTwoWindow);
  });

  test('Large echo', () => {
    return echoTest(conn, bigData);
  });

  test('Basic mimic', async () => {
    return mimicTest(conn, enc.encode("Hi there"));
  });

  test(`Mimic 1/2 window size`, () => {
    return mimicTest(conn, dataHalfWindow);
  });

  test(`Mimic 1x window size`, () => {
    return mimicTest(conn, dataOneWindow);
  });

  test(`Mimic 2x window size`, () => {
    return mimicTest(conn, dataTwoWindow);
  });

  test('Large mimic', () => {
    return mimicTest(conn, bigData);
  });

  const stop = stopwatch();

  if (concurrent) {
    await runTestsConcurrent();
  }
  else {
    await runTests();
  }

  console.log(`Ran in ${formatTime(stop())}`);

  // TODO: turn close() into a test
  // TODO: This is currently throwing an (uncatchable apparently) exception
  // when using WebTransport
  await conn.close();

  async function test(description, callback) {
    testQueue.push({ description, callback });
  }

  async function runTests() {
    for (const test of testQueue) {
      await runTest(test); 
    }
  }

  async function runTestsConcurrent() {
    const promises = [];
    for (const test of testQueue) {
      promises.push(runTest(test)); 
    }
    await Promise.all(promises);
  }

  async function runTest(test) {

    let timeoutId;
    const timeoutPromise = new Promise((resolve, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error("Timeout"));
      }, TimeoutMs);
    });

    const stop = stopwatch();

    try {

      const testPromise = test.callback();
      await Promise.race([ testPromise, timeoutPromise ]);

      clearTimeout(timeoutId);

      const results = await testPromise;

      const duration = stop();

      let msg = `PASS - ${test.description} - ${formatTime(duration)}`;
      if (results && results.bytesReceived) {
        const bytesPerSec = results.bytesReceived / duration;
        msg += ` - ${formatBytes(results.bytesReceived)} - ${formatBytes(bytesPerSec)}/s`;
      }
      else if (results && results.bytesSent) {
        const bytesPerSec = results.bytesSent / duration;
        msg += ` - ${formatBytes(results.bytesSent)} - ${formatBytes(bytesPerSec)}/s`;
      }
      console.log(msg);
    }
    catch (e) {
      console.error('FAIL - ' + test.description);
      console.group(test.description);
      console.error(e);
      console.groupEnd();
    }
  }

  async function consumeTest(conn, data) {
    const stream = await conn.createBidirectionalStream();
    const writer = stream.writable.getWriter();
    await writer.ready;
    const testData = buildData(TestTypeConsume, nextTestId++, data);
    await writer.write(testData);
    await writer.ready;
    await writer.close();

    return {
      bytesSent: data.length,
    };
  }

  async function echoTest(conn, data) {
    const stream = await conn.createBidirectionalStream();
    const writer = stream.writable.getWriter();

    const expectData = buildData(TestTypeEcho, nextTestId++, data);

    const stop = stopwatch();

    (async () => {
      await writer.ready;
      await writer.write(expectData);

      await writer.ready;
      await writer.close();
    })();

    await waitUntilReceived(stream, expectData);

    return {
      bytesSent: data.length,
      bytesReceived: data.length,
    }
  }

  async function mimicTest(conn, data) {
    const stream = await conn.createBidirectionalStream();
    const writer = stream.writable.getWriter();

    const id = nextTestId++;

    const expectData = buildData(TestTypeMimic, id, data);

    (async () => {
      await writer.ready;
      await writer.write(expectData);
    })();

    const responseStream = await streamReader.acceptWithId(id);

    await waitUntilReceived(responseStream, expectData);

    await writer.ready;
    await writer.close();

    return {
      bytesReceived: data.length,
    }
  }
}

class StreamReader {
  constructor(incomingBidirectionalStreams) {

    this._streamMap = {};
    this._resolveMap = {};

    (async () => {
      for await (const stream of incomingBidirectionalStreams) {

        const reader = stream.readable.getReader();

        let bytesReceived = 0;

        let firstChunk = new Uint8Array();

        while (bytesReceived < TEST_HEADER_SIZE) {
          const { value, done } = await reader.read();
          if (done) {
            throw new Error("done early");
          }

          firstChunk = concatArrays(firstChunk, value);
          bytesReceived += value.length;
        }

        reader.releaseLock();

        const dv = new DataView(firstChunk.buffer);
        const id = dv.getUint32(1, false);

        const tsSend = new TransformStream();
        const tsRecv = new TransformStream();

        const passthroughStream = {
          readable: tsRecv.readable,
          writable: tsSend.writable,
        };

        (async () => {
          const writer = tsRecv.writable.getWriter();
          await writer;
          await writer.write(firstChunk);
          await writer.releaseLock();
          try {
            await stream.readable.pipeTo(tsRecv.writable);
          }
          catch (e) {
            // TODO: this is throwing undefined errors but the tests are working
          }
        })();

        tsSend.readable.pipeTo(stream.writable);

        if (this._resolveMap[id]) {
          this._resolveMap[id](passthroughStream);
        }
        else {
          this._streamMap[id] = passthroughStream;
        }
      }
    })();
  }

  async acceptWithId(id) {
    if (this._streamMap[id]) {
      return this._streamMap[id];
    }
    else {
      return new Promise((resolve, reject) => {
        this._resolveMap[id] = resolve;
      });
    }
  }
}

function stopwatch() {
  const startTime = performance.now();

  return () => {
    return (performance.now() - startTime) / 1000;
  };
}

function arraysEqual(a1, a2) {
  if (a1.length !== a2.length) {
    return false;
  }

  // Check several points as a fast smoke test first
  if (a1[0] !== a2[0] || a1[a1.length-1] !== a2[a2.length-1]) {
    return false;
  }
  const step = (a1.length / 10);
  for (let i = 0; i < a1.length; i += step) {
    if (a1[i] !== a2[i]) {
      return false;
    }
  }

  // Compare entire arrays if necessary
  for (let i=0; i<a1.length; i++) {
    if (a1[i] !== a2[i]) {
      return false;
    }
  }
  return true;
}

function concatArrays(a1, a2) {
  const catted = new Uint8Array(a1.length + a2.length);
  catted.set(a1);
  catted.set(a2, a1.length);
  return catted;
}

function buildData(type, id, data) {

  let valid = false;
  for (const elem of data) {
    if (elem !== 0) {
      valid = true;
      break;
    }
  }

  if (!valid) {
    throw new Error("Data is invalid");
  }

  const catted = new Uint8Array(TEST_HEADER_SIZE + data.length);
  catted[0] = type;
  const dv = new DataView(catted.buffer);
  dv.setUint32(TEST_TYPE_SIZE, id, false);
  catted.set(data, TEST_HEADER_SIZE);

  return catted;
}

async function sleep(sec) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, sec*1000);
  });
}

function initArray(a) {
  for (let i=0; i<a.length; i++) {
    a[i] = i;
  }
}

function formatTime(timeSeconds) {
  if (timeSeconds > 1) {
    return `${timeSeconds.toFixed(3)}s`;
  }
  else {
    return `${(timeSeconds*1000).toFixed(3)}ms`;
  }
}

function formatBytes(bytes) {
  if (bytes > 1*1000*1000*1000) {
    return (bytes / 1000 / 1000 / 1000).toFixed(2) + " GB";
  }
  else if (bytes > 1*1000*1000) {
    return (bytes / 1000 / 1000).toFixed(2) + " MB";
  }
  else if (bytes > 1*1000) {
    return (bytes / 1000).toFixed(2) + " KB";
  }
  return bytes.toFixed(2) + " bytes";
}

async function waitUntilReceived(stream, expectData) {
  const echoData = new Uint8Array(expectData.length);
  echoData.fill(42);

  let offset = 0;
  for await (const chunk of stream.readable) {
    if ((offset + chunk.length) > expectData.length) {
      throw new Error("Data doesn't match expected");
    }
    echoData.set(chunk, offset);
    offset += chunk.length;
    if (arraysEqual(echoData, expectData)) {
      break;
    }
  }
}

export {
  run,
};
