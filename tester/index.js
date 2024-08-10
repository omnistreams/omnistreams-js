import omnistreams from '../index.js';

const TestTypeConsume = 0;
const TestTypeEcho = 1;
const TestTypeMimic = 2;

async function run(serverUri, concurrent) {

  // TODO: turn connection initiation into a test
  const conn = new omnistreams.WebTransport(serverUri);

  await conn.ready;

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const testQueue = [];

  test('Basic consume', async () => {
    await consumeTest(conn, "Hi there");
  });

  test('Basic echo', async () => {
    await echoTest(conn, "Hi there");
  });

  test('Basic mimic', async () => {
    await mimicTest(conn, "Hi there");
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
    await writer.write(new Uint8Array([TestTypeConsume, ...enc.encode(data)]));
    await writer.ready;
    await writer.close();
  }

  async function echoTest(conn, data) {
    const stream = await conn.createBidirectionalStream();
    const writer = stream.writable.getWriter();

    const testData = enc.encode(data);

    await writer.ready;
    await writer.write(new Uint8Array([TestTypeEcho, ...testData]));

    await writer.ready;
    await writer.close();

    let echoData = new Uint8Array();
    for await (const chunk of stream.readable) {
      echoData = concatArrays(echoData, chunk);
      if (arraysEqual(echoData, testData)) {
        break;
      }
    }
  }

  async function mimicTest(conn, data) {
    const stream = await conn.createBidirectionalStream();
    const writer = stream.writable.getWriter();

    (async () => {
      await writer.ready;
      await writer.write(new Uint8Array([TestTypeMimic, ...enc.encode(data)]));
    })();

    const streamReader = conn.incomingBidirectionalStreams.getReader();
    const res = await streamReader.read();
    const responseStream = res.value;

    let mimicData = '';
    for await (const chunk of responseStream.readable) {
      mimicData += dec.decode(chunk);
      if (mimicData === data) {
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
