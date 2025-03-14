const RUNTIME_BROWSER = 0;
const RUNTIME_NODE = 1;
const RUNTIME_DENO = 2;
const RUNTIME_BUN = 3;

const runtime = detectRuntime();

function detectRuntime() {
  let runtime = RUNTIME_BROWSER;
  if (globalThis.Deno !== undefined) {
    runtime = RUNTIME_DENO;
  }
  else if (typeof process !== 'undefined' && process.versions.bun !== undefined) {
    runtime = RUNTIME_BUN;
  }
  else if (isNode()) {
    runtime = RUNTIME_NODE;
  }
  return runtime;
}

function isNode() {
  return (typeof process !== 'undefined' && process.release.name === 'node');
}

export {
  isNode,
  detectRuntime,
  RUNTIME_NODE,
  RUNTIME_DENO,
  RUNTIME_BUN,
};
