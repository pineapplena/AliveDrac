const base = process.argv[2] ?? 'http://127.0.0.1:8788';

async function json(path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) }
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!response.ok) throw new Error(`${path}: ${response.status} ${text.slice(0, 300)}`);
  return data;
}

async function chat(text) {
  const response = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  if (!response.ok || !response.body) throw new Error(`chat ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const events = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf('\n\n');
    while (index >= 0) {
      const raw = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const lines = raw.split('\n');
      let type = '';
      let data = '';
      for (const line of lines) {
        if (line.startsWith('event:')) type = line.slice(6).trim();
        if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (type && data) {
        try {
          events.push({ type, data: JSON.parse(data) });
        } catch {
          // ignore
        }
      }
      index = buffer.indexOf('\n\n');
    }
  }
  const done = events.find((event) => event.type === 'done');
  const error = events.find((event) => event.type === 'error');
  if (error) throw new Error(`chat error: ${JSON.stringify(error.data)}`);
  return done?.data?.message?.content ?? '';
}

const health = await json('/api/health');
console.log('health:', health.ok, 'demo:', health.demo);

const boot = await json('/api/bootstrap');
console.log('character:', boot.character.name, '| state:', boot.life.state.currentActivity);

const created = await json('/api/memories', {
  method: 'POST',
  body: JSON.stringify({
    kind: 'preference',
    title: '画画时会忘记时间',
    content: '对方喜欢在晚上画画，进入状态之后会忘记时间，也不太记得吃饭。',
    importance: 0.72,
    pinned: true,
    tags: ['画画', '习惯']
  })
});
console.log('memory created:', created.id, created.title);

const found = await json('/api/memories?query=' + encodeURIComponent('画画'));
console.log('memory search:', found.memories.length, found.memories[0]?.title);

for (const text of [
  '今天画了一晚上，手都酸了',
  '晚饭只吃了面包，你别念我',
  '你还记得我上次说要画你吗',
  '明天要去复查，有点紧张',
  '晚安，今天真的困了'
]) {
  const reply = await chat(text);
  console.log('chat:', text, '=>', reply.replace(/\n/g, ' / ').slice(0, 80));
}

const summary = await json('/api/memories/summarize', { method: 'POST' });
console.log('summary:', JSON.stringify(summary));

const stats = await json('/api/stats');
console.log('stats: messages', stats.messages, 'memories', stats.memories.total, 'timeline', stats.memories.timeline);

const proactive = await json('/api/proactive/run', {
  method: 'POST',
  body: JSON.stringify({ force: true })
});
console.log('proactive:', proactive.sent, proactive.reason);

const schedule = await json('/api/schedule/generate', {
  method: 'POST',
  body: JSON.stringify({})
});
console.log('schedule:', schedule.source, schedule.blocks.length);

console.log('OK');
