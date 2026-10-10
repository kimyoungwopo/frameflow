const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('../web/node_modules/typescript');
require('./load-ts.cjs');
const settle = () => new Promise(resolve => setImmediate(resolve));

function persistenceHarness(props = {}) {
  const metadata = new Map(), pixels = new Map(), timers = new Map(), slots = [];
  let position = 0, dirty = true, pendingEffects = [], api, loadFailure = false, holdLoad, saveFailure = false, deleteFailure = false;
  const writes = [];
  let workspaceProps = props;
  let bridgeFetch = async () => ({ json: async () => ({}) });
  const react = {
    useState(initial) {
      const index = position++;
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], value => { const next = typeof value === 'function' ? value(slots[index]) : value; if (next !== slots[index]) { slots[index] = next; dirty = true; } }];
    },
    useRef(initial) { const index = position++; return slots[index] ||= { current: initial }; },
    useMemo(callback) { position++; return callback(); },
    useEffect(callback, deps) {
      const index = position++, old = slots[index];
      if (!old || deps.some((value, i) => value !== old.deps[i])) {
        slots[index] = { deps, cleanup: old?.cleanup };
        pendingEffects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = callback(); });
      }
    },
  };
  const storage = {
    async saveImageRecords(records, id) { if (saveFailure) throw new Error('write failed'); writes.push(id); pixels.set(id, Object.fromEntries(records.map(record => [record.key, record.url]))); },
    async loadImageRecords(keys, id) { if (loadFailure) { loadFailure = false; throw new Error('read failed'); } if (holdLoad) await holdLoad; const values = pixels.get(id) || {}; return Object.fromEntries(keys.filter(key => key in values).map(key => [key, values[key]])); },
    async deleteImageRecords(keys, id) { const values = pixels.get(id) || {}; for (const key of keys) delete values[key]; },
    async deleteProjectImageRecords(id) { if (deleteFailure) throw new Error('delete failed'); pixels.delete(id); },
  };
  const page = path.resolve(__dirname, '../web/app/page.tsx');
  const source = fs.readFileSync(page, 'utf8');
  const cut = source.indexOf('  const resultCount =');
  const program = source.slice(0, cut) + '\nreturn { createProject, openProject, saveProject, deleteProject, importProject, setNodes, setEdges, setRequest, setProjectName, addNode, startVisualTask, plan, runWorkflow, executionRef, planningRef, nodes, history, runState, currentProjectId, hydrated, message };\n}\nexports.StudioWorkspace = StudioWorkspace;';
  const context = {
    exports: {}, AbortController, AbortSignal, crypto: require('node:crypto').webcrypto,
    FileReader: class { readAsText(file) { this.result = file.content; queueMicrotask(() => { this.onload(); this.onloadend(); }); } },
    localStorage: { getItem: key => metadata.get(key) ?? null, setItem: (key, value) => metadata.set(key, value), removeItem: key => metadata.delete(key) },
    window: { confirm: () => true, addEventListener() {}, removeEventListener() {}, setTimeout(callback) { const id = Symbol(); timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); } },
    require(name) {
      if (name === 'react') return react;
      if (name === 'gifenc') return require('../web/node_modules/gifenc');
      if (name === 'upng-js') return { encode: () => new ArrayBuffer(0) };
      if (name === './image-store') return storage;
      if (name === './local-bridge') return { localBridgeFetch: (...args) => bridgeFetch(...args) };
      const file = path.resolve(path.dirname(page), name);
      if (fs.existsSync(file + '.tsx')) return {};
      return require(file + '.ts');
    },
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(program, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const render = () => {
    for (let iteration = 0; dirty && iteration < 20; iteration++) {
      dirty = false; position = 0; api = context.exports.StudioWorkspace(workspaceProps);
      const effects = pendingEffects; pendingEffects = []; effects.forEach(effect => effect());
    }
    return api;
  };
  return {
    metadata, pixels, writes, get api() { return api; }, render,
    setProps(next) { workspaceProps = { ...workspaceProps, ...next }; dirty = true; render(); },
    setBridge(callback) { bridgeFetch = callback; },
    async settle() { await settle(); render(); await settle(); render(); },
    async timers() { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } await settle(); render(); },
    failRead() { loadFailure = true; }, failSave(value) { saveFailure = value; }, failDelete() { deleteFailure = true; },
    holdRead() { let release; holdLoad = new Promise(resolve => { release = resolve; }); return () => { holdLoad = null; release(); }; },
  };
}
module.exports = { persistenceHarness };
