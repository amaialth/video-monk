import { h, mount, icon, fmt, toast, segmented } from '../ui.js';
import { api } from '../api.js';
import { fileBrowser } from '../components/filebrowser.js';

const blank = () => ({ media: null, probe: null, name: '', step: 0, options: { deliverable: 'long', content: 'talking-head', vertical: '', shortLength: '55', shortPick: 'hook', shortFrom: '', shortTo: '', pace: '', graphics: '', captions: 'kinetic', sfx: '',
  theme: 'auto', style: 'bytemonk', quality: 'final', target: 'youtube', engine: 'rules', variants: 0, allowLlm: false, sfxEngine: 'synth', allowMirelo: false, mireloBudget: 300, broll: 'plan', glossary: '', transcribe: true, wordsFile: '', language: 'en', model: '',
  gates: { script: true, cut: false, storyboard: true, final: true }, rightsConfirmed: false } });
let draft = blank();
const STEPS = ['Footage', 'Format', 'Look and sound', 'Script', 'Review and start'];

const demo = {
  long: () => h('div', { class: 'frame-demo' }, h('i', { style: { width: '84px', height: '47px' } })), short: () => h('div', { class: 'frame-demo' }, h('i', { style: { width: '33px', height: '58px' } })),
  both: () => h('div', { class: 'frame-demo' }, h('i', { style: { width: '84px', height: '47px' } }), h('i', { style: { width: '27px', height: '48px', borderColor: 'var(--accent2)' } })), feed: () => h('div', { class: 'frame-demo' }, h('i', { style: { width: '50px', height: '50px' } }), h('i', { style: { width: '44px', height: '55px', borderColor: 'var(--accent2)' } }))
};

export async function renderWizard(view, ctx) {
  let questions = [], envInfo = null, browser = null, presets = [], terms = { terms: [] }, recents = [];
  mount(view, h('div', { class: 'skeleton', style: { height: '320px' } }));
  [questions, envInfo, presets, terms, recents] = await Promise.all([api.questions(), api.env().catch(() => null), api.presets().catch(() => []), api.terms().catch(() => ({ terms: [] })), api.recent().catch(() => [])]);
  const q = id => questions.find(x => x.id === id);
  const o = draft.options;

  const body = h('div', {});
  const stepper = h('div', { class: 'steps' });
  const foot = h('div', { class: 'footbar' });
  const go = n => { draft.step = Math.max(0, Math.min(STEPS.length - 1, n)); paint(); window.scrollTo(0, 0); };

  function drawStepper() {
    mount(stepper, STEPS.map((s, i) => h('div', { class: `s ${i === draft.step ? 'on' : ''} ${i < draft.step ? 'done' : ''}`, onclick: () => { if (i === 0 || draft.media) go(i); } }, h('b', {}, i < draft.step ? icon('check', 13) : i + 1), s)));
  }

  function cards(question, key, { allowAuto = false, autoLabel = 'Automatic' } = {}) {
    const wrap = h('div', { class: 'optcards' });
    const draw = () => mount(wrap, [
      ...(allowAuto ? [h('button', { type: 'button', class: `opt ${o[key] === '' ? 'on' : ''}`, onclick: () => { o[key] = ''; draw(); } }, h('b', {}, autoLabel), h('span', {}, 'Chosen from the footage type'))] : []),
      ...question.options.map(op => h('button', { type: 'button', class: `opt ${o[key] === op.value ? 'on' : ''}`, onclick: () => { o[key] = op.value; draw(); if (key === 'deliverable') paint(); }, },
        key === 'deliverable' && demo[op.value] ? demo[op.value]() : null, h('b', {}, op.label.replace(/ \(recommended.*\)/i, '')), h('span', {}, op.description)))]);
    draw();
    return wrap;
  }
  const section = (title, sub, ...content) => h('div', { class: 'mt-l' }, h('h3', {}, title), sub ? h('div', { class: 'sub muted small', style: { marginBottom: '12px' } }, sub) : null, h('div', { class: 'mt-s' }, content));
  const field = (label, control, hint) => h('label', { class: 'field' }, h('span', {}, label), control, hint ? h('small', {}, hint) : null);
  const toggle = (label, hint, key, obj = o, onChange) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: Boolean(obj[key]), onchange: e => { obj[key] = e.target.checked; onChange?.(); } }), h('div', {}, h('b', {}, label), hint ? h('div', { class: 'muted small' }, hint) : null));

  // ---- 1. footage
  function stepFootage() {
    const detail = h('div', { class: 'card pad', style: { alignSelf: 'start' } });
    const paintDetail = () => {
      const p = draft.probe;
      if (!draft.media) return mount(detail, h('div', { class: 'empty', style: { padding: '30px 10px' } }, icon('film', 38), h('h3', {}, 'Choose a video'), h('div', { class: 'small' }, 'Pick a recording from the browser. MP4, MOV, MKV and more are supported.')));
      if (!p) return mount(detail, h('div', { class: 'skeleton', style: { height: '260px' } }));
      mount(detail, h('img', { src: api.thumb(p.path), alt: '', style: { width: '100%', borderRadius: '10px', border: '1px solid var(--line)', display: 'block' } }),
        h('h3', { class: 'mt', style: { wordBreak: 'break-word' } }, p.name),
        h('dl', { class: 'kvs mt-s' }, h('dt', {}, 'Length'), h('dd', {}, fmt.dur(p.duration)), h('dt', {}, 'Picture'), h('dd', {}, `${p.width}×${p.height} at ${p.fps} fps (${p.videoCodec})`), h('dt', {}, 'Sound'), h('dd', {}, p.hasAudio ? `${p.audioCodec}, ${p.channels} ch, ${p.sampleRate} Hz` : 'none'), h('dt', {}, 'Size'), h('dd', {}, fmt.size(p.size))),
        !p.hasAudio ? h('div', { class: 'hint bad mt' }, icon('alert', 18), 'This file has no audio. Cutting pauses and captions need speech.') : null,
        p.hdr ? h('div', { class: 'hint warn mt' }, icon('alert', 18), 'HDR footage: the toolkit does not convert HDR to SDR, so colours may look flat.') : null,
        p.duration > 3600 ? h('div', { class: 'hint warn mt' }, icon('clock', 18), 'Long recording: expect a long run. Try draft quality first.') : null,
        field('Project name', h('input', { class: 'input', value: draft.name, oninput: e => { draft.name = e.target.value; } })));
    };
    browser?.destroy();
    browser = fileBrowser({ mode: 'file', selected: draft.media, initial: draft.media ? draft.media.replace(/\/[^/]+$/, '') : null, onSelect: async e => { draft.media = e.path; draft.probe = null; draft.name = e.name.replace(/\.[^.]+$/, ''); paintDetail(); updateFoot(); try { draft.probe = await api.probe(e.path); } catch (error) { toast(error.message, 'bad'); draft.media = null; } paintDetail(); updateFoot(); } });
    paintDetail();
    const pick = async p => { draft.media = p.path; draft.probe = null; draft.name = p.name.replace(/\.[^.]+$/, ''); paintDetail(); updateFoot(); try { draft.probe = await api.probe(p.path); } catch (error) { toast(error.message, 'bad'); draft.media = null; } paintDetail(); updateFoot(); };
    const extras = [];
    if (presets.length) extras.push(h('div', { class: 'card pad row wrap', style: { marginBottom: '14px' } }, h('b', {}, 'Start from a preset'), h('select', { class: 'select', style: { maxWidth: '280px' }, onchange: e => { const pr = presets.find(x => String(x.id) === e.target.value); if (pr) { Object.assign(o, pr.options, { rightsConfirmed: false }); toast(`Applied "${pr.name}"`, 'good'); } } }, h('option', { value: '' }, 'Choose…'), presets.map(pr => h('option', { value: pr.id }, pr.name))), h('span', { class: 'muted small' }, 'Your saved settings. Rights are always confirmed per project.')));
    if (recents.length) extras.push(h('div', { style: { marginBottom: '14px' } }, h('div', { class: 'small muted', style: { marginBottom: '8px' } }, 'Recent footage'), h('div', { class: 'row wrap' }, recents.slice(0, 6).map(r => h('button', { class: 'btn sm', title: r.path, onclick: () => pick(r) }, icon('film', 14), r.name)))));
    return h('div', {}, extras, h('div', { class: 'grid', style: { gridTemplateColumns: 'minmax(0,1fr) 340px', alignItems: 'start' } }, browser.el, detail));
  }

  // ---- 2. format
  function stepFormat() {
    const vertical = ['short', 'both', 'feed'].includes(o.deliverable);
    return h('div', {},
      section('What are you making?', 'A landscape video and a vertical short are different products: frame, pace, caption size and length all differ.', cards(q('deliverable'), 'deliverable')),
      section('What kind of footage is it?', 'This sets sensible pacing and graphics defaults.', cards(q('content'), 'content')),
      vertical ? section('How should the picture fit a vertical frame?', 'Blur keeps the whole picture visible, which suits slides and screen recordings. Crop fills the frame, which suits a centred speaker.', cards(q('vertical'), 'vertical', { allowAuto: true, autoLabel: 'Automatic' })) : null,
      ['short', 'both'].includes(o.deliverable) ? section('The vertical short', 'Shorts allow up to 3 minutes; under 60 seconds performs best.', cards(q('shortLength'), 'shortLength'),
        h('div', { class: 'mt' }, cards(q('shortPick'), 'shortPick')),
        o.shortPick === 'range' ? h('div', { class: 'grid g2 mt' }, field('Start (seconds)', h('input', { class: 'input', type: 'number', min: 0, value: o.shortFrom, oninput: e => { o.shortFrom = e.target.value; } })), field('End (seconds)', h('input', { class: 'input', type: 'number', min: 0, value: o.shortTo, oninput: e => { o.shortTo = e.target.value; } }))) : null,
        o.shortPick === 'highlight' ? h('div', { class: 'hint mt' }, icon('info', 18), 'The toolkit proposes the strongest stretch from the transcript. You approve the result at the end.') : null) : null);
  }

  // ---- 3. look and sound
  function stepLook() {
    const claude = envInfo?.canUseClaude, keys = envInfo?.keys || {};
    return h('div', {},
      section('Pacing', null, cards(q('pace'), 'pace', { allowAuto: true, autoLabel: 'Automatic' })),
      section('Motion graphics and infographics', 'Planned from the transcript wherever something is explained.', cards(q('graphics'), 'graphics', { allowAuto: true, autoLabel: 'Automatic' }),
        h('div', { class: 'grid g3 mt' },
          field('Theme', segmented([['auto', 'Auto'], ['night', 'Night'], ['paper', 'Paper']], o.theme, v => { o.theme = v; })),
          field('House style', segmented([['bytemonk', 'ByteMonk-inspired'], ['plain', 'Plain']], o.style, v => { o.style = v; })),
          field('Graphic designer', segmented([['rules', 'Built-in rules'], ['claude', 'Claude']], o.engine, v => { if (v === 'claude' && !claude) { toast('Claude Code CLI was not found on this machine', 'bad'); return paint(); } o.engine = v; o.allowLlm = v === 'claude' ? o.allowLlm : false; if (v !== 'claude') o.variants = 0; paint(); }), claude ? 'Claude designs diagrams and offers alternatives.' : 'Install the Claude Code CLI to enable.')),
        o.engine === 'claude' ? h('div', { class: 'card pad mt col' },
          toggle('Allow sending the transcript to Anthropic', 'Uses your Claude Code login. Required for Claude designs.', 'allowLlm'),
          field('Alternative designs per key moment', segmented([[0, 'Off'], [2, '2'], [3, '3'], [4, '4']], o.variants, v => { o.variants = v; }), 'Each is rendered and checked; you can switch between them. About one Claude request per key moment.')) : null),
      section('Captions', null, cards(q('captions'), 'captions')),
      section('Sound effects', 'Quiet accents on graphics. Built-in sounds are free; Mirelo generates richer ones with your credits.', cards(q('sfx'), 'sfx', { allowAuto: true, autoLabel: 'Automatic' }),
        h('div', { class: 'card pad mt col' }, field('Sound source', segmented([['synth', 'Built-in synthesis'], ['mirelo', 'Mirelo']], o.sfxEngine, v => { if (v === 'mirelo' && !keys.mirelo) { toast('MIRELO_API_KEY was not found', 'bad'); return paint(); } o.sfxEngine = v; if (v !== 'mirelo') o.allowMirelo = false; paint(); }), keys.mirelo ? 'Mirelo key found.' : 'Add MIRELO_API_KEY to enable Mirelo.'),
          o.sfxEngine === 'mirelo' ? h('div', { class: 'col' }, toggle('Allow sending prompts to Mirelo and spending credits', 'Capped by the budget below.', 'allowMirelo'), field('Credit budget', h('input', { class: 'input', type: 'number', min: 10, step: 10, value: o.mireloBudget, oninput: e => { o.mireloBudget = Number(e.target.value) || 300; } }))) : null)),
      section('B-roll', 'The toolkit plans where B-roll is needed. You can fetch and approve clips while reviewing the storyboard.', segmented([['plan', 'Plan B-roll'], ['off', 'Skip B-roll']], o.broll, v => { o.broll = v; }),
        h('div', { class: 'muted small mt-s' }, `Stock sources found: ${['pixabay', 'unsplash', 'pexels'].filter(k => keys[k]).join(', ') || 'none (add a key in .env to fetch clips)'}`)),
      section('Output', null, h('div', { class: 'grid g3' },
        field('Quality', segmented([['final', 'Final'], ['draft', 'Draft (fast)']], o.quality, v => { o.quality = v; }), 'Draft renders much faster. Use it to check the edit.'),
        field('Destination', segmented([['youtube', 'YouTube / social'], ['web', 'Web'], ['master', 'Master']], o.target, v => { o.target = v; })))));
  }

  // ---- 4. script
  function stepScript() {
    return h('div', {},
      section('Transcription', 'Speech is transcribed on this machine with whisper.cpp. No audio leaves it.',
        envInfo && !envInfo.canTranscribe ? h('div', { class: 'hint warn' }, icon('alert', 18), h('div', {}, h('b', {}, 'whisper.cpp or a model was not found. '), 'Install it (macOS: ', h('code', {}, 'brew install whisper-cpp'), ') and download a model (', h('code', {}, 'video-monk models --download base.en --allow-download'), '), or supply your own word timestamps below, or edit without captions and graphics.')) : null,
        h('div', { class: 'grid g3 mt-s' },
          field('Transcribe the speech', segmented([[true, 'Yes'], [false, 'No (cut only)']], o.transcribe, v => { o.transcribe = v; paint(); })),
          field('Language', h('input', { class: 'input', value: o.language, placeholder: 'en, es, de, … or auto', oninput: e => { o.language = e.target.value.trim() || 'en'; } })),
          field('Model', h('select', { class: 'select', onchange: e => { o.model = e.target.value; } }, ['', 'tiny.en', 'base.en', 'small.en', 'medium.en', 'large-v3-turbo'].map(m => h('option', { value: m, selected: o.model === m }, m || 'Best available'))), 'Larger is more accurate and slower.')),
        h('div', { class: 'mt' }, field('Or use an existing words file', h('input', { class: 'input mono', value: o.wordsFile, placeholder: '/path/to/words.json (source-relative word timestamps)', oninput: e => { o.wordsFile = e.target.value.trim(); } })))),
      section('Names, acronyms and jargon', 'Speech recognition spells what it hears: REST becomes “wrist”, Redis becomes “red is”. List the terms in your video and you will approve each correction before it is applied.',
        h('textarea', { class: 'textarea', placeholder: 'REST | api; http; endpoint\nRedis\nApache Camel | integration; route\nKubernetes', value: o.glossary, oninput: e => { o.glossary = e.target.value; } }),
        terms.terms.length ? h('div', { class: 'card pad mt col' }, h('div', { class: 'row between' }, h('b', {}, 'Remembered from your earlier projects'), h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: o.useRemembered !== false, onchange: e => { o.useRemembered = e.target.checked; } }), 'Check these too')),
          h('div', { class: 'muted small' }, 'Corrections you approved before are proposed again automatically; you still approve each one.'),
          h('div', { class: 'row wrap' }, terms.terms.slice(0, 24).map(t => h('span', { class: `chip ${t.enabled ? 'info' : ''}`, title: `${t.uses}× · ${t.hints || 'no hints'}`, style: { cursor: 'pointer' }, onclick: async () => { t.enabled = t.enabled ? 0 : 1; await api.toggleTerm(t.heard, t.term, Boolean(t.enabled)); paint(); } }, `${t.heard} → ${t.term}`, h('span', { class: 'faint', onclick: async e => { e.stopPropagation(); await api.deleteTerm(t.heard, t.term); terms.terms = terms.terms.filter(x => x !== t); paint(); }, title: 'Forget' }, ' ×'))))) : null,
        h('div', { class: 'hint mt-s' }, icon('info', 18), h('div', {}, 'One term per line. After a ', h('code', {}, '|'), ' list words that show the term is meant (', h('code', {}, 'REST | api; http'), '), so a real “wrist” in a sentence about hands is left alone.'))));
  }

  // ---- 5. review
  function stepReview() {
    const brief = (id, value) => q(id)?.options.find(x => x.value === value)?.label.replace(/ \(.*\)/, '') || value;
    const rows = [['Footage', draft.probe ? `${draft.probe.name} (${fmt.dur(draft.probe.duration)}, ${draft.probe.width}×${draft.probe.height})` : '–'],
      ['Making', brief('deliverable', o.deliverable)], ['Footage type', brief('content', o.content)], ['Pace', o.pace ? brief('pace', o.pace) : 'Automatic'], ['Graphics', `${o.graphics ? brief('graphics', o.graphics) : 'Automatic'}, ${o.engine === 'claude' ? `designed by Claude${o.variants ? `, ${o.variants} alternatives each` : ''}` : 'built-in rules'}`],
      ['Captions', brief('captions', o.captions)], ['Sound effects', `${o.sfx ? brief('sfx', o.sfx) : 'Automatic'} (${o.sfxEngine === 'mirelo' ? 'Mirelo' : 'built-in'})`], ['Quality', o.quality === 'draft' ? 'Draft (fast)' : 'Final'],
      ['Speech', o.wordsFile ? 'Supplied words file' : o.transcribe ? `Transcribed locally (${o.language})` : 'Not transcribed (cut only)'], ['Glossary', o.glossary.trim() ? `${o.glossary.trim().split(/\n/).length} line(s)` : 'None']];
    const missing = (envInfo?.checks || []).filter(c => !c.optional && !c.ok);
    return h('div', { class: 'grid', style: { gridTemplateColumns: 'minmax(0,1fr) 360px', alignItems: 'start' } },
      h('div', { class: 'col' },
        h('div', { class: 'card pad' }, h('h3', {}, 'Summary'), h('dl', { class: 'kvs mt-s' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]))),
        h('div', { class: 'card pad col' }, h('h3', {}, 'Pause for my approval'), h('div', { class: 'sub muted small' }, 'The toolkit stops at these points and waits. Every decision is recorded with your name and the time.'),
          toggle('After checking the script', 'Approve each correction of mis-heard words (only when a glossary finds something).', 'script', o.gates),
          toggle('After planning the storyboard', 'See every graphic, the B-roll plan and sound cues, remove what you do not want, fetch B-roll. Recommended.', 'storyboard', o.gates),
          toggle('After cutting', 'Check what was removed before graphics are planned.', 'cut', o.gates),
          toggle('Final approval', 'Watch the finished video and sign off before it is marked ready.', 'final', o.gates))),
      h('div', { class: 'col' },
        h('div', { class: 'card pad col' }, h('h3', {}, 'Save these settings'), h('div', { class: 'sub muted small' }, 'Reuse them for the next video. Footage, rights and one-off ranges are not saved.'),
          h('div', { class: 'row' }, h('input', { class: 'input', id: 'preset-name', placeholder: 'Preset name, e.g. My explainers' }), h('button', { class: 'btn', onclick: async () => { const name = document.getElementById('preset-name').value.trim(); if (!name) return toast('Give the preset a name', 'bad'); try { const saved = await api.savePreset(name, { ...o, glossary: '' }); presets = [...presets.filter(x => x.name !== saved.name), saved]; toast(`Saved "${saved.name}"`, 'good'); } catch (error) { toast(error.message, 'bad'); } } }, 'Save'))),
        h('div', { class: 'card pad col' }, h('h3', {}, 'Before you start'),
          missing.length ? h('div', { class: 'hint bad' }, icon('alert', 18), h('div', {}, h('b', {}, 'Missing tools: '), missing.map(m => m.label).join(', '), '. ', h('a', { href: '#/system' }, 'See how to fix'))) : h('div', { class: 'hint' }, icon('check', 18), 'FFmpeg and Chrome are ready.'),
          h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: o.rightsConfirmed, onchange: e => { o.rightsConfirmed = e.target.checked; updateFoot(); } }), h('div', {}, h('b', {}, 'I have the right to edit and publish this footage'), h('div', { class: 'muted small' }, 'I am responsible for checking facts, caption wording and the licences of any stock material before publishing.'))))));
  }

  function updateFoot() {
    const last = draft.step === STEPS.length - 1;
    const canNext = draft.step === 0 ? Boolean(draft.probe) : true;
    const missing = (envInfo?.checks || []).filter(c => !c.optional && !c.ok);
    const rangeOk = o.shortPick !== 'range' || (Number(o.shortTo) > Number(o.shortFrom));
    mount(foot,
      h('button', { class: 'btn', disabled: draft.step === 0, onclick: () => go(draft.step - 1) }, icon('back', 16), 'Back'),
      h('div', { class: 'row' },
        last ? h('button', { class: 'btn', disabled: !o.rightsConfirmed || !rangeOk, onclick: () => create(false) }, 'Save without starting') : null,
        last ? h('button', { class: 'btn primary', disabled: !o.rightsConfirmed || missing.length > 0 || !rangeOk, onclick: () => create(true) }, icon('play', 16), 'Start editing')
          : h('button', { class: 'btn primary', disabled: !canNext, onclick: () => go(draft.step + 1) }, 'Continue', icon('chev', 16))));
  }

  async function create(start) {
    const options = { ...o, graphics: o.graphics || undefined, pace: o.pace || undefined, sfx: o.sfx || undefined, vertical: o.vertical || undefined, model: o.model || undefined, wordsFile: o.wordsFile || undefined,
      shortFrom: o.shortPick === 'range' ? Number(o.shortFrom) : undefined, shortTo: o.shortPick === 'range' ? Number(o.shortTo) : undefined, variants: o.variants || undefined };
    try {
      const project = await api.create({ name: draft.name || draft.probe.name, media: draft.media, options, start });
      draft = blank();
      toast(start ? 'Started. Watch each step below.' : 'Project saved', 'good');
      ctx.navigate(`#/project/${project.id}`);
    } catch (error) { toast(error.message, 'bad'); }
  }

  function paint() {
    drawStepper();
    const pages = [stepFootage, stepFormat, stepLook, stepScript, stepReview];
    mount(body, pages[draft.step]());
    updateFoot();
  }

  mount(view, h('div', { class: 'page-head' }, h('div', {}, h('div', { class: 'crumb' }, h('a', { href: '#/' }, 'Projects'), ' / New'), h('h1', {}, 'New ', h('em', { class: 'serif' }, 'project')), h('p', {}, 'Tell the toolkit what you are making. You stay in control: it pauses for your approval where it matters.'))), stepper, body, foot);
  paint();
  return () => browser?.destroy();
}
