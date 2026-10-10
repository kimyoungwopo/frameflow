#!/usr/bin/env node
const base = process.env.FRAMEFLOW_E2E_ORIGIN || `http://127.0.0.1:${process.env.BRIDGE_PORT || 4319}`;
(async () => {
  const response = await fetch(`${base}/status`, { signal: AbortSignal.timeout(5000) });
  const data = await response.json();
  const result = {
    origin: base,
    httpStatus: response.status,
    bridge: data.bridge === 'gpt-node-studio-bridge',
    authenticated: data.authenticated === true,
    canRun: data.canRun === true,
    sessionPresent: data.sessionPresent === true,
    providerAuthReady: data.authenticated === true,
    providerCallExecuted: false,
    e2eReady: false,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.e2eReady) process.exitCode = 2;
})().catch((error) => {
  console.error(JSON.stringify({ origin: base, e2eReady: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exitCode = 1;
});
