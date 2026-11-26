export interface BlockSeed {
  startMin: number;
  endMin: number;
  activity: string;
  location: string;
  category: string;
  detail: string;
  shareable: boolean;
}

export interface ScheduleWeather {
  temperature?: number;
  code?: number;
  label?: string;
}

export interface ScheduleVariantOptions {
  date?: string;
  seed?: number;
  salt?: string | number;
  weather?: ScheduleWeather | null;
}

type ActivityTemplate = Omit<BlockSeed, 'startMin' | 'endMin'>;

type Rng = () => number;

function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length)]!;
}

function pickDifferent(rng: Rng, list: readonly ActivityTemplate[], last: string): ActivityTemplate {
  const options = list.filter((item) => item.activity !== last);
  return pick(rng, options.length ? options : list);
}

function pickUnused(
  rng: Rng,
  list: readonly ActivityTemplate[],
  used: Set<string>
): ActivityTemplate {
  const options = list.filter((item) => !used.has(item.activity));
  const template = pick(rng, options.length ? options : list);
  used.add(template.activity);
  return template;
}

function chance(rng: Rng, probability: number): boolean {
  return rng() < probability;
}

function weighted<T extends string>(rng: Rng, entries: readonly [T, number][]): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let value = rng() * total;
  for (const [item, weight] of entries) {
    value -= weight;
    if (value <= 0) return item;
  }
  return entries[entries.length - 1]![0];
}

class DayBuilder {
  private blocks: BlockSeed[] = [];
  cursor = 0;

  add(duration: number, template: ActivityTemplate, minDuration = 5): boolean {
    const remaining = 1440 - this.cursor;
    const length = Math.min(Math.max(minDuration, Math.round(duration)), remaining);
    if (length < minDuration) return false;
    this.blocks.push({
      startMin: this.cursor,
      endMin: this.cursor + length,
      ...template
    });
    this.cursor += length;
    return true;
  }

  finish(): BlockSeed[] {
    if (this.cursor < 1440) {
      const last = this.blocks.at(-1);
      if (1440 - this.cursor >= 5) {
        this.blocks.push({
          startMin: this.cursor,
          endMin: 1440,
          activity: '睡着',
          location: '宿舍 · 卧室',
          category: 'sleep',
          detail: '灯已经关了，房间里只剩下很轻的呼吸声。',
          shareable: false
        });
      } else if (last) {
        last.endMin = 1440;
      }
    }
    return this.blocks;
  }

  activities(): string[] {
    return this.blocks.map((block) => block.activity);
  }
}

const SLEEP_DETAILS = [
  '被子拉到下巴，龙角把枕套蹭出两个小坑。',
  '半张脸埋在枕头里，呼吸很轻，像一整天都没这么松过。',
  '睡前忘了拉窗帘，晨光会先落在龙角上。',
  '抱着邦布形状的抱枕，睡得很沉。',
  '把被子踢到床尾，半夜又迷迷糊糊拉了回来。',
  '床头的小灯忘了关，光落在摊开的书页上。'
];

const NIGHT_SLEEP_DETAILS = [
  '灯关掉以后，窗外还有一点点城市的光。',
  '把被子往上拉了拉，很快就不动了。',
  '龙角压着枕头，发出很轻的摩擦声。',
  '最后看了一眼终端，确认闹钟已经设好。'
];

const WAKE_TEMPLATES: ActivityTemplate[] = [
  {
    activity: '起床洗漱',
    location: '宿舍 · 盥洗室',
    category: 'routine',
    detail: '先对着镜子把左眼上的织物理正，再慢慢把制服扣好。',
    shareable: false
  },
  {
    activity: '慢慢起床',
    location: '宿舍 · 卧室',
    category: 'routine',
    detail: '坐起来发了会儿呆，龙角把枕头蹭得翘起来。',
    shareable: false
  },
  {
    activity: '洗漱',
    location: '宿舍 · 盥洗室',
    category: 'routine',
    detail: '水有点凉，她捧了一捧扑在脸上，彻底醒了。',
    shareable: false
  },
  {
    activity: '收拾出门',
    location: '宿舍 · 卧室',
    category: 'routine',
    detail: '把昨晚摊在椅背上的衣服叠好，顺手拉开了窗帘。',
    shareable: false
  },
  {
    activity: '整理仪容',
    location: '宿舍 · 镜子前',
    category: 'routine',
    detail: '把翘起来的呆毛按下去，过两秒又翘回来，只好算了。',
    shareable: false
  }
];

const BREAKFAST_TEMPLATES: ActivityTemplate[] = [
  {
    activity: '吃早饭',
    location: '宿舍 · 小厨房',
    category: 'meal',
    detail: '一碗热粥，一枚煎蛋。今天多拿了一只邦布形状的小面包。',
    shareable: true
  },
  {
    activity: '早饭',
    location: '宿舍 · 小厨房',
    category: 'meal',
    detail: '烤了两片面包，抹了一点果酱，站在窗边吃完。',
    shareable: true
  },
  {
    activity: '买早餐',
    location: '楼下 · 早餐摊',
    category: 'meal',
    detail: '排了几分钟队，最后买了豆浆和一个还烫手的饭团。',
    shareable: true
  },
  {
    activity: '吃点东西',
    location: '宿舍 · 餐桌',
    category: 'meal',
    detail: '没什么胃口，还是要了一小碗面，慢慢吃完。',
    shareable: true
  },
  {
    activity: '吃早饭',
    location: '宿舍 · 餐桌',
    category: 'meal',
    detail: '把昨天剩的汤热了热，又煎了一个边缘焦掉的蛋。',
    shareable: true
  }
];

const COMMUTE_TEMPLATES: ActivityTemplate[] = [
  {
    activity: '通勤',
    location: '罗斯凯利法 · 连廊',
    category: 'commute',
    detail: '抱着文件走过长长的连廊，玻璃外面是缓慢移动的云。',
    shareable: true
  },
  {
    activity: '去中枢局',
    location: '罗斯凯利法 · 悬浮列车',
    category: 'commute',
    detail: '车厢很空，她靠着门看城市从下面滑过去。',
    shareable: true
  },
  {
    activity: '走去办公室',
    location: '中枢局 · 中庭',
    category: 'commute',
    detail: '绕了一点路，只为了看中庭那棵总是掉叶子的树。',
    shareable: true
  },
  {
    activity: '通勤',
    location: '罗斯凯利法 · 步行道',
    category: 'commute',
    detail: '今天没坐车，沿着步行道走过去，鞋底沾了一点潮气。',
    shareable: true
  }
];

const WORK_MORNING_TEMPLATES: ActivityTemplate[] = [
  {
    activity: '处理总务文件',
    location: '算理中枢局 · 总务官办公室',
    category: 'work',
    detail: '签字、排期，把三份互相矛盾的申请打回去重写。',
    shareable: true
  },
  {
    activity: '整理本周排期',
    location: '算理中枢局 · 总务官办公室',
    category: 'work',
    detail: '把会议和外出申请重新排了一遍，给自己空出半小时。',
    shareable: true
  },
  {
    activity: '审核申请',
    location: '算理中枢局 · 总务官办公室',
    category: 'work',
    detail: '一份连廊照明申请写得太含糊，她批注了三行才放回去。',
    shareable: true
  },
  {
    activity: '对接外部文书',
    location: '算理中枢局 · 会客室',
    category: 'work',
    detail: '和外部事务所来回改了两版措辞，最后把“尽快”换成具体日期。',
    shareable: true
  },
  {
    activity: '整理档案',
    location: '算理中枢局 · 档案室',
    category: 'work',
    detail: '把上周的纸质文件按日期码好，手指沾了一点灰。',
    shareable: true
  }
];

const WORK_AFTERNOON_TEMPLATES: ActivityTemplate[] = [
  {
    activity: '校对空洞数据',
    location: '算理中枢局 · 数据室',
    category: 'work',
    detail: '罗塞塔数据有一小段谐波对不上，她今天非把它磨平不可。',
    shareable: true
  },
  {
    activity: '复核报表',
    location: '算理中枢局 · 数据室',
    category: 'work',
    detail: '数字对上了，但说明写得太漂亮，她删掉两句修饰。',
    shareable: true
  },
  {
    activity: '开会与整理纪要',
    location: '算理中枢局 · 会议室',
    category: 'work',
    detail: '一场很长的预算会，中间休息了两次，她记满了三页。',
    shareable: true
  },
  {
    activity: '整理滤波器参数',
    location: '算理中枢局 · 数据室',
    category: 'work',
    detail: '把上周的滤波参数整理成一页，方便下次直接调用。',
    shareable: true
  },
  {
    activity: '处理临时事务',
    location: '算理中枢局 · 总务官办公室',
    category: 'work',
    detail: '临时插进来三件小事，她一件件做完才允许自己喝水。',
    shareable: true
  },
  {
    activity: '修订流程细则',
    location: '算理中枢局 · 总务官办公室',
    category: 'work',
    detail: '把一份用了很多年的流程改了两处，又觉得还是原来的写法更稳。',
    shareable: true
  }
];

const LUNCH_TEMPLATES: ActivityTemplate[] = [
  {
    activity: '午饭',
    location: '中枢局 · 食堂',
    category: 'meal',
    detail: '今天食堂有新的液态电池面包，她犹豫了很久才拿了一块。',
    shareable: true
  },
  {
    activity: '吃午饭',
    location: '中枢局 · 食堂',
    category: 'meal',
    detail: '要了一份汤面，吃得很慢，顺便把上午没想通的事又想了一遍。',
    shareable: true
  },
  {
    activity: '午饭',
    location: '办公室 · 小桌',
    category: 'meal',
    detail: '把便当热了热，边吃边看窗外的云。',
    shareable: true
  },
  {
    activity: '吃午饭',
    location: '中枢局 · 食堂',
    category: 'meal',
    detail: '拿了平时不太吃的菜，第一口下去表情很复杂。',
    shareable: true
  },
  {
    activity: '午饭',
    location: '连廊 · 小桌',
    category: 'meal',
    detail: '买了一个三明治，坐在连廊尽头吃完，风有点凉。',
    shareable: true
  }
];

const OUT_LUNCH_TEMPLATES: ActivityTemplate[] = [
  {
    activity: '午饭',
    location: '旧城区 · 小馆子',
    category: 'meal',
    detail: '点了一份没吃过的面，汤很烫，她吃得很慢。',
    shareable: true
  },
  {
    activity: '吃午饭',
    location: '旧城区 · 街角小店',
    category: 'meal',
    detail: '店里只有几张桌子，她坐在靠窗的位置，看街上的人来来往往。',
    shareable: true
  },
  {
    activity: '午饭',
    location: '旧城区 · 咖啡馆',
    category: 'meal',
    detail: '点了一份简餐，面包有点硬，她把边角留在了盘子里。',
    shareable: true
  }
];

const HOME_LUNCH_TEMPLATES: ActivityTemplate[] = [
  {
    activity: '午饭',
    location: '宿舍 · 餐桌',
    category: 'meal',
    detail: '把昨天剩的菜热了热，又煮了一小锅汤。',
    shareable: true
  },
  {
    activity: '吃午饭',
    location: '宿舍 · 小厨房',
    category: 'meal',
    detail: '煮了一碗面，放了很多青菜，端着碗在窗边吃。',
    shareable: true
  },
  {
    activity: '午饭',
    location: '宿舍 · 餐桌',
    category: 'meal',
    detail: '不赶时间，慢慢吃完，碗先放在水池里，打算晚点再洗。',
    shareable: true
  }
];

const REST_TEMPLATES: ActivityTemplate[] = [
  {
    activity: '午休',
    location: '总务官办公室 · 沙发',
    category: 'rest',
    detail: '把外套搭在椅背上，靠着沙发眯了二十分钟。',
    shareable: false
  },
  {
    activity: '喝杯茶',
    location: '总务官办公室',
    category: 'rest',
    detail: '泡了一杯淡茶，盯着杯底的茶叶看了很久。',
    shareable: false
  },
  {
    activity: '走动一下',
    location: '中枢局 · 连廊',
    category: 'rest',
    detail: '沿着连廊走了一圈，活动一下坐僵的肩。',
    shareable: false
  },
  {
    activity: '闭眼歇一会儿',
    location: '总务官办公室 · 窗边',
    category: 'rest',
    detail: '把终端调暗，靠着窗边闭了会儿眼，没有真的睡着。',
    shareable: false
  }
];

const HOME_TEMPLATES: ActivityTemplate[] = [
  {
    activity: '回宿舍',
    location: '宿舍',
    category: 'routine',
    detail: '把制服挂好，换上宽松的居家衣服，给窗台的植物浇水。',
    shareable: true
  },
  {
    activity: '下班回去',
    location: '宿舍 · 走廊',
    category: 'commute',
    detail: '把制服外套搭在手臂上，脚步比早上慢。',
    shareable: true
  },
  {
    activity: '收拾东西回宿舍',
    location: '罗斯凯利法 · 连廊',
    category: 'commute',
    detail: '文件袋比早上轻了一点，她顺手买了杯热饮。',
    shareable: true
  },
  {
    activity: '回宿舍',
    location: '宿舍 · 玄关',
    category: 'routine',
    detail: '换鞋的时候发现鞋底沾了一片小叶子，拿起来看了两眼。',
    shareable: true
  }
];

const ERRAND_TEMPLATES: ActivityTemplate[] = [
  {
    activity: '顺路买东西',
    location: '宿舍楼下 · 便利店',
    category: 'routine',
    detail: '在货架前站了一会儿，最后只买了一盒牛奶。',
    shareable: true
  },
  {
    activity: '取快递',
    location: '中枢局 · 收发室',
    category: 'routine',
    detail: '一个小盒子，摇起来没有声音，她决定回去再拆。',
    shareable: true
  },
  {
    activity: '在楼下转一圈',
    location: '宿舍 · 楼下',
    category: 'leisure',
    detail: '没有特别的目的，只是绕了一圈，看了看亮起来的窗。',
    shareable: true
  },
  {
    activity: '买明天的早饭',
    location: '旧城区 · 面包店',
    category: 'routine',
    detail: '挑了一个看起来最不甜的面包，又顺手拿了一小盒果酱。',
    shareable: true
  }
];

const PREDINNER_TEMPLATES: ActivityTemplate[] = [
  {
    activity: '歇一会儿',
    location: '宿舍 · 沙发',
    category: 'rest',
    detail: '把腿缩到沙发上，什么也没做，听了一会儿楼下的声音。',
    shareable: true
  },
  {
    activity: '收拾一下',
    location: '宿舍',
    category: 'routine',
    detail: '把桌上的纸归成一摞，顺手擦了擦杯底留下的水印。',
    shareable: true
  },
  {
    activity: '在窗边发呆',
    location: '宿舍 · 窗边',
    category: 'rest',
    detail: '看着外面的灯一盏盏亮起来，没急着开屋里的灯。',
    shareable: true
  }
];

const DINNER_TEMPLATES: ActivityTemplate[] = [
  {
    activity: '吃晚饭',
    location: '宿舍 · 餐桌',
    category: 'meal',
    detail: '吃得很慢，边吃边看窗外。',
    shareable: true
  },
  {
    activity: '做点晚饭',
    location: '宿舍 · 小厨房',
    category: 'meal',
    detail: '煮了一小锅汤面，放了很多青菜，厨房里有一点雾气。',
    shareable: true
  },
  {
    activity: '晚饭',
    location: '宿舍 · 小厨房',
    category: 'meal',
    detail: '把剩饭热了，又煎了一个蛋，摆盘的时候认真了一下。',
    shareable: true
  },
  {
    activity: '吃晚饭',
    location: '旧城区 · 小馆子',
    category: 'meal',
    detail: '点了一份没吃过的东西，第一口下去表情很复杂。',
    shareable: true
  },
  {
    activity: '简单吃点',
    location: '宿舍 · 餐桌',
    category: 'meal',
    detail: '一碗汤，两片面包。今天不太饿，但还是坐下来好好吃了。',
    shareable: true
  }
];

const EVENING_TEMPLATES: ActivityTemplate[] = [
  {
    activity: '看书',
    location: '宿舍 · 沙发',
    category: 'leisure',
    detail: '一本讲人类城市生活的旧书，看到不懂的地方会停下来想一想。',
    shareable: true
  },
  {
    activity: '看电影',
    location: '宿舍 · 沙发',
    category: 'leisure',
    detail: '挑了一部人类拍的旧电影，看到一半开始认真吐槽里面的逻辑。',
    shareable: true
  },
  {
    activity: '听音乐',
    location: '宿舍 · 窗边',
    category: 'leisure',
    detail: '把音量调得很低，听一张旧唱片，手指在膝盖上打拍子。',
    shareable: true
  },
  {
    activity: '打游戏',
    location: '宿舍 · 书桌',
    category: 'leisure',
    detail: '打了两局，输赢都没太在意，倒是把地图逛完了。',
    shareable: true
  },
  {
    activity: '下楼走走',
    location: '宿舍 · 楼下',
    category: 'exercise',
    detail: '绕着宿舍楼走了两圈，夜风把头发吹得有点乱。',
    shareable: true
  },
  {
    activity: '泡澡',
    location: '宿舍 · 浴室',
    category: 'routine',
    detail: '水温调得刚好，出来的时候脸颊还是红的。',
    shareable: true
  },
  {
    activity: '写观察笔记',
    location: '宿舍 · 书桌',
    category: 'study',
    detail: '把今天觉得有意思的几件小事记下来，字很小，排得很整齐。',
    shareable: false
  },
  {
    activity: '学一点新东西',
    location: '宿舍 · 书桌',
    category: 'study',
    detail: '翻了两页关于人类节日的资料，在边上画了线。',
    shareable: true
  },
  {
    activity: '拼模型',
    location: '宿舍 · 地毯',
    category: 'leisure',
    detail: '把一个小零件安上去，发现说明书少画了一步。',
    shareable: true
  },
  {
    activity: '给朋友回消息',
    location: '宿舍 · 沙发',
    category: 'leisure',
    detail: '回了几条消息，最后一条写了又删。',
    shareable: true
  }
];

const WIND_DOWN_TEMPLATES: ActivityTemplate[] = [
  {
    activity: '准备睡觉',
    location: '宿舍 · 卧室',
    category: 'sleep',
    detail: '关掉大灯，只留床头一盏暖黄的小灯。',
    shareable: false
  },
  {
    activity: '洗漱睡觉',
    location: '宿舍 · 盥洗室',
    category: 'routine',
    detail: '把头发擦到半干，镜子里的自己看起来有点困。',
    shareable: false
  },
  {
    activity: '关灯躺下',
    location: '宿舍 · 卧室',
    category: 'sleep',
    detail: '把明天要穿的衣服叠好放在椅背上，然后钻进被子。',
    shareable: false
  },
  {
    activity: '睡前收尾',
    location: '宿舍 · 书桌',
    category: 'routine',
    detail: '把终端调成静音，最后确认了一遍明天的闹钟。',
    shareable: false
  }
];

const WEEKEND_LIE_IN: ActivityTemplate[] = [
  {
    activity: '赖床',
    location: '宿舍 · 卧室',
    category: 'rest',
    detail: '醒了但没起，抱着被子听窗外的声音。',
    shareable: true
  },
  {
    activity: '在被窝里发呆',
    location: '宿舍 · 卧室',
    category: 'rest',
    detail: '把手机举在眼前，看了两眼又放下，还是没有起。',
    shareable: true
  },
  {
    activity: '慢慢醒过来',
    location: '宿舍 · 卧室',
    category: 'rest',
    detail: '翻了个身，龙角在枕头上蹭了蹭，决定再躺五分钟。',
    shareable: true
  }
];

const WEEKEND_MORNING: ActivityTemplate[] = [
  {
    activity: '慢慢洗漱',
    location: '宿舍 · 盥洗室',
    category: 'routine',
    detail: '不赶时间，洗脸的时候还闭着眼睛，水珠顺着下巴滴下来。',
    shareable: false
  },
  {
    activity: '开窗通风',
    location: '宿舍 · 窗边',
    category: 'routine',
    detail: '把窗户推开，站在那儿吹了会儿风，才真正醒过来。',
    shareable: false
  },
  {
    activity: '给植物浇水',
    location: '宿舍 · 窗台',
    category: 'routine',
    detail: '挨个看了看叶子，把枯掉的一小片摘下来。',
    shareable: true
  }
];

const WEEKEND_REST: ActivityTemplate[] = [
  {
    activity: '在沙发上眯一会儿',
    location: '宿舍 · 沙发',
    category: 'rest',
    detail: '盖着一条薄毯，本来只想闭眼，结果真的睡着了。',
    shareable: false
  },
  {
    activity: '在床上躺一会儿',
    location: '宿舍 · 卧室',
    category: 'rest',
    detail: '把枕头拍松，侧过身去，什么也不想。',
    shareable: false
  },
  {
    activity: '在窗边坐一会儿',
    location: '宿舍 · 窗边',
    category: 'rest',
    detail: '搬了把小椅子坐着，看楼下的人走来走去。',
    shareable: true
  }
];

const WEEKEND_OUT_REST: ActivityTemplate[] = [
  {
    activity: '在公园长椅坐一会儿',
    location: '旧城区 · 小公园',
    category: 'rest',
    detail: '找了张背阴的长椅坐下，看小孩追着一只滚远的球。',
    shareable: true
  },
  {
    activity: '在咖啡馆歇脚',
    location: '旧城区 · 咖啡馆',
    category: 'rest',
    detail: '点了一杯没喝过的，靠在椅背上歇了一会儿。',
    shareable: true
  },
  {
    activity: '在河边坐坐',
    location: '罗斯凯利法 · 河边',
    category: 'rest',
    detail: '在河边的台阶上坐下，风把裙摆吹得贴在腿上。',
    shareable: true
  }
];

const BRUNCH_TEMPLATES: ActivityTemplate[] = [
  {
    activity: '做早午饭',
    location: '宿舍 · 小厨房',
    category: 'meal',
    detail: '把煎蛋煎得有点焦，还是认真摆好了盘。',
    shareable: true
  },
  {
    activity: '早午餐',
    location: '楼下 · 小店',
    category: 'meal',
    detail: '点了一份招牌套餐，吃得很慢，顺便看了一会儿窗外。',
    shareable: true
  },
  {
    activity: '面包和咖啡',
    location: '宿舍 · 餐桌',
    category: 'meal',
    detail: '面包屑掉在桌上，她用指尖一粒粒捡起来。',
    shareable: true
  },
  {
    activity: '煮面',
    location: '宿舍 · 小厨房',
    category: 'meal',
    detail: '煮了一碗面，放了很多青菜，端到窗边吃。',
    shareable: true
  }
];

const WEEKEND_CHORES: ActivityTemplate[] = [
  {
    activity: '整理房间',
    location: '宿舍',
    category: 'routine',
    detail: '把文件按日期重新码好，顺手擦了一遍书桌。',
    shareable: false
  },
  {
    activity: '洗衣服',
    location: '宿舍 · 洗衣间',
    category: 'routine',
    detail: '把浅色和深色分开，认真得像在处理一份公文。',
    shareable: false
  },
  {
    activity: '收拾厨房',
    location: '宿舍 · 小厨房',
    category: 'routine',
    detail: '把昨天没洗的杯子洗了，台面擦到没有水渍。',
    shareable: false
  }
];

const WEEKEND_OUTDOOR: ActivityTemplate[] = [
  {
    activity: '去街上走走',
    location: '罗斯凯利法 · 旧城区',
    category: 'leisure',
    detail: '在卖热饮的小摊前站了一会儿，认真研究菜单上的每一种配料。',
    shareable: true
  },
  {
    activity: '逛市集',
    location: '旧城区 · 市集',
    category: 'leisure',
    detail: '在一个卖旧明信片的小摊前翻了好久，最后只买了一张。',
    shareable: true
  },
  {
    activity: '去书店',
    location: '旧城区 · 书店',
    category: 'leisure',
    detail: '在书架之间慢慢走，抽出一本又放回去。',
    shareable: true
  },
  {
    activity: '河边散步',
    location: '罗斯凯利法 · 河边',
    category: 'exercise',
    detail: '沿着河走了一段，风把水面吹出细小的褶。',
    shareable: true
  },
  {
    activity: '找家咖啡馆坐着',
    location: '旧城区 · 咖啡馆',
    category: 'leisure',
    detail: '点了一杯没喝过的，第一口下去表情很复杂，最后还是喝完了。',
    shareable: true
  }
];

const WEEKEND_INDOOR_OUT: ActivityTemplate[] = [
  {
    activity: '去书店躲雨',
    location: '旧城区 · 书店',
    category: 'leisure',
    detail: '外面下雨，她在书架之间慢慢走，偶尔抬头看窗外。',
    shareable: true
  },
  {
    activity: '在咖啡馆坐一会儿',
    location: '旧城区 · 咖啡馆',
    category: 'leisure',
    detail: '靠窗的位置空着，她坐下来看雨沿着玻璃往下走。',
    shareable: true
  },
  {
    activity: '逛室内市集',
    location: '旧城区 · 室内市集',
    category: 'leisure',
    detail: '在一个卖手工小物件的摊位前停了很久，最后买了一个不太实用的小东西。',
    shareable: true
  }
];

const WEEKEND_HOME_HOBBIES: ActivityTemplate[] = [
  {
    activity: '烘焙',
    location: '宿舍 · 小厨房',
    category: 'leisure',
    detail: '按食谱做了小饼干，形状不太整齐，但味道还行。',
    shareable: true
  },
  {
    activity: '看资料',
    location: '宿舍 · 书桌',
    category: 'study',
    detail: '翻了几页关于人类节日的资料，在某一段旁边画了线。',
    shareable: true
  },
  {
    activity: '拼模型',
    location: '宿舍 · 地毯',
    category: 'leisure',
    detail: '把零件按颜色排开，慢慢拼，不急着完成。',
    shareable: true
  },
  {
    activity: '看纪录片',
    location: '宿舍 · 沙发',
    category: 'leisure',
    detail: '看了一部关于深海生物的纪录片，遇到感兴趣的地方会倒回去。',
    shareable: true
  },
  {
    activity: '打游戏',
    location: '宿舍 · 书桌',
    category: 'leisure',
    detail: '玩了一会儿经营游戏，把小镇的路重新铺了一遍。',
    shareable: true
  },
  {
    activity: '写点东西',
    location: '宿舍 · 书桌',
    category: 'study',
    detail: '打开文档写了两段，又觉得语气不对，删掉重来。',
    shareable: true
  }
];

const WEEKEND_LAZY: ActivityTemplate[] = [
  {
    activity: '在阳台坐一会儿',
    location: '宿舍 · 阳台',
    category: 'rest',
    detail: '搬了把小椅子坐着，什么也不做，看楼下的人走来走去。',
    shareable: true
  },
  {
    activity: '在沙发上躺着',
    location: '宿舍 · 沙发',
    category: 'rest',
    detail: '盖着一条薄毯，什么也没做，听楼下的声音。',
    shareable: true
  },
  {
    activity: '翻两页书',
    location: '宿舍 · 沙发',
    category: 'leisure',
    detail: '书翻到一半，眼睛先闭上了，干脆把书扣在胸口。',
    shareable: true
  },
  {
    activity: '整理照片',
    location: '宿舍 · 书桌',
    category: 'leisure',
    detail: '把最近存下来的图翻了翻，删掉几张重复的。',
    shareable: true
  }
];

function isRainy(weather: ScheduleWeather | null | undefined): boolean {
  if (!weather) return false;
  const label = weather.label ?? '';
  if (/雨|雪|雷/.test(label)) return true;
  const code = weather.code;
  return typeof code === 'number' && ((code >= 51 && code <= 67) || (code >= 80 && code <= 82));
}

function isCold(weather: ScheduleWeather | null | undefined): boolean {
  return typeof weather?.temperature === 'number' && weather.temperature <= 8;
}

function isHot(weather: ScheduleWeather | null | undefined): boolean {
  return typeof weather?.temperature === 'number' && weather.temperature >= 30;
}

function mealDetail(
  detail: string,
  weather: ScheduleWeather | null | undefined,
  slot: 'morning' | 'noon' | 'evening' = 'noon'
): string {
  if (isCold(weather)) {
    if (slot === 'morning') return `${detail} 早上有点冷，热气在窗上蒙了一层。`;
    if (slot === 'evening') return `${detail} 夜里降温了，她把碗捧在手里暖了一会儿。`;
    return `${detail} 今天有点冷，她吃得很慢，想让热气多留一会儿。`;
  }
  if (isHot(weather)) {
    if (slot === 'noon') return `${detail} 中午很热，旁边放了一杯加冰的水。`;
    return `${detail} 天气热，她没什么胃口，但还是慢慢吃完了。`;
  }
  return detail;
}

function fillUntil(
  builder: DayBuilder,
  rng: Rng,
  until: number,
  pool: readonly ActivityTemplate[],
  maxBlocks = 3,
  used?: Set<string>
): void {
  let count = 0;
  while (builder.cursor < until - 35 && count < maxBlocks) {
    const remaining = until - builder.cursor;
    const duration = Math.min(remaining, randInt(rng, 45, 90));
    if (duration < 20) break;
    builder.add(duration, used ? pickUnused(rng, pool, used) : pick(rng, pool));
    count++;
  }
}

function addWindDown(builder: DayBuilder, rng: Rng): void {
  const wind = Math.min(35, 1440 - builder.cursor - 25);
  if (wind >= 15) {
    builder.add(wind, pick(rng, WIND_DOWN_TEMPLATES));
  }
  builder.add(1440 - builder.cursor, {
    activity: '睡着',
    location: '宿舍 · 卧室',
    category: 'sleep',
    detail: pick(rng, NIGHT_SLEEP_DETAILS),
    shareable: false
  });
}

function addEvening(builder: DayBuilder, rng: Rng, bedtime: number, used?: Set<string>): void {
  let last = '';
  let count = 0;
  while (builder.cursor < bedtime - 35 && count < 5) {
    const remaining = bedtime - 35 - builder.cursor;
    const duration = Math.min(remaining, randInt(rng, 40, 80));
    if (duration < 15) break;
    const template = used
      ? pickUnused(rng, EVENING_TEMPLATES, used)
      : pickDifferent(rng, EVENING_TEMPLATES, last);
    if (!builder.add(duration, template)) break;
    last = template.activity;
    count++;
  }
  addWindDown(builder, rng);
}

function weekdaySchedule(rng: Rng, weather: ScheduleWeather | null): BlockSeed[] {
  const builder = new DayBuilder();
  const flavor = weighted(rng, [
    ['busy', 0.25],
    ['normal', 0.5],
    ['light', 0.25]
  ] as const);

  const wake = 410 + randInt(rng, 0, 40) + (flavor === 'busy' ? -5 : 0);
  builder.add(wake, {
    activity: '睡着',
    location: '宿舍 · 卧室',
    category: 'sleep',
    detail: pick(rng, SLEEP_DETAILS),
    shareable: false
  });
  builder.add(randInt(rng, 25, 40), pick(rng, WAKE_TEMPLATES));
  const breakfast = pick(rng, BREAKFAST_TEMPLATES);
  builder.add(randInt(rng, 25, 35), {
    ...breakfast,
    detail: mealDetail(breakfast.detail, weather, 'morning')
  });
  builder.add(randInt(rng, 20, 35), pick(rng, COMMUTE_TEMPLATES));
  builder.add(randInt(rng, 170, 210), pick(rng, WORK_MORNING_TEMPLATES));
  const lunch = pick(rng, LUNCH_TEMPLATES);
  builder.add(randInt(rng, 30, 50), {
    ...lunch,
    detail: mealDetail(lunch.detail, weather, 'noon')
  });
  builder.add(randInt(rng, 15, 35), pick(rng, REST_TEMPLATES));

  const work2 =
    flavor === 'busy'
      ? randInt(rng, 310, 340)
      : flavor === 'light'
        ? randInt(rng, 240, 260)
        : randInt(rng, 270, 300);
  builder.add(work2, pick(rng, WORK_AFTERNOON_TEMPLATES));
  builder.add(randInt(rng, 20, 35), pick(rng, HOME_TEMPLATES));

  if (chance(rng, 0.22)) {
    builder.add(randInt(rng, 15, 30), pick(rng, ERRAND_TEMPLATES));
  }
  const used = new Set(builder.activities());
  fillUntil(builder, rng, 1080, PREDINNER_TEMPLATES, 2, used);
  const dinner = pick(rng, DINNER_TEMPLATES);
  builder.add(randInt(rng, 35, 55), {
    ...dinner,
    detail: mealDetail(dinner.detail, weather, 'evening')
  });

  addEvening(builder, rng, 1350 + randInt(rng, 0, 60), used);
  return builder.finish();
}

function weekendSchedule(rng: Rng, weather: ScheduleWeather | null): BlockSeed[] {
  const builder = new DayBuilder();
  const used = new Set<string>();
  const choose = (pool: readonly ActivityTemplate[]) => pickUnused(rng, pool, used);
  const flavor = weighted(rng, [
    ['out', 0.4],
    ['cozy', 0.4],
    ['lazy', 0.2]
  ] as const);

  const wake = 480 + randInt(rng, 0, 75) + (flavor === 'lazy' ? randInt(rng, 10, 30) : 0);
  builder.add(wake, {
    activity: '睡着',
    location: '宿舍 · 卧室',
    category: 'sleep',
    detail: pick(rng, SLEEP_DETAILS),
    shareable: false
  });
  builder.add(randInt(rng, 20, 40), pick(rng, WEEKEND_LIE_IN));
  builder.add(randInt(rng, 15, 25), choose(WEEKEND_MORNING));
  const brunch = pick(rng, BRUNCH_TEMPLATES);
  used.add(brunch.activity);
  builder.add(randInt(rng, 40, 70), {
    ...brunch,
    detail: mealDetail(brunch.detail, weather, 'morning')
  });

  if (flavor === 'out') {
    const outdoor = isRainy(weather) ? WEEKEND_INDOOR_OUT : WEEKEND_OUTDOOR;
    builder.add(randInt(rng, 90, 150), choose(outdoor));
    fillUntil(builder, rng, 790, outdoor, 2, used);
    const lunch = pick(rng, OUT_LUNCH_TEMPLATES);
    used.add(lunch.activity);
    builder.add(randInt(rng, 40, 60), {
      ...lunch,
      detail: mealDetail(lunch.detail, weather, 'noon')
    });
    builder.add(randInt(rng, 25, 45), choose(WEEKEND_OUT_REST));
    builder.add(randInt(rng, 80, 130), choose(outdoor));
  } else if (flavor === 'cozy') {
    builder.add(randInt(rng, 40, 70), choose(WEEKEND_CHORES));
    builder.add(randInt(rng, 60, 100), choose(WEEKEND_HOME_HOBBIES));
    fillUntil(builder, rng, 790, [...WEEKEND_HOME_HOBBIES, ...WEEKEND_CHORES], 2, used);
    const lunch = pick(rng, HOME_LUNCH_TEMPLATES);
    used.add(lunch.activity);
    builder.add(randInt(rng, 40, 60), {
      ...lunch,
      detail: mealDetail(lunch.detail, weather, 'noon')
    });
    builder.add(randInt(rng, 30, 55), choose(WEEKEND_REST));
    builder.add(randInt(rng, 70, 120), choose(WEEKEND_HOME_HOBBIES));
  } else {
    builder.add(randInt(rng, 30, 50), choose(WEEKEND_LAZY));
    builder.add(randInt(rng, 30, 60), choose(WEEKEND_CHORES));
    fillUntil(builder, rng, 790, [...WEEKEND_LAZY, ...WEEKEND_HOME_HOBBIES], 2, used);
    const lunch = pick(rng, HOME_LUNCH_TEMPLATES);
    used.add(lunch.activity);
    builder.add(randInt(rng, 50, 70), {
      ...lunch,
      detail: mealDetail(lunch.detail, weather, 'noon')
    });
    builder.add(randInt(rng, 60, 90), choose(WEEKEND_REST));
    builder.add(randInt(rng, 70, 120), choose(WEEKEND_LAZY));
  }

  if (chance(rng, 0.1) && builder.cursor < 1000) {
    const overtime = pick(rng, WORK_AFTERNOON_TEMPLATES);
    used.add(overtime.activity);
    builder.add(randInt(rng, 90, 150), overtime);
  }
  fillUntil(
    builder,
    rng,
    1110,
    [...WEEKEND_HOME_HOBBIES, ...WEEKEND_CHORES, ...WEEKEND_LAZY, ...WEEKEND_REST],
    4,
    used
  );
  const dinner = pick(rng, DINNER_TEMPLATES);
  builder.add(randInt(rng, 40, 60), {
    ...dinner,
    detail: mealDetail(dinner.detail, weather, 'evening')
  });

  addEvening(builder, rng, 1350 + randInt(rng, 0, 75), used);
  return builder.finish();
}

export function fallbackSchedule(
  weekday: number,
  options: ScheduleVariantOptions = {}
): BlockSeed[] {
  const day = ((Math.round(weekday) % 7) + 7) % 7;
  const datePart = options.date ?? `${Date.now()}-${Math.random()}`;
  const seed =
    options.seed != null
      ? options.seed >>> 0
      : hashSeed(`${datePart}|${day}|${options.salt ?? ''}|alive-schedule`);
  const rng = mulberry32(seed);
  return day === 0 || day === 6
    ? weekendSchedule(rng, options.weather ?? null)
    : weekdaySchedule(rng, options.weather ?? null);
}
