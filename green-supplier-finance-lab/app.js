import {validate, scenario, minimumBuyerShare} from './core.js';
const $ = id => document.getElementById(id);
let caseData = null;
const compact = new Intl.NumberFormat('en', {maximumFractionDigits:1});
const integer = new Intl.NumberFormat('en', {maximumFractionDigits:0});

function selected() {
  if (!caseData) return [];
  const country = $('country').value;
  const key = ({emissions:'allocated_direct_ghg_t',flow:'direct_input_usd_m',va:'allocated_va_usd_m'})[$('sort').value];
  return caseData.links.filter(r => !country || r.country===country).sort((a,b)=>b[key]-a[key]);
}
function csv(rows) {
  const keys=['supplier','year','direct_input_usd_m','allocated_direct_ghg_t','allocated_va_usd_m','scenario_investment_usd_m','scenario_buyer_usd_m','scenario_supplier_usd_m'];
  const lines=[keys.join(',')];
  for(const r of rows){const s=scenario(r,+$('reduction').value,+$('cost').value,+$('buyerShare').value);
    lines.push([r.supplier,caseData.year,r.direct_input_usd_m,r.allocated_direct_ghg_t,r.allocated_va_usd_m,s.investment,s.buyer,s.supplier].join(','));}
  return lines.join('\n')+'\n';
}
function text(id, value){$(id).textContent=value;}
function render(){
  if(!caseData)return;
  const links=selected();const sum=k=>links.reduce((acc,l)=>acc+l[k],0);
  text('flows', '$'+compact.format(sum('direct_input_usd_m'))+'m');
  text('emissions', integer.format(sum('allocated_direct_ghg_t')));
  text('valueadded', '$'+compact.format(sum('allocated_va_usd_m'))+'m');
  text('coveragePct',caseData.coverage ? (caseData.coverage.input_value_share*100).toFixed(1)+'%' : '—');
  const reduction=+$('reduction').value,cost=+$('cost').value,share=+$('buyerShare').value,threshold=+$('threshold').value;
  text('reductionOut',reduction+'%');text('costOut','$'+cost);text('buyerShareOut',share+'%');text('thresholdOut',threshold+'%');
  const scenarios=links.map(l=>scenario(l,reduction,cost,share));const investment=scenarios.reduce((a,s)=>a+s.investment,0);
  text('investment','$'+compact.format(investment)+'m');text('buyerCost','$'+compact.format(investment*share/100)+'m');
  text('supplierCost','$'+compact.format(investment*(1-share/100))+'m');
  $('buyerBar').style.width=share+'%';$('supplierBar').style.width=(100-share)+'%';
  const need=scenarios.map((s,i)=>minimumBuyerShare(links[i],s.investment,threshold));
  const above=need.filter(n=>n>share+1e-9).length;
  text('insight',above ? `${above} of ${links.length} matched links cross your diagnostic ceiling under the current buyer share. Their required buyer shares appear in the table; this is a scenario diagnostic, not observed distress.` : `Under these assumptions, all ${links.length} matched links fall below your diagnostic ceiling. This says nothing about their actual financing capacity.`);
  const top=[...links].sort((a,b)=>b.allocated_direct_ghg_t-a.allocated_direct_ghg_t).slice(0,9);
  const max=Math.max(...top.map(l=>l.allocated_direct_ghg_t),1);
  $('bars').replaceChildren(...top.map(l=>{const row=document.createElement('div');row.className='bar-row';
    const name=document.createElement('span');name.className='name';name.textContent=l.supplier;name.title=l.supplier;
    const track=document.createElement('div');track.className='track';const fill=document.createElement('div');fill.className='fill';fill.style.width=100*l.allocated_direct_ghg_t/max+'%';track.append(fill);
    const n=document.createElement('b');n.textContent=integer.format(l.allocated_direct_ghg_t);row.append(name,track,n);return row;}));
  const displayed=links.slice(0,120);
  $('rows').replaceChildren(...displayed.map((l,i)=>{const tr=document.createElement('tr');const burden=scenarios[i].supplier;
    [l.supplier,compact.format(l.direct_input_usd_m),integer.format(l.allocated_direct_ghg_t),compact.format(l.allocated_va_usd_m),compact.format(burden),l.allocated_va_usd_m ? compact.format(burden/l.allocated_va_usd_m*100)+'%' : '—',compact.format(need[i])+'%']
      .forEach(value=>{const td=document.createElement('td');td.textContent=value;tr.append(td)});return tr;}));
  const c=caseData.coverage;
  text('coverage',`Showing ${displayed.length} of ${links.length} matched links in this view (download includes all). ${caseData.unmatched_count} foreign-sector links were excluded from the full case, never counted as zero. ${c ? (c.input_value_share*100).toFixed(1)+'% of foreign intermediate-input value is covered; '+compact.format(c.unmatched_input_usd_m)+' USD million is excluded. ' : ''}The chart, scenario and totals use matched links only. Coverage is for the full buyer case, even when a supplier economy is selected.`);
}
function load(input){caseData=validate(input);$('results').hidden=false;$('country').disabled=false;$('sort').disabled=false;
  $('country').replaceChildren(new Option('All economies',''),...[...new Set(caseData.links.map(l=>l.country))].sort().map(c=>new Option(c,c)));
  text('status',`${caseData.year} · buyer ${caseData.buyer} · ${caseData.links.length} matched cross-border supplier sectors. Published OECD input accounts and production GHG; proportional allocation and finance scenarios are modelled.`);
  const sources=$('sources');sources.replaceChildren(document.createTextNode('Data sources: '));
  for (const [label,url] of [['OECD ICIO',caseData.sources.icio],['industry emissions',caseData.sources.emissions]]){
    const a=document.createElement('a');a.href=url;a.target='_blank';a.rel='noopener noreferrer';a.textContent=label;sources.append(a,document.createTextNode(' · '));}
  sources.append(document.createTextNode('See case JSON for file hashes and unmatched sectors.'));
  render();}
$('file').addEventListener('change',async e=>{try{const file=e.target.files?.[0];if(file)load(JSON.parse(await file.text()));}catch(err){text('status','Could not load case: '+err.message);$('results').hidden=true;caseData=null;}});
['country','sort','reduction','cost','buyerShare','threshold'].forEach(id=>$(id).addEventListener('input',render));
$('download').addEventListener('click',()=>{const blob=new Blob([csv(selected())],{type:'text/csv'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`supplier-links-${caseData.year}-${caseData.buyer}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});
fetch('./data/case.json').then(r=>r.ok?r.json():null).then(d=>{
  if(d)load(d);else text('status','Built-in case unavailable. Import a validated case JSON to continue.');
}).catch(err=>text('status','Built-in case could not load: '+err.message));
