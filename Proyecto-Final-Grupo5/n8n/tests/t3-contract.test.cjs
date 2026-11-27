const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const workflow = require('../workflow.json');
const lookupWorkflow = require('../consultar-pedido.json');

function runCode(name, item, earlierNodes = {}) {
  const node = workflow.nodes.find(node => node.name === name);
  const run = new Function('$input', '$', node.parameters.jsCode);
  return run({ first: () => ({ json: item }) }, name => ({
    first: () => ({ json: earlierNodes[name] }),
  }))[0].json;
}

function resolve(chatInput, messages) {
  return runCode('Resolver contexto del pedido', { messages }, {
    'Validar chat': { chatInput },
  });
}

function formResponse(agent, orderId = 'JS-101', origin = 'current') {
  return runCode('Formar respuesta verificada', agent, {
    'Resolver contexto del pedido': { orderId, origin },
  });
}

function observation(orderId, data) {
  return {
    action: { tool: 'consultar_pedido' },
    observation: JSON.stringify([{ status: 'found', orderId, data }]),
  };
}

test('a current ID supersedes history and an ambiguous human turn blocks earlier IDs', () => {
  const messages = [{ human: 'Mi pedido JS-102' }, { human: 'JS-104 o JS-101' }];
  assert.equal(resolve('Revisa js-103', messages).orderId, 'JS-103');
  assert.equal(resolve('Quedó JS-101 o JS-102', messages).origin, 'ambiguous');
  assert.equal(resolve('¿Cuándo llegó?', messages).orderId, null);
  assert.equal(resolve('¿Cuándo llegó?', [{ human: 'Pedido JS-102' }, { ai: 'JS-103' }]).orderId, 'JS-102');
  assert.equal(resolve('¿Cuándo llegó?', [{ ai: 'JS-103' }]).orderId, null);
});

test('only recent human turns can authorize a historical ID', () => {
  const messages = [{ human: 'Pedido JS-102' }, ...Array.from({ length: 6 }, () => ({ human: 'Gracias' }))];
  assert.equal(resolve('¿Cuándo llegó?', messages).origin, 'missing');
});

test('the response projects evidence from the bound tool and rejects an unsupported category', () => {
  const data = {
    orderId: 'JS-101', sku: 'BAL-01', productName: 'Balón de entrenamiento', channel: 'online',
    deliveredOn: '2026-11-13', warrantyMonths: 12, requiresSerial: false, extra: 'internal',
  };
  const result = formResponse({
    output: '{"category":"approved"}', intermediateSteps: [observation('JS-101', data)],
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.classification, { category: 'sin_clasificar' });
  assert.equal(result.body.evidence[0].data.deliveredOn, '2026-11-13');
  assert.equal(Object.hasOwn(result.body.evidence[0].data, 'extra'), false);
  assert.equal(Object.hasOwn(result.body, 'intermediateSteps'), false);
});

test('a missing or mismatched tool observation cannot supply order facts', () => {
  const agent = { output: '{"category":"retracto"}' };
  assert.equal(formResponse(agent).body.error.code, 'AGENT_UNAVAILABLE');
  agent.intermediateSteps = [observation('JS-104', { orderId: 'JS-104' })];
  assert.equal(formResponse(agent).body.error.code, 'DATA_SOURCE_UNAVAILABLE');
  assert.deepEqual(formResponse(agent, null, 'ambiguous').body.evidence, []);
});

test('lookup parameters come from context and exports contain no credential bindings', () => {
  const tool = workflow.nodes.find(node => node.name === 'consultar_pedido');
  assert.equal(tool.parameters.workflowId.value, lookupWorkflow.id);
  assert.match(tool.parameters.workflowInputs.value.orderId, /Resolver contexto del pedido/);
  assert.doesNotMatch(tool.parameters.workflowInputs.value.orderId, /\$fromAI/);
  assert.ok([...workflow.nodes, ...lookupWorkflow.nodes].every(node => !node.credentials));
});

const webhookUrl = process.env.JALECO_T3_URL;
test('the published webhook classifies Spanish claims and isolates conversation context', {
  skip: !webhookUrl, timeout: 240_000,
}, async () => {
  assert.ok(process.env.N8N_WEBHOOK_KEY, 'Set N8N_WEBHOOK_KEY for the integration test');
  const a = randomUUID();
  const cases = [
    [a, 'Quiero devolver el pedido JS-101 porque cambié de opinión', 'retracto', 'JS-101'],
    [a, '¿Qué día lo recibí?', 'retracto', 'JS-101'],
    [randomUUID(), '¿Qué día lo recibí?', 'sin_clasificar', null],
    [randomUUID(), 'Quiero cambiar la talla de JS-103 porque me queda grande', 'cambio_talla', 'JS-103'],
    [randomUUID(), 'El cronómetro JS-102 dejó de funcionar', 'defecto', 'JS-102'],
    [randomUUID(), 'En el paquete JS-104 faltó una pieza', 'pedido_incompleto', 'JS-104'],
    [randomUUID(), 'Pedí M y llegó S', 'sin_clasificar', null],
    [randomUUID(), 'Tengo un problema con mi compra', 'sin_clasificar', null],
    [randomUUID(), 'Consulta el pedido JS-999', 'sin_clasificar', null],
  ];

  for (const [sessionId, chatInput, category, recordId] of cases) {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Jaleco-Key': process.env.N8N_WEBHOOK_KEY },
      body: JSON.stringify({ sessionId, chatInput }),
      signal: AbortSignal.timeout(90_000),
    });
    assert.equal(response.status, 200, chatInput);
    const body = await response.json();
    assert.deepEqual(body.classification, { category }, chatInput);
    assert.equal(body.draft, null, chatInput);
    assert.deepEqual(body.evidence.map(item => item.recordId), recordId ? [recordId] : [], chatInput);
  }
});
