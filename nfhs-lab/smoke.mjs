// Small DOM smoke check for environments without a graphical browser.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const payload = JSON.parse(readFileSync(new URL('./data.json', import.meta.url)));
class Element {
  constructor() { this.value=''; this.textContent=''; this.innerHTML=''; this.style={}; this.children=[]; this.options=[]; this.dataset={}; this.listeners={}; this.parentElement=this; }
  addEventListener(event,fn){this.listeners[event]=fn;}
  add(option){this.options.push(option);}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  querySelector(){return this;}
  querySelectorAll(){return [];}
  setAttribute(name,value){this[name]=value;}
}
const nodes=new Map();
const get=id => nodes.get(id) || (nodes.set(id,new Element()),nodes.get(id));
get('outcome').value='stunting';get('exposure').value='sanitation';get('mode').value='change';get('state').value='all';
for(const [id,values] of Object.entries({outcome:['stunting','underweight','child_anaemia','women_anaemia','births','antenatal'],exposure:['sanitation','fuel','schooling','antenatal','births'],mode:['change','level'],state:['all']}))get(id).options=values.map(value=>({value}));
const context=vm.createContext({
  document:{getElementById:get,createElement:()=>new Element()},
  fetch:async()=>({ok:true,json:async()=>payload}),
  Option:class{constructor(label,value){this.label=label;this.value=value;}},
  location:{search:'',pathname:'/nfhs-lab/'},history:{replaceState:()=>{}},URLSearchParams,
  Blob,URL, setTimeout,
});
vm.runInContext(readFileSync(new URL('./app.js',import.meta.url),'utf8'),context);
await new Promise(resolve=>setTimeout(resolve,0));
assert.equal(get('count').textContent,262);
assert.equal(get('matrix').children.length,21);
assert.match(get('slope').textContent,/pp/);
get('fe').listeners.click();
assert.equal(get('fe')['aria-pressed'],'true');
assert.equal(get('count').textContent,262);
get('mode').value='level';get('mode').listeners.change();
assert.equal(get('count').textContent,341);
assert.equal(get('median-title').textContent,'Median outcome level');
get('state').value='Goa';get('state').listeners.change();
assert(get('count').textContent>0 && get('count').textContent<341);
assert.equal(get('matrix').children.length,1);
console.log('Interactive smoke: loading, matrix, regression toggle, level switch and state filter passed.');
