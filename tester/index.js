import omnistreams from '../index.js';

const TestTypeConsume = 0;
const TestTypeEcho = 1;
const TestTypeMimic = 2;

async function run(serverUri) {

  // TODO: turn connection initiation into a test
  const conn = new omnistreams.WebTransport(serverUri);

  await conn.ready;

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  await consumeTest(conn, "Hi there");
  await echoTest(conn, "Hi there");
  await mimicTest(conn, "Hi there");

  // TODO: turn close() into a test
  conn.close();

  async function consumeTest(conn, data) {
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

export {
  run,
};
