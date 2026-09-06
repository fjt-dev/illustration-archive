const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const source = readFileSync(require('node:path').join(__dirname, '../src/archive-calendar.js'), 'utf8').replaceAll('export function', 'function');

function setup() {
  const timers = new Map();
  let timerId = 0;
  const context = { Date, Map, Math,
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    window: { innerWidth: 1200, innerHeight: 900, addEventListener() {} }
  };
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.attributes = {}; this.listeners = {}; this.style = { setProperty(k,v) { this[k] = v; } }; this.validity = { valid: true }; }
    setAttribute(k,v) { this.attributes[k] = v; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    contains(node) { return node === this || this.children.includes(node); }
    getBoundingClientRect() { return {left:240,right:280,top:36,bottom:76,width:400,height:500}; }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    focus() { context.document.activeElement = this; }
    querySelector(selector) { return this.children.find(child => child.dataset.date === selector.match(/data-date="([^"]+)"/)?.[1]); }
    click() { this.focus(); this.listeners.click(); }
  }
  context.document = { activeElement: null, createElement: () => new Element(), listeners: {}, addEventListener(type, fn) { this.listeners[type] = fn; }, querySelector() { return null; } };
  vm.createContext(context); vm.runInContext(source, context);
  const nodes = Object.fromEntries(['field','month','days','status','clear','prev','next','today'].map(key => [key,new Element()]));
  const root = { querySelector(selector) { return nodes[selector.match(/data-calendar-(\w+)/)[1]]; } };
  return { context, nodes, root, timers };
}

test('dates use local calendar days and reject missing or invalid dates', () => {
  const { context: c } = setup();
  assert.equal(c.calendarDateKey('2024-02-29'), '2024-02-29');
  for (const value of ['', null, undefined, 'invalid', '2023-02-29']) assert.equal(c.calendarDateKey(value), '');
  const d = new Date('2026-09-01T23:30:00Z');
  const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  assert.equal(c.calendarDateKey('2026-09-01T23:30:00Z'), key);
});

test('counts works once regardless of image count and separates unknown dates', () => {
  const { context: c } = setup();
  const works = [{archivedAt:'2024-02-29',imageCount:12},{archivedAt:'2024-02-29',imageCount:0},{archivedAt:'bad'}];
  const result = c.calendarCounts(works, 'archivedAt');
  assert.equal(result.counts.get('2024-02-29'), 2);
  assert.equal(result.unknown, 1);
  assert.equal(c.calendarCounts(works,'postedAt').unknown, 3);
});

test('month layout respects leap years, weekday offsets and month boundaries', () => {
  const { context: c } = setup();
  const result = c.calendarMonth(2024,1,new Map([['2024-02-29',2],['2024-03-01',5]]));
  assert.equal(result.days.length,29); assert.equal(result.offset,4); assert.equal(result.total,2);
  assert.equal(c.calendarMonth(2023,1,new Map()).days.length,28);
  assert.equal(c.calendarMonth(2026,11,new Map()).days.at(-1).key,'2026-12-31');
});

test('filled circles increase in size and opacity, with no circle for zero works', () => {
  const { context: c } = setup();
  let previous = {size:0,opacity:0};
  for (const count of [1,4,16,64,256]) {
    const circle = c.calendarCircle(count,256);
    assert(circle.size>previous.size);assert(circle.opacity>previous.opacity);
    assert(circle.size<=44);assert(circle.opacity<=0.58);
    previous=circle;
  }
  assert.equal(c.calendarCircle(0,0).size,0);
  assert.equal(c.calendarCircle(0,0).opacity,0);
});

test('day selection filters results without shrinking counts, preserves focus, and clears on month or field changes', () => {
  const { context:c,nodes,root } = setup();
  const works=[{id:1,archivedAt:'2024-02-29',postedAt:'2024-02-10'},{id:2,archivedAt:'2024-02-20',postedAt:'2024-02-10'}];
  let visible;
  const refresh=()=>{calendar.update(works);visible=works.filter(calendar.matches);};
  const calendar=c.createArchiveCalendar(root,refresh);
  refresh();
  nodes.month.value='2024-02';nodes.month.listeners.change();
  nodes.days.querySelector('[data-date="2024-02-29"]').click();
  assert.deepEqual(visible.map(w=>w.id),[1]);
  assert(nodes.status.textContent.includes('2作品'));
  assert.equal(c.document.activeElement.dataset.date,'2024-02-29');
  nodes.days.querySelector('[data-date="2024-02-29"]').click();
  assert.equal(visible.length,2);
  nodes.days.querySelector('[data-date="2024-02-29"]').click();
  nodes.next.click();assert.equal(visible.length,2);assert.equal(nodes.month.value,'2024-03');
  nodes.prev.click();nodes.field.value='postedAt';nodes.field.listeners.change();
  nodes.days.querySelector('[data-date="2024-02-10"]').click();assert.equal(visible.length,2);
  assert.equal(nodes.days.querySelector('[data-date="2024-02-10"]').title,'2作品');
  nodes.clear.click();assert.equal(nodes.clear.hidden,true);
  nodes.month.value='2024-12';nodes.month.listeners.change();nodes.next.click();assert.equal(nodes.month.value,'2025-01');
  nodes.month.value='';nodes.month.listeners.change();assert.equal(nodes.month.value,'2025-01');
});

test('archive combines search, tags, favorites and date while calendar retains other days', () => {
  const archive = readFileSync(require('node:path').join(__dirname, '../src/archive.js'), 'utf8');
  const filterSource = archive.slice(archive.indexOf('function applyFilters()'), archive.indexOf('function render(items,'));
  const works = [
    {id:1,title:'花',tags:['青'],favorite:true,archivedAt:'2024-02-29'},
    {id:2,title:'花',tags:['青'],favorite:true,archivedAt:'2024-02-20'},
    {id:3,title:'花',tags:['青'],favorite:false,archivedAt:'2024-02-29'},
    {id:4,title:'海',tags:['青'],favorite:true,archivedAt:'2024-02-29'},
    {id:5,title:'花',tags:['赤'],favorite:true,archivedAt:'2024-02-29'}
  ];
  let counted, rendered;
  const state = { works, activeTags:new Set(['青']),searchQuery:'花',favoriteOnly:true,
    normalizeTag:tag=>tag,sortOrder:'archived-desc',sortComparators:{'archived-desc':(a,b)=>a.id-b.id},
    archiveCalendar:{update(items){counted=items;},matches(work){return work.archivedAt==='2024-02-29';}},
    render(items){rendered=items;}
  };
  vm.createContext(state);vm.runInContext(filterSource,state);state.applyFilters();
  assert.deepEqual(counted.map(w=>w.id),[1,2]);
  assert.deepEqual(rendered.map(w=>w.id),[1]);
});


test('circle levels group nearby counts and stay translucent even at maximum', () => {
  const { context: c } = setup();
  assert.equal(c.calendarCircle(1,100).size, c.calendarCircle(2,100).size);
  assert(c.calendarCircle(4,100).size > c.calendarCircle(2,100).size);
  assert.equal(c.calendarCircle(100,100).opacity, 0.58);
});

test('calendar starts collapsed, toggles with its title button, and Escape restores focus', () => {
  const { context:c,nodes } = setup();
  const button=nodes.today, panel=nodes.days;
  c.bindCalendarToggle(button,panel);
  assert.equal(panel.hidden,true);
  assert.equal(button.attributes['aria-expanded'],'false');
  button.click();
  assert.equal(panel.hidden,false);
  assert.equal(button.attributes['aria-expanded'],'true');
  button.click();assert.equal(panel.hidden,true);
  button.click();
  c.document.listeners.keydown({key:'Escape',preventDefault(){},stopPropagation(){}});
  assert.equal(panel.hidden,true);
  assert.equal(button.attributes['aria-expanded'],'false');
  assert.equal(c.document.activeElement,button);
});


test('click positions calendar beside button or below on narrow screens', () => {
  const {context:c,nodes}=setup();
  const button=nodes.today,panel=nodes.days;
  c.bindCalendarToggle(button,panel);
  button.click();
  assert.equal(panel.hidden,false);
  assert.equal(panel.style.left,'288px');
  button.click();
  c.window.innerWidth=420;
  button.click();
  assert.equal(panel.style.left,'12px');
  assert.equal(panel.style.top,'84px');
});

test('hover and focus alone do not open calendar; outside clicks close it', () => {
  const {context:c,nodes}=setup();
  const button=nodes.today,panel=nodes.days;
  let outside;
  c.document.addEventListener=(type,listener)=>{ if(type==='pointerdown') outside=listener; };
  c.bindCalendarToggle(button,panel);
  button.listeners.pointerenter?.({pointerType:'mouse'});
  button.listeners.focusin?.();
  assert.equal(panel.hidden,true);
  button.click();
  outside({target:panel});assert.equal(panel.hidden,false);
  outside({target:button});assert.equal(panel.hidden,false);
  outside({target:{}});assert.equal(panel.hidden,true);
});


test('Escape outside calendar closes it without affecting hidden panels or foreground dialogs', () => {
  const {context:c,nodes}=setup();
  const button=nodes.today,panel=nodes.days;
  c.bindCalendarToggle(button,panel);
  const escape=()=>({key:'Escape',defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}});
  button.click();nodes.field.focus();
  const event=escape();c.document.listeners.keydown(event);
  assert.equal(panel.hidden,true);assert.equal(event.defaultPrevented,true);
  assert.equal(c.document.activeElement,button);
  nodes.field.focus();const hiddenEvent=escape();c.document.listeners.keydown(hiddenEvent);
  assert.equal(hiddenEvent.defaultPrevented,false);assert.equal(c.document.activeElement,nodes.field);
  button.click();c.document.querySelector=()=>({});
  const dialogEvent=escape();c.document.listeners.keydown(dialogEvent);
  assert.equal(panel.hidden,false);assert.equal(dialogEvent.defaultPrevented,false);
  c.document.querySelector=()=>null;
  const consumed=escape();consumed.defaultPrevented=true;c.document.listeners.keydown(consumed);
  assert.equal(panel.hidden,false);
});

test('completing metadata immediately moves unknown dates into calendar counts and selected results', async () => {
  const {context:c,nodes,root}=setup();
  const work={id:'1',title:'test'};
  let visible,handler,shown;
  const calendar=c.createArchiveCalendar(root,()=>refresh());
  function refresh() { calendar.update([work]);visible=[work].filter(calendar.matches); }
  refresh();nodes.field.value='postedAt';nodes.field.listeners.change();
  nodes.month.value='2024-02';nodes.month.listeners.change();
  nodes.days.querySelector('[data-date="2024-02-29"]').click();
  assert.equal(visible.length,0);assert(nodes.status.textContent.includes('日付不明 1件'));
  const archive=readFileSync(require('node:path').join(__dirname,'../src/archive.js'),'utf8');
  const handlerSource=archive.slice(archive.indexOf('  article.querySelector("[data-metadata]").addEventListener'),archive.indexOf('  bindFavoriteButton(article.querySelector'));
  const state={work,article:{querySelector(){return {addEventListener(type,fn){handler=fn;}};}},
    chrome:{runtime:{async sendMessage(){return {ok:true,metadata:{postedAt:'2024-02-29'}};}}},
    applyFilters:refresh,archiveViewer:{showMetadata(value){shown=value;}},alert(){throw new Error('Unexpected error');}};
  vm.createContext(state);vm.runInContext(handlerSource,state);await handler();
  assert.equal(visible.length,1);assert.equal(shown,work);
  assert.equal(nodes.days.querySelector('[data-date="2024-02-29"]').title,'1作品');
  assert(!nodes.status.textContent.includes('日付不明'));
});
