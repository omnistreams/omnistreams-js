import omnistreams from '../index.js';

const TestTypeConsume = 0;
const TestTypeEcho = 1;
const TestTypeMimic = 2;

const TimeoutMs = 2000;

const WINDOW_SIZE = 256*1024;

async function run(serverUri, concurrent) {

  // TODO: turn connection initiation into a test
  const conn = new omnistreams.WebTransport(serverUri);
  (async () => {
    try {
      await conn.closed;
    }
    catch (e) {
      console.error("Connection closed", e);
    }
  })();

  await conn.ready;
  const streamReader = conn.incomingBidirectionalStreams.getReader();

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const dataHalfWindow = new Uint8Array(WINDOW_SIZE / 2);
  initArray(dataHalfWindow);
  const dataOneWindow = new Uint8Array(1*WINDOW_SIZE);
  initArray(dataOneWindow);
  const dataTwoWindow = new Uint8Array(2*WINDOW_SIZE);
  initArray(dataTwoWindow);

  const bigData = new Uint8Array(1*1024*1024);
  initArray(bigData);

  const testQueue = [];

  test('Basic consume', async () => {
    await consumeTest(conn, enc.encode("Hi there"));
  });

  test(`Consume 1/2 window size (${dataHalfWindow.length} bytes)`, async () => {
    await consumeTest(conn, dataHalfWindow);
  });

  test(`Consume 1x window size (${dataOneWindow.length} bytes)`, async () => {
    await consumeTest(conn, dataOneWindow);
  });

  test(`Consume 2x window size (${dataTwoWindow.length} bytes)`, async () => {
    await consumeTest(conn, dataTwoWindow);
  });

  test('Large consume', async () => {
    await consumeTest(conn, bigData);
  });

  test('Basic echo', async () => {
    await echoTest(conn, enc.encode("Hi there"));
  });

  test(`Echo 1/2 window size (${dataHalfWindow.length} bytes)`, async () => {
    await echoTest(conn, dataHalfWindow);
  });

  test(`Echo 1x window size (${dataOneWindow.length} bytes)`, async () => {
    await echoTest(conn, dataOneWindow);
  });

  test(`Echo 2x window size (${dataTwoWindow.length} bytes)`, async () => {
    await echoTest(conn, dataTwoWindow);
  });

  test('Large echo', async () => {
    await echoTest(conn, bigData);
  });

  test('Basic mimic', async () => {
    await mimicTest(conn, enc.encode("Hi there"));
  });

  test('Large mimic', async () => {
    await mimicTest(conn, bigData);
  });

  const startTime = performance.now();

  if (concurrent) {
    await runTestsConcurrent();
  }
  else {
    await runTests();
  }

  const duration = (performance.now() - startTime) / 1000;
  console.log(`Ran in ${duration} seconds`);

  // TODO: turn close() into a test
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

    try {

      await Promise.race([ test.callback(), timeoutPromise ]);

      clearTimeout(timeoutId);

      console.log('PASS -- ' + test.description);
    }
    catch (e) {
      console.error('FAIL -- ' + test.description);
      console.group(test.description);
      console.error(e);
      console.groupEnd();
    }
  }

  async function consumeTest(conn, data) {
    //await sleep(300);
    const stream = await conn.createBidirectionalStream();
    const writer = stream.writable.getWriter();
    await writer.ready;
    const testData = buildData(TestTypeConsume, data);
    await writer.write(testData);
    await writer.ready;
    await writer.close();
  }

  async function echoTest(conn, data) {
    const stream = await conn.createBidirectionalStream();
    const writer = stream.writable.getWriter();

    const wireData = buildData(TestTypeEcho, data);

    const expectData = wireData.slice(1);

    (async () => {
      await writer.ready;
      await writer.write(wireData);

      await writer.ready;
      await writer.close();
    })();

    // TODO: consider creating echoData with size expectData.length and using
    // Uint8Array.set() to append. Not sure if comparing would be faster than
    // allocating (since comparing can shortcut if sizes are different, but I
    // suspect it would be much faster.
    let echoData = new Uint8Array();
    for await (const chunk of stream.readable) {
      echoData = concatArrays(echoData, chunk);
      if (arraysEqual(echoData, expectData)) {
        break;
      }
    }
  }

  async function mimicTest(conn, data) {
    const stream = await conn.createBidirectionalStream();
    const writer = stream.writable.getWriter();

    const wireData = buildData(TestTypeMimic, data);
    const expectData = wireData.slice(1);

    (async () => {
      await writer.ready;
      await writer.write(wireData);
    })();

    const res = await streamReader.read();
    const responseStream = res.value;

    let mimicData = new Uint8Array();
    for await (const chunk of responseStream.readable) {
      mimicData = concatArrays(mimicData, chunk);
      if (arraysEqual(mimicData, expectData)) {
        break;
      }
    }

    await writer.ready;
    await writer.close();
  }
}

function arraysEqual(a1, a2) {
  if (a1.length !== a2.length) {
    return false;
  }
  for (let i=0; i<a1.length; i++) {
    if (a1[i] !== a2[i]) {
      return false;
    }
  }
  return true;
}

function concatArrays(a1, a2) {
  // TODO: slow. Use Uint8Array.set()
  const catted = new Uint8Array(a1.length + a2.length);
  catted.set(a1);
  catted.set(a2, a1.length);
  return catted;
}

function buildData(type, data) {

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

  const catted = new Uint8Array(1 + data.length);
  catted[0] = type;
  catted.set(data, 1);

  return catted;
}

async function sleep(ms) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

function initArray(a) {
  for (let i=0; i<a.length; i++) {
    a[i] = i;
  }
}

export {
  run,
};
