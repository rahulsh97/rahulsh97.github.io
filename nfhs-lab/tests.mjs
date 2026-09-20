import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const data = JSON.parse(readFileSync(new URL('./data.json', import.meta.url)));
assert.equal(data.districts.length, 341);
assert.equal(new Set(data.districts.map(d => d.state)).size, 21);
assert.equal(data.matched_counts.stunting, 262);
const pairs = data.districts.filter(d => [d.v.fuel, d.v.stunting].every(values => values.every(v => v !== null)));
assert.equal(pairs.length, 262);
assert.equal(new Set(pairs.map(d => `${d.state}|${d.district}`)).size, pairs.length);
assert(data.districts.every(d => Object.values(d.v).every(([a,b]) => [a,b].every(v => v === null || (Number.isFinite(v) && v >= 0 && v <= 100)))));

// Exercise the actual browser regression helper, including within-state demeaning.
const source = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const helper = source.match(/function fit\(rows, stateEffects = false\) \{[\s\S]*?\n\}\n\nfunction colour/);
assert(helper, 'Regression helper is present');
const context = vm.createContext({});
vm.runInContext('const mean = xs => xs.reduce((a,b) => a+b,0)/xs.length; '+helper[0].replace(/\n\nfunction colour$/, ''), context);
const rows = [{state:'A',x:0,y:10},{state:'A',x:1,y:12},{state:'B',x:2,y:100},{state:'B',x:3,y:102}];
assert(Math.abs(vm.runInContext('fit',context)(rows,true).slope-2)<1e-10);
assert(Math.abs(vm.runInContext('fit',context)(rows,true).r2-1)<1e-10);
assert(vm.runInContext('fit',context)(rows,false).slope>2);
assert.equal(vm.runInContext('fit',context)(rows.map(r=>({...r,x:1})),true), null);
console.log('Data coverage, missing values and pooled/within-state regression checks passed.');
