// Example props for built-in templates: what the studio shows in previews, and a starting point to edit. Sample words only.
export const EXAMPLES = {
  title: { kicker: 'Launch', title: 'Say it in *one line*', subtitle: 'A short, true subtitle' },
  chapter: { number: '02', title: 'How it works', subtitle: 'Three steps' },
  stat: { value: 10000, label: 'members', note: 'Example figure' },
  quote: { quote: 'Built by the people who showed up.', author: 'The team' },
  bullets: { title: 'Three things', items: ['One clear idea', 'One proof', 'One ask'], marker: 'check' },
  'chart-morph': { title: 'Weekly signups', labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], values: [12, 19, 15, 28, 34], illustrative: true },
  'search-results': { query: 'how do I reset my password', results: [{ title: 'Reset your password', meta: 'Help centre' }, { title: 'Two-step sign in', meta: 'Security' }, { title: 'Recover a locked account' }] },
  'card-workspace': { card: 'New: Projects', workspace: 'Projects', sidebar: ['Overview', 'Files', 'Team'], lines: ['Brief approved', 'Cut v2 in review', 'Ship Friday'] },
  'button-player': { label: 'Watch the demo', caption: 'Two minutes, no sign-up' },
  'tabs-panels': { title: 'Pick a plan', tabs: [{ label: 'Starter', points: ['One project', 'Email support'] }, { label: 'Team', points: ['Ten projects', 'Shared library', 'Priority support'] }] },
  'spring-stack': { title: 'Three offers', cards: [{ title: 'Audit', body: 'A one-hour review' }, { title: 'Sprint', body: 'Two weeks, one goal' }, { title: 'Retainer', body: 'Monthly support' }] },
  'glass-focus': { lines: ['Revenue grew in every region', 'Costs were flat', 'Margin is the number to watch', 'Hiring resumes in Q3'], focus: 2 },
  'particle-text': { text: 'video-monk', subtitle: 'Edit by describing it' },
  'perspective-layers': { title: 'The stack', layers: [{ label: 'Interface', detail: 'What people touch' }, { label: 'Logic', detail: 'Rules and workflows' }, { label: 'Data', detail: 'Where it lives' }] },
  dock: { title: 'Works with your tools', items: [{ icon: 'mail', label: 'Mail' }, { icon: 'chart', label: 'Charts' }, { icon: 'cloud', label: 'Cloud' }, { icon: 'code', label: 'Code' }, { icon: 'globe', label: 'Web' }] }
};
