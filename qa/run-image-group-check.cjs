const fs = require('node:fs');
const assert = require('node:assert/strict');
require('../tests/load-ts.cjs');
const { executeWorkflow, workflowGroups } = require('../web/app/workflow-engine.ts');

async function main() {
  const source = `data:image/png;base64,${fs.readFileSync(`${__dirname}/group-test-source.png`).toString('base64')}`;
  const nodes = [
    { id: 1, type: 'image', imageUrl: source },
    { id: 2, type: 'prompt', prompt: 'Apply a warm amber color grade to this product illustration. Preserve the bottle shape, label, cap, background and composition. Change only color temperature. Do not add text.' },
    { id: 3, type: 'edit' }, { id: 4, type: 'preview' },
    { id: 5, type: 'prompt', prompt: 'Apply a cool blue color grade to this product illustration. Preserve the bottle shape, label, cap, background and composition. Change only color temperature. Do not add text.' },
    { id: 6, type: 'edit' }, { id: 7, type: 'preview' },
  ];
  const edges = [[1,2],[2,3],[3,4],[1,5],[5,6],[6,7]].map(([source,target]) => ({source,target}));
  const disconnected = nodes.map(n => ({ ...n, id: n.id + 10 }));
  const separateEdges = edges.map(e => ({source:e.source+10,target:e.target+10}));
  assert.equal(workflowGroups([...nodes,...disconnected],[...edges,...separateEdges],null).length,2);
  assert.equal(workflowGroups([...nodes,...disconnected],[...edges,...separateEdges],3).length,1);
  assert.equal(workflowGroups(nodes,edges,3)[0].length,7);
  const report = { testedAt: new Date().toISOString(), groups: { separateChains:2, selectedChains:1, sharedInputIncludesBothBranches:true }, calls:[], previews:[] };
  await executeWorkflow({nodes,edges,request:'',normalizeImage:async url=>url,
    execute: async stage => {
      assert.equal(stage.imageUrls.length,1);
      assert.equal(stage.imageUrls[0],source);
      const response = await fetch('http://127.0.0.1:4320/api/workflow/execute',{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://127.0.0.1:4320'},body:JSON.stringify(stage),signal:AbortSignal.timeout(245000)});
      const data = await response.json();
      report.calls.push({status:response.status,kind:stage.kind,originalInput:true,prompt:stage.prompt});
      if (!response.ok || !data.imageUrl) throw new Error(`Image request failed: ${response.status} ${data.error || ''} ${data.message || ''}`);
      console.log(`Real image request ${report.calls.length}: ${response.status}`);
      return data.imageUrl;
    },
    onPreview: (node,url) => {
      const file = node.id===4?'group-result-warm.png':'group-result-cool.png';
      const match = /^data:image\/[^;]+;base64,(.+)$/.exec(url);
      if (!match) throw new Error('Expected data image result');
      fs.writeFileSync(`${__dirname}/${file}`,Buffer.from(match[1],'base64'));
      report.previews.push({nodeId:node.id,file});
    }
  });
  fs.writeFileSync(`${__dirname}/IMAGE-GROUP-CHECK.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
