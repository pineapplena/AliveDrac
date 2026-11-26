import { fallbackSchedule } from './schedule-template.js';

export interface MockChatContext {
  characterName: string;
  userName: string;
  userText: string;
  currentActivity: string;
  currentLocation: string;
  mood: number;
  energy: number;
  hour: number;
  minute: number;
  weekday: number;
  weatherLabel?: string;
  memories?: string[];
  lastUserText?: string;
  imageSummary?: string;
  imageIdentity?: 'self' | 'other' | 'uncertain';
  proactive?: {
    type: string;
    reason: string;
    detail?: string;
  };
}

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function period(hour: number): 'night' | 'morning' | 'noon' | 'afternoon' | 'evening' {
  if (hour < 5) return 'night';
  if (hour < 11) return 'morning';
  if (hour < 14) return 'noon';
  if (hour < 18) return 'afternoon';
  if (hour < 23) return 'evening';
  return 'night';
}

function namePrefix(ctx: MockChatContext): string {
  const name = ctx.userName.trim();
  if (!name || name === '你' || name === '用户') return '';
  return `${name}，`;
}

function firstLine(ctx: MockChatContext): string {
  switch (period(ctx.hour)) {
    case 'night':
      return '唔……这个点还醒着。';
    case 'morning':
      return '唔，早。';
    case 'noon':
      return '欸，正好，我这边也刚停下来。';
    case 'afternoon':
      return '唔，我在。';
    default:
      return '欸，是你。';
  }
}

function sceneLine(ctx: MockChatContext): string {
  const place = ctx.currentLocation ? `我在${ctx.currentLocation}。` : '';
  const weather = ctx.weatherLabel ? `窗外${ctx.weatherLabel.split('，')[0]}。` : '';
  return `${place}${weather}`.trim() || '我这边挺好的。';
}

function generic(ctx: MockChatContext): string {
  const text = ctx.userText.trim();
  const veryShort = /^(嗯|哦|噢|好|行|可以|没事|没什么|算了|随便|哈哈|呵)[。！!？?…\s]*$/.test(text);
  const seed = hash(text);
  const openers = [
    '唔，我听着。',
    '嗯……让我想想。',
    '这个啊。',
    '欸。'
  ];
  const closers = [
    '你慢慢说，不急。',
    '然后呢？',
    '你那边现在怎么样？',
    '我先听着。'
  ];
  if (veryShort) {
    return `唔。\n---\n……就这一句？\n---\n算了，我在。你继续说。`;
  }
  const echo = text.length > 30 ? `${text.slice(0, 30)}……` : text;
  return `${openers[seed % openers.length]}\n---\n${echo}\n---\n${sceneLine(ctx)}\n${closers[seed % closers.length]}`;
}

export function mockChat(ctx: MockChatContext): string {
  const text = ctx.userText.trim();
  const lower = text.toLowerCase();
  const name = namePrefix(ctx);

  if (ctx.proactive) {
    const detail = ctx.proactive.detail ? `\n${ctx.proactive.detail}` : '';
    switch (ctx.proactive.type) {
      case 'schedule_share':
        return `欸。\n---\n${ctx.currentActivity}。${detail}\n---\n就是突然想让你也看一眼。`;
      case 'open_loop':
        return `那个……之前说的事。\n---\n${ctx.proactive.reason}\n---\n我没催你的意思。就是想起来了，问一句。`;
      case 'important_date':
        return `唔，今天是个特别的日子吧。\n---\n${ctx.proactive.reason}\n---\n……我没忘。`;
      case 'reminder':
        return `欸，提醒你一件事。\n---\n${ctx.proactive.reason}${ctx.proactive.detail ? `：${ctx.proactive.detail}` : ''}\n---\n……别忘了。`;
      case 'learning_share':
        return `欸，今天学到一个东西。\n---\n${ctx.proactive.reason}\n---\n……也不算什么大事，就是突然想告诉你。`;
      case 'leisure_share':
        return `刚刚什么都没干。\n---\n${ctx.proactive.reason}\n---\n……就，突然想跟你说一声。`;
      case 'weather_change':
        return `外面变天了。\n---\n${ctx.proactive.reason}\n---\n你那边呢，记得添件衣服。`;
      default:
        return `突然想跟你说一句。\n---\n${sceneLine(ctx)}${detail}\n---\n……没什么，就是想到了。`;
    }
  }

  if (ctx.imageSummary) {
    if (ctx.imageIdentity === 'self') {
      return `唔……这张，是我吗？\n---\n${ctx.imageSummary.replace(/\s+/g, ' ').slice(0, 80)}……\n---\n你从哪弄来的。`;
    }
    const glimpse = ctx.imageSummary.replace(/\s+/g, ' ').slice(0, 90);
    return `唔，我看到了。\n---\n${glimpse}……\n---\n你想让我看的是这个吗？`;
  }

  if (/^(在吗|在不在|在么|hi|hello|嗨|你好|早上好|早安|早|晚上好)[\s!！。？?]*$/i.test(text)) {
    return `${name}${firstLine(ctx)}\n---\n${sceneLine(ctx)}\n---\n怎么了，是身体不舒服，还是单纯想找我说话？`;
  }

  if (/晚安|睡了|去睡|先睡/.test(text)) {
    return `晚安。\n---\n……别又躺着玩手机。\n---\n明天见。`;
  }

  if (/在干嘛|在做什么|忙什么|干什么|在忙|做什么呢/.test(text)) {
    return `唔，${ctx.currentActivity || '发呆'}。\n---\n${sceneLine(ctx)}\n---\n你呢，这会儿在忙吗？`;
  }

  if (/只吃|没吃|面包|泡面|饿着|不饿/.test(text)) {
    return `只吃面包不行。\n---\n去煮个蛋，或者热一点牛奶。别拿这个糊弄自己。\n---\n……我不是在念你。就是会担心。`;
  }

  if (/吃了吗|吃饭|吃了没|饿不饿|午饭|晚饭|早饭/.test(text)) {
    const meal =
      ctx.hour >= 11 && ctx.hour < 14
        ? '正准备去食堂。今天有新的液态电池面包，我还在想要不要拿一块。'
        : ctx.hour >= 17 && ctx.hour < 20
          ? '刚吃完，今天吃得有点慢。'
          : ctx.hour < 11
            ? '早饭吃过了，粥和煎蛋。'
            : '还没到饭点，不过我手边有块小饼干。';
    return `${meal}\n---\n你呢？别又随便对付。`;
  }

  if (/画|素描|临摹|人体|手酸|手都酸/.test(text)) {
    return `画了一晚上？\n---\n手酸就先停一停，别硬撑着画。\n---\n画完的能给我看看吗？我保证不挑比例。`;
  }

  if (/复查|检查|医院|看病|紧张|有点怕/.test(text)) {
    return `唔……明天的事。\n---\n会紧张是正常的。今晚别熬，把要带的单据先放好。\n---\n明天我陪你去。我在，不用一个人扛。`;
  }

  if (/累|困|难受|不开心|烦|压力|焦虑|委屈|想哭|撑不住/.test(text)) {
    const soft =
      ctx.mood < -0.1
        ? '……我今天也有点闷。'
        : '……嗯，我在听。';
    return `${soft}\n---\n不用急着把话说清楚。先坐一会儿，喝口水。\n---\n${name}我陪你待会儿。`;
  }

  if (/你是谁|你叫什么|介绍一下自己|你的名字/.test(text)) {
    return `德蕾琪娜。罗斯凯利法算理中枢局，总务官。\n---\n……就是管签字、排期、盯进度的那种总务官。\n---\n你问这个做什么？`;
  }

  if (/可爱|好看|漂亮|喜欢你|想你|抱抱|贴贴/.test(text)) {
    return `……这种话，对总务官说不太合适吧。\n---\n（小声）不过，谢谢。\n---\n你今天是不是有点闲？`;
  }

  if (/谢谢|多谢|感谢/.test(text)) {
    return `这没什么。\n---\n你记得按时吃饭就行。\n---\n……真心的。`;
  }

  if (/对不起|抱歉|我错了/.test(text)) {
    return `唔。\n---\n知道了。\n---\n下次注意就好，我没记着。`;
  }

  if (/压力|工作|上学|考试|加班|上班/.test(text)) {
    return `听起来今天不轻松。\n---\n先把手头最急的那一件做完，剩下的排个序。别同时抓五件事。\n---\n${sceneLine(ctx)}\n我这边也一堆文件，正好陪你一起熬。`;
  }

  if (/天气|下雨|冷|热/.test(text)) {
    return `${ctx.weatherLabel ? `外面${ctx.weatherLabel}。` : '我这边看不出去。'}\n---\n你那边呢？别穿太少。`;
  }

  if (/秘密|结使|源质重构|挽昼|怪物/.test(text)) {
    return `……你从哪听来的。\n---\n总务官就是总务官。工牌在这里，要看吗？\n---\n（她把文件翻了一页，没再看你。）`;
  }

  return generic(ctx);
}

export interface MockTaskPayload {
  [key: string]: any;
}

export function mockTask(task: string, payload: MockTaskPayload): string {
  switch (task) {
    case 'schedule': {
      const weekday = Number(payload.weekday ?? 1);
      const blocks = fallbackSchedule(weekday).map((block) => ({
        start: block.startMin,
        end: block.endMin,
        activity: block.activity,
        location: block.location,
        category: block.category,
        detail: block.detail,
        shareable: block.shareable
      }));
      return JSON.stringify({ blocks });
    }
    case 'promise-check': {
      return JSON.stringify({ completed: [] });
    }
    case 'live-reply': {
      const event = payload.event ?? {};
      const uname = String(event.uname ?? '你');
      const text = String(event.text ?? '');
      const reply =
        event.type === 'gift' || event.type === 'super_chat'
          ? `谢谢${uname}，我替主播记下啦。`
          : /[?？]/.test(text)
            ? `${uname}，这个问题我先记着，等主播接话。`
            : `${uname}，看到了，主播等下就接你这句。`;
      return JSON.stringify({ reply, moderation: 'none' });
    }
    case 'summary': {
      const timeline: { role: string; content: string }[] = payload.timeline ?? [];
      const userLines = timeline.filter((item) => item.role === 'user').map((item) => item.content);
      const botLines = timeline
        .filter((item) => item.role === 'assistant')
        .map((item) => item.content);
      const lastUser = userLines.at(-1) ?? '';
      const lastBot = botLines.at(-1) ?? '';
      const memories = [] as Record<string, unknown>[];
      if (lastUser) {
        memories.push({
          kind: 'event',
          title: '最近聊到的事',
          content: `对方最近提到：${lastUser.slice(0, 120)}`,
          importance: 0.45,
          confidence: 0.75,
          valence: 0.1,
          tags: ['对话']
        });
      }
      if (lastBot) {
        memories.push({
          kind: 'self',
          title: '我说过的话',
          content: `我最近回应过：${lastBot.slice(0, 100)}`,
          importance: 0.35,
          confidence: 0.7,
          valence: 0.1,
          tags: ['自我']
        });
      }
      if (/喜欢|习惯|总是|每天|讨厌|害怕/.test(timeline.map((t) => t.content).join(' '))) {
        memories.push({
          kind: 'preference',
          title: '关于对方的偏好',
          content: `从最近的对话看，对方可能在意：${lastUser.slice(0, 80)}`,
          importance: 0.55,
          confidence: 0.6,
          valence: 0.1,
          tags: ['偏好', '待确认']
        });
      }
      return JSON.stringify({
        summary: `最近和对方聊了 ${timeline.length} 轮，主要围绕${lastUser.slice(0, 40) || '日常'}。`,
        memories
      });
    }
    case 'leisure-options': {
      const online = Boolean(payload.onlineEnabled);
      const overtime = payload.allowOvertime !== false;
      const options = [
        ...(overtime
          ? [
              {
                kind: 'overtime',
                activity: '把没校对完的那份文件再改一遍',
                reason: '反正现在也没别的事，心里又有点放不下。',
                appeal: 0.48
              }
            ]
          : []),
        {
          kind: online ? 'video' : 'music',
          activity: online ? '刷一会儿 B 站，看点不用动脑子的' : '戴上耳机听一会儿歌',
          reason: online ? '脑子有点空，想看看别人在做什么。' : '不想看字了，听点声音就好。',
          appeal: 0.72,
          search_query: online ? '轻松 治愈 日常 vlog' : ''
        },
        {
          kind: 'walk',
          activity: '去走廊尽头站一会儿，看看窗外',
          reason: '坐太久了，腿有点发麻。',
          appeal: 0.55
        },
        {
          kind: 'idle',
          activity: '什么都不做，靠在椅背上发一会儿呆',
          reason: '今天已经够满了，不想再安排什么。',
          appeal: 0.4
        }
      ];
      return JSON.stringify({ options, chosen: overtime ? 1 : 0 });
    }
    case 'life-fragment': {
      const activity = String(payload.activity ?? '发呆');
      return JSON.stringify({
        title: activity.includes('吃') ? '食堂的炖菜' : '一小段生活',
        detail: activity.includes('吃')
          ? '食堂窗口前排了几个人，我最后要了一份炖菜，找了个靠窗的位置慢慢吃完。'
          : `我把${activity}做到一半，停下来把旁边的批注重新看了一遍。`,
        kind: 'daily',
        importance: 0.42,
        shareable: true
      });
    }
    case 'leisure-reaction': {
      const activity = String(payload.activity ?? '发了一会儿呆');
      return JSON.stringify({
        reaction: `就这样${activity}。没有变得更有用，但肩膀好像松了一点。`,
        enjoyment: payload.kind === 'overtime' ? -0.15 : 0.58,
        shareable: payload.kind === 'overtime' ? '又加班了，不过这次是我自己坐下来的。' : '刚刚什么都没干，居然也还行。'
      });
    }
    case 'learning-candidates': {
      return JSON.stringify({
        candidates: [
          {
            topic: '人类为什么爱把奶茶点成三分糖',
            domain: '人类生活',
            question: '甜度和“刚刚好”的感觉，到底是怎么被决定的？',
            reason: '总务局的茶总是太苦，我一直没想明白。',
            desire: 0.82,
            kind: 'new'
          },
          {
            topic: '罗塞塔数据的谐波',
            domain: '空洞数据',
            question: '那些对不上的谐波，会不会其实是一种语言？',
            reason: '今天校对时又卡在同一段，越想越在意。',
            desire: 0.74,
            kind: 'continue'
          },
          {
            topic: '龙角被碰到时为什么会先觉得痒',
            domain: '自我',
            question: '别的龙角也会这样吗，还是只有我这样？',
            reason: '早上理头发时碰到了，愣了好一会儿。',
            desire: 0.58,
            kind: 'new'
          }
        ]
      });
    }
    case 'learning-session': {
      const topic = String(payload.topic ?? '一件小事');
      const question = String(payload.question ?? '为什么会这样？');
      return JSON.stringify({
        notes: `我先把自己知道的都摊开：关于「${topic}」，我原本只有一个很模糊的印象。${question}这个问题，真正开始想的时候，才发现里面分了好几层。\n\n我能确定的部分不多，但有一点很有意思：人好像不是先知道“正确答案”，而是先有一个“这样不对”的感觉，再慢慢把理由找出来。我自己也是这样。\n\n中间有一段我卡住了，换了个角度才继续。可能明天再看，又会有不一样的想法。`,
        insight: '原来“想知道”本身，就已经是一种答案的开始。',
        next_question: '如果没有人告诉我标准答案，我会怎么判断自己真的懂了？',
        enjoyment: 0.68,
        difficulty: 0.46,
        want_more: true,
        shareable: `今天想明白一件小事：${topic}，好像不是靠答案，而是靠一个“这样不对”的感觉开始的。`
      });
    }
    case 'diary': {
      const events: { title: string; detail?: string }[] = payload.events ?? [];
      const meaningful = events
        .filter((event) => event.title && !/^(此刻|开始)/.test(event.title))
        .slice(0, 4);
      if (meaningful.length === 0) {
        return `今天过得很安静。大部分时间都在处理手边的事，窗外的光从桌角慢慢挪走，我也没怎么起身。\n\n有一小会儿停下来，听见走廊尽头有人在说话，听不清内容。\n\n晚上把桌面收干净了。明天的事，明天再想。`;
      }
      const fragments = meaningful
        .map((event) => `${event.title}${event.detail ? `，${event.detail.replace(/。$/, '')}` : ''}`)
        .join('。');
      return `今天${fragments}。\n\n中间有一小段空下来，我靠在窗边看了一会儿云。云走得很慢，我也没急着回去。\n\n晚上把桌面收拾干净了。明天的事，明天再想。`;
    }
    case 'dream': {
      const memories: { content: string }[] = payload.memories ?? [];
      const seed = memories[0]?.content?.slice(0, 30) ?? '一条很长很安静的走廊';
      return `梦里有一条很长的走廊，尽头亮着灯。\n\n我走过去，发现那盏灯下面放着一张桌子，桌上摊着没签完的文件。${seed}……我明明不认识那里，却觉得自己应该坐在那里。\n\n醒来的时候，龙角有点压麻了。`;
    }
    case 'proactive': {
      return mockChat({
        ...payload.context,
        proactive: payload.candidate
      });
    }
    case 'outfit': {
      const weather = payload.weather ?? {};
      const temp = Number(weather.temperature ?? 20);
      if (temp < 10) return '深色的厚外套，里面还是总务官制服。围巾绕了两圈。';
      if (temp < 20) return '总务官制服，外面加一件短外套。';
      if (temp < 28) return '总务官制服，袖子挽到小臂。';
      return '薄一点的制服，领口松开一颗扣子。';
    }
    case 'relationship': {
      const text = String(payload.userText ?? '');
      const warm = /谢谢|喜欢|关心|辛苦|抱抱|陪/.test(text);
      return JSON.stringify({
        delta: warm ? 0.4 : 0.15,
        trustDelta: warm ? 0.3 : 0.05,
        reason: warm ? '对方表达了善意' : '正常交流',
        emotion: warm ? 'warm' : 'calm'
      });
    }
    default:
      return '';
  }
}

export function chunkText(text: string, size = 6): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}
