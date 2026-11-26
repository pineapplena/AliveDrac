import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Download,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  Shirt,
  Sparkles,
  Trash2,
  Upload,
  Wand2
} from 'lucide-react';
import type {
  AppearanceView,
  Character,
  LifeView,
  PublicSettings
} from '../../shared/types';
import { api } from '../api';
import { Avatar } from '../components/Avatar';
import type { ToastKind } from '../components/Toast';
import { readFileAsDataUrl } from '../lib/card';
import { cn, dateTime } from '../utils';

interface Props {
  character: Character;
  settings: PublicSettings;
  life: LifeView;
  onOpenSettings: () => void;
  onToast: (message: string, kind?: ToastKind) => void;
}

export function AppearancePage({
  character,
  settings,
  life,
  onOpenSettings,
  onToast
}: Props) {
  const [view, setView] = useState<AppearanceView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [wardrobeName, setWardrobeName] = useState('');
  const [wardrobeDescription, setWardrobeDescription] = useState('');
  const [wardrobeTags, setWardrobeTags] = useState('');
  const [wardrobeImage, setWardrobeImage] = useState<{ dataUrl: string; name: string } | null>(
    null
  );
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await api.appearance());
    } catch (error) {
      onToast(error instanceof Error ? error.message : '读取形象资料失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const todayItem = useMemo(
    () => view?.wardrobe.find((item) => item.id === view.today.itemId) ?? null,
    [view]
  );
  const outfitImage = todayItem?.imageUrl || character.avatarUrl;
  const canGenerate = Boolean(view?.imageConfigured && (view?.remainingToday ?? 0) > 0);

  const reroll = async () => {
    setBusy('outfit');
    try {
      setView(await api.rerollOutfit());
      onToast('今天换了一套', 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : '换衣服失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const choose = async (itemId: string) => {
    setBusy(`wear-${itemId}`);
    try {
      setView(await api.selectOutfit(itemId));
      onToast('今天穿这套', 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : '换衣服失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const addWardrobe = async () => {
    if (!wardrobeName.trim()) {
      onToast('先给这套衣服起个名字', 'error');
      return;
    }
    setBusy('wardrobe');
    try {
      await api.addWardrobeItem({
        name: wardrobeName.trim(),
        description: wardrobeDescription.trim(),
        tags: wardrobeTags
          .split(/[，,]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
        imageDataUrl: wardrobeImage?.dataUrl
      });
      setWardrobeName('');
      setWardrobeDescription('');
      setWardrobeTags('');
      setWardrobeImage(null);
      if (fileRef.current) fileRef.current.value = '';
      setView(await api.appearance());
      onToast('衣柜里多了一套', 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : '添加衣柜失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const removeWardrobe = async (id: string) => {
    if (!window.confirm('从衣柜里删除这套衣服？今天已经选中的穿搭不会消失。')) return;
    setBusy(`remove-${id}`);
    try {
      await api.deleteWardrobeItem(id);
      setView(await api.appearance());
      onToast('已经从衣柜里拿掉了', 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : '删除失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const generate = async () => {
    if (!canGenerate) {
      onOpenSettings();
      return;
    }
    setBusy('generate');
    try {
      const result = await api.generateAppearanceImage({
        prompt: prompt.trim(),
        source: 'outfit'
      });
      setView(result.view);
      setPrompt('');
      onToast('画好了', 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : '生图失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const removeImage = async (id: string) => {
    if (!window.confirm('删除这张生成的图片？')) return;
    setBusy(`image-${id}`);
    try {
      await api.deleteGeneratedImage(id);
      setView(await api.appearance());
      onToast('图片已删除', 'success');
    } catch (error) {
      onToast(error instanceof Error ? error.message : '删除失败', 'error');
    } finally {
      setBusy(null);
    }
  };

  const uploadImage = async (file: File) => {
    if (file.size > 8 * 1024 * 1024) {
      onToast('衣柜图片不能超过 8MB', 'error');
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    setWardrobeImage({ dataUrl, name: file.name });
  };

  if (loading || !view) {
    return (
      <div className="page-screen appearance-page">
        <div className="boot-card">
          <Loader2 className="spin" size={20} />
          <p>正在打开她的衣柜……</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-screen appearance-page">
      <header className="page-head">
        <div>
          <span className="eyebrow">形象 · 穿搭与照片</span>
          <h1>她今天想这样穿</h1>
          <p className="page-sub">
            每天的穿搭会从衣柜里挑，也会进入她生成照片时的画面描述。
          </p>
        </div>
        <span className="appearance-weather">
          {life.weather.city} · {Math.round(life.weather.temperature)}°C · {life.weather.label}
        </span>
      </header>

      <section className="appearance-hero">
        <div className="appearance-portrait">
          {outfitImage ? (
            <img src={outfitImage} alt={todayItem?.name || character.name} />
          ) : (
            <Avatar name={character.name} src={null} size={150} />
          )}
          <span className="appearance-portrait-label">
            {todayItem?.name || '今天的穿搭'}
          </span>
        </div>
        <div className="appearance-hero-copy">
          <span className="eyebrow">今日穿搭 · {view.date}</span>
          <h2>{todayItem?.name || '今天先这样出门'}</h2>
          <p>{view.today.description}</p>
          <div className="appearance-meta">
            <span>
              <Shirt size={13} />{' '}
              {view.today.source === 'wardrobe'
                ? '从衣柜里挑的'
                : view.today.source === 'manual'
                  ? '你替她选的'
                  : '天气和日程凑出来的'}
            </span>
            {todayItem?.tags.length ? <span>{todayItem.tags.join(' · ')}</span> : null}
          </div>
          <div className="appearance-actions">
            <button className="button" onClick={() => void reroll()} disabled={busy === 'outfit'}>
              {busy === 'outfit' ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
              换一套
            </button>
            <button
              className="button primary"
              onClick={() => void generate()}
              disabled={busy === 'generate'}
            >
              {busy === 'generate' ? (
                <Loader2 className="spin" size={15} />
              ) : (
                <Wand2 size={15} />
              )}
              生成穿搭照
            </button>
            {!view.imageConfigured && (
              <button className="button ghost" onClick={onOpenSettings}>
                配置生图
              </button>
            )}
          </div>
        </div>
      </section>

      <div className="appearance-grid">
        <section className="appearance-panel">
          <div className="section-head compact">
            <div>
              <span className="eyebrow"><Shirt size={12} /> 衣柜</span>
              <h2>她可以穿的衣服</h2>
              <p>每套只是一段描述；有图片时可以一起放进衣柜。</p>
            </div>
            <span className="appearance-count">{view.wardrobe.length} 套</span>
          </div>

          <div className="wardrobe-form">
            <input
              value={wardrobeName}
              onChange={(event) => setWardrobeName(event.target.value)}
              placeholder="名字，例如：米色针织衫"
              maxLength={80}
            />
            <textarea
              value={wardrobeDescription}
              onChange={(event) => setWardrobeDescription(event.target.value)}
              placeholder="描述：颜色、材质、搭配、适合什么天气……"
              rows={2}
              maxLength={600}
            />
            <input
              value={wardrobeTags}
              onChange={(event) => setWardrobeTags(event.target.value)}
              placeholder="标签，用逗号分隔：日常, 秋天, 宅家"
              maxLength={200}
            />
            <div className="wardrobe-form-bottom">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadImage(file);
                }}
              />
              <button
                className="button ghost small"
                onClick={() => fileRef.current?.click()}
                type="button"
              >
                <Upload size={13} /> {wardrobeImage ? '换图片' : '加一张图'}
              </button>
              {wardrobeImage && (
                <span className="wardrobe-file">{wardrobeImage.name}</span>
              )}
              <button
                className="button"
                type="button"
                onClick={() => void addWardrobe()}
                disabled={busy === 'wardrobe'}
              >
                {busy === 'wardrobe' ? (
                  <Loader2 className="spin" size={14} />
                ) : (
                  <Plus size={14} />
                )}
                放进衣柜
              </button>
            </div>
            {wardrobeImage && (
              <img className="wardrobe-preview" src={wardrobeImage.dataUrl} alt="衣柜预览" />
            )}
          </div>

          <div className="wardrobe-list">
            {view.wardrobe.length === 0 ? (
              <div className="appearance-empty">
                <Shirt size={20} />
                <p>衣柜还是空的。先放一套进去，明天她就有得选了。</p>
              </div>
            ) : (
              view.wardrobe.map((item) => (
                <article
                  key={item.id}
                  className={cn('wardrobe-item', view.today.itemId === item.id && 'current')}
                >
                  {item.imageUrl ? (
                    <img src={item.imageUrl} alt={item.name} />
                  ) : (
                    <span className="wardrobe-item-placeholder">
                      <Shirt size={18} />
                    </span>
                  )}
                  <div className="wardrobe-item-copy">
                    <div>
                      <strong>{item.name}</strong>
                      {view.today.itemId === item.id && (
                        <span className="wardrobe-current"><Check size={11} /> 今天</span>
                      )}
                    </div>
                    <p>{item.description || '还没有描述'}</p>
                    {item.tags.length > 0 && <small>{item.tags.join(' · ')}</small>}
                  </div>
                  <div className="wardrobe-item-actions">
                    <button
                      className="icon-button"
                      title="今天穿这套"
                      disabled={busy === `wear-${item.id}`}
                      onClick={() => void choose(item.id)}
                    >
                      {busy === `wear-${item.id}` ? (
                        <Loader2 className="spin" size={14} />
                      ) : (
                        <Check size={14} />
                      )}
                    </button>
                    <button
                      className="icon-button"
                      title="删除"
                      disabled={busy === `remove-${item.id}`}
                      onClick={() => void removeWardrobe(item.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>

        <section className="appearance-panel">
          <div className="section-head compact">
            <div>
              <span className="eyebrow"><ImageIcon size={12} /> 生图</span>
              <h2>画一张今天的她</h2>
              <p>穿搭会自动带上；你也可以补一个场景。</p>
            </div>
            <span className="appearance-count">
              今天还剩 {view.remainingToday} 张
            </span>
          </div>
          <div className="image-prompt-box">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="例如：在窗边抱着杯子，午后的光，半身自拍"
              rows={3}
              maxLength={500}
            />
            <div className="image-prompt-actions">
              <span>
                <Sparkles size={13} /> {settings.image.model || '未选择图片模型'}
                {' · '}
                {settings.image.useReferences && view.referenceCount > 0
                  ? `角色参考图 ${Math.min(3, view.referenceCount)} 张`
                  : '纯文字提示词'}
              </span>
              <button
                className="button primary"
                onClick={() => void generate()}
                disabled={busy === 'generate' || !canGenerate}
              >
                {busy === 'generate' ? (
                  <Loader2 className="spin" size={14} />
                ) : (
                  <Wand2 size={14} />
                )}
                {canGenerate ? '生成' : view.imageConfigured ? '今日额度用完' : '先配置生图'}
              </button>
            </div>
          </div>
          {!view.imageConfigured && (
            <p className="appearance-hint">
              生图还没有接通。去设置里的「生图」填写 API Key、模型和尺寸后，这里才能画。
            </p>
          )}

          <div className="generated-grid">
            {view.images.length === 0 ? (
              <div className="appearance-empty">
                <ImageIcon size={20} />
                <p>还没有生成过照片。</p>
              </div>
            ) : (
              view.images.map((image) => (
                <figure className="generated-card" key={image.id}>
                  <a href={image.url} target="_blank" rel="noreferrer">
                    <img src={image.url} alt={image.prompt} />
                  </a>
                  <figcaption>
                    <span>{dateTime(image.createdAt)}</span>
                    <div>
                      <a className="icon-button" href={image.url} download title="下载">
                        <Download size={13} />
                      </a>
                      <button
                        className="icon-button"
                        title="删除"
                        disabled={busy === `image-${image.id}`}
                        onClick={() => void removeImage(image.id)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </figcaption>
                </figure>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
