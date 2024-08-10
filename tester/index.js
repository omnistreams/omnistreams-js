import omnistreams from '../index.js';

const TestTypeConsume = 0;
const TestTypeEcho = 1;
const TestTypeMimic = 2;

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

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const bigData = new Uint8Array(10*1024*1024);
  bigData.fill(42);

  const testQueue = [];

  test('Basic consume', async () => {
    await consumeTest(conn, enc.encode("Hi there"));
  });

  test('Large consume', async () => {
    await consumeTest(conn, bigData);
  });

  test('Basic echo', async () => {
    await echoTest(conn, enc.encode("Hi there"));
  });

  test('Basic mimic', async () => {
    await mimicTest(conn, enc.encode("Hi there"));
  });

  if (concurrent) {
    await runTestsConcurrent();
  }
  else {
    await runTests();
  }

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
    try {
      await test.callback();
      console.log('PASS -- ' + test.description);
    }
    catch (e) {
      console.error('FAIL -- ' + test.description);
      console.group();
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

    await writer.ready;
    await writer.write(wireData);

    await writer.ready;
    await writer.close();

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

    const streamReader = conn.incomingBidirectionalStreams.getReader();
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
  return new Uint8Array([...a1, ...a2]);
}

function buildData(type, data) {

  const arr = new Uint8Array([...data]);

  let valid = false;
  for (const elem of arr) {
    if (elem !== 0) {
      valid = true;
      break;
    }
  }

  if (!valid) {
    throw new Error("Data is invalid");
  }

  return new Uint8Array([type, ...arr]);
}

async function sleep(ms) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

export {
  run,
};
